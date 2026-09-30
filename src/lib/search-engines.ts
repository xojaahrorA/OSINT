import type { SearchResultItem } from "./osint";

/**
 * Ko'p qatlamli ochiq qidiruv dvigatellari — API kalitsiz, istalgan mashinada.
 *
 * Z.ai SDK faqat Z.ai sandbox muhitida ishlaydi. Lokal mashinalarda (Kali,
 * Windows, macOS) skaner avtomatik shu zanjirga o'tadi:
 *
 *   DuckDuckGo HTML → DuckDuckGo Lite → Bing → Google Yangiliklar RSS
 *   → Yandex → Startpage (Google proksi) → Bing Yangiliklar RSS → SearXNG
 *   → Yahoo → Ecosia → Marginalia → Yep → Mojeek → Brave
 *
 * Yandex — RU/UZ bo'shliqini eng chuqur indekslaydi (t.me, VK, OK, Instagram
 * izlari ko'proq chiqadi). Startpage — Google natijalarini kalitsiz beradi.
 *
 * Har bir dvigatel javobi operator filtri (site:/"ibora") o'tkaziladi —
 * ba'zi dvigatellar operatorli so'rovga soxta (mos bo'lmagan) natija
 * qaytaradi. Agar barcha dvigatellar bo'sh bo'lsa va so'rovda operator
 * bo'lsa — so'rov avtomatik soddalashtirilib qayta so'raladi.
 */

// dvigatellarni yangilaganda ham bu satr saqlansin — diagnostika kod
// versiyasini shu belgi orqali aniqlaydi
export const SEARCH_ENGINES_VERSION = "multi-14-engines-v5";

const UA_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Chrome brauzer to'liq bo'lgan sarlavhalar to'plami — Mojeek/Brave kabi
 * qattiq bot-aniqlagichlar sarlavhalar to'liq bo'lmagan so'rovlarga 403
 * qaytaradi. Sec-Fetch-* va sec-ch-ua sarlavhalari so'rovni haqiqiy
 * brauzer so'roviga o'xshatadi.
 */
function chromeBrowserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,uz;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    ...extra,
  };
}

