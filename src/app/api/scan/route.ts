import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import {
  OSINT_MODULES,
  DIRECT_MODULE_META,
  buildProfileLinks,
  type SearchResultItem,
  type TargetType,
  type ScanEvent,
} from "@/lib/osint";
import { searchOpenWeb, relevanceFilter } from "@/lib/search-engines";
import { DIRECT_RUNS, cleanDomain } from "@/lib/osint-sources";

export const maxDuration = 180;

const VALID_TYPES: TargetType[] = ["username", "email", "phone", "name", "domain", "ip"];

// So'rovlar orasidagi pauza va parallellik — qidiruv dvigatelining rate-limit
// (429 Too Many Requests) chekloviga tushmaslik uchun.
const CONCURRENCY = 2;
const STAGGER_MS = 400;
// Ochiq dvigatellar (DuckDuckGo/Bing) scraping'da og'irroq cheklovlar qo'yadi —
// ulardan foydalanilganda ketma-ket va sekinroq so'rov yuboriladi.
const OPEN_STAGGER_MS = 2200;
const OPEN_CONCURRENCY = 1;
const QUERY_TIMEOUT_MS = 25000;
const RETRY_DELAYS_MS = [1500, 3500, 7000];

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, label = "query"): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

export async function POST(req: NextRequest) {
  let body: {
    type?: string;
    query?: string;
    modules?: string[];
    querySet?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov tanasi" }, { status: 400 });
  }

  const targetType = (body.type ?? "") as TargetType;
  const query = (body.query ?? "").trim();

  // So'rov to'plami: core — asosiy so'rovlar; deep-only — faqat chuqur
  // kengaytirilgan so'rovlar (fokus bosqichi); extended — ikkalasi (pivot skanerlar)
  const querySet =
    body.querySet === "deep-only"
      ? "deep-only"
      : body.querySet === "extended"
        ? "extended"
        : "core";
  const requestedModules = Array.isArray(body.modules)
    ? body.modules.filter((id): id is string => typeof id === "string")
    : null;

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
      // Id'lar so'rov bazasida unikal bo'lishi uchun vaqt belgisi ofseti (har skanerdan 1,2,3... boshlanmaydi)
      let logId = Date.now();

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

      let applicable = OSINT_MODULES.filter(
        (m) => m.appliesTo === "all" || m.appliesTo.includes(targetType)
      );
      if (requestedModules && requestedModules.length > 0) {
        applicable = applicable.filter((m) => requestedModules.includes(m.id));
      }
      if (querySet === "deep-only") {
        applicable = applicable.filter((m) => !!m.deepQueries);
      }

      const buildQueries = (m: (typeof OSINT_MODULES)[number]): string[] => {
        if (querySet === "deep-only") return m.deepQueries ? m.deepQueries(query) : [];
        if (querySet === "extended")
          return [...m.queries(query), ...(m.deepQueries ? m.deepQueries(query) : [])];
        return m.queries(query);
      };

      // To'g'ridan-to'g'ri manbalar (OSINT Framework uslubi): DNS, RDAP/WHOIS,
      // crt.sh, Wayback, urlscan.io, Shodan InternetDB — faqat domen/IP uchun.
      // Qidiruv dvigatellari bu ma'lumotlarni indekslamaydi — shuning uchun
      // real API'larga to'g'ridan-to'g'ri ulanamiz.
      const directPlanned =
        querySet !== "deep-only"
          ? DIRECT_MODULE_META.filter(
              (m) =>
                m.appliesTo.includes(targetType) &&
                (!requestedModules || requestedModules.length === 0 || requestedModules.includes(m.id))
            )
          : [];

      if (applicable.length === 0 && directPlanned.length === 0) {
        send({ type: "error", message: "Tanlangan modullar bo'yicha so'rov topilmadi" });
        close();
        return;
      }

      const moduleIds = [
        ...directPlanned.map((m) => m.id),
        ...applicable.map((m) => m.id),
        ...(targetType === "username" && querySet !== "deep-only" ? ["profiles"] : []),
      ];

      send({
        type: "start",
        target: query,
        targetType,
        modulesPlanned: moduleIds,
      });
      log("sys", `OSINT Radar v2.0 — skaner ishga tushirildi (${querySet.toUpperCase()})`);
      log("info", `Maqsad turi: ${targetType.toUpperCase()} — "${query}"`);
      log(
        "sys",
        `${moduleIds.length} ta modul, ${moduleIds.reduce((acc, id) => {
          if (id === "profiles") return acc + 1;
          const def = OSINT_MODULES.find((m) => m.id === id);
          return acc + (def ? buildQueries(def).length : 0);
        }, 0)} ta qidiruv so'rovi navbatga qo'yildi.`
      );
      log("sys", "Rejim: PASSIVE OSINT — faqat ochiq manbalar, tizimga ruxsatsiz kirish yo'q.");
      if (directPlanned.length > 0) {
        log(
          "sys",
          `${directPlanned.length} ta to'g'ridan-to'g'ri manba ulanadi: ${directPlanned.map((m) => m.title).join(", ")}`
        );
      }

      // Z.ai SDK faqat Z.ai muhitida ishlaydi — lokal mashinalarda mavjud emas.
      // Bo'lmasa skaner to'xtamaydi: ochiq dvigatellarga (DuckDuckGo/Bing) o'tadi.
      // SEARCH_ENGINE=open — Z.ai'ni umuman ishlatmaslik (lokal majburiy rejim)
      const enginePref = (process.env.SEARCH_ENGINE ?? "auto").toLowerCase();
      let zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
      if (enginePref !== "open") {
        try {
          zai = await ZAI.create();
          log("ok", "Z.ai qidiruv dvigateliga ulanish o'rnatildi");
        } catch {
          log(
            "warn",
            "Z.ai dvigateli mavjud emas — ochiq dvigatellar rejimi (10 ta dvigatel zanjiri)"
          );
        }
      } else {
        log("info", "SEARCH_ENGINE=open — ochiq dvigatellar rejimi (10 ta dvigatel zanjiri)");
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
        for (const qs of buildQueries(m)) {
          queue.push({
            moduleId: m.id,
            moduleTitle: m.title,
            query: qs,
            num: m.num ?? 6,
            recency: m.recency_days,
          });
        }
      }

      let lastEngineLabel = "Z.ai";
      const engineStats = new Map<string, number>();
      let openZeroStreak = 0;

      const searchOnce = async (
        queryStr: string,
        num: number,
        recency?: number
      ): Promise<SearchResultItem[]> => {
        if (zai) {
          try {
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
            lastEngineLabel = "Z.ai";
            engineStats.set("Z.ai", (engineStats.get("Z.ai") ?? 0) + 1);
            const mapped = (raw ?? [])
              .filter((r) => r && r.url)
              .map((r) => ({
                name: r.name || r.host_name || queryStr,
                url: r.url,
                snippet: r.snippet || "",
                host_name: r.host_name || new URL(r.url).hostname,
                date: r.date || undefined,
                favicon: r.favicon || undefined,
              }));
            // Ism-familiya qattiqligi Z.ai natijalariga ham qo'llanadi —
            // boshqa shaxs (faqat familiyasi mos) natijalari chiqib ketmasligi uchun
            return relevanceFilter(queryStr, mapped);
          } catch (e) {
            const msg = String(e);
            // 422 — dvigatel ushbu so'rov bo'yicha natija yo'q deb qaytardi: yuqoriga o'tkazamiz
            if (msg.includes("422") || msg.toLowerCase().includes("no search results")) throw e;
            // Boshqa xatolar (auth/tarmoq/429) — ochiq dvigatellarga zaxira o'tish
            log(
              "warn",
              "Z.ai dvigateli xato berdi — ochiq dvigatellarga o'tilmoqda (10 ta dvigatel zanjiri)..."
            );
          }
        }
        const open = await searchOpenWeb(queryStr, num);
        lastEngineLabel = open.engine;
        if (open.results.length === 0) {
          openZeroStreak++;
          if (open.errors.length > 0) {
            log(
              "warn",
              `Dvigatellar javob bermadi: ${open.errors.slice(0, 3).join("; ").slice(0, 170)}`
            );
          }
          if (openZeroStreak === 3) {
            log(
              "warn",
              "Ketma-ket 3 so'rov bo'sh — yuqoridagi «Diagnostika» tugmasini bosing yoki terminalda `npm run doctor` ishga tushiring"
            );
          }
        } else {
          openZeroStreak = 0;
          engineStats.set(
            open.engine,
            (engineStats.get(open.engine) ?? 0) + 1
          );
        }
        return open.results;
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
        doneByModule.set(m.id, { total: buildQueries(m).length, failed: 0 });
        collector.set(m.id, []);
        seenUrls.set(m.id, new Set());
      }

      let cursor = 0;
      let processed = 0;
      const TOTAL_ALL = queue.length + directPlanned.length;

      // ===== To'g'ridan-to'g'ri manbalar — hammasi parallel, 5-15s ichida =====
      const directResults = new Map<string, SearchResultItem[]>();
      const runDirect = async () => {
        if (directPlanned.length === 0) return;
        const directTarget = targetType === "domain" ? cleanDomain(query) : query;
        await Promise.allSettled(
          directPlanned.map(async (meta) => {
            let items: SearchResultItem[] = [];
            try {
              const run = DIRECT_RUNS[meta.id];
              if (run) {
                items = (await withTimeout(
                  Promise.resolve(run(directTarget)),
                  16000,
                  meta.id
                )) as SearchResultItem[];
              }
            } catch (e) {
              log("warn", `[${meta.title}] Manba javob bermadi: ${String(e).slice(0, 60)}`);
            }
            directResults.set(meta.id, items);
            if (items.length > 0) {
              log(
                "ok",
                `[${meta.title}] ✓ ${items.length} ta aniq ma'lumot topildi (to'g'ridan-to'g'ri manba)`
              );
            } else {
              log("info", `[${meta.title}] Bu manbada ma'lumot yo'q`);
            }
            processed++;
            send({ type: "progress", count: processed, total: TOTAL_ALL });
            send({
              type: "module_done",
              moduleId: meta.id,
              moduleTitle: meta.title,
              count: items.length,
              results: items,
            });
          })
        );
      };

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
              `[${job.moduleTitle}] ✓ ${added} ta yangi natija${lastEngineLabel ? ` (${lastEngineLabel})` : ""} — "${job.query.slice(0, 56)}${job.query.length > 56 ? "..." : ""}"`
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
          send({ type: "progress", count: processed, total: TOTAL_ALL });
          await sleep(zai ? STAGGER_MS : OPEN_STAGGER_MS);
        }
      };

      // module_start hodisalari — barchasi "running" holatda (to'g'ridan-to'g'ri manbalar birinchi)
      for (const m of directPlanned) {
        send({ type: "module_start", moduleId: m.id, moduleTitle: m.title });
      }
      for (const m of applicable) {
        send({ type: "module_start", moduleId: m.id, moduleTitle: m.title });
      }
      if (targetType === "username" && querySet !== "deep-only") {
        send({
          type: "module_start",
          moduleId: "profiles",
          moduleTitle: "Profil havolalari",
        });
      }

      // To'g'ridan-to'g'ri manbalar va qidiruv zanjiri parallel ishlaydi
      await Promise.all([
        runDirect(),
        Promise.all(
          Array.from(
            { length: Math.min(zai ? CONCURRENCY : OPEN_CONCURRENCY, queue.length || 1) },
            () => runNext()
          )
        ),
      ]);

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

      if (targetType === "username" && querySet !== "deep-only") {
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
      const totalResults = [...collector.values(), ...directResults.values()].reduce(
        (acc, v) => acc + v.length,
        0
      );
      if (engineStats.size > 0) {
        const dist = [...engineStats.entries()]
          .map(([e, n]) => `${e} ×${n}`)
          .join(", ");
        log("sys", `Dvigatellar taqsimoti: ${dist}`);
      }
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
