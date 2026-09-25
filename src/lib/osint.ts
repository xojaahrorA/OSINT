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
  num?: number;
  recency_days?: number;
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
    num: 6,
  },
  {
    id: "video",
    title: "Video va media",
    icon: "Youtube",
    description: "YouTube, Vimeo va boshqa video platformalardagi izlar",
    appliesTo: ALL,
    queries: (t) => [`site:youtube.com ${q(t)}`, `site:vimeo.com OR site:dailymotion.com ${q(t)}`],
    num: 6,
  },
  {
    id: "forums",
    title: "Forum va jamoalar",
    icon: "MessagesSquare",
    description: "Reddit, Quora va turli forumlardagi xabarlar",
    appliesTo: ALL,
    queries: (t) => [`site:reddit.com OR site:quora.com ${q(t)}`, `${q(t)} forum jamoa izoh`],
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
    num: 6,
  },
  {
    id: "news",
    title: "Yangiliklar va ensiklopediya",
    icon: "Newspaper",
    description: "So'nggi yangiliklar (1 yil) va Vikipediyadagi eslatib o'tishlar",
    appliesTo: ALL,
    queries: (t) => [`${q(t)} yangiliklar`, `site:wikipedia.org ${q(t)}`],
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
