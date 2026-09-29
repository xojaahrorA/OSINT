// OSINT Radar — PREMIUM manbalar qatlami (API kalitli, OSINT Framework'dagi pullik/bepul xizmatlar)
// Foydalanuvchi kalitni .env faylga yozadi — shu zahoti manba skanerga qo'shiladi.
// Kalit yo'q bo'lsa manba jimgina o'tkazib yuboriladi (skaner hech qachon to'xtamaydi),
// diagnostika esa qaysi kalitlar yoqilgani va qayerdan olishni ko'rsatadi.
//
// Kalitli qidiruv dvigatellari (Serper = Google natijalari, Brave API, Google CSE,
// Tavily) HTML scraping'ga qaraganda ancha ishonchli: 403/429/captcha bo'lmaydi —
// shuning uchun ochiq HTML dvigatellar doim bloklanib turadigan muhitlarda ular
// asosiy kuch bo'lib xizmat qiladi.

import type { SearchResultItem, TargetType } from "@/lib/osint";

const ALL: TargetType[] = ["username", "email", "phone", "name", "domain", "ip"];

// ===== Yordamchilar =====

function keyOf(envName: string): string | null {
  const v = process.env[envName];
  return v && v.trim().length > 0 ? v.trim() : null;
}

/** Xato sifatida tashlanmaydi — kalit yoki tarmoq muammosida bo'sh ro'yxat qaytadi */
const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