export interface OpenSearchResult {
  results: SearchResultItem[];
  engine: string;
  errors: string[];
  /** true — operatorli so'rov soddalashtirilib qayta so'ralgan */
  reformulated?: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function fetchHtml(
  url: string,
  opts: {
    timeoutMs?: number;
    ua?: string;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    /** POST tanasi — masalan "q=..." forma (DDG POST-zaxira yo'li uchun) */
    body?: string;
  } = {}
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      signal: ac.signal,
      headers: {
        "User-Agent": opts.ua ?? UA_FIREFOX,
        "Accept-Language": "en-US,en;q=0.9,uz;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(opts.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ===== Operator filtri =====

/**
 * Dvigatellar operatorli so'rovlarga (site:, "ibora", filetype:) ba'zan
 * umuman aloqasiz zaxira natijalar qaytaradi. OSINT uchun soxta topilma
 * xavfli — natijalar operatorlar bo'yicha qattiq tekshiriladi.
 *
 * siteInText=true bo'lsa (RSS/redirect dvigatellarda) site: domeni
 * havola yoki matn ichida qidiriladi.
 */
export function operatorFilter(
  query: string,
  results: SearchResultItem[],
  siteInText = false
): SearchResultItem[] {
  const siteDomains = [...query.matchAll(/site:([a-z0-9.-]+)/gi)].map((m) =>
    m[1].toLowerCase().replace(/^www\./, "")
  );
  const phrases = [...query.matchAll(/"([^"]{2,})"/g)].map((m) =>
    m[1].toLowerCase()
  );
  if (siteDomains.length === 0 && phrases.length === 0) return results;

  return results.filter((r) => {
    let host = "";
    try {
      host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return false;
    }
    if (siteDomains.length > 0) {
      const domainHit =
        !siteInText &&
        siteDomains.some((d) => host === d || host.endsWith(`.${d}`));
      const textHit = siteInText
        ? `${r.url} ${r.name} ${r.snippet}`
            .toLowerCase()
            .includes(siteDomains[0])
        : false;
      if (!domainHit && !textHit) return false;
    }
    if (phrases.length > 0) {
      const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
      if (!phrases.every((p) => hay.includes(p))) return false;
    }
    return true;
  });
}

/**
 * Umumiy maqbuliyat filtri: natija (sarlavha+snippet+havola) maqsad so'zlaridan
 * kamida bittasini o'z ichiga olishi kerak. Bing va boshqalar bot aniqlanganda
 * BUTUNLAY boshqa so'rov natijalarini qaytaradi (masalan "ulugbek tukhtayev"
 * so'roviga Microsoft Teams yuklab olish sahifasi!) — bunday soxta topilmalar
 * shu filtrga tushib qoladi. OSINT maqsadlari (ism, handle, email, doman)
 * o'z ichiga olgan natijalar esa qiyin voyaga yetadi.
 */
const STOPWORDS = new Set([
  "va", "bu", "uchun", "bilan", "yoki", "ham", "the", "and", "or", "of",
  "in", "on", "for", "with", "a", "an", "to", "kim", "nima",
]);

/**
 * Ism-familiya iborasini aniqlash: 2-4 ta sof harfli so'z (apostrof/tire
 * bilan — O'tkir, O'zbekiston kabi). "Muhammad Karimov" → true,
 * "Tashkent weather 7 kun" → false.
 */
function isPersonPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => /^[a-z\u0400-\u04ff'.-]{2,}$/i.test(w))
  );
}

/**
 * Ism-familiya mosligi uch darajali:
 *  - "full"    — har bir so'z aniq yoki initsial ko'rinishda bor
 *                ("M. Karimov" — "Muhammad Karimov" uchun mos)
 *  - "partial" — familiya aniq bor + kamida 2 ta so'z mos
 *  - "none"    — mos emas (faqat familiya uchragan ho'kiz natijalar)
 */
function personMatch(hay: string, words: string[]): "full" | "partial" | "none" {
  const checks = words.map((w) => {
    if (hay.includes(w)) return "full" as const;
    // Initsial: "Muhammad" → "M." (matnda qisqa yozilgan ism)
    if (hay.includes(`${w[0]}.`)) return "initial" as const;
    return "none" as const;
  });
  if (checks.every((c) => c === "full")) return "full";
  const matched = checks.filter((c) => c !== "none").length;
  const surnameOk = checks[checks.length - 1] === "full";
  if (surnameOk && matched >= 2) return "partial";
  return "none";
}

export function relevanceFilter(
  query: string,
  results: SearchResultItem[]
): SearchResultItem[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04ff'.@]+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (tokens.length === 0) return results;

  // stamlar: "ma'lumotlar" → "ma'lumo", "profiles" → "profil" (yaxlit moslik uchun)
  const stems = new Set<string>();
  for (const t of tokens) {
    stems.add(t);
    if (t.length >= 6) {
      stems.add(t.slice(0, -2));
      stems.add(t.slice(0, -3));
    }
  }
  const stemArr = [...stems];
  const matchesAny = (r: SearchResultItem) => {
    const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
    return stemArr.some((s) => hay.includes(s));
  };

  // --- Ism-familiya qattiqligi (noto'g'ri shaxs natijalariga qarshi) ---
  //
  // Muammo: "Muhammad Karimov" qidiruvida dvigatellar faqat familiyasi
  // mos boshqa shaxslar (Islom Karimov, Karimova...) sahifalarini ham
  // qaytaradi. OSINT uchun boshqa shaxs natijasi xavfli.
  //
  // Darajalar: full (hamma so'z aniq/initsial) → partial (familiya + 2 so'z)
  // → none (chetlanadi). Faqat familiyasi mos soxta natijalar o'tmaydi.
  //
  // 1-qoida: qo'shtirnoqli ibora 2-4 harfli so'zdan iborat bo'lsa
  //    ("Muhammad Karimov").
  const namePhrases = [...query.matchAll(/"([^"]{2,60})"/g)]
    .map((m) => m[1])
    .filter(isPersonPhrase);
  if (namePhrases.length > 0) {
    const nameWords = [
      ...new Set(namePhrases.flatMap((p) => p.toLowerCase().split(/\s+/))),
    ];
    const graded = results.filter((r) => {
      const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
      const g = personMatch(hay, nameWords);
      return g === "full" || g === "partial";
    });
    return graded;
  }

  // 2-qoida: qo'shtirnoqsiz, 2-3 ta sof harfli so'z (soddalashtirilgan
  //    ism-familiya so'rovi: "Muhammad Karimov facebook") — birinchi 2 ta
  //    so'z (ism va familiya) majburiy, qolgani (platforma so'zi) ixtiyoriy.
  const cleanCore = query
    .replace(/site:\S+|filetype:\S+|inurl:\S+|intitle:\S+|\bOR\b|[()"]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const coreWords = cleanCore
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (
    coreWords.length >= 2 &&
    coreWords.length <= 3 &&
    coreWords.every((w) => /^[a-z\u0400-\u04ff'.-]{2,}$/i.test(w))
  ) {
    const lead = coreWords.slice(0, 2);
    return results.filter((r) => {
      const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
      const g = personMatch(hay, lead);
      return g === "full" || g === "partial";
    });
  }

  return results.filter(matchesAny);
}

/** So'rovda qidiruv operatorlari bormi? */
export function hasOperators(query: string): boolean {
  return /(?:site:|inurl:|filetype:|intitle:|allintitle:|related:|cache:|\(|\)|\bOR\b)/i.test(
    query
  );
}

/**
 * Operatorli so'rovni dvigatellar tushunadigan oddiy so'rovga aylantiradi.
 *   site:linkedin.com/in "Tukhtayev"  →  Tukhtayev linkedin profile
 *   site:github.com dilshod filetype:md  →  dilshod github md
 */
export function reformulateQuery(query: string): string {
  const sites = [...query.matchAll(/site:([a-z0-9.-]+)/gi)].map((m) =>
    m[1].toLowerCase()
  );
  const filetypes = [...query.matchAll(/filetype:([a-z0-9]+)/gi)].map(
    (m) => m[1]
  );

  const PLATFORM_WORDS: [RegExp, string][] = [
    [/linkedin\./, "linkedin profile"],
    [/github\./, "github"],
    [/(^|\.)t\.me|telegram\./, "telegram"],
    [/facebook\./, "facebook"],
    [/instagram\./, "instagram"],
    [/(twitter|x)\.com/, "twitter"],
    [/tiktok\./, "tiktok"],
    [/youtube\./, "youtube"],
    [/reddit\./, "reddit"],
    [/pastebin\./, "pastebin"],
    [/medium\./, "medium"],
    [/vk\.com/, "vk"],
  ];

  const hints: string[] = [];
  for (const s of sites) {
    const hit = PLATFORM_WORDS.find(([re]) => re.test(s));
    if (hit) hints.push(hit[1]);
  }
  hints.push(...filetypes);

  // Operatorlarni va qavslarni olib tashlash
  const core = query
    .replace(/site:[a-z0-9.\-/]+/gi, " ")
    .replace(/filetype:[a-z0-9]+/gi, " ")
    .replace(/inurl:[^\s]+/gi, " ")
    .replace(/intitle:[^\s]+/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\bOR\b/gi, " ")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [...new Set([core, ...hints].filter(Boolean))].join(" ").trim();
}

// ===== 1. DuckDuckGo HTML =====
/**
 * DDG anti-bot holatlari:
 *  - ba'zi IP'larga 202 + bo'sh bosh sahifa qaytaradi (challenge)
 *  - ba'zi tarmoqlarda GET'ni umuman javob bermaydi (tarpit/timeout)
 * 202/bo'sh sahifa bo'lsa — POST forma bilan bir zaxira urinish (DDG edge'da
 * ba'zan GET blok bo'lib POST yo'li o'tadi). Timeout bo'lsa POST ham urinmaydi —
 * shu host baribir o'lik.
 */
function parseDdgHtml(html: string, num: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const linkRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snipRe.exec(html))) snippets.push(stripTags(sm[1]));

  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < num) {
    const href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    const url = uddg ? decodeURIComponent(uddg[1]) : href;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/duckduckgo\.com\/y\.js/i.test(url)) continue; // reklama
    results.push({
      name: stripTags(m[2]) || hostOf(url),
      url,
      snippet: snippets[i] ?? "",
      host_name: hostOf(url),
    });
    i++;
  }
  return results;
}

export async function ddgHtmlSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  let html: string;
  try {
    html = await fetchHtml(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { timeoutMs: 6000 }
    );
  } catch (e) {
    // Timeout — shu host javob bermayapti; POST bilan ham bo'lmaydi
    throw e;
  }
  let results = parseDdgHtml(html, num);
  if (results.length === 0) {
    // challenge/202 holat — POST forma bilan zaxira urinish
    try {
      const html2 = await fetchHtml("https://html.duckduckgo.com/html/", {
        timeoutMs: 6000,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `q=${encodeURIComponent(query)}`,
      });
      results = parseDdgHtml(html2, num);
    } catch {
      /* zaxira ham o'tmadi — quyida 0 natija xatosi */
    }
  }
  return operatorFilter(query, results);
}

