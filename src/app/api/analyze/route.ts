import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { TARGET_TYPES } from "@/lib/osint";

export const maxDuration = 180;

interface FindingItem {
  name: string;
  url: string;
  snippet: string;
}

interface FindingModule {
  moduleTitle: string;
  results: FindingItem[];
}

const SYSTEM_PROMPT = `Sen tajribali, halol OSINT (Open Source Intelligence) tahlilchisan.
Senga bir maqsad bo'yicha avtomatik skaner topilgan OCHIQ manba natijalari beriladi.
Vazifa — faqat berilgan natijalar ASOSIDA o'zbek tilida tahlil yozish.

Qoidalar:
- FAQAT berilgan natijalarga tayan; o'ylab topilgan faktlarni kiritma. Agar ma'lumot yo'q bo'lsa, "topilmadi" deb ochiq yoz.
- Hech qanday shaxsiy ma'lumotni (telefon, uy manzili, hujjat raqami) o'zing takrorlama va tarqatma — faqat umumiy xulosa ber.
- Javobni markdown formatda yoz: ## sarlavhalar, - ro'yxatlar, **qalin**.
- Tuzilma: "## Umumiy xulosa", "## Asosiy topilmalar" (modullar bo'yicha qisqa), "## Ochiqlik darajasi" (Past/O'rta/Yuqori va nega), "## Raqamli gigiyena bo'yicha tavsiyalar", "## Etik eslatma" (bu tahlil faqat o'quv maqsadida, ochiq manbalargagina asoslangan).
- Gaplar aniq, mutaxassislar tilida, lekin tushunarli bo'lsin. Javob 350-500 so'z orasida.`;

const QA_PROMPT = `Sen OSINT tahlilchisan. Foydalanuvchi skaner natijalari haqida savol berdi.
FAQAT berilgan natijalarga tayanib, o'zbek tilida, 120-250 so'zlik aniq javob yoz.
Agar javob natijalar ichida bo'lmasa — "Topilgan manbalarda bu savolga javob yo'q" deb yoz va nima uchunini tushuntir.
Kerak bo'lsa markdown ishlat (- ro'yxat, **qalin**).`;

const HARD_TIMEOUT_MS = 90000;

