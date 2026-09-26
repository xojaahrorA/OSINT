import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const maxDuration = 120;

interface InputItem {
  id: string;
  title: string;
  snippet: string;
  url: string;
  moduleTitle: string;
}

const SYSTEM_PROMPT = `Sen tajribali OSINT tahlilchisan. Senga foydalanuvchining qidiruv maqsadi va ochiq manbalardan topilgan natijalar ro'yxati beriladi.
Vazifa: har bir natijani MAQSAD bilan solishtirish va qolgan natijalar bilan mos kelishini baholash.

Verdictlar:
- "related": natija maqsad bilan aniq bog'liq — bir xil shaxs, organizatsiya, telefon, doman yoki username haqida.
- "unsure": bog'liqligi aniq emas — ism/username o'xshaydi lekin bir xil obyekt ekanligi isbotlanmagan, yoki ma'lumot juda kam.
- "unrelated": natija boshqa shaxs/obyekt/mavzu haqida — maqsadga tegishli emas (masalan, boshqa shaxsning xuddi shu ismdagi profili, maqsad bilan aloqasi yo'q yangilik).

Qoidalar:
- Faqat natijadagi faktlarga tayan; o'ylab topma.
- Bir xil ism-familiya yetarli emas — kasb, shahar, doman, username kabi qo'shimcha mosliklarni qidiring.
- Har bir natija uchun 3-6 so'zlik qisqa sabab yozing (o'zbek tilida).

Faqat quyidagi JSON massivini qaytar, hech qanday izoh yoki markdown belgisiz:
[{"i":"<natija id si>","v":"related|unsure|unrelated","r":"qisqa sabab"}]`;

const HARD_TIMEOUT_MS = 90000;

/** SSE bayt oqimidan matn ajratib oluvchi yordamchi (analyze route bilan bir xil mantiq) */
function makeStreamParser() {
  const byteDecoder = new TextDecoder();
  let sseBuf = "";
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
  return (chunk: unknown): string => {
    let raw = "";
    if (typeof chunk === "string") {
      raw = chunk;
    } else if (chunk instanceof Uint8Array) {
      raw = byteDecoder.decode(chunk, { stream: true });
    } else if (Array.isArray(chunk)) {
      raw = byteDecoder.decode(Uint8Array.from(chunk as number[]), { stream: true });
    } else if (chunk && typeof chunk === "object") {
      const asAny = chunk as Record<string, unknown>;
      const keys = Object.keys(asAny);
      if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
        raw = byteDecoder.decode(
          Uint8Array.from(keys.sort((a, b) => Number(a) - Number(b)).map((k) => Number(asAny[k]))),
          { stream: true }
        );
      } else {
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
}

export async function POST(req: NextRequest) {
  let body: { query?: string; type?: string; results?: InputItem[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  const results = Array.isArray(body.results) ? body.results.slice(0, 40) : [];

  if (!query || results.length === 0) {
    return Response.json({ verdicts: [] });
  }

  const list = results
    .map(
      (r, i) =>
        `${i + 1}. id=${r.id} | (${r.moduleTitle}) ${r.title.slice(0, 120)} | ${r.url.slice(0, 150)} | ${r.snippet.slice(0, 180)}`
    )
    .join("\n");

  const userContent = `MAQSAD (${body.type ?? "noma'lum"}): "${query}"\n\nNATIJALAR:\n${list}`;

  try {
    const zai = await ZAI.create();

    // 429 rate-limit uchun retry (scan route mantiqiga o'xshash)
    type CompletionResult = Awaited<ReturnType<typeof zai.chat.completions.create>>;
    const RETRY_DELAYS_MS = [5000, 15000, 30000];
    let completion: CompletionResult | null = null;
    let lastErr: unknown = null;
    const createCall = () =>
      zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        thinking: { type: "disabled" },
        stream: true,
      });

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        completion = await createCall();
        break;
      } catch (e) {
        lastErr = e;
        const msg = String(e);
        if ((msg.includes("429") || msg.toLowerCase().includes("too many")) && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    if (!completion) throw lastErr ?? new Error("AI chaqiruvi bajarilmadi");

    const parse = makeStreamParser();
    let content = "";

    const iterate = async () => {
      for await (const chunk of completion as AsyncIterable<unknown>) {
        content += parse(chunk);
        if (content.length > 20000) break;
      }
    };
    // Oqim osilib qolsa ham maksimal HARD_TIMEOUT_MS kutamiz
    await Promise.race([
      iterate().catch(() => {}),
      new Promise((r) => setTimeout(r, HARD_TIMEOUT_MS)),
    ]);

    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start === -1 || end <= start) {
      return Response.json({ verdicts: [], warning: "AI javobi tahlil qilinmadi" });
    }
    const jsonText = content.slice(start, end + 1);
    const parsed = JSON.parse(jsonText) as { i?: string; v?: string; r?: string }[];
    const valid = new Set(["related", "unsure", "unrelated"]);
    const verdicts = parsed
      .filter((v) => v.i && valid.has(v.v ?? ""))
      .map((v) => ({
        id: String(v.i),
        verdict: v.v as "related" | "unsure" | "unrelated",
        reason: String(v.r ?? "").slice(0, 90),
      }));
    return Response.json({ verdicts });
  } catch (e) {
    return Response.json(
      { verdicts: [], error: String((e as Error)?.message ?? e).slice(0, 140) },
      { status: 200 }
    );
  }
}