// ===== 2. DuckDuckGo Lite =====
function parseDdgLiteHtml(html: string, num: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  // lite: <a rel="nofollow" href="URL" class='result-link'>Title</a>
  const re =
    /<a[^>]+href="([^"]+)"[^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>/g;
  const reAlt =
    /<a[^>]+class=["']result-link["'][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(/class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/g)].map(
    (x) => stripTags(x[1])
  );
  let i = 0;
  for (const rx of [re, reAlt]) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(html)) && results.length < num) {
      const href = decodeEntities(m[1]);
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      const url = uddg ? decodeURIComponent(uddg[1]) : href;
      if (!/^https?:\/\//i.test(url)) continue;
      if (/duckduckgo\.com\/y\.js/i.test(url)) continue;
      results.push({
        name: stripTags(m[2]) || hostOf(url),
        url,
        snippet: snippets[i] ?? "",
        host_name: hostOf(url),
      });
      i++;
    }
    if (results.length > 0) break;
  }
  return results;
}

export async function ddgLiteSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  let html: string;
  try {
    html = await fetchHtml(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      { timeoutMs: 6000 }
    );
  } catch (e) {
    throw e; // timeout — POST ham yordam bermaydi
  }
  let results = parseDdgLiteHtml(html, num);
  if (results.length === 0) {
    try {
      const html2 = await fetchHtml("https://lite.duckduckgo.com/lite/", {
        timeoutMs: 6000,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `q=${encodeURIComponent(query)}`,
      });
      results = parseDdgLiteHtml(html2, num);
    } catch {
      /* zaxira ham o'tmadi */
    }
  }
  return operatorFilter(query, results);
}

// ===== 3. Mojeek =====
export async function mojeekSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
    {
      ua: UA_CHROME,
      // Mojeek ba'zi tarmoqlarda javob bermay qoladi (TCP darajasida o'chiradi)
      // — 6s da tez muvaffaqiyatsizlik zanjirni ushlab qolmasin
      timeoutMs: 6000,
      headers: chromeBrowserHeaders({ Referer: "https://www.mojeek.com/" }),
    }
  );
  const results: SearchResultItem[] = [];
  const re = /<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < num) {
    results.push({
      name: stripTags(m[2]) || hostOf(m[1]),
      url: decodeEntities(m[1]),
      snippet: "",
      host_name: hostOf(m[1]),
    });
  }
  return operatorFilter(query, results);
}

// ===== 4. Brave =====
export async function braveSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  // Brave 429'ni burst limit sifatida beradi — 2s kutib BIR marta qayta
  // so'raymiz; ko'p hollarda ikkinchi urinish o'tadi (adaptiv tezlik)
  let html: string;
  try {
    html = await fetchHtml(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
      { ua: UA_CHROME, headers: chromeBrowserHeaders() }
    );
  } catch (err) {
    if (!/HTTP 429/.test(String(err))) throw err;
    await sleep(1800 + Math.floor(Math.random() * 700));
    html = await fetchHtml(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
      { ua: UA_CHROME, headers: chromeBrowserHeaders() }
    );
  }
  if (/captcha|Captcha/i.test(html.slice(0, 4000)))
    throw new Error("Brave captcha");
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const patterns = [
    /<a[^>]+class="[^"]*heading-serpresult[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*heading-serpresult[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < num) {
      const url = decodeEntities(m[1]);
      if (!/^https?:\/\//i.test(url)) continue;
      if (/brave\.com/i.test(url)) continue;
      const key = url.replace(/[#?].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        name: stripTags(m[2]) || hostOf(url),
        url,
        snippet: "",
        host_name: hostOf(url),
      });
    }
    if (results.length > 0) break;
  }
  return operatorFilter(query, results);
}

// ===== SERP parser — barcha yangi dvigatellarda qayta ishlatiladi =====
/**
 * HTML ichidan natija havolalarini bir nechta fallback regex bilan oladi.
 * Dvigatel markup'i o'zgarsa ikkinchi/uchinchi pattern ishlaydi;
 * hammasi bo'sh bo'lsa — bo'sh massiv qaytadi (dvigatel cooldown oladi).
 */
function extractSerResults(
  html: string,
  num: number,
  patterns: RegExp[],
  blockHostRe?: RegExp
): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < num) {
      const url = decodeEntities(m[1]);
      if (!/^https?:\/\//i.test(url)) continue;
      if (blockHostRe?.test(url)) continue;
      const key = url.replace(/[#?].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: stripTags(m[2]) || hostOf(url), url });
    }
    if (out.length > 0) break;
  }
  return out;
}

const H2_FALLBACK =
  /<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g;

// ===== 5a. Yandex =====
/**
 * Yandex — RU/UZ kontentini eng chuqur indekslaydi: t.me, telegra.ph, VK,
 * OK.ru, Instagram izlari Google/Bing/DDG'dan ko'proq chiqadi. O'zbek va
 * rus tilidagi ma'lumotlar uchun eng samarali ochiq dvigatel.
 */
export async function yandexSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://yandex.com/search/?text=${encodeURIComponent(query)}`,
    {
      ua: UA_CHROME,
      timeoutMs: 7000,
      headers: chromeBrowserHeaders({ Referer: "https://yandex.com/" }),
    }
  );
  if (/showcaptcha|smartcaptcha|<title>verification/i.test(html.slice(0, 8000)))
    throw new Error("Yandex captcha");
  const found = extractSerResults(
    html,
    num,
    [
      /<a[^>]+class="[^"]*organic__url[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      H2_FALLBACK,
    ],
    /yandex\.|ya\.ru/i
  );
  return operatorFilter(
    query,
    found.map((f) => ({
      name: f.name,
      url: f.url,
      snippet: "",
      host_name: hostOf(f.url),
    }))
  );
}

// ===== 5b. Startpage — Google natijalari proksi =====
/**
 * Startpage Google natijalarini kalitsiz, shaffof private oynadan beradi —
 * "Google'da ham qidirish" talabining bepul yechimi. Ba'zan captcha beradi,
 * o'shanda sovitish rejimi o'tkazib yuboradi.
 */
export async function startpageSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`,
    {
      ua: UA_CHROME,
      timeoutMs: 7000,
      headers: chromeBrowserHeaders({ Referer: "https://www.startpage.com/" }),
    }
  );
  if (/captcha|<title>[^<]*blocked/i.test(html.slice(0, 8000)))
    throw new Error("Startpage captcha/block");
  const found = extractSerResults(
    html,
    num,
    [
      /<a[^>]+class="[^"]*wgl-link[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      H2_FALLBACK,
    ],
    /startpage\.com/i
  );
  return operatorFilter(
    query,
    found.map((f) => ({
      name: f.name,
      url: f.url,
      snippet: "",
      host_name: hostOf(f.url),
    }))
  );
}

// ===== 5c. Ecosia — Bing bazali, o'z serveridan =====
/**
 * Ecosia Bing indeksidan foydalanadi lekin Bing'dan kamroq bloklaydi —
 * Bing 429 bergan zanjir momentida zaxira variant.
 */
export async function ecosiaSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://www.ecosia.org/search?q=${encodeURIComponent(query)}`,
    {
      ua: UA_CHROME,
      timeoutMs: 7000,
      headers: chromeBrowserHeaders({ Referer: "https://www.ecosia.org/" }),
    }
  );
  const found = extractSerResults(
    html,
    num,
    [
      /<a[^>]+class="[^"]*result__link[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      /<a[^>]+data-test-id="[^"]*result-link[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      H2_FALLBACK,
    ],
    /ecosia\.org/i
  );
  return operatorFilter(
    query,
    found.map((f) => ({
      name: f.name,
      url: f.url,
      snippet: "",
      host_name: hostOf(f.url),
    }))
  );
}

