// OSINT Radar — API kalitlarini JONLI tekshirish (sozlamalar sahifasi uchun).
//
// MUAMMO: kalit noto'g'ri kiritilsa manba jimlikda bo'sh natija qaytarardi —
// foydalanuvchi "kalit buzilgan"ni "ma'lumot yo'q"dan ajrata olmasdi.
//
// YECHIM: har bir kalit uchun servisning ENGIKAM so'rovi yuboriladi (1 natija,
// 10s timeout). Natija: ok (ishlayapti) / bad (rad etildi) / limited (limit
// tugagan) / error (tarmoq — bahoga bo'lmadi). Kalit qiymati javobda
// HECH QANDAY KO'RINISHDA qaytmaydi.
//
// Eslatma: HIBP'da 404 — bu YAXSHI javob (kalit qabul qilindi, sinov emaili
// shunchaki oqishlarda yo'q). Shu kabi servis maxsus holatlari alohida ushlanadi.

export interface KeyTestResult {
  ok: boolean;
  status: "ok" | "bad" | "limited" | "error" | "missing" | "partial";
  message: string;
}

const TIMEOUT_MS = 10_000;

async function ping(
  url: string,
  init?: RequestInit
): Promise<{ http: number; body: unknown | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("json")) body = await res.json();
      else body = (await res.text()).slice(0, 300);
    } catch {
      /* body bo'lmasligi mumkin */
    }
    return { http: res.status, body };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    throw new Error(/timeout|aborted/i.test(msg) ? "timeout" : `network: ${msg.slice(0, 60)}`);
  }
}

const BAD = (http: number): KeyTestResult => ({
  ok: false,
  status: "bad",
  message: `Kalit rad etildi (HTTP ${http}) — qiymatni tekshiring: boshqatmos, bo'shliq yoki eskirgan kalit bo'lishi mumkin`,
});
const NET = (e: unknown): KeyTestResult => {
  const m = String((e as Error)?.message ?? e);
  if (m === "timeout")
    return { ok: false, status: "error", message: "Servis javob bermadi (timeout) — kalit to'g'ri bo'lishi mumkin, keyinroq qayta tekshiring" };
  return { ok: false, status: "error", message: `Tarmoq xatosi — tekshirib bo'lmadi (${m.slice(0, 70)})` };
};