async function jsonFetch<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T | null> {
  const { timeoutMs = 12_000, ...rest } = init ?? {};
  try {
    const res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Premium javobdagi element — `via` manba nomini snippet boshiga yozadi */
const mk = (name: string, url: string, snippet: string, host: string): SearchResultItem => ({
  name,
  url,
  snippet,
  host_name: host,
});

// ===== Premium manbalar metaslari (diagnostika + README uchun) =====

export interface PremiumMeta {
  id: string;
  title: string;
  envKey: string;
  envKey2?: string;
  appliesTo: TargetType[];
  what: string;
  getKeyUrl: string;
  free: string;
}

export const PREMIUM_SOURCES: PremiumMeta[] = [
  {
    id: "serper",
    title: "Google (Serper)",
    envKey: "SERPER_API_KEY",
    appliesTo: ALL,
    what: "Google qidiruv natijalari + Knowledge Graph — eng aniq topilma, bloklanish yo'q",
    getKeyUrl: "https://serper.dev",
    free: "Ro'yxatdan o'tgach 2500 so'rov bepul",
  },
  {
    id: "brave-api",
    title: "Brave Search API",
    envKey: "BRAVE_API_KEY",
    appliesTo: ALL,
    what: "Brave rasmiy qidiruv API — HTML blok/rate-limit (429) umuman boshqacha, kvota bilan",
    getKeyUrl: "https://api-dashboard.search.brave.com/register",
    free: "Oyiga 2000 so'rov bepul",
  },
  {
    id: "google-cse",
    title: "Google Programmable Search",
    envKey: "GOOGLE_CSE_KEY",
    envKey2: "GOOGLE_CSE_CX",
    appliesTo: ALL,
    what: "Google rasmiy CSE API — 2 ta kalit kerak (API key + Search Engine ID)",
    getKeyUrl: "https://programmablesearchengine.google.com",
    free: "Kuniga 100 so'rov bepul",
  },
  {
    id: "tavily",
    title: "Tavily AI qidiruv",
    envKey: "TAVILY_API_KEY",
    appliesTo: ALL,
    what: "AI-optimallashtirilgan qidiruv — shaxs/username izlashda sifatli natija",
    getKeyUrl: "https://app.tavily.com",
    free: "Oyiga 1000 so'rov bepul",
  },
  {
    id: "hibp",
    title: "Oqishlar (Have I Been Pwned)",
    envKey: "HIBP_API_KEY",
    appliesTo: ["email"],
    what: "Email qaysi ommaviy oqishlarda: sana, manba, oshkor bo'lgan maydonlar (eng aniq baza)",
    getKeyUrl: "https://haveibeenpwned.com/API/Key",
    free: "≈$3.50/oy — eng arzon pullik manba",
  },
  {
    id: "hunter",
    title: "Hunter.io",
    envKey: "HUNTER_API_KEY",
    appliesTo: ["email", "domain"],
    what: "Email tasdiqlash + domen bo'yicha xodimlar email/ism-familiyalarini topish",
    getKeyUrl: "https://hunter.io/api-keys",
    free: "Oyiga 25 qidiruv bepul",
  },
  {
    id: "shodan",
    title: "Shodan to'liq API",
    envKey: "SHODAN_API_KEY",
    appliesTo: ["ip", "domain"],
    what: "Ochiq portlar, service bannerlari, tarixiy ma'lumotlar (InternetDB'dan ancha chuqur)",
    getKeyUrl: "https://account.shodan.io/register",
    free: "Bepul hisob yetarli (kunlik limit bilan)",
  },
  {
    id: "numlookup",
    title: "NumLookup",
    envKey: "NUMLOOKUP_API_KEY",
    appliesTo: ["phone"],
    what: "Raqam holati, operator, liniya turi (mobil/qotirilgan/VoIP) — xalqaro baza",
    getKeyUrl: "https://app.numlookupapi.com/register",
    free: "Kuniga 100 so'rov bepul",
  },
  {
    id: "ipinfo",
    title: "IPinfo",
    envKey: "IPINFO_TOKEN",
    appliesTo: ["ip"],
    what: "Aniq geolokatsiya, ISP/ASN, VPN/proxy/Tor aniqlash (privacy detection)",
    getKeyUrl: "https://ipinfo.io/signup",
    free: "Oyiga 50 000 so'rov bepul",
  },
  {
    id: "telegram-bot",
    title: "Telegram Bot API",
    envKey: "TELEGRAM_BOT_TOKEN",
    appliesTo: ["username"],
    what: "Telegram'ning rasmiy API'si: profil/kanal ANIQ ma'lumoti — chat id, turi, bio, obunachilar soni (getChat + getChatMemberCount)",
    getKeyUrl: "https://t.me/BotFather",
    free: "Mutlaqo bepul — @BotFather'da bot yarating (/newbot), tokenni shu yerga yozing",
  },
  {
    id: "otx",
    title: "AlienVault OTX",
    envKey: "OTX_API_KEY",
    appliesTo: ["domain", "ip"],
    what: "Maltego uslubidagi transform: passiv DNS (tarixiy hostlar), URL arxivi, bog'liq infratuzilma — domen/IP atrofidagi butun tarmoq",
    getKeyUrl: "https://otx.alienvault.com",
    free: "Bepul hisob yetarli (kunlik limit bilan) — ro'yxatdan o'tib API key oling",
  },
];

export function premiumKeySet(id: string): boolean {
  const m = PREMIUM_SOURCES.find((s) => s.id === id);
  if (!m) return false;
  if (!keyOf(m.envKey)) return false;
  if (m.envKey2 && !keyOf(m.envKey2)) return false;
  return true;
}

/** Premium manba kaliti yo'qmi — skaner route'i o'tkazib yuborish uchun ishlatadi.
 *  Premium EMAS manbalar (mis. phone-meta) hech qachon "yo'q" hisoblanmaydi. */
export function premiumKeyMissing(id: string): boolean {
  const m = PREMIUM_SOURCES.find((s) => s.id === id);
  if (!m) return false;
  if (!keyOf(m.envKey)) return true;
  if (m.envKey2 && !keyOf(m.envKey2)) return true;
  return false;
}

/** id bo'yicha premium manba metasi */
export function premiumFind(id: string): PremiumMeta | undefined {
  return PREMIUM_SOURCES.find((s) => s.id === id);
}

/** Kaliti yo'q premium manbalar ro'yxati — diagnostika va skaner logi uchun */
export function premiumMissing(): PremiumMeta[] {
  return PREMIUM_SOURCES.filter((s) => !premiumKeySet(s.id));
}

/** Skaner logi uchun: kalitni qayerdan olish ko'rsatmasi */
export function premiumHint(m: PremiumMeta): string {
  const pair = m.envKey2 ? ` + ${m.envKey2}` : "";
  return `${m.envKey}${pair} yo'q — bepul kalit: ${m.getKeyUrl} (${m.free})`;
}

// ===== 1. Serper — Google qidiruv (eng sifatli manba) =====

interface SerperResp {
  organic?: { title: string; link: string; snippet?: string }[];
  knowledgeGraph?: { title?: string; type?: string; description?: string; website?: string };
  answerBox?: { title?: string; answer?: string; snippet?: string; link?: string };
}

export async function serperSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("serper")) return [];
  const key = keyOf("SERPER_API_KEY")!;
  const data = await safe(
    (async () => {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: target, num: 10 }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SerperResp;
    })()
  );
  if (!data) return [];
  const out: SearchResultItem[] = [];

  // Knowledge Graph — ism-familiya bo'yicha aynan shu eng aniq javobni beradi
  const kg = data.knowledgeGraph;
  if (kg?.title) {
    out.push(
      mk(
        `Google Knowledge Graph: ${kg.title}${kg.type ? ` (${kg.type})` : ""}`,
        kg.website ?? `https://www.google.com/search?q=${encodeURIComponent(target)}`,
        kg.description ?? "Google'ning rasmiy ma'lumotnoma javobi",
        "google.serper.dev"
      )
    );
  }
  const ab = data.answerBox;
  if (ab?.answer || ab?.snippet) {
    out.push(
      mk(
        ab.title ?? `Google javob qutisi: ${target}`,
        ab.link ?? `https://www.google.com/search?q=${encodeURIComponent(target)}`,
        ab.answer ?? ab.snippet ?? "",
        "google.serper.dev"
      )
    );
  }
  for (const o of data.organic ?? []) {
    if (!o.link) continue;
    let host = "google.com";
    try {
      host = new URL(o.link).hostname.replace(/^www\./, "");
    } catch {
      /* standart host */
    }
    out.push(mk(o.title || host, o.link, o.snippet ?? "", host));
  }
  return out;
}

