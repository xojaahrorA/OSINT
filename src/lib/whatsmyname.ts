// WhatsMyName (whatsmyname.app) integratsiyasi — username'ni 700+ saytda tekshirish
//
// Dataset: WebBreacher/WhatsMyName — wmn-data.json (repo bilan vendor qilingan,
// har 6 soatda fon rejimida yangilab turiladi — whatsmyname.app bilan bir xil yangilik).
//
// Deteksiya mantiqi rasmiy scripts/checker/checker.py semantikasiga to'liq mos:
//   - method  = post_body bor bo'lsa POST, aks holda GET
//   - REDIRECT FOLLOW QILINMAYDI (e_code — birinchi javob kodi, dataset shunga qurilgan)
//   - TOPILDI : status === e_code  && (e_string === "" || body.includes(e_string))
//   - YO'Q    : status === m_code  && (m_string === "" || body.includes(m_string))
//   - qolgani — noma'lum (challenge/captcha/tarmoq xatosi) — natijaga CHIQMAYDI
// Bu — qo'lda yozilgan 7 ta probe emas, har bir sayt uchun kurator tomonidan
// tekshirilgan aniq HTTP/imzo qoidalari (shu sababli whatsmyname.app darajasida aniq).

import raw from "./data/wmn-data.json";

export interface WmnSite {
  name: string;
  uri_check: string;
  uri_pretty?: string;
  e_code: number;
  e_string: string;
  m_code: number;
  m_string: string;
  cat?: string;
  headers?: Record<string, string>;
  post_body?: string;
  strip_bad_char?: string;
  valid?: boolean;
  protection?: string[];
}

const VENDORED: WmnSite[] = (raw.sites as WmnSite[]).filter((s) => s.valid !== false);

// Yangi dataset — 6 soatda bir marta fon rejimida yangilanadi.
// Skaner hech qachon fetch'ni kutmaydi: xato bo'lsa vendored nusxa ishlaydi.
const REFRESH_MS = 6 * 3_600_000;
let fresh: WmnSite[] | null = null;
let refreshAt = 0;

function startRefresh(): void {
  if (Date.now() - refreshAt < REFRESH_MS) return;
  refreshAt = Date.now();
  fetch("https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json", {
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ sites?: WmnSite[] }>) : null))
    .then((j) => {
      const list = j?.sites?.filter((s) => s.valid !== false);
      if (list && list.length > 100) fresh = list;
    })
    .catch(() => {
      /* vendored nusxa qoladi */
    });
}

export function wmnSites(): WmnSite[] {
  startRefresh();
  return fresh ?? VENDORED;
}

// ===== Kategoriyalar — natijalarni guruhlab chiqarish uchun tartib =====
const CAT_ORDER = [
  "social", "coding", "gaming", "art", "blog", "video", "music", "business",
  "finance", "shopping", "images", "hobby", "tech", "news", "political",
  "health", "dating", "misc", "archived", "xx NSFW xx",
];
const catRank = (c?: string) => {
  const i = c ? CAT_ORDER.indexOf(c) : -1;
  return i === -1 ? CAT_ORDER.length : i;
};

// ===== Skaner =====

export interface WmnHit {
  site: WmnSite;
  /** foydalanuvchiga ko'rsatiladigan chiroyli URL (uri_pretty yoki tekshirilgan URL) */
  url: string;
  username: string;
}

export interface WmnProgress {
  checked: number;
  total: number;
  found: number;
  missing: number;
  unknown: number;
}

export interface WmnScanResult {
  username: string;
  hits: WmnHit[];
  missing: number;
  unknown: number;
  total: number;
  elapsedMs: number;
}

const UA_WM =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BODY_MAX = 300_000;

/** checker.py'dagi apply_strip_bad_char — username'dan ayrim belgilarni olib tashlaydi */
function applyStrip(u: string, chars?: string): string {
  if (!chars) return u;
  try {
    const escaped = chars.replace(/[\\\]^\-]/g, "\\$&");
    return u.replace(new RegExp(`[${escaped}]`, "g"), "");
  } catch {
    return u;
  }
}

function fill(tpl: string, u: string): string {
  return tpl.replaceAll("{account}", u);
}

function siteDisplayUrl(site: WmnSite, u: string): string {
  if (site.uri_pretty && site.uri_pretty.includes("{account}")) return fill(site.uri_pretty, u);
  return fill(site.uri_check, u);
}

/** Final javobni e/m qoidalari bilan baholaydi (checkSite va redirect-recovery uchun umumiy) */
function evaluate(
  site: WmnSite,
  status: number,
  body: string
): { state: "found" | "missing" | "unknown" } {
  // TOPILDI: e_code mos + e_string imzosi body'da (e_string bo'sh bo'lsa kod yetarli)
  if (status === site.e_code && (site.e_string === "" || body.includes(site.e_string))) {
    return { state: "found" };
  }
  // YO'Q: m_code mos + m_string imzosi (yo'q sahifasi)
  if (status === site.m_code && (site.m_string === "" || body.includes(site.m_string))) {
    return { state: "missing" };
  }
  return { state: "unknown" };
}