export async function testKeyLive(envKey: string, value: string): Promise<KeyTestResult> {
  const key = value.trim();
  if (!key) return { ok: false, status: "missing", message: "Kalit qiymati bo'sh" };

  try {
    switch (envKey) {
      // ===== QIDIRUV DVIGATELLARI =====
      case "SERPER_API_KEY": {
        const { http } = await ping("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/json" },
          body: JSON.stringify({ q: "test", num: 1 }),
        });
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — Google natijalari ochiq" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin limit tugagan (429) — bepul kvota yangilanishini kutin" };
        return BAD(http);
      }
      case "BRAVE_API_KEY": {
        const { http } = await ping(
          "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
          { headers: { Accept: "application/json", "X-Subscription-Token": key } }
        );
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — Brave API ochiq" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin oylik limit tugagan (429)" };
        return BAD(http);
      }
      case "GOOGLE_CSE_KEY": {
        const cx = process.env.GOOGLE_CSE_CX?.trim() ?? "";
        if (!cx)
          return { ok: false, status: "partial", message: "GOOGLE_CSE_CX ham kerak — ikkala qiymatni kiriting (Search engine ID)" };
        const { http } = await ping(
          `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=test&num=1`
        );
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — Google CSE ochiq" };
        if (http === 400)
          return { ok: false, status: "bad", message: "Kalit yoki CX rad etildi (400) — ikkala qiymatni tekshiring" };
        if (http === 403)
          return { ok: false, status: "limited", message: "Kalit tanindi, lekin kunlik 100 ta bepul so'rov tugagan yoki CSE yoqilmagan (403)" };
        return BAD(http);
      }
      case "GOOGLE_CSE_CX": {
        const k = process.env.GOOGLE_CSE_KEY?.trim() ?? "";
        if (!k)
          return { ok: false, status: "partial", message: "GOOGLE_CSE_KEY ham kerak — API kalitini ham kiriting" };
        const { http } = await ping(
          `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(k)}&cx=${encodeURIComponent(key)}&q=test&num=1`
        );
        if (http === 200) return { ok: true, status: "ok", message: "CX ishlayapti — Google CSE ochiq" };
        return BAD(http);
      }
      case "TAVILY_API_KEY": {
        const { http } = await ping("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: key, query: "test", max_results: 1 }),
        });
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — Tavily AI qidiruv ochiq" };
        if (http === 432) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin limit tugagan" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin limit tugagan (429)" };
        return BAD(http);
      }

      // ===== EMAIL =====
      case "HIBP_API_KEY": {
        const { http } = await ping(
          "https://haveibeenpwned.com/api/v3/breachedaccount/test%40example.com?truncateResponse=false",
          { headers: { "hibp-api-key": key, Accept: "application/json" } }
        );
        if (http === 404)
          return { ok: true, status: "ok", message: "Kalit ishlayapti (404 = sinov manzili oqishlarda yo'q — bu normal javob)" };
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — HIBP oqish bazasi ochiq" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin so'rov limiti oshdi (429) — bir daqiqa kutib qayta tekshiring" };
        return BAD(http);
      }
      case "EMAILREP_API_KEY": {
        const { http } = await ping(`https://emailrep.io/test%40example.com?key=${encodeURIComponent(key)}`);
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — EmailRep ochiq" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin kunlik limit tugagan (429)" };
        return BAD(http);
      }
      case "HUNTER_API_KEY": {
        const { http, body } = await ping(
          `https://api.hunter.io/v2/email-verifier?email=test%40example.com&api_key=${encodeURIComponent(key)}`
        );
        if (http === 200) {
          const errors = (body as { meta?: { errors?: unknown[] } })?.meta?.errors;
          if (Array.isArray(errors) && errors.length > 0)
            return { ok: false, status: "bad", message: "Kalit rad etildi — Hunter javobida xato bor (qiymatni tekshiring)" };
          return { ok: true, status: "ok", message: "Kalit ishlayapti — Hunter.io ochiq" };
        }
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin oylik limit tugagan (429)" };
        return BAD(http);
      }

      // ===== TEXNIK =====
      case "SHODAN_API_KEY": {
        const { http, body } = await ping(`https://api.shodan.io/api-info?key=${encodeURIComponent(key)}`);
        if (http === 200) {
          const plan = (body as { plan?: string })?.plan;
          return { ok: true, status: "ok", message: `Kalit ishlayapti — Shodan ochiq${plan ? ` (reja: ${plan})` : ""}` };
        }
        return BAD(http);
      }
      case "NUMLOOKUP_API_KEY": {
        const { http } = await ping(
          `https://api.numlookupapi.com/v1/validate/%2B998901234567?apikey=${encodeURIComponent(key)}`
        );
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — NumLookup ochiq" };
        if (http === 429) return { ok: false, status: "limited", message: "Kalit to'g'ri, lekin kunlik limit tugagan (429)" };
        return BAD(http);
      }
      case "IPINFO_TOKEN": {
        const { http } = await ping(`https://ipinfo.io/8.8.8.8/json?token=${encodeURIComponent(key)}`);
        if (http === 200) return { ok: true, status: "ok", message: "Token ishlayapti — IPinfo ochiq" };
        return BAD(http);
      }
      case "OTX_API_KEY": {
        const { http } = await ping("https://otx.alienvault.com/api/v1/indicators/domain/google.com/general", {
          headers: { "X-OTX-API-KEY": key, Accept: "application/json" },
        });
        if (http === 200) return { ok: true, status: "ok", message: "Kalit ishlayapti — AlienVault OTX ochiq" };
        if (http === 400) return { ok: false, status: "bad", message: "Kalit rad etildi (400) — OTX kaliti formatini tekshiring" };
        return BAD(http);
      }

      // ===== TELEGRAM =====
      case "TELEGRAM_BOT_TOKEN": {
        const { http, body } = await ping(`https://api.telegram.org/bot${encodeURIComponent(key)}/getMe`);
        if (http === 200) {
          const okFlag = (body as { ok?: boolean })?.ok === true;
          const uname = (body as { result?: { username?: string } })?.result?.username;
          if (okFlag)
            return { ok: true, status: "ok", message: `Bot tokeni ishlayapti${uname ? ` (@${uname})` : ""}` };
          return { ok: false, status: "bad", message: "Token rad etildi — Telegram ok:false qaytardi, qiymatni tekshiring" };
        }
        if (http === 401) return BAD(401);
        return BAD(http);
      }

      default:
        return { ok: false, status: "missing", message: `Noma'lum kalit: ${envKey}` };
    }
  } catch (e) {
    return NET(e);
  }
}