// ===== 2. Brave Search rasmiy API =====

interface BraveApiResp {
  web?: { results: { title: string; url: string; description?: string }[] };
}

export async function braveApiSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("brave-api")) return [];
  const key = keyOf("BRAVE_API_KEY")!;
  const data = await jsonFetch<BraveApiResp>(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(target)}&count=10`,
    { headers: { Accept: "application/json", "X-Subscription-Token": key } }
  );
  const out: SearchResultItem[] = [];
  for (const r of data?.web?.results ?? []) {
    if (!r.url) continue;
    let host = "brave.com";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      /* standart host */
    }
    // description HTML teglarini tozalash (Brave <strong> qo'yadi)
    const clean = (r.description ?? "").replace(/<[^>]+>/g, "");
    out.push(mk(r.title || host, r.url, clean, host));
  }
  return out;
}

// ===== 3. Google Programmable Search (CSE) =====

interface CseResp {
  items?: { title: string; link: string; snippet?: string }[];
}

export async function googleCseSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("google-cse")) return [];
  const key = keyOf("GOOGLE_CSE_KEY")!;
  const cx = keyOf("GOOGLE_CSE_CX")!;
  const data = await jsonFetch<CseResp>(
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(target)}&num=10`
  );
  const out: SearchResultItem[] = [];
  for (const r of data?.items ?? []) {
    if (!r.link) continue;
    let host = "google.com";
    try {
      host = new URL(r.link).hostname.replace(/^www\./, "");
    } catch {
      /* standart host */
    }
    out.push(mk(r.title || host, r.link, r.snippet ?? "", host));
  }
  return out;
}

// ===== 4. Tavily AI qidiruv =====

interface TavilyResp {
  results?: { title: string; url: string; content?: string }[];
}

export async function tavilySource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("tavily")) return [];
  const key = keyOf("TAVILY_API_KEY")!;
  const data = await jsonFetch<TavilyResp>("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query: target, max_results: 8 }),
  });
  const out: SearchResultItem[] = [];
  for (const r of data?.results ?? []) {
    if (!r.url) continue;
    let host = "tavily.com";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      /* standart host */
    }
    out.push(mk(r.title || host, r.url, r.content ?? "", host));
  }
  return out;
}

// ===== 5. Have I Been Pwned — email oqishlari (eng aniq baza) =====

interface HibpBreach {
  Name: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  PwnCount?: number;
  DataClasses?: string[];
  IsVerified?: boolean;
}