// ===== 5d. Yep — Ahrefs dvigateli =====
/**
 * Yep (yep.com) — Ahrefs'ning o'z indeksli dvigateli, HTML'i sodda.
 * Ko'pincha boshqa dvigatellar topmagan sahifalarni beradi.
 */
export async function yepSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://yep.com/web?q=${encodeURIComponent(query)}`,
    {
      ua: UA_CHROME,
      timeoutMs: 6000,
      headers: chromeBrowserHeaders({ Referer: "https://yep.com/" }),
    }
  );
  const found = extractSerResults(
    html,
    num,
    [
      /<a[^>]+class="[^"]*(?:partial-title|serp-title)[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      H2_FALLBACK,
    ],
    /yep\.com/i
  );
  return operatorFilter(
    query,
    found.map((f) => ({
      name: f.name,
      url: f.url,
      snippet: "",
      host_name: hostOf(f.url),
    }))
  );
}

// ===== 5. Qwant =====
export async function qwantSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const body = await fetchHtml(
    `https://api.qwant.com/v3/search/web?q=${encodeURIComponent(
      query
    )}&count=${Math.max(num, 10)}&locale=en_US&offset=0&device=desktop&safesearch=1`,
    {
      ua: UA_CHROME,
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.qwant.com/",
        Origin: "https://www.qwant.com",
      },
    }
  );
  const j = JSON.parse(body) as {
    data?: {
      result?: {
        items?: { mainline?: { data?: { items?: { url?: string; title?: string; desc?: string }[] }[] } };
      };
    };
  };
  const groups = j?.data?.result?.items?.mainline?.data ?? [];
  const results: SearchResultItem[] = [];
  for (const g of groups) {
    for (const it of g.items ?? []) {
      if (!it.url || results.length >= num) continue;
      results.push({
        name: it.title || hostOf(it.url),
        url: it.url,
        snippet: it.desc ?? "",
        host_name: hostOf(it.url),
      });
    }
  }
  return operatorFilter(query, results);
}

// ===== 6. Bing =====
function decodeBingRedirect(url: string): string {
  const u = url.match(/[?&]u=(a1[A-Za-z0-9_-]+)/);
  if (!u) return url;
  try {
    let b64 = u[1].slice(2).replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    return /^https?:\/\//i.test(decoded) ? decoded : url;
  } catch {
    return url;
  }
}

