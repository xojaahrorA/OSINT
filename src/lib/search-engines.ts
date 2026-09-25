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
export const SEARCH_ENGINES_VERSION = "multi-9-engines";

const UA_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
    { ua: UA_CHROME }
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
    { ua: UA_CHROME }
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
const SEARX_INSTANCES = [
  "https://searx.be",
  "https://search.inetol.net",
  "https://searx.tiekoetter.com",
  "https://searx.ninja",
];

export async function searxSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const errors: string[] = [];
  for (const inst of SEARX_INSTANCES) {
    try {
      const html = await fetchHtml(
        `${inst}/search?q=${encodeURIComponent(query)}`,
        { ua: UA_CHROME, timeoutMs: 8000, headers: { Accept: "text/html" } }
      );
      const results: SearchResultItem[] = [];
      const re =
        /<article[^>]+class="[^"]*result[^"]*[\s\S]*?<h3[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && results.length < num) {
        const url = decodeEntities(m[1]);
        if (!/^https?:\/\//i.test(url)) continue;
        results.push({
          name: stripTags(m[2]) || hostOf(url),
          url,
          snippet: "",
          host_name: hostOf(url),
        });
      }
      if (results.length > 0) {
        return operatorFilter(query, results, true);
      }
      errors.push(`${hostOf(inst)}: natija yo'q`);
    } catch (e) {
      errors.push(`${hostOf(inst)}: ${String(e).slice(0, 40)}`);
    }
  }
  throw new Error(errors.join("; ").slice(0, 100));
}

// ===== Zanjir: barcha dvigatellar ketma-ket (juftliklar bilan parallellashgan) =====

type EngineFn = (query: string, num: number) => Promise<SearchResultItem[]>;

const ENGINE_CHAIN: { name: string; fn: EngineFn }[] = [
  { name: "DuckDuckGo", fn: ddgHtmlSearch },
  { name: "DuckDuckGo Lite", fn: ddgLiteSearch },
  { name: "Mojeek", fn: mojeekSearch },
  { name: "Brave", fn: braveSearch },
  { name: "Qwant", fn: qwantSearch },
  { name: "Bing", fn: bingSearch },
  { name: "Google Yangiliklar", fn: googleNewsRssSearch },
  { name: "Bing Yangiliklar", fn: bingNewsRssSearch },
  { name: "SearXNG", fn: searxSearch },
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
    errors.push(`${e.name}: ${String(err).slice(0, 60)}`);
  }
  return null;
}

const REFORM_ENGINES = [
  ENGINE_CHAIN[1], // DuckDuckGo Lite
  ENGINE_CHAIN[2], // Mojeek
  ENGINE_CHAIN[3], // Brave
  ENGINE_CHAIN[5], // Bing
  ENGINE_CHAIN[6], // Google Yangiliklar
];

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
