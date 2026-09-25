import type { SearchResultItem } from "./osint";

/**
 * Ochiq qidiruv dvigatellari — API kalitsiz, istalgan mashinada ishlaydi.
 * Z.ai SDK mavjud bo'lmagan muhitlarda (masalan, lokal Kali/Windows mashina)
 * skaner avtomatik shu dvigatellarga o'tadi: DuckDuckGo → Bing.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

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

async function fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,uz;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ===== DuckDuckGo (HTML) =====
export async function ddgSearch(
  query: string,
  num: number
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  );
  const results: SearchResultItem[] = [];

  const linkRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe =
    /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
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

// ===== Bing (HTML) =====
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

/**
 * Bing ba'zan operatorli so'rovlar (site:, "aniq ibora") uchun mos bo'lmagan
 * zaxira (fallback) natijalar qaytaradi. OSINT uchun soxta topilmalar xavfli —
 * shuning uchun natijalar so'rov operatorlari bo'yicha qattiq filtrlanadi.
 */
function bingRelevanceFilter(
  query: string,
  results: SearchResultItem[]
): SearchResultItem[] {
  const siteDomains = [...query.matchAll(/site:([a-z0-9.-]+)/gi)].map((m) =>
    m[1].toLowerCase().replace(/^www\./, "")
  );
  const phrases = [...query.matchAll(/"([^"]{2,})"/g)].map((m) =>
    m[1].toLowerCase()
  );

  return results.filter((r) => {
    let host = "";
    try {
      host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return false;
    }
    if (
      siteDomains.length > 0 &&
      !siteDomains.some((d) => host === d || host.endsWith(`.${d}`))
    ) {
      return false;
    }
    if (phrases.length > 0) {
      const hay = `${r.name} ${r.snippet}`.toLowerCase();
      if (!phrases.every((p) => hay.includes(p))) return false;
    }
    return true;
  });
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
  return bingRelevanceFilter(query, results);
}

// ===== Fallback zanjiri: DuckDuckGo → Bing (1 marta qayta urinish bilan) =====
export interface OpenSearchResult {
  results: SearchResultItem[];
  engine: string;
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function searchOpenWeb(
  query: string,
  num: number
): Promise<OpenSearchResult> {
  const errors: string[] = [];

  // 2 urinish: dvigatellar tez-tez so'rovlarda vaqtinchalik blok qo'yadi —
  // qisqa pauzadan keyin yana bir marta so'rash yordam beradi.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1600);

    try {
      const r = await ddgSearch(query, num);
      if (r.length > 0) return { results: r, engine: "DuckDuckGo", errors };
      errors.push(`DuckDuckGo: natija yo'q yoki bloklandi`);
    } catch (e) {
      errors.push(`DuckDuckGo: ${String(e).slice(0, 70)}`);
    }

    try {
      const r = await bingSearch(query, num);
      if (r.length > 0) return { results: r, engine: "Bing", errors };
      errors.push("Bing: natija yo'q yoki bloklandi");
    } catch (e) {
      errors.push(`Bing: ${String(e).slice(0, 70)}`);
    }
  }

  return { results: [], engine: "open", errors };
}