/** Bing bitta urinish — extraParams orqali turli formatlar sinab ko'riladi */
async function bingSearchOnce(
  query: string,
  num: number,
  extraParams: string
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(
      num,
      10
    )}&mkt=en-US&setlang=en${extraParams}`
  );
  const results: SearchResultItem[] = [];
  const blocks = html.match(/<li class="b_algo[\s\S]*?<\/li>/g) ?? [];

  for (const block of blocks) {
    if (results.length >= num) break;
    const h2 = block.match(
      /<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!h2) continue;
    const url = decodeBingRedirect(decodeEntities(h2[1]));
    if (!/^https?:\/\//i.test(url)) continue;
    const sn =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
      block.match(/class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    results.push({
      name: stripTags(h2[2]) || hostOf(url),
      url,
      snippet: sn ? stripTags(sn[1]) : "",
      host_name: hostOf(url),
    });
  }
  return operatorFilter(query, results);
}

export async function bingSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  let results = await bingSearchOnce(query, num, "");
  if (results.length === 0) {
    // Bing avtomatik trafikka vaqti-vaqti bilan BO'SH SERP qaytaradi
    // (yumshoq blok — sahifa bor, natija yo'q). Qisqa pauza bilan boshqa
    // formatda bir marta qayta so'raymiz — ko'p hollarda ochiladi.
    await sleep(350 + Math.floor(Math.random() * 350));
    results = await bingSearchOnce(query, num, "&FORM=QBRE&adlt=moderate");
  }
  return results;
}

// ===== 6b. Bing RASMLAR — jonli rasm qidiruvi =====
/**
 * Bing Images scraping — odamning RASMLARI qayerda ishlatilganini topish uchun.
 * Har natija:
 *   url     — rasm joylashgan sahifa (manba — «u yer»)
 *   snippet — to'liq o'lchamdagi rasm fayl havolasi (murl)
 *   favicon — Bing thumbnail (kartada kichik ko'rinish chiqadi)
 * Soft-blok (sahifa bor, iusc bloklari yo'q) → boshqa format bilan 1 marta
 * qayta so'raladi, baribir bo'sh bo'lsa [] qaytadi (xato emas — rasm topilmadi).
 */
interface BingImageMeta {
  murl?: string;
  purl?: string;
  turl?: string;
  t?: string;
  desc?: string;
}

async function bingImagesOnce(
  endpoint: "search" | "async",
  query: string,
  num: number,
  extraParams: string
): Promise<SearchResultItem[]> {
  // "search" — to'liq SERP sahifasi; "async" — brauzer scroll'da yuklaydigan
  // grid endpoint'i (sahifa eskisi JS-shell qaytarsa bu to'liq metadata beradi)
  const base =
    endpoint === "search"
      ? `https://www.bing.com/images/search?q=${encodeURIComponent(
          query
        )}&first=1&count=${Math.max(num, 15)}&mkt=en-US&setlang=en`
      : `https://www.bing.com/images/async?q=${encodeURIComponent(
          query
        )}&first=0&count=${Math.max(num, 15)}&mkt=en-US`;
  const html = await fetchHtml(base + extraParams, {
    ua: UA_CHROME,
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      Referer: "https://www.bing.com/",
    },
  });
  const metas: BingImageMeta[] = [];
  // Har natija <a class="iusc" ... m="{JSON}"> blokida — m atributi
  // HTML-escape qilingan JSON (murl: rasm, purl: sahifa, turl: thumbnail)
  const re = /<a\b[^>]*?\sm="([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && metas.length < num * 3) {
    if (!m[1].includes("murl")) continue;
    try {
      const j = JSON.parse(decodeEntities(m[1])) as BingImageMeta;
      if (j.murl) metas.push(j);
    } catch {
      /* buzilgan atribut — o'tkazib yuboramiz */
    }
  }
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const j of metas) {
    if (results.length >= num) break;
    if (!j.murl || !/^https?:\/\//i.test(j.murl)) continue;
    const key = j.murl.replace(/[#?].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const page =
      j.purl && /^https?:\/\//i.test(j.purl) ? j.purl : j.murl;
    results.push({
      name: (j.t || j.desc || `Rasm — ${query}`).slice(0, 200),
      url: page,
      snippet: j.murl,
      host_name: hostOf(page),
      favicon: j.turl && /^https?:\/\//i.test(j.turl) ? j.turl : undefined,
    });
  }
  return results;
}

/** Openverse (api.openverse.org) — kalitsiz, barqaror JSON rasm API.
 * Bing JS-shell qaytargan hollarda ishonchli zaxira: CC-liSENSIYALI rasmlar
 * (Wikimedia Commons, Flickr va boshqalar) manba sahifasi bilan qaytadi. */
async function openverseImages(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const body = await fetchHtml(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${Math.max(num, 8)}`,
    { timeoutMs: 9000, headers: { Accept: "application/json" } }
  );
  const j = JSON.parse(body) as {
    results?: {
      title?: string;
      url?: string;
      foreign_landing_url?: string;
      thumbnail?: string;
    }[];
  };
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const x of j.results ?? []) {
    if (results.length >= num) break;
    if (!x.url || !/^https?:\/\//i.test(x.url)) continue;
    const key = x.url.replace(/[#?].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const page =
      x.foreign_landing_url && /^https?:\/\//i.test(x.foreign_landing_url)
        ? x.foreign_landing_url
        : x.url;
    results.push({
      name: (x.title || `Rasm — ${query}`).slice(0, 200),
      url: page,
      snippet: x.url,
      host_name: hostOf(page),
      favicon:
        x.thumbnail && /^https?:\/\//i.test(x.thumbnail) ? x.thumbnail : undefined,
    });
  }
  return results;
}

export async function bingImagesSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  // Bing rasm qidiruvi VAQTI-VAQTI bilan JS-shell (metadata'siz) sahifa
  // qaytaradi — shuning uchun bir nechta variant navbat bilan sinab ko'riladi:
  //   1-2. Bing search/async endpoint'lari (eng dolzarb natijalar)
  //   3.   Openverse API — har doim barqaror ishonchli zaxira
  //   4.   Bing boshqa format — oxirgi urinish
  // To'liq metadata kelgan variant darrov qaytariladi; hammasi bo'sh bo'lsa
  // [] qaytadi (xato emas — bu tarmoqda rasm topilmadi).
  const variants: { run: () => Promise<SearchResultItem[]> }[] = [
    { run: () => bingImagesOnce("search", query, num, "") },
    { run: () => bingImagesOnce("async", query, num, "") },
    { run: () => openverseImages(query, num) },
    { run: () => bingImagesOnce("search", query, num, "&FORM=IRFLTR&adlt=moderate") },
  ];
  for (const v of variants) {
    try {
      const results = await v.run();
      if (results.length > 0) return results;
    } catch {
      /* HTTP/parse xato — keyingi variant */
    }
    await sleep(300 + Math.floor(Math.random() * 300));
  }
  return [];
}

// ===== 5b. Yahoo (Qwant o'rniga — DataDome server tomondan o'tmaydi) =====
/**
 * Yahoo Search oddiy HTML qaytaradi (server-render, JS kerak emas) va
 * natijalari asosan Bing indeksidan keladi — Qwant o'rniga eng yaxshi
 * almashtirish. Havolalar r.search.yahoo.com redirect ichida RU= parametrida
 * haqiqiy manzil yashiringan.
 *
 * Muammo: Yahoo bot-verifikatsiya "raqsi" ishlatadi — /search 307 qilib
 * /_bv/v.gif ga yo'naltiradi, u YBV cookie o'rnatadi, so'ng qayta /search
 * ochiladi. Node fetch cookie'larni redirectlar orasida saqlamaydi, shuning
 * uchun raqsni QO'LDA bajaramiz: har hop'da Set-Cookie ni jar'ga yig'amiz.
 */
async function yahooCookieDance(url: string): Promise<string> {
  const jar = new Map<string, string>();
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const headers: Record<string, string> = {
      "User-Agent": UA_CHROME,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    // MUHIM: to'liq Sec-Fetch-*/sec-ch-ua sarlavhalari bu raqsda ishlamaydi —
    // redirect hop'larida qiymatlar nomuvofiq bo'lib Yahoo yana 307 qaytaradi
    if (hop > 0) headers["Referer"] = "https://www.yahoo.com/";
    if (jar.size)
      headers["Cookie"] = [...jar.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    const res = await fetch(current, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    // Set-Cookie larni jar'ga yig'ish (Node 18.14+: getSetCookie)
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie") ?? []].flat();
    for (const c of setCookies) {
      const kv = c.split(";")[0] ?? "";
      const eq = kv.indexOf("=");
      if (eq > 0) jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        current = new URL(loc, current).toString();
        continue;
      }
    }
    if (res.ok) return await res.text();
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("Yahoo: redirect limiti");
}

export async function yahooSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&n=${Math.max(num, 10)}`;
  // Yahoo bu yo'lda vaqti-vaqti bilan ulanish uzilishiga ham uchraydi —
  // bitta qisqa pauzali qayta urinish barqarorlikni sezilarli oshiradi
  let html: string;
  try {
    html = await yahooCookieDance(url);
  } catch (err) {
    await sleep(600 + Math.floor(Math.random() * 500));
    html = await yahooCookieDance(url);
  }
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const re =
    /<a[^>]+href="(https:\/\/r\.search\.yahoo\.com\/[^"\s]+?RU=([^/"\s]+)\/[^"\s]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < num) {
    let url2: string;
    try {
      url2 = decodeEntities(decodeURIComponent(m[2]));
    } catch {
      url2 = decodeEntities(m[2]);
    }
    if (!/^https?:\/\//i.test(url2)) continue;
    if (/(^|\.)yahoo\.[a-z.]+$/i.test(hostOf(url2))) continue; // ichki havolalar
    const key = url2.replace(/[#?].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // Sarlavha tozalash: "Wikipediahttps://en.wikipedia.org › wiki" shaklida
    // breadcrumb boshlanadi — URL boshlanishidan oldingi qismi sarlavha
    let name = stripTags(m[3]).split(/https?:\/\//)[0].trim();
    if (!name) name = hostOf(url2);
    results.push({
      name: name.slice(0, 200),
      url: url2,
      snippet: "",
      host_name: hostOf(url2),
    });
  }
  if (results.length === 0) throw new Error("Yahoo: natija yo'q");
  return operatorFilter(query, results);
}

// ===== RSS yordamchi =====
interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
}

function parseRssItems(xml: string, limit: number): RssItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: RssItem[] = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const title = stripCdata(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = stripCdata(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const pubDate = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    if (link && /^https?:\/\//i.test(link)) out.push({ title, link, pubDate });
  }
  return out;
}

// ===== 7. Google Yangiliklar RSS =====
export async function googleNewsRssSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  // Google News qo'shtirnoqlarni qatti'q talqin qiladi — "nuu.uz" kabi
  // domanli/qo'shtirnoqli so'rovlarda 0 qaytaradi. Qo'shtirnoqlarni
  // tozalab yuboramiz: moslik filtri baribir asl so'rov bo'yicha ishlaydi.
  const cleanQuery = query.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  const xml = await fetchHtml(
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      cleanQuery
    )}&hl=en-US&gl=US&ceid=US:en`,
    { ua: UA_CHROME }
  );
  const items = parseRssItems(xml, num);
  // ASL so'rov (qo'shtirnoqlar bilan) beriladi — "Ism Familiya" iborasi
  // natija ichida majburiy bo'ladi. Aks holda faqat familiyasi mos boshqa
  // shaxs yangiliklari (Islom Karimov kabi) ham o'tib ketadi.
  return operatorFilter(
    query,
    items.map((it) => ({
      name: it.title || "Yangilik",
      url: it.link,
      snippet: "",
      host_name: "news.google.com",
      date: it.pubDate,
    })),
    true // site: domeni havola/matn ichida qidiriladi (redirect havolalar)
  );
}

// ===== 8. Bing Yangiliklar RSS =====
export async function bingNewsRssSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const cleanQuery = query.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  const xml = await fetchHtml(
    `https://www.bing.com/news/search?q=${encodeURIComponent(cleanQuery)}&format=rss`
  );
  const items = parseRssItems(xml, num);
  // ASL so'rov (qo'shtirnoqlar bilan) beriladi — ibora filtri majburiy
  // bo'ladi (boshqa shaxsning yangiliklari o'tib ketmasligi uchun).
  return operatorFilter(
    query,
    items.map((it) => ({
      name: it.title || "Yangilik",
      url: it.link,
      snippet: "",
      host_name: hostOf(it.link),
      date: it.pubDate,
    })),
    true
  );
}

