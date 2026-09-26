// OSINT Radar — umumiy tiplar va modul ta'riflari
// Bu fayl server (API) va klient tomonida ishlatiladi, SDK import QILINMAYDI.

export type TargetType =
  | "username"
  | "email"
  | "phone"
  | "name"
  | "domain"
  | "ip";

export const TARGET_TYPES: { value: TargetType; label: string; hint: string; example: string }[] = [
  { value: "username", label: "Username", hint: "Foydalanuvchi nomi (@belgisiz)", example: "dilshod_dev" },
  { value: "email", label: "Email", hint: "Elektron pochta manzili", example: "info@example.uz" },
  { value: "phone", label: "Telefon", hint: "Raqam (xalqaro formatda)", example: "+998901234567" },
  { value: "name", label: "Ism-familiya", hint: "Shaxsning to'liq ismi", example: "Muhammad Karimov" },
  { value: "domain", label: "Domen", hint: "Sayt nomi (https://siz)", example: "example.uz" },
  { value: "ip", label: "IP manzil", hint: "IPv4 yoki IPv6", example: "8.8.8.8" },
];

export interface SearchResultItem {
  name: string;
  url: string;
  snippet: string;
  host_name: string;
  date?: string;
  favicon?: string;
}

export interface ModuleResult {
  moduleId: string;
  moduleTitle: string;
  status: "running" | "done" | "error";
  count: number;
  results: SearchResultItem[];
}

export interface OsintModuleDef {
  id: string;
  title: string;
  icon: string;
  description: string;
  appliesTo: TargetType[] | "all";
  queries: (t: string) => string[];
  /** Chuqur bosqich uchun qo'shimcha (kengaytirilgan) so'rovlar — deepOnly/extended rejimlarda ishlatiladi */
  deepQueries?: (t: string) => string[];
  num?: number;
  recency_days?: number;
}

/** Adaptiv chuqur taramok bosqichlari */
export type DeepStep =
  | "idle"
  | "global"
  | "focused"
  | "review"
  | "pivots"
  | "done"
  | "stopped";

export interface PivotCandidate {
  kind: TargetType;
  value: string;
  /** topilgan manba (host) */
  source: string;
  /** avtomatik rekursiyaga yaramidi yoki faqat qo'lda "+" orqali */
  auto: boolean;
}

export interface LogLine {
  id: number;
  time: string;
  level: "info" | "ok" | "warn" | "error" | "sys";
  module?: string;
  message: string;
}

export interface ScanEvent {
  type: "start" | "log" | "module_start" | "module_done" | "progress" | "done" | "error";
  target?: string;
  targetType?: TargetType;
  modulesPlanned?: string[];
  log?: LogLine;
  moduleId?: string;
  moduleTitle?: string;
  count?: number;
  total?: number;
  results?: SearchResultItem[];
  totalResults?: number;
  elapsedMs?: number;
  message?: string;
}

const q = (s: string) => `"${s}"`;

const ALL: TargetType[] = ["username", "email", "phone", "name", "domain", "ip"];