// AI mavjud bo'lmaganda lokal statistik xulosa — skaner natijalaridan avtomatik tayyorlanadi
function buildLocalSummary(
  query: string,
  typeLabel: string,
  modules: FindingModule[],
  isQuestion: boolean
): string {
  const nonEmpty = modules.filter((m) => m.results?.length > 0);
  const total = nonEmpty.reduce((a, m) => a + m.results.length, 0);

  const domainCount = new Map<string, number>();
  for (const m of nonEmpty) {
    for (const r of m.results) {
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, "");
        domainCount.set(h, (domainCount.get(h) ?? 0) + 1);
      } catch {
        /* noto'g'ri url */
      }
    }
  }
  const topDomains = [...domainCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const lines: string[] = [
    "> ⚠️ **AI xizmatiga hozir ulanib bo'lmadi** — quyida skaner natijalari asosida avtomatik lokal xulosa keltirildi. AI tahlilni keyinroq qayta urinib ko'ring.",
    "",
    "## Umumiy xulosa",
    "",
    `"${query}" (${typeLabel}) bo'yicha skaner **${nonEmpty.length} ta modul** bo'yicha ochiq manbalarda qidiruv o'tkazdi va **${total} ta topilma** yig'di.`,
    isQuestion
      ? "Savolingizga to'liq javob berish uchun AI kerak — hozir faqat topilmalarning tuzilgan ko'rinishi beriladi."
      : "Bu topilmalar maqsadning ochiq tarmoqlardagi ko'rinish darajasini aks ettiradi.",
    "",
    "## Asosiy topilmalar",
    "",
  ];

  for (const m of nonEmpty.slice(0, 6)) {
    lines.push(`**${m.moduleTitle}** — ${m.results.length} ta natija:`);
    for (const r of m.results.slice(0, 3)) {
      const host = (() => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      lines.push(`- [${(r.name || host).slice(0, 90)}](${r.url})${host ? ` — ${host}` : ""}`);
    }
    lines.push("");
  }

  if (topDomains.length > 0) {
    lines.push("## Eng faol manbalar", "");
    for (const [dom, cnt] of topDomains) {
      lines.push(`- ${dom} — ${cnt} ta topilma`);
    }
    lines.push("");
  }

  lines.push(
    "## Tavsiyalar",
    "",
    "- Topilmalarni ko'zdan kechirib, keraklilarini «Saqlash» tugmasi bilan bookmark'ga qo'shing.",
    "- Har bir kartadagi «+» tugmasi orqali istalgan iz bo'yicha chuqur qidiruvni ishga tushirishingiz mumkin.",
    "- AI xulosa tugmasini keyinroq yana bosing — xizmat tiklanganda to'liq AI tahlil tayyor bo'ladi.",
    "",
    "## Etik eslatma",
    "",
    "Barcha topilmalar faqat ochiq (public) manbalardan olingan; tahlil o'quv maqsadida."
  );

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  let body: {
    query?: string;
    type?: string;
    question?: string;
    modules?: FindingModule[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  const question = (body.question ?? "").trim();
  const typeLabel =
    TARGET_TYPES.find((t) => t.value === body.type)?.label ?? body.type ?? "maqsad";
  const modules = Array.isArray(body.modules) ? body.modules : [];

  if (!query || modules.length === 0) {
    return Response.json(
      { error: "Tahlil uchun avval skaner natijalari kerak" },
      { status: 400 }
    );
  }

  // Har moduldan ko'pi bilan 4 ta natija, snippet 220 belgiga qisqartiriladi
  const compact = modules
    .filter((m) => m.results?.length > 0)
    .map((m) => ({
      module: m.moduleTitle,
      items: m.results.slice(0, 4).map((r) => ({
        sarlavha: (r.name || "").slice(0, 140),
        manzil: (r.url || "").slice(0, 200),
        qisqa: (r.snippet || "").slice(0, 220),
      })),
    }));

  const userContent = [
    `MAQSAD: ${query} (turi: ${typeLabel})`,
    question ? `FOYDALANUVCHI SAVOLI: ${question}` : "",
    "SKANER NATIJALARI (JSON):",
    JSON.stringify(compact, null, 1),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: question ? QA_PROMPT : SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
      stream: true,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const push = (text: string) => {
          if (closed || !text) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };
        const close = () => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* noop */
            }
          }
        };
        req.signal.addEventListener("abort", close);

        // SDK oqimi xom SSE baytlari ko'rinishida keladi:
        // "data: {\"choices\":[{\"delta\":{\"content\":\"...\"}}]}\n\n"
        const byteDecoder = new TextDecoder();
        let sseBuf = "";
        let anyText = false;

        const extractDelta = (obj: unknown): string => {
          const o = obj as {
            choices?: { delta?: { content?: string }; message?: { content?: string }; text?: string }[];
            delta?: { content?: string };
            content?: string;
          };
          return (
            o?.choices?.[0]?.delta?.content ||
            o?.choices?.[0]?.message?.content ||
            o?.choices?.[0]?.text ||
            o?.delta?.content ||
            o?.content ||
            ""
          );
        };

        const chunkToText = (chunk: unknown): string => {
          let raw = "";
          if (typeof chunk === "string") {
            raw = chunk;
          } else if (chunk instanceof Uint8Array) {
            raw = byteDecoder.decode(chunk, { stream: true });
          } else if (Array.isArray(chunk)) {
            raw = byteDecoder.decode(Uint8Array.from(chunk as number[]), { stream: true });
          } else if (chunk && typeof chunk === "object") {
            const asAny = chunk as Record<string, unknown>;
            // {0:104,1:112,...} ko'rinishidagi array-like bayt obyektlar
            const keys = Object.keys(asAny);
            if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
              raw = byteDecoder.decode(
                Uint8Array.from(keys.sort((a, b) => Number(a) - Number(b)).map((k) => Number(asAny[k]))),
                { stream: true }
              );
            } else {
              // parse qilingan chunk obyekt
              return extractDelta(chunk);
            }
          }
          if (!raw) return "";

          sseBuf += raw;
          let out = "";
          const lines = sseBuf.split("\n");
          sseBuf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              out += extractDelta(JSON.parse(payload));
            } catch {
              /* to'liq bo'lmagan qator */
            }
          }
          return out;
        };

        const hardTimer = setTimeout(close, HARD_TIMEOUT_MS);

        try {
          for await (const chunk of completion as AsyncIterable<unknown>) {
            if (closed) break;
            const text = chunkToText(chunk);
            if (text) {
              anyText = true;
              push(text);
            }
          }
        } catch {
          /* iterator yopilishi */
        }
        clearTimeout(hardTimer);

        if (!anyText && !closed) {
          push("[AI javob qaytarmadi — qayta urinib ko'ring]");
        }
        close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch {
    // AI mavjud emas (lokal mashinada SDK kredensiali yo'q) — 502 o'rniga
    // lokal statistik xulosa stream qilinadi, UI xatosiz ko'rsatadi.
    const summary = buildLocalSummary(query, typeLabel, modules, !!question);
    return new Response(summary, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }
}