export async function hibpSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("hibp")) return [];
  const email = target.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return [];
  const key = keyOf("HIBP_API_KEY")!;
  const res = await safe(
    (async () => {
      const r = await fetch(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
        { headers: { "hibp-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
      );
      // 404 — bu email hech qanday oqishda yo'q: bu ham FOYDALI javob
      if (r.status === 404) return [] as HibpBreach[];
      if (!res_ok(r)) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as HibpBreach[];
    })()
  );
  if (res === null) return []; // kalit xato / tarmoq — jimgina o'tamiz
  if (res.length === 0) {
    return [
      mk(
        "HIBP: oqishlar topilmadi",
        "https://haveibeenpwned.com/",
        `Rasmiy baza bo'yicha "${email}" hech qanday ommaviy oqishga duch kelmagani aniqlandi — parol xavfsizligi holati yaxshi.`,
        "haveibeenpwned.com"
      ),
    ];
  }
  return res.slice(0, 12).map((b) =>
    mk(
      `${b.Title ?? b.Name} oqishi — email oshkor bo'lgan`,
      `https://haveibeenpwned.com/PwnedWebsites#${(b.Domain ?? b.Name ?? "").replace(/\..*$/, "")}`,
      [
        b.BreachDate ? `Sana: ${b.BreachDate}` : "",
        b.PwnCount ? `${b.PwnCount.toLocaleString("en-US")} ta hisob ta'sir qilgan` : "",
        b.DataClasses?.length ? `Oshkor bo'lgan maydonlar: ${b.DataClasses.join(", ")}` : "",
        b.IsVerified === false ? "(tasdiqlanmagan xabar)" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      "haveibeenpwned.com"
    )
  );
}

// kichik yordamchi (nom to'qnashuvining oldini olish uchun alohida)
function res_ok(r: Response): boolean {
  return r.ok;
}

// ===== 6. Hunter.io — email tasdiqlash + domen bo'yicha xodim topish =====

interface HunterVerify {
  data?: {
    result?: string;
    score?: number;
    first_name?: string;
    last_name?: string;
    position?: string;
    company?: string;
  };
}
interface HunterDomain {
  data?: {
    domain?: string;
    organization?: string;
    emails?: { value: string; first_name?: string; last_name?: string; position?: string; type?: string }[];
  };
}

export async function hunterSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("hunter")) return [];
  const key = keyOf("HUNTER_API_KEY")!;
  const out: SearchResultItem[] = [];

  if (target.includes("@")) {
    // Email tasdiqlash — ba'zan egasining ism-familiyasini ham qaytaradi
    const d = await jsonFetch<HunterVerify>(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(target)}&api_key=${encodeURIComponent(key)}`
    );
    const v = d?.data;
    if (v) {
      const name = [v.first_name, v.last_name].filter(Boolean).join(" ");
      out.push(
        mk(
          `Hunter.io: ${target} — ${v.result ?? "aniqlanmadi"}`,
          `https://hunter.io/email-verifier/${encodeURIComponent(target)}`,
          [
            v.score !== undefined ? `Ishonch: ${v.score}/100` : "",
            name ? `Egasi (bazadan): ${name}` : "",
            v.position ? `Lavozim: ${v.position}` : "",
            v.company ? `Kompaniya: ${v.company}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "Email holati tekshirildi",
          "hunter.io"
        )
      );
    }
    return out;
  }

  // Domen bo'yicha — kompaniyadagi email/ism-familiyalar (kuchli pivot manba)
  const d = await jsonFetch<HunterDomain>(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(target)}&limit=10&api_key=${encodeURIComponent(key)}`
  );
  const org = d?.data?.organization ?? target;
  for (const e of d?.data?.emails ?? []) {
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    out.push(
      mk(
        name ? `${name} (${org}) — ${e.value}` : `${e.value} (${org})`,
        `mailto:${e.value}`,
        [e.position ? `Lavozim: ${e.position}` : "", e.type ? `Tur: ${e.type}` : ""]
          .filter(Boolean)
          .join(" · ") || "Hunter.io domen bazasidan topilgan xodim manzili",
        "hunter.io"
      )
    );
  }
  return out;
}

// ===== 7. Shodan to'liq API =====

interface ShodanHost {
  ip_str?: string;
  org?: string;
  isp?: string;
  country_name?: string;
  city?: string;
  ports?: number[];
  hostnames?: string[];
  data?: { port?: number; product?: string; version?: string; banner?: string }[];
  last_update?: string;
}
interface ShodanDns {
  [sub: string]: { type?: number; value?: string }[] | undefined;
}

export async function shodanSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("shodan")) return [];
  const key = keyOf("SHODAN_API_KEY")!;
  let ip = target;
  const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(target);

  if (!isIp) {
    // Domen → Shodan DNS resolve → birinchi IP bo'yicha host ma'lumoti
    const dns = await jsonFetch<ShodanDns>(
      `https://api.shodan.io/dns/resolve?hostname=${encodeURIComponent(target)}&key=${encodeURIComponent(key)}`
    );
    const first = Object.values(dns ?? {})[0]?.[0]?.value;
    if (!first) return [];
    ip = first;
  }

  const h = await jsonFetch<ShodanHost>(
    `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}`
  );
  if (!h) return [];
  const facts = [
    h.org ? `Tashkilot: ${h.org}` : "",
    h.isp && h.isp !== h.org ? `ISP: ${h.isp}` : "",
    h.country_name ? `Joylashuv: ${h.city ? `${h.city}, ` : ""}${h.country_name}` : "",
    h.ports?.length ? `Ochiq portlar: ${h.ports.join(", ")}` : "",
    h.hostnames?.length ? `Hostname'lar: ${h.hostnames.slice(0, 6).join(", ")}` : "",
    h.last_update ? `Yangilangan: ${h.last_update.slice(0, 10)}` : "",
  ].filter(Boolean);
  const out: SearchResultItem[] = [
    mk(
      `Shodan: ${ip}${h.org ? ` — ${h.org}` : ""}`,
      `https://www.shodan.io/host/${ip}`,
      facts.join(" · ") || "Shodan bazasida ma'lumot topildi",
      "shodan.io"
    ),
  ];
  // Servis bannerlari — versiya/product ma'lumoti OSINT uchun qimmatli
  for (const d of (h.data ?? []).slice(0, 6)) {
    if (!d.product && !d.banner) continue;
    out.push(
      mk(
        `Shodan servis: ${ip}:${d.port ?? "?"}${d.product ? ` — ${d.product}${d.version ? ` ${d.version}` : ""}` : ""}`,
        `https://www.shodan.io/host/${ip}`,
        (d.banner ?? "").slice(0, 220),
        "shodan.io"
      )
    );
  }
  return out;
}