export const OSINT_MODULES: OsintModuleDef[] = [
  {
    id: "search",
    title: "Qidiruv tizimlari",
    icon: "Globe",
    description: "Umumiy ochiq qidiruv: profil, manzil va eslatib o'tishlar",
    appliesTo: ALL,
    queries: (t) => [q(t), `${q(t)} profil ma'lumotlar`],
    deepQueries: (t) => [
      `${q(t)} (kim bu OR ta'rif OR maqola OR tarjimai hol)`,
      `${q(t)} (bio OR profil OR rezyume OR portfolio)`,
    ],
    num: 8,
  },
  {
    id: "social",
    title: "Ijtimoiy tarmoqlar",
    icon: "Users",
    description: "Instagram, Facebook, X/Twitter, LinkedIn, TikTok, VK, Telegram",
    appliesTo: ALL,
    queries: (t) => [
      `site:instagram.com OR site:facebook.com ${q(t)}`,
      `site:x.com OR site:twitter.com OR site:t.me ${q(t)}`,
      `site:linkedin.com OR site:tiktok.com OR site:vk.com ${q(t)}`,
    ],
    deepQueries: (t) => [
      `site:linkedin.com/in OR site:linkedin.com/pub ${q(t)}`,
      `site:t.me OR site:telegram.me ${q(t)}`,
      `site:github.com OR site:gitlab.com ${q(t)}`,
      `site:vk.com OR site:ok.ru OR site:pinterest.com ${q(t)}`,
    ],
    num: 6,
  },
  {
    id: "video",
    title: "Video va media",
    icon: "Youtube",
    description: "YouTube, Vimeo va boshqa video platformalardagi izlar",
    appliesTo: ALL,
    queries: (t) => [`site:youtube.com ${q(t)}`, `site:vimeo.com OR site:dailymotion.com ${q(t)}`],
    deepQueries: (t) => [
      `site:youtube.com ${q(t)} (kanal OR video OR shorts)`,
      `site:tiktok.com OR site:twitch.tv ${q(t)}`,
    ],
    num: 6,
  },
  {
    id: "forums",
    title: "Forum va jamoalar",
    icon: "MessagesSquare",
    description: "Reddit, Quora va turli forumlardagi xabarlar",
    appliesTo: ALL,
    queries: (t) => [`site:reddit.com OR site:quora.com ${q(t)}`, `${q(t)} forum jamoa izoh`],
    deepQueries: (t) => [
      `site:reddit.com ${q(t)} (post OR koment OR thread)`,
      `site:stackoverflow.com OR site:habr.com ${q(t)}`,
      `${q(t)} forum a'zosi foydalanuvchi post`,
    ],
    num: 6,
  },
  {
    id: "docs",
    title: "Hujjatlar va fayllar",
    icon: "FileText",
    description: "PDF hujjatlar, pastebin, Google Docs, SlideShare",
    appliesTo: ALL,
    queries: (t) => [
      `${q(t)} filetype:pdf`,
      `site:pastebin.com OR site:scribd.com OR site:docs.google.com ${q(t)}`,
    ],
    deepQueries: (t) => [
      `site:pastebin.com ${q(t)}`,
      `${q(t)} (filetype:pdf OR filetype:docx OR filetype:xlsx)`,
      `site:github.com ${q(t)} (README OR profil OR repo)`,
    ],
    num: 6,
  },
  {
    id: "news",
    title: "Yangiliklar va ensiklopediya",
    icon: "Newspaper",
    description: "So'nggi yangiliklar (1 yil) va Vikipediyadagi eslatib o'tishlar",
    appliesTo: ALL,
    queries: (t) => [`${q(t)} yangiliklar`, `site:wikipedia.org ${q(t)}`],
    deepQueries: (t) => [
      `${q(t)} (intervyu OR bayonot OR konferensiya)`,
      `${q(t)} (loyiha OR kompaniya OR biznes OR jamoa)`,
    ],
    num: 6,
    recency_days: 365,
  },
  {
    id: "tech",
    title: "Texnik izlar",
    icon: "Server",
    description: "WHOIS, DNS, Shodan va sertifikat jurnallari",
    appliesTo: ["domain", "ip"],
    queries: (t) => [
      `${q(t)} whois DNS manzil`,
      `site:shodan.io OR site:crt.sh ${q(t)}`,
      `${q(t)} geolokatsiya subnet tarmoq`,
    ],
    deepQueries: (t) => [
      `site:shodan.io OR site:censys.io OR site:zoomeye.com ${q(t)}`,
      `${q(t)} (DNS OR MX OR TXT yozuvlar OR SSL sertifikat OR subdomen)`,
    ],
    num: 6,
  },
];