// ===== 9. SearXNG (ommaviy instanslar) =====
/**
 * Instanslar real test asosida tanlangan (2025-09): paulgo.io — server tomonda
 * to'liq render qilinadigan yagona yirik instans (bot tekshiruvi yo'q).
 * searx.be / inetol / priv.au endi antibot captcha qo'yadi — olib tashlangan.
 */
const SEARX_INSTANCES = [
  "https://paulgo.io",
  "https://searx.tiekoetter.com",
  "https://searx.be",
];

export async function searxSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const errors: string[] = [];
  for (const inst of SEARX_INSTANCES) {
    // 1) Oddiy HTML sahifa (server tomonda render qilingan natijalar)
    try {
      const html = await fetchHtml(
        `${inst}/search?q=${encodeURIComponent(query)}`,
        { ua: UA_CHROME, timeoutMs: 8000, headers: { Accept: "text/html" } }
      );
      const results = parseSearxHtml(html, num);
      if (results.length > 0) {
        return operatorFilter(query, results, true);
      }
      // antibot captcha sahifasi aniqroq xato bo'lsin
      if (/verifying|captcha|security check|antibot/i.test(html.slice(0, 3000)))
        errors.push(`${hostOf(inst)}: antibot captcha`);
      else errors.push(`${hostOf(inst)}: natija yo'q`);
    } catch (e) {
      errors.push(`${hostOf(inst)}: ${String(e).slice(0, 40)}`);
    }
    // 2) RSS zaxira yo'li — SearXNG format=rss'ni qo'llaydi, ba'zan HTML'dan
    //    keyin ham ishlaydi (boshqa upstream yo'li)
    try {
      const xml = await fetchHtml(
        `${inst}/search?q=${encodeURIComponent(query)}&format=rss`,
        { ua: UA_CHROME, timeoutMs: 7000, headers: { Accept: "application/rss+xml,text/xml" } }
      );
      const items = parseRssItems(xml, num);
      if (items.length > 0) {
        const mapped = items.map((it) => ({
          name: it.title || "Natija",
          url: it.link,
          snippet: "",
          host_name: hostOf(it.link),
        }));
        return operatorFilter(query, mapped, true);
      }
    } catch {
      /* HTML xatosi yetarli tavsif beradi */
    }
  }
  throw new Error(errors.join("; ").slice(0, 100));
}

