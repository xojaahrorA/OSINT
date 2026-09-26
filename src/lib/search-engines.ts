import type { SearchResultItem } from "./osint";

/**
 * Ko'p qatlamli ochiq qidiruv dvigatellari — API kalitsiz, istalgan mashinada.
 *
 * Z.ai SDK faqat Z.ai sandbox muhitida ishlaydi. Lokal mashinalarda (Kali,
 * Windows, macOS) skaner avtomatik shu zanjirga o'tadi:
 *
 *   DuckDuckGo HTML → DuckDuckGo Lite → Mojeek → Brave → Qwant
 *   → Bing → Google Yangiliklar RSS → Bing Yangiliklar RSS → SearXNG
 *
 * Har bir dvigatel javobi operator filtri (site:/"ibora") o'tkaziladi —
 * ba'zi dvigatellar operatorli so'rovga soxta (mos bo'lmagan) natija
 * qaytaradi. Agar barcha dvigatellar bo'sh bo'lsa va so'rovda operator
 * bo'lsa — so'rov avtomatik soddalashtirilib qayta so'raladi.
 */

// dvigatellarni yangilaganda ham bu satr saqlansin — diagnostika kod
// versiyasini shu belgi orqali aniqlaydi
export const SEARCH_ENGINES_VERSION = "multi-10-engines";

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
  } = {}
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
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

  return results.filter((r) => {
    const hay = `${r.name} ${r.snippet} ${r.url}`.toLowerCase();
    return [...stems].some((s) => hay.includes(s));
  });
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
export async function ddgHtmlSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  );
  if (/anomaly|challenge|blocked/i.test(html.slice(0, 2000)))
    throw new Error("DDG blok (anomaly)");
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
  return operatorFilter(query, results);
}

// ===== 2. DuckDuckGo Lite =====
export async function ddgLiteSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  );
  if (/anomaly|challenge|blocked/i.test(html.slice(0, 2000)))
    throw new Error("DDG blok (anomaly)");
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
  const html = await fetchHtml(
    `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    { ua: UA_CHROME, headers: chromeBrowserHeaders() }
  );
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

export async function bingSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(
      num,
      10
    )}&mkt=en-US&setlang=en`
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
  return operatorFilter(
    query.replace(/"/g, " "),
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
  return operatorFilter(
    query.replace(/"/g, " "),
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
 * QAYD: API ba'zan sekinlashadi/osilib qoladi — shuning uchun qisqa 5s
 * timeout qo'llanadi; osilib qolsa zanjir tezda keyingi dvigatelga o'tadi.
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
      timeoutMs: 5000,
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

// ===== Zanjir: barcha dvigatellar ketma-ket (juftliklar bilan parallellashgan) =====

type EngineFn = (query: string, num: number) => Promise<SearchResultItem[]>;

const ENGINE_CHAIN: { name: string; fn: EngineFn }[] = [
  // 1-juftlik: tekshirilgan ishonchli dvigatellar
  { name: "DuckDuckGo", fn: ddgHtmlSearch },
  { name: "DuckDuckGo Lite", fn: ddgLiteSearch },
  // 2-juftlik: Microsoft/Google yangiliklari ham barqaror
  { name: "Bing", fn: bingSearch },
  { name: "Google Yangiliklar", fn: googleNewsRssSearch },
  // 3-juftlik: server-render SearXNG (paulgo.io) + Marginalia JSON API
  { name: "Bing Yangiliklar", fn: bingNewsRssSearch },
  { name: "SearXNG", fn: searxSearch },
  { name: "Marginalia", fn: marginaliaSearch },
  // 4-juftlik: qattiq bot-aniqlagichli dvigatellar — ko'pincha 403/429
  { name: "Mojeek", fn: mojeekSearch },
  { name: "Brave", fn: braveSearch },
  // 5-juftlik: DataDome himoyalangan — zaxira oxirida
  { name: "Qwant", fn: qwantSearch },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENGINE_TIMEOUT_MS = 6500;
const CHAIN_BUDGET_MS = 17000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    ),
  ]);
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
  try {
    const raw = await withTimeout(e.fn(query, num), ENGINE_TIMEOUT_MS);
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
    // Blok/rate-limit xatosi bo'lsa — dvigatelni 10 daqiqaga sovitamiz:
    // keyingi skanerlar u dvigatelni umuman tekshirmaydi, zanjir tezlashadi.
    if (/HTTP (403|429|503)/.test(msg)) {
      setCooldown(e.name);
      errors.push(
        `${e.name}: ${msg.slice(0, 60)} — ${COOLDOWN_MINUTES} daqiqaga o'tkazib yuboriladi`
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

export async function searchOpenWeb(
  query: string,
  num: number
): Promise<OpenSearchResult> {
  const errors: string[] = [];
  const deadline = Date.now() + CHAIN_BUDGET_MS;

  // Juftliklar bilan yurish — har juftlik parallellashadi (tezlik uchun)
  for (let i = 0; i < ENGINE_CHAIN.length; i += 2) {
    if (Date.now() > deadline) break;
    const pair = ENGINE_CHAIN.slice(i, i + 2);
    const settled = await Promise.all(
      pair.map(async (e) => ({ e, res: await tryEngine(e, query, num, errors) }))
    );
    for (const s of settled) {
      if (s.res) return { results: s.res, engine: s.e.name, errors };
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
        if (r)
          return {
            results: r,
            engine: `${e.name}*`,
            errors,
            reformulated: true,
          };
      }
    }
  }

  return { results: [], engine: "open", errors };
}