// Username uchun to'g'ridan-to'g'ri profil havolalari (passive tekshiruv uchun)
export function buildProfileLinks(username: string): SearchResultItem[] {
  const u = username.replace(/^@/, "").trim();
  const platforms: { name: string; url: string; host: string }[] = [
    { name: "Instagram", url: `https://instagram.com/${u}`, host: "instagram.com" },
    { name: "Facebook", url: `https://facebook.com/${u}`, host: "facebook.com" },
    { name: "X (Twitter)", url: `https://x.com/${u}`, host: "x.com" },
    { name: "Telegram", url: `https://t.me/${u}`, host: "t.me" },
    { name: "GitHub", url: `https://github.com/${u}`, host: "github.com" },
    { name: "Reddit", url: `https://reddit.com/user/${u}`, host: "reddit.com" },
    { name: "YouTube", url: `https://youtube.com/@${u}`, host: "youtube.com" },
    { name: "TikTok", url: `https://tiktok.com/@${u}`, host: "tiktok.com" },
    { name: "VK", url: `https://vk.com/${u}`, host: "vk.com" },
    { name: "Medium", url: `https://medium.com/@${u}`, host: "medium.com" },
    { name: "Pinterest", url: `https://pinterest.com/${u}`, host: "pinterest.com" },
    { name: "Behance", url: `https://behance.net/${u}`, host: "behance.net" },
  ];
  return platforms.map((p) => ({
    name: `${p.name} — @${u}`,
    url: p.url,
    snippet: "To'g'ridan-to'g'ri profil havolasi. Mavjudligini brauzerda ochib tekshiring (tizim faqat ochiq qidiruvdan foydalanadi).",
    host_name: p.host,
  }));
}

export function getModuleIcon(moduleId: string): string {
  return OSINT_MODULES.find((m) => m.id === moduleId)?.icon ?? "Globe";
}

// ===== Adaptiv chuqur taramok yordamchilari =====

/** Katta platformalar — ularning hostnomasi "domen pivot" sifatida foydasiz */
const PLATFORM_DOMAINS = new Set([
  "instagram.com", "facebook.com", "x.com", "twitter.com", "t.me", "telegram.me",
  "linkedin.com", "tiktok.com", "vk.com", "ok.ru", "github.com", "gitlab.com",
  "medium.com", "pinterest.com", "behance.net", "reddit.com", "quora.com",
  "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "twitch.tv",
  "wikipedia.org", "google.com", "yandex.com", "yandex.ru", "mail.ru",
  "pastebin.com", "scribd.com", "docs.google.com", "shodan.io", "censys.io",
  "crt.sh", "stackoverflow.com", "habr.com", "substack.com", "imgur.com",
  "flickr.com", "zoomeye.com", "dailymail.co.uk",
]);

/** Bepul pochta domeni — bundan "domen pivot" chiqarmaymiz */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "proton.me", "protonmail.com", "mail.ru", "yandex.ru",
  "yandex.com", "zoho.com", "gmx.com", "inbox.ru", "bk.ru", "list.ru",
]);

const PROFILE_URL_SEGMENTS = new Set([
  "p", "reel", "reels", "watch", "user", "users", "in", "pub", "company",
  "channel", "c", "hashtag", "status", "post", "question", "topics", "tag",
  "search", "profile", "u", "id", "share", "shares", "video", "photo",
  "shorts", "playlist", "groups", "events", "comments",
]);