// ===== 8. NumLookup — telefon raqam holati =====

interface NumLookupResp {
  valid?: boolean;
  country?: string;
  countryCallingCode?: string;
  nationalNumber?: string;
  carrier?: string;
  lineType?: string;
  isPossible?: boolean;
}

export async function numlookupSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("numlookup")) return [];
  let num = target.replace(/[\s().-]/g, "");
  if (!num.startsWith("+")) num = `+${num.replace(/^8(?=9\d{9}$)/, "7")}`;
  const key = keyOf("NUMLOOKUP_API_KEY")!;
  const d = await jsonFetch<NumLookupResp>(
    `https://api.numlookupapi.com/v1/validate/${encodeURIComponent(num)}?apikey=${encodeURIComponent(key)}`
  );
  if (!d) return [];
  return [
    mk(
      `NumLookup: ${num} — ${d.valid ? "faol/haqiqiy" : "haqiqiy emas"}`,
      `https://www.sync.me/search/?number=${encodeURIComponent(num)}`,
      [
        d.country ? `Mamlakat: ${d.country}` : "",
        d.carrier ? `Operator: ${d.carrier}` : "",
        d.lineType ? `Liniya: ${d.lineType}` : "",
        d.nationalNumber ? `Milliy raqam: ${d.nationalNumber}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Raqam bazada tekshirildi",
      "numlookupapi.com"
    ),
  ];
}

// ===== 9. IPinfo — aniq IP razvedka =====

interface IpinfoResp {
  ip?: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  postal?: string;
  timezone?: string;
  error?: { title?: string; message?: string };
}

export async function ipinfoSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("ipinfo")) return [];
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target)) return [];
  const token = keyOf("IPINFO_TOKEN")!;
  const d = await jsonFetch<IpinfoResp>(
    `https://ipinfo.io/${encodeURIComponent(target)}/json?token=${encodeURIComponent(token)}`
  );
  if (!d || d.error) return [];
  return [
    mk(
      `IPinfo: ${d.ip ?? target}${d.hostname ? ` (${d.hostname})` : ""}`,
      `https://ipinfo.io/${d.ip ?? target}`,
      [
        d.org ? `Tashkilot/ASN: ${d.org}` : "",
        [d.city, d.region, d.country].filter(Boolean).length
          ? `Joylashuv: ${[d.city, d.region, d.country].filter(Boolean).join(", ")}`
          : "",
        d.timezone ? `Vaqt zonasi: ${d.timezone}` : "",
        d.postal ? `Post kodi: ${d.postal}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "IPinfo bazasidan geolokatsiya",
      "ipinfo.io"
    ),
  ];
}

// ===== 10. AlienVault OTX — Maltego uslubidagi bog'liq infratuzilma transformi =====

interface OtxPassive {
  passive_dns?: { hostname?: string; address?: string; first?: string; last?: string; type?: string }[];
}
interface OtxUrls {
  url_list?: { url?: string; hostname?: string; httpcode?: number }[];
}

export async function otxSource(target: string): Promise<SearchResultItem[]> {
  if (!premiumKeySet("otx")) return [];
  const key = keyOf("OTX_API_KEY")!;
  const host = "otx.alienvault.com";
  const headers = { "X-OTX-API-KEY": key, Accept: "application/json" };
  const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(target);
  const domain = target.replace(/^www\./, "").toLowerCase();
  if (!isIp && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return [];

  const kind = isIp ? "IPv4" : "domain";
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`https://otx.alienvault.com/api/v1/indicators/${kind}/${encodeURIComponent(target)}${path}`, {
        headers,
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const out: SearchResultItem[] = [];

  // Passiv DNS — bu domen/IP tarixan QAYERGA ulangan (Maltego "toHost" transformi)
  const pd = await get<OtxPassive>("/passive_dns");
  const recs = (pd?.passive_dns ?? []).filter((r) => r.hostname || r.address);
  const uniqHosts = [...new Set(recs.map((r) => (isIp ? r.hostname! : r.address!)))].filter(Boolean);
  if (uniqHosts.length > 0) {
    out.push({
      name: `OTX passiv DNS: ${uniqHosts.length} ta bog'liq ${isIp ? "host" : "IP"}`,
      url: `https://otx.alienvault.com/indicator/${isIp ? "ipv4" : "domain"}/${encodeURIComponent(target)}`,
      snippet: `Tarixiy bog'lanishlar: ${uniqHosts.slice(0, 12).join(", ")}${uniqHosts.length > 12 ? "..." : ""} — Maltego'dagi "resolved to" transformi ushbu infratuzilmani ochadi.`,
      host_name: host,
    });
  }
  for (const r of recs.slice(0, 6)) {
    if (!r.hostname || !r.address) continue;
    out.push({
      name: `OTX: ${isIp ? r.hostname : r.address}`,
      url: `https://otx.alienvault.com/indicator/${isIp ? "domain" : "ipv4"}/${encodeURIComponent(isIp ? r.hostname! : r.address!)}`,
      snippet: [
        r.first ? `Birinchi: ${r.first.slice(0, 10)}` : "",
        r.last ? `Oxirgi: ${r.last.slice(0, 10)}` : "",
        isIp ? "Bu host shu IP'ga ulangan" : "Bu IP shu domenga tegishli bo'lgan",
      ]
        .filter(Boolean)
        .join(" · "),
      host_name: host,
    });
  }

  // URL arxivi — domenda ko'rilgan sahifalar
  const ul = await get<OtxUrls>("/url_list?limit=8");
  for (const u of (ul?.url_list ?? []).slice(0, 5)) {
    if (!u.url) continue;
    out.push({
      name: `OTX URL: ${u.url.slice(0, 80)}`,
      url: u.url,
      snippet:
        [u.httpcode ? `HTTP: ${u.httpcode}` : "", u.hostname ? `Host: ${u.hostname}` : ""]
          .filter(Boolean)
          .join(" · ") || "OTX url arxivi",
      host_name: host,
    });
  }
  return out;
}

// ===== DIRECT_RUNS'ga bog'lanadigan xarita =====

export const PREMIUM_RUNS: Record<
  string,
  (target: string) => Promise<SearchResultItem[]>
> = {
  serper: serperSource,
  "brave-api": braveApiSource,
  "google-cse": googleCseSource,
  tavily: tavilySource,
  hibp: hibpSource,
  hunter: hunterSource,
  shodan: shodanSource,
  numlookup: numlookupSource,
  ipinfo: ipinfoSource,
  otx: otxSource,
};