/** Bitta saytni tekshiradi — rasmiy checker semantikasi */
async function checkSite(
  site: WmnSite,
  u: string,
  timeoutMs: number
): Promise<{ state: "found" | "missing" | "unknown"; hit?: WmnHit }> {
  const uu = applyStrip(u, site.strip_bad_char);
  const url = fill(site.uri_check, uu);
  const headers: Record<string, string> = {
    "User-Agent": UA_WM,
    Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(site.headers ?? {}),
  };
  const isPost = !!site.post_body;
  try {
    const res = await fetch(url, {
      method: isPost ? "POST" : "GET",
      headers,
      body: isPost ? fill(site.post_body!, uu) : undefined,
      // MUHIM: redirect follow qilinmaydi — dataset e_code'ni birinchi javobga qurilgan
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const buf = await res.arrayBuffer();
    const body = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, BODY_MAX));
    const status = res.status;

    const first = evaluate(site, status, body);
    if (first.state === "found") {
      return { state: "found", hit: { site, url: siteDisplayUrl(site, uu), username: uu } };
    }

    // Redirect-recovery: ayrim saytlar uri_check'ni profil sahifasiga yo'naltiradi.
    // Birinchi javob 3xx bo'lib topilmadi bo'lsa — bora-bora follow qilib final javobni
    // ham baholaymiz (e_code=302 bo'lgan saytlar yuqorida allaqachon topilgan bo'ladi).
    if (!isPost && status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          const res2 = await fetch(new URL(loc, url).toString(), {
            method: "GET",
            headers: { "User-Agent": UA_WM, Accept: headers.Accept },
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
          });
          const buf2 = await res2.arrayBuffer();
          const body2 = new TextDecoder("utf-8", { fatal: false }).decode(buf2.slice(0, BODY_MAX));
          const second = evaluate(site, res2.status, body2);
          if (second.state === "found") {
            return { state: "found", hit: { site, url: siteDisplayUrl(site, uu), username: uu } };
          }
          if (second.state === "missing") return { state: "missing" };
        } catch {
          /* redirect ergashib bo'lmadi — noma'lum qoladi */
        }
      }
    }

    return first.state === "missing" ? { state: "missing" } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

export type WmnProgressCb = (p: WmnProgress) => void;

/**
 * Berilgan saytlar ro'yxatini parallel tekshiradi (worker pool).
 * scanWhatsMyName va validatsiya testlari (dataset 'known' username'lari) ishlatadi.
 */
export async function checkSites(
  sites: WmnSite[],
  username: string,
  opts: {
    concurrency?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEach?: (r: { state: "found" | "missing" | "unknown"; hit?: WmnHit; site: WmnSite }) => void;
  } = {}
): Promise<{ hits: WmnHit[]; missing: number; unknown: number; checked: number }> {
  const total = sites.length;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 32, 64));
  const timeoutMs = opts.timeoutMs ?? 9_000;

  const hits: WmnHit[] = [];
  let checked = 0;
  let missing = 0;
  let unknown = 0;

  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < total) {
      if (opts.signal?.aborted) return;
      const site = sites[idx++];
      try {
        const r = await checkSite(site, username, timeoutMs);
        checked++;
        if (r.state === "found" && r.hit) {
          hits.push(r.hit);
        } else if (r.state === "missing") missing++;
        else unknown++;
        opts.onEach?.({ ...r, site });
      } catch {
        checked++;
        unknown++;
        opts.onEach?.({ state: "unknown", site });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { hits, missing, unknown, checked };
}

/**
 * Username'ni barcha WhatsMyName saytlarida parallel tekshiradi.
 * Konkurrentlik 32 — whatsmyname.app tezligiga yaqin, lekin IP'ni to'liq to'fon qilmaydi.
 */
export async function scanWhatsMyName(
  rawUsername: string,
  opts: {
    concurrency?: number;
    timeoutMs?: number;
    onProgress?: WmnProgressCb;
    signal?: AbortSignal;
  } = {}
): Promise<WmnScanResult> {
  const started = Date.now();
  const u = rawUsername.trim().replace(/^@/, "");
  const sites = wmnSites();
  const total = sites.length;
  const concurrency = Math.max(8, Math.min(opts.concurrency ?? 32, 64));
  const timeoutMs = opts.timeoutMs ?? 9_000;

  const hits: WmnHit[] = [];
  let checked = 0;
  let found = 0;
  let missing = 0;
  let unknown = 0;
  let lastReport = 0;

  const report = (force = false) => {
    if (!opts.onProgress) return;
    if (!force && checked - lastReport < 40) return;
    lastReport = checked;
    try {
      opts.onProgress({ checked, total, found, missing, unknown });
    } catch {
      /* progress callback xatosi skanerni to'xtatmasin */
    }
  };

  const res = await checkSites(sites, u, {
    concurrency,
    timeoutMs,
    signal: opts.signal,
    onEach: (r) => {
      checked++;
      if (r.state === "found") {
        found++;
        if (r.hit) hits.push(r.hit);
      } else if (r.state === "missing") missing++;
      else unknown++;
      report();
    },
  });
  report(true);

  hits.sort((a, b) => {
    const d = catRank(a.site.cat) - catRank(b.site.cat);
    return d !== 0 ? d : a.site.name.localeCompare(b.site.name);
  });

  return {
    username: u,
    hits,
    missing: res.missing,
    unknown: res.unknown,
    total,
    elapsedMs: Date.now() - started,
  };
}