/** Qidiruv natijasi URL'ni yagona kalitga aylantirish (dedupe uchun) */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}${path === "/" ? "" : path}`.toLowerCase();
  } catch {
    return u.replace(/[#?].*$/, "").toLowerCase();
  }
}

/** Matnga qarab maqsad turini avtomatik aniqlash (pivotlar uchun) */
export function detectTargetType(text: string): TargetType {
  const t = text.trim();
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return "email";
  if (/^\+\d{7,15}$/.test(t.replace(/[\s().-]/g, ""))) return "phone";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(t)) return "ip";
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) && !t.includes(" ")) return "domain";
  if (!t.includes(" ") && /^[a-z0-9._-]{3,32}$/i.test(t) && !/^\+?\d+$/.test(t)) return "username";
  return "name";
}

/**
 * Natija (sarlavha + snippet + URL) ichidan yangi qidiruv maqsadlari
 * (pivotlar) ajratib oladi: email, username, telefon, domen, IP.
 * auto=false bo'lganlar faqat foydalanuvchi "+" tugmasi bilan qidiriladi.
 */
export function extractPivots(
  item: { name: string; url: string; snippet: string }
): PivotCandidate[] {
  const out: PivotCandidate[] = [];
  const seen = new Set<string>();

  const push = (kind: TargetType, raw: string, auto: boolean) => {
    let value = raw.trim().toLowerCase().replace(/[.,;:!)\]]+$/, "");
    if (kind === "phone") value = value.replace(/[\s().-]/g, "");
    if (kind === "username") value = value.replace(/^@+/, "").replace(/[._-]+$/, "");
    if (kind === "domain") value = value.replace(/^www\./, "");
    if (!value || value.length < 4 || value.length > 254) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, source: "", auto });
  };

  const text = `${item.name} ${item.snippet}`;

  // 1) Email — korporativ domendan avtomatik domen pivot ham chiqadi
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const email = m[0].toLowerCase();
    const dom = email.split("@")[1] ?? "";
    push("email", email, true);
    if (dom && !FREEMAIL_DOMAINS.has(dom) && !PLATFORM_DOMAINS.has(dom)) {
      push("domain", dom, true);
    }
  }

  // 2) Xalqaro telefon (+ bilan boshlanadigan, false-positive kam)
  for (const m of text.matchAll(/\+\d[\d\s().-]{6,16}\d/g)) {
    push("phone", m[0], true);
  }

  // 3) IP manzil — avtomatik emas (ommaviy IP'lar ko'p uchraydi), faqat qo'lda
  for (const m of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const parts = m[0].split(".").map(Number);
    if (parts.every((n) => n <= 255) && parts[0] >= 1 && parts[3] >= 1) {
      push("ip", m[0], false);
    }
  }

  // 4) @username izohlari
  for (const m of text.matchAll(/(^|[\s(@:])@([a-z0-9._-]{3,30})/gi)) {
    const h = m[2];
    if (h.length >= 3 && !/^\d+$/.test(h)) push("username", h, true);
  }

  // 5) URL tahlili — platforma profil username'lari va nodavlat domenlar
  try {
    const u = new URL(item.url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const isPlatform =
      PLATFORM_DOMAINS.has(host) ||
      [...PLATFORM_DOMAINS].some((d) => host.endsWith(`.${d}`));
    if (!isPlatform && !FREEMAIL_DOMAINS.has(host) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
      push("domain", host, false);
    }
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (
      isPlatform &&
      seg &&
      !PROFILE_URL_SEGMENTS.has(seg.toLowerCase()) &&
      /^[a-z0-9._-]{3,30}$/i.test(seg) &&
      !/^\d+$/.test(seg)
    ) {
      push("username", seg, true);
    }
  } catch {
    /* URL noto'g'ri — tashlab ketamiz */
  }

  // Manba ma'lumotini to'ldirib, har turdan eng ko'pi bilan 2 tadan qoldiramiz
  let source = "";
  try {
    source = new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    /* source bo'sh qoladi */
  }
  const byKind = new Map<string, PivotCandidate[]>();
  for (const p of out) {
    const arr = byKind.get(p.kind) ?? [];
    arr.push(p);
    byKind.set(p.kind, arr);
  }
  const limited: PivotCandidate[] = [];
  for (const arr of byKind.values()) {
    for (const p of arr.slice(0, 2)) {
      limited.push({ ...p, source });
    }
  }
  return limited.slice(0, 6);
}

/** Pivot turlarining avtomatik rekursiya ustuvorligi (kichik = birinchi) */
export const PIVOT_PRIORITY: Record<TargetType, number> = {
  email: 0,
  username: 1,
  phone: 2,
  domain: 3,
  ip: 4,
  name: 5,
};
