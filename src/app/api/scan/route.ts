import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import {
  OSINT_MODULES,
  buildProfileLinks,
  type SearchResultItem,
  type TargetType,
  type ScanEvent,
} from "@/lib/osint";

export const maxDuration = 180;

const VALID_TYPES: TargetType[] = ["username", "email", "phone", "name", "domain", "ip"];

// So'rovlar orasidagi pauza va parallellik — qidiruv dvigatelining rate-limit
// (429 Too Many Requests) chekloviga tushmaslik uchun.
const CONCURRENCY = 2;
const STAGGER_MS = 400;
const QUERY_TIMEOUT_MS = 25000;
const RETRY_DELAYS_MS = [1500, 3500, 7000];

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, label = "query"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

export async function POST(req: NextRequest) {
  let body: { type?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov tanasi" }, { status: 400 });
  }

  const targetType = (body.type ?? "") as TargetType;
  const query = (body.query ?? "").trim();

  if (!VALID_TYPES.includes(targetType) || query.length < 2) {
    return Response.json(
      { error: "Maqsad turini va kamida 2 belgili maqsadni kiriting" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let logId = 0;

      const send = (ev: ScanEvent) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          closed = true;
        }
      };

      const log = (
        level: "info" | "ok" | "warn" | "error" | "sys",
        message: string,
        module?: string
      ) => {
        send({
          type: "log",
          log: { id: ++logId, time: nowTime(), level, message, module },
        });
      };

      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      req.signal.addEventListener("abort", close);

      const startedAt = Date.now();

      const applicable = OSINT_MODULES.filter(
        (m) => m.appliesTo === "all" || m.appliesTo.includes(targetType)
      );
      const moduleIds = [
        ...applicable.map((m) => m.id),
        ...(targetType === "username" ? ["profiles"] : []),
      ];

      send({
        type: "start",
        target: query,
        targetType,
        modulesPlanned: moduleIds,
      });
      log("sys", "OSINT Radar v1.0 — skaner ishga tushirildi");
      log("info", `Maqsad turi: ${targetType.toUpperCase()} — "${query}"`);
      log(
        "sys",
        `${moduleIds.length} ta modul, ${moduleIds.reduce((acc, id) => {
          const def = OSINT_MODULES.find((m) => m.id === id);
          return acc + (def ? def.queries(query).length : 0);
        }, 0)} ta qidiruv so'rovi navbatga qo'yildi.`
      );
      log("sys", "Rejim: PASSIVE OSINT — faqat ochiq manbalar, tizimga ruxsatsiz kirish yo'q.");

      let zai: Awaited<ReturnType<typeof ZAI.create>>;
      try {
        zai = await ZAI.create();
        log("ok", "Qidiruv dvigateliga ulanish o'rnatildi");
      } catch {
        log("error", "Qidiruv dvigateliga ulanib bo'lmadi. Keyinroq urinib ko'ring.");
        send({ type: "error", message: "Dvigatelga ulanish xatosi" });
        close();
        return;
      }

      // Global so'rov navbati
      const queue: {
        moduleId: string;
        moduleTitle: string;
        query: string;
        num: number;
        recency?: number;
      }[] = [];
      for (const m of applicable) {
        for (const qs of m.queries(query)) {
          queue.push({
            moduleId: m.id,
            moduleTitle: m.title,
            query: qs,
            num: m.num ?? 6,
            recency: m.recency_days,
          });
        }
      }

      const searchOnce = async (
        queryStr: string,
        num: number,
        recency?: number
      ): Promise<SearchResultItem[]> => {
        const args: { query: string; num: number; recency_days?: number } = {
          query: queryStr,
          num,
        };
        if (recency) args.recency_days = recency;
        const raw = await withTimeout(
          zai.functions.invoke("web_search", args),
          QUERY_TIMEOUT_MS,
          "web_search"
        );
        return (raw ?? [])
          .filter((r) => r && r.url)
          .map((r) => ({
            name: r.name || r.host_name || queryStr,
            url: r.url,
            snippet: r.snippet || "",
            host_name: r.host_name || new URL(r.url).hostname,
            date: r.date || undefined,
            favicon: r.favicon || undefined,
          }));
      };

      const searchWithRetry = async (
        queryStr: string,
        num: number,
        recency?: number
      ): Promise<SearchResultItem[]> => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
          try {
            return await searchOnce(queryStr, num, recency);
          } catch (e) {
            lastErr = e;
            const msg = String(e);
            if (msg.includes("429") || msg.toLowerCase().includes("too many")) {
              if (attempt < RETRY_DELAYS_MS.length) {
                const delay = RETRY_DELAYS_MS[attempt];
                log("warn", `Rate-limit (429) — ${delay / 1000}s dan keyin qayta uriniladi...`);
                await sleep(delay);
                continue;
              }
            }
            throw e;
          }
        }
        throw lastErr;
      };

      const collector = new Map<string, SearchResultItem[]>();
      const seenUrls = new Map<string, Set<string>>();
      const doneByModule = new Map<string, { total: number; failed: number }>();
      for (const m of applicable) {
        doneByModule.set(m.id, { total: m.queries(query).length, failed: 0 });
        collector.set(m.id, []);
        seenUrls.set(m.id, new Set());
      }

      let cursor = 0;
      let processed = 0;
      const runNext = async () => {
        while (cursor < queue.length && !closed && !req.signal.aborted) {
          const job = queue[cursor++];
          try {
            const results = await searchWithRetry(job.query, job.num, job.recency);
            const seen = seenUrls.get(job.moduleId)!;
            const arr = collector.get(job.moduleId)!;
            let added = 0;
            for (const r of results) {
              const key = r.url.replace(/[#?].*$/, "").toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              arr.push(r);
              added++;
            }
            log(
              "ok",
              `[${job.moduleTitle}] ✓ ${added} ta yangi natija — "${job.query.slice(0, 56)}${job.query.length > 56 ? "..." : ""}"`
            );
          } catch (e) {
            const st = doneByModule.get(job.moduleId);
            const msg = String(e);
            if (msg.includes("422") || msg.includes("No search results")) {
              // Dvigatel ushbu so'rov bo'yicha natija topilmadi — bu xato emas
              log(
                "info",
                `[${job.moduleTitle}] natija topilmadi — "${job.query.slice(0, 56)}${job.query.length > 56 ? "..." : ""}"`
              );
            } else {
              if (st) st.failed++;
              log(
                "warn",
                `[${job.moduleTitle}] So'rov bajarilmadi: ${msg.slice(0, 70)}`
              );
            }
          }
          processed++;
          send({ type: "progress", count: processed, total: queue.length });
          await sleep(STAGGER_MS);
        }
      };

      // module_start hodisalari — barchasi "running" holatda
      for (const m of applicable) {
        send({ type: "module_start", moduleId: m.id, moduleTitle: m.title });
      }
      if (targetType === "username") {
        send({
          type: "module_start",
          moduleId: "profiles",
          moduleTitle: "Profil havolalari",
        });
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, () => runNext())
      );

      // Yakuniy module_done hodisalari
      for (const m of applicable) {
        const arr = collector.get(m.id)!;
        const st = doneByModule.get(m.id)!;
        if (st.failed > 0 && arr.length === 0) {
          log("error", `[${m.title}] Barcha so'rovlar bajarilmadi (rate-limit yoki tarmoq).`);
        }
        log("ok", `[${m.title}] Yakunlandi — ${arr.length} ta natija`);
        send({
          type: "module_done",
          moduleId: m.id,
          moduleTitle: m.title,
          count: arr.length,
          results: arr,
        });
      }

      if (targetType === "username") {
        log("info", "[Profil havolalari] 12 ta platforma uchun to'g'ridan-to'g'ri havolalar tayyorlanmoqda...");
        const links = buildProfileLinks(query);
        log("ok", `[Profil havolalari] ${links.length} ta havola tayyor`);
        send({
          type: "module_done",
          moduleId: "profiles",
          moduleTitle: "Profil havolalari",
          count: links.length,
          results: links,
        });
      }

      const elapsedMs = Date.now() - startedAt;
      const totalResults = [...collector.values()].reduce((acc, v) => acc + v.length, 0);
      log("sys", `Skaner yakunlandi — ${totalResults} ta topilma, ${(elapsedMs / 1000).toFixed(1)}s`);
      log("sys", 'Endi "AI xulosa chiqarish" tugmasi bilan AI tahlilni so\'rashingiz mumkin.');
      send({ type: "done", totalResults, elapsedMs });
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