/** SearXNG HTML'dan natijalarni ajratib olish (eski va yangi markup) */
export function parseSearxHtml(
  html: string,
  num: number
): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  // Yangi markup: <article class="result ..."> ... <h3><a href="URL" ...>Sarlavha</a></h3> ... <p class="content">matn</p>
  const articles = html.match(/<article[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/article>/g) ?? [];
  for (const art of articles) {
    if (results.length >= num) break;
    const a = art.match(/<h3[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const snip = art.match(/<p class="content">([\s\S]*?)<\/p>/);
    results.push({
      name: stripTags(a[2]) || hostOf(url),
      url,
      snippet: snip ? stripTags(snip[1]).slice(0, 300) : "",
      host_name: hostOf(url),
    });
  }

  // Eskicha markup zaxirasi: h3 ichidagi havolalar to'g'ridan-to'g'ri
  if (results.length === 0) {
    const re =
      /<h3[^>]*><a[^>]+href="(https?:\/\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < num) {
      const url = decodeEntities(m[1]);
      results.push({
        name: stripTags(m[3]) || hostOf(url),
        url,
        snippet: "",
        host_name: hostOf(url),
      });
    }
  }
  return results;
}

// ===== 10. Marginalia (ochiq manba qidiruv — JSON API, bot tekshiruvi yo'q) =====
/**
 * Qwant DataDome captcha qo'yganidan keyin shu dvigatel uning o'rnini
 * egallaydi. api.marginalia.nu ochiq kalit bilan ishlaydi, JSON qaytaradi.
 * Kichik/nostandart vebga ixtisoslashgan — OSINT uchun qo'shimcha qamrov.
 * QAYD: API ba'zan sekinlashadi/osilib qoladi — 11s timeout; osilib qolsa
 * zanjir keyingi dvigatelga o'tadi (tashqi cap ENGINE_TIMEOUTS'da 12s).
 */
export async function marginaliaSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const cleanQuery = query.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  const body = await fetchHtml(
    `https://api.marginalia.nu/public/search/${encodeURIComponent(cleanQuery)}`,
    {
      ua: UA_CHROME,
      timeoutMs: 11000,
      headers: { Accept: "application/json" },
    }
  );
  const j = JSON.parse(body) as {
    results?: { url?: string; title?: string; description?: string }[];
  };
  const results: SearchResultItem[] = [];
  for (const it of j.results ?? []) {
    if (!it.url || results.length >= num) break;
    if (!/^https?:\/\//i.test(it.url)) continue;
    results.push({
      name: it.title || hostOf(it.url),
      url: it.url,
      snippet: (it.description ?? "").slice(0, 300),
      host_name: hostOf(it.url),
    });
  }
  return operatorFilter(query.replace(/"/g, " "), results, true);
}

// ===== Sovitish (circuit breaker) — bloklangan dvigatellarni vaqtincha o'tkazib yuborish =====
/**
 * Dvigatel HTTP 403/429/503 qaytarsa — IP bloklangan/rate-limit. Shu holatda
 * keyingi skanerlarda u dvigatelga murojaat qilmaslik kerak: har safar 6-7s
 * timeout kutib, zanjirni sekinlashtirmaslik va blokni kuchaytirmaslik uchun.
 * Dvigatel COOLDOWN_MINUTES davomida "dam olish" rejimida bo'ladi.
 */
const COOLDOWN_MINUTES = 10;
const cooldowns = new Map<string, number>(); // dvigatel nomi → qachongacha (epoch ms)

function setCooldown(name: string, minutes = COOLDOWN_MINUTES): void {
  cooldowns.set(name, Date.now() + minutes * 60_000);
}

export function isCoolingDown(name: string): boolean {
  const until = cooldowns.get(name);
  if (!until) return false;
  if (Date.now() > until) {
    cooldowns.delete(name);
    return false;
  }
  return true;
}

export function cooldownMinutesLeft(name: string): number {
  const until = cooldowns.get(name);
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 60_000)) : 0;
}

// ===== So'rov keshi — bir xil so'rov qayta yuborilsa darrov, bloklanmay javob =====
/**
 * Skanerlar/pivotlar ko'pincha bir xil so'rovlarni qaytaradi. Kesh dvigatel
 * yukini kamaytirib bloklanishning oldini oladi va takroriy so'rovlarni
 * 0ms da bajaradi. Faqat muvaffaqiyatli natijalar keshlanadi.
 */
const CACHE_TTL_MS = 8 * 60_000;
const CACHE_MAX = 300;
interface CacheEntry {
  results: SearchResultItem[];
  engine: string;
  expires: number;
}
const respCache = new Map<string, CacheEntry>();

function cacheGet(query: string, num: number): CacheEntry | null {
  const e = respCache.get(`${num}|${query}`);
  if (!e) return null;
  if (Date.now() > e.expires) {
    respCache.delete(`${num}|${query}`);
    return null;
  }
  return e;
}

function cacheSet(query: string, num: number, results: SearchResultItem[], engine: string): void {
  if (results.length === 0) return; // bo'sh natija keshlanmaydi — yangi dvigatellar topishi mumkin
  if (respCache.size >= CACHE_MAX) {
    const first = respCache.keys().next().value;
    if (first !== undefined) respCache.delete(first); // FIFO — eng eskisi chiqadi
  }
  respCache.set(`${num}|${query}`, { results, engine, expires: Date.now() + CACHE_TTL_MS });
}

// ===== Dvigatel bo'yicha minimal pauza — bir dvigatelga ketma-ket zarba bo'lmasin =====
/**
 * Google/Bing/DDG tez-tez so'rovda IP'ni bloklaydi. Shu xarita har dvigatelga
 * qayta murojaat orasida minimal pauza ushlab turadi (parallel ishchilar
 * o'rtasida ham umumiy) — zanjir 429'ga uchramasdan iloji boricha tez yuradi.
 * API dvigatellarga (RSS/JSON) pauza qisqaroq, scrape qiladiganlarga uzunroq.
 */
const ENGINE_GAP_MS: Record<string, number> = {
  Marginalia: 700,
  Yep: 1400,
  Ecosia: 1500,
  // Yandex/Startpage botga qattiq — boshqalardan ko'proq dam beramiz
  Yandex: 1900,
  Startpage: 1900,
  "Google Yangiliklar": 900,
  "Bing Yangiliklar": 900,
  SearXNG: 1400,
  Yahoo: 1500,
  DuckDuckGo: 1700,
  "DuckDuckGo Lite": 1700,
  Bing: 1700,
  Mojeek: 1700,
  // Brave rate-limiti eng qattiq — boshqalardan ko'proq dam beramiz
  Brave: 2400,
};
const DEFAULT_GAP_MS = 1700;
const lastEngineReq = new Map<string, number>();

// ===== Tezlik profili — foydalanuvchi UI'dagi "Tezlik" tanlovi orqali =====
/**
 * Skaner juda tez yursa dvigatellar bloklaydi, juda sekin yursa ko'p kutadi.
 * Shu sababli pauzalar foizli ko'paytiruvchi orqali boshqariladi:
 *   sekin  — barcha pauzalar 2x (bloklanishdan maksimal himoya)
 *   oddiy  — standart muvozanat
 *   tez    — ~1.7x tezroq
 *   tezkor — maksimal tezlik, blok xavfi yuqori
 * Har skaner boshlanishida scan route setSpeedProfile() chaqiradi.
 */
export type SpeedProfile = "sekin" | "oddiy" | "tez" | "tezkor";
export const SPEED_PROFILES: SpeedProfile[] = ["sekin", "oddiy", "tez", "tezkor"];
const GAP_MULTIPLIER: Record<SpeedProfile, number> = {
  sekin: 2,
  oddiy: 1,
  tez: 0.6,
  tezkor: 0.35,
};
let activeSpeed: SpeedProfile = "oddiy";

export function setSpeedProfile(p: SpeedProfile): void {
  activeSpeed = SPEED_PROFILES.includes(p) ? p : "oddiy";
}

export function getSpeedProfile(): SpeedProfile {
  return activeSpeed;
}

async function paceEngine(name: string): Promise<void> {
  const gap = (ENGINE_GAP_MS[name] ?? DEFAULT_GAP_MS) * GAP_MULTIPLIER[activeSpeed];
  const last = lastEngineReq.get(name) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(Math.min(wait, 3200));
  lastEngineReq.set(name, Date.now());
}

// ===== Zanjir: barcha dvigatellar ketma-ket (juftliklar bilan parallellashgan) =====

type EngineFn = (query: string, num: number) => Promise<SearchResultItem[]>;

const ENGINE_CHAIN: { name: string; fn: EngineFn }[] = [
  // 1-juftlik: tekshirilgan ishonchli dvigatellar
  { name: "DuckDuckGo", fn: ddgHtmlSearch },
  { name: "DuckDuckGo Lite", fn: ddgLiteSearch },
  // 2-juftlik: Microsoft/Google yangiliklari ham barqaror
  { name: "Bing", fn: bingSearch },
  { name: "Google Yangiliklar", fn: googleNewsRssSearch },
  // 3-juftlik: Yandex (RU/UZ chuqur indeks) + Startpage (Google proksi)
  { name: "Yandex", fn: yandexSearch },
  { name: "Startpage", fn: startpageSearch },
  // 4-juftlik: server-render SearXNG (paulgo.io) + Marginalia JSON API
  { name: "Bing Yangiliklar", fn: bingNewsRssSearch },
  { name: "SearXNG", fn: searxSearch },
  { name: "Marginalia", fn: marginaliaSearch },
  // 5-juftlik: Yahoo — server-render HTML, Qwant'ning barqaror o'rnini bosadi
  { name: "Yahoo", fn: yahooSearch },
  { name: "Ecosia", fn: ecosiaSearch },
  // 6-juftlik: Yep — Ahrefs indeksi
  { name: "Yep", fn: yepSearch },
  { name: "Mojeek", fn: mojeekSearch },
  // 7-juftlik: qattiq bot-aniqlagichli dvigatellar — ko'pincha 403/429,
  // lekin ba'zi tarmoqlarda ishlaydi; sovitish rejimi avtomatik o'tkazadi
  { name: "Brave", fn: braveSearch },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Har dvigatel uchun tashqi timeout (tryEngine cap) — sekin API'larga uzoqroq */
const ENGINE_TIMEOUTS: Record<string, number> = {
  Marginalia: 12_000, // API o'rtacha 1-3s, lekin ba'zan 8-10s gacha sekinlashadi
  SearXNG: 10_000, // 3 instansli rotatsiya — budget cheklangan bo'lsin
};
const DEFAULT_ENGINE_TIMEOUT_MS = 6500;
const CHAIN_BUDGET_MS = 17000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  // Timer p tugaganda bekor qilinadi — pending timer'lari Node
  // jarayonini ushlab qolmaydi (test skriptlar darrov chiqadi)
  return Promise.race([p, timeoutP]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function tryEngine(
  e: { name: string; fn: EngineFn },
  query: string,
  num: number,
  errors: string[]
): Promise<SearchResultItem[] | null> {
  // Sovitish rejimida — o'tkazib yuboramiz (timeout kutmaymiz)
  if (isCoolingDown(e.name)) {
    errors.push(
      `${e.name}: o'tkazib yuborildi (sovitish ${cooldownMinutesLeft(e.name)} daqiqa qoldi)`
    );
    return null;
  }
  // Har dvigatelga minimal pauza — bloklanishning oldini oladi
  await paceEngine(e.name);
  try {
    const raw = await withTimeout(
      e.fn(query, num),
      ENGINE_TIMEOUTS[e.name] ?? DEFAULT_ENGINE_TIMEOUT_MS
    );
    // Operator filtri dvigatel ichida, bu yerda umumiy maqbuliyat filtri:
    const r = relevanceFilter(query, raw);
    if (r.length > 0) return r;
    errors.push(
      raw.length > 0
        ? `${e.name}: ${raw.length} natija mos kelmadi (soxta filtrlandi)`
        : `${e.name}: 0 natija`
    );
  } catch (err) {
    const msg = String(err);
    // Blok/rate-limit xatosi bo'lsa — dvigatelni sovitamiz (adaptiv):
    // 429 (vaqtinchalik rate-limit) 6 daqiqa — tez orada o'z-o'zidan ochiladi;
    // 403/503 (qattiq blok) 10 daqiqa — uzoqroq dam berish ma'qul.
    if (/HTTP 429/.test(msg)) {
      setCooldown(e.name, 6);
      errors.push(
        `${e.name}: ${msg.slice(0, 60)} — 6 daqiqaga o'tkazib yuboriladi`
      );
    } else if (/HTTP (403|503)/.test(msg)) {
      setCooldown(e.name);
      errors.push(
        `${e.name}: ${msg.slice(0, 60)} — ${COOLDOWN_MINUTES} daqiqaga o'tkazib yuboriladi`
      );
    } else if (/timeout|AbortError|aborted/i.test(msg)) {
      // MUHIM: timeout ham cooldown beradi — aks holda har so'rov yana 6-8s
      // o'lik dvigatelni kutib qoladi (DDG tarpit holati shunday edi)
      setCooldown(e.name, 3);
      errors.push(
        `${e.name}: ${msg.slice(0, 60)} — 3 daqiqaga o'tkazib yuboriladi (javob yo'q)`
      );
    } else {
      errors.push(`${e.name}: ${msg.slice(0, 60)}`);
    }
  }
  return null;
}

/** Reformulatsiya uchun dvigatellarni nom bo'yicha olish (indeks buzuq bo'lmasin) */
const REFORM_ENGINES = ["DuckDuckGo Lite", "Bing", "Google Yangiliklar", "Marginalia", "Mojeek"]
  .map((name) => ENGINE_CHAIN.find((e) => e.name === name))
  .filter((e): e is { name: string; fn: EngineFn } => Boolean(e));

/** Rotatsiya ko'rsatkichi — har chaqiriqda zanjir boshlanish nuqtasi siljiydi,
 *  yuk va bloklanish xavfi barcha dvigatellarga tekis taqsimlanadi */
let rrPointer = 0;

export async function searchOpenWeb(
  query: string,
  num: number
): Promise<OpenSearchResult> {
  // 0) Kesh — bir xil so'rov 8 daqiqa ichida qayta so'ralgan bo'lsa darrov javob
  const cached = cacheGet(query, num);
  if (cached) {
    return { results: cached.results, engine: `${cached.engine} (kesh)`, errors: [] };
  }

  const errors: string[] = [];
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  const pairCount = Math.floor(ENGINE_CHAIN.length / 2);
  const startPair = rrPointer++ % pairCount;

  const success = (engine: string, results: SearchResultItem[]): OpenSearchResult => {
    cacheSet(query, num, results, engine);
    return { results, engine, errors };
  };

  // Juftliklar bilan yurish — har juftlik parallellashadi (tezlik uchun).
  // Boshlanish nuqtasi har chaqiriqda rotatsiya qilinadi: birinchi so'rov DDG'dan,
  // keyingisi Bing'dan, so'ng GNews'dan boshlanadi... — bir dvigatelga ortiqcha
  // yuk tushmaydi va bloklanish kamayadi.
  for (let k = 0; k < pairCount; k++) {
    const i = ((startPair + k) % pairCount) * 2;
    if (Date.now() > deadline) break;
    const pair = ENGINE_CHAIN.slice(i, i + 2);
    const settled = await Promise.all(
      pair.map(async (e) => ({ e, res: await tryEngine(e, query, num, errors) }))
    );
    for (const s of settled) {
      if (s.res) return success(s.e.name, s.res);
    }
  }

  // Operatorli so'rov bo'lsa va hech kim javob bermasa — soddalashtirib qayta so'rash
  if (hasOperators(query)) {
    const simplified = reformulateQuery(query);
    if (simplified && simplified.length >= 3 && Date.now() < deadline - 3000) {
      errors.push(`Soddalashtirilgan so'rov: "${simplified}"`);
      for (const e of REFORM_ENGINES) {
        if (Date.now() > deadline) break;
        const r = await tryEngine(e, simplified, num, errors);
        if (r) {
          // Reformulatsiya natijasi ham ASL so'rov kalitida keshlanadi
          cacheSet(query, num, r, `${e.name}*`);
          return {
            results: r,
            engine: `${e.name}*`,
            errors,
            reformulated: true,
          };
        }
      }
    }
  }

  return { results: [], engine: "open", errors };
}
