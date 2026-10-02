// OSINT Radar — umumiy tiplar va modul ta'riflari
// Bu fayl server (API) va klient tomonida ishlatiladi, SDK import QILINMAYDI.

import {
  nameVariantCoreQueries,
  nameVariantDeepQueries,
} from "./name-variants";

export type TargetType =
  | "username"
  | "email"
  | "phone"
  | "name"
  | "domain"
  | "ip"
  | "company";

export const TARGET_TYPES: { value: TargetType; label: string; hint: string; example: string }[] = [
  { value: "username", label: "Username", hint: "Foydalanuvchi nomi (@belgisiz)", example: "dilshod_dev" },
  { value: "email", label: "Email", hint: "Elektron pochta manzili", example: "info@example.uz" },
  { value: "phone", label: "Telefon", hint: "Raqam (xalqaro formatda)", example: "+998901234567" },
  { value: "name", label: "Ism-familiya", hint: "Shaxsning to'liq ismi", example: "Muhammad Karimov" },
  { value: "company", label: "Kompaniya/Tashkilot", hint: "Kompaniya nomi yoki sayt manzili (URL)", example: "Uzum Market yoki uzum.uz" },
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
  /** Jonli tekshiruv natijasi (profil havolalari): "yes" — tasdiqlandi, "no" — mavjud emas, "unknown" — aniqlanmadi */
  verified?: "yes" | "no" | "unknown";
  /** Tekshiruv izohi — nima uchun shunday xulosa qilingani */
  verifyNote?: string;
}

export interface ModuleResult {
  moduleId: string;
  moduleTitle: string;
  status: "running" | "done" | "error";
  count: number;
  results: SearchResultItem[];
}

/** To'g'ridan-to'g'ri ma'lumot manbasi metadata'si (OSINT Framework uslubi) */
export interface DirectModuleMeta {
  id: string;
  title: string;
  icon: string;
  description: string;
  appliesTo: TargetType[];
}

/**
 * Domen/IP uchun to'g'ridan-to'g'ri API manbalari — qidiruv tizimlari o'rniga
 * real ma'lumot bazalariga ulanadi (DNS, WHOIS, sertifikatlar, Shodan va h.k).
 * Run funksiyalari src/lib/osint-sources.ts da (server-side).
 */
export const DIRECT_MODULE_META: DirectModuleMeta[] = [
  {
    id: "dns",
    title: "DNS yozuvlari",
    icon: "Network",
    description: "A, AAAA, MX, NS, TXT, SOA, CAA yozuvlari — DNS-over-HTTPS orqali",
    appliesTo: ["domain"],
  },
  {
    id: "whois",
    title: "Domen ro'yxati (RDAP)",
    icon: "Activity",
    description: "Registrator, ro'yxatga olish sanasi, muddat, holat va nameserverlar",
    appliesTo: ["domain"],
  },
  {
    id: "subdomains",
    title: "Subdomenlar",
    icon: "Layers",
    description: "crt.sh sertifikat shaffofligi va Wayback Machine arxivi orqali",
    appliesTo: ["domain"],
  },
  {
    id: "site-probe",
    title: "Sayt tahlili",
    icon: "Radar",
    description: "Sarlavha, texnologiyalar, xavfsizlik sarlavhalari, email va tarmoqlar, robots.txt",
    appliesTo: ["domain"],
  },
  {
    id: "recon",
    title: "Tashqi rekon",
    icon: "Crosshair",
    description: "urlscan.io skanerlari va bir serverdagi qo'shni domenlar",
    appliesTo: ["domain"],
  },
  {
    id: "company-signals",
    title: "Firibgarlik signallari",
    icon: "ShieldQuestion",
    description:
      "Domen yoshi, WHOIS maxfiyligi, hosting/proxy belgilari va reestr havolasi — firibgarlik xavfini baholash",
    appliesTo: ["company", "domain"],
  },
  {
    id: "ip-intel",
    title: "IP razvedka",
    icon: "Zap",
    description: "Geolokatsiya, ISP/ASN, ochiq portlar va zaifliklar (Shodan InternetDB)",
    appliesTo: ["ip"],
  },
  {
    id: "whois-ip",
    title: "Tarmoq egasi (RDAP)",
    icon: "Activity",
    description: "IP blok egasi, tarmoq nomi, diapazon va abuse kontakti",
    appliesTo: ["ip"],
  },
  {
    id: "ptr-recon",
    title: "PTR va qo'shnilar",
    icon: "Server",
    description: "Reverse DNS (PTR) va shu IP'da joylashgan boshqa domenlar",
    appliesTo: ["ip"],
  },
  // ---- Email: OSINT Framework bepul manbalari ----
  {
    id: "breaches",
    title: "Ma'lumot oqishlari",
    icon: "ShieldAlert",
    description: "Email qaysi ommaviy oqishlarga duch kelgan, parollar holati va xavf bali (XposedOrNot)",
    appliesTo: ["email"],
  },
  {
    id: "gravatar",
    title: "Gravatar profil",
    icon: "UserRound",
    description: "Email bilan bog'langan avatar, ism, bio va bog'langan ijtimoiy profillar",
    appliesTo: ["email"],
  },
  {
    id: "mailbox",
    title: "Pochta serveri",
    icon: "MailCheck",
    description: "MX, SPF va DMARC — pochta provayderi va manzil haqiqiyligini tekshirish",
    appliesTo: ["email"],
  },
  {
    id: "corp-domain",
    title: "Korporativ domen",
    icon: "Building2",
    description: "Freemail bo'lmagan domenda: WHOIS, sayt tahlili, kontaktlar, ijtimoiy tarmoqlar, server IP",
    appliesTo: ["email"],
  },
  {
    id: "github-email",
    title: "GitHub commitlari",
    icon: "Github",
    description: "Bu email bilan yozilgan ommaviy commitlar — haqiqiy ism va username aniqlanadi",
    appliesTo: ["email"],
  },
  {
    id: "email-username",
    title: "Email → Username",
    icon: "UserRoundSearch",
    description:
      "Maltego uslubi: email lokal qismi (@dan oldingi) ko'pincha username ham bo'ladi — 12 platformada JONLI tekshiriladi, faqat mavjud profillar qoladi",
    appliesTo: ["email"],
  },
  // ---- Username / Telefon / Ism: OSINT Framework bepul manbalari ----
  {
    id: "whatsmyname",
    title: "WhatsMyName — 700+ sayt",
    icon: "ScanSearch",
    description:
      "Username whatsmyname.app dataseti bilan tekshiriladi: har bir sayt uchun aniq HTTP kod va imzo qoidalari (kategoriya: social, gaming, coding va h.k.)",
    appliesTo: ["username"],
  },
  {
    id: "username-probe",
    title: "Profil tekshiruvi",
    icon: "UserCheck",
    description: "Telegram, GitHub, GitLab, Steam, Keybase, VK, Gravatar'da profil bor-yo'qligi, ism va bio'si",
    appliesTo: ["username"],
  },
  {
    id: "phone-meta",
    title: "Telefon razvedkasi",
    icon: "Phone",
    description: "Mamlakat, operator (UZ kodi), liniya turi va formatlar — libphonenumber bazasi",
    appliesTo: ["phone"],
  },
  {
    id: "wiki-people",
    title: "Shaxs ma'lumotnomasi",
    icon: "BookOpen",
    description: "Mashhur shaxslar haqida ma'lumotnoma — bio, kasb, sanalar (DuckDuckGo Knowledge Graph)",
    appliesTo: ["name"],
  },
  // ---- Telegram: OSINT Framework "Instant Messaging" bo'limi ----
  {
    id: "telegram",
    title: "Telegram profili",
    icon: "Send",
    description:
      "t.me'da profil/kanal/bot mavjudligi, turi (kanal/guruh/bot/shaxs), ismi, tavsif, avatar va obunachilar soni",
    appliesTo: ["username"],
  },
  {
    id: "telegram-feed",
    title: "Telegram posti (ochiq kanal)",
    icon: "Rss",
    description:
      "Ochiq kanalning so'nggi posti (t.me/s) — sana, ko'rishlar, post matni; kontaktlar intel paneliga yig'iladi",
    appliesTo: ["username"],
  },
  {
    id: "telegram-bot",
    title: "Telegram Bot API",
    icon: "Bot",
    description:
      "Rasmiy API'dan ANIQ javob: chat id, turi, bio, a'zolar soni. Token: @BotFather (mutlaqo bepul)",
    appliesTo: ["username"],
  },
  // ---- Maltego uslubidagi transformlar: bir obyekt → bog'liq obyektlar ----
  {
    id: "otx",
    title: "AlienVault OTX",
    icon: "Binoculars",
    description:
      "Maltego uslubi: passiv DNS (tarixiy hostlar), URL arxivi, bog'liq infratuzilma. Kalit: otx.alienvault.com (bepul)",
    appliesTo: ["domain", "ip"],
  },
  {
    id: "reverse-whois",
    title: "Ega bo'yicha domenlar",
    icon: "History",
    description:
      "Reverse WHOIS: shu email/ism bilan ro'yxatga olingan barcha domenlar (ViewDNS) — Maltegoning eng kuchli transformi",
    appliesTo: ["email", "name"],
  },
  // ---- Premium (API kalitli) manbalar — .env ga kalit yozilsa faollashadi ----
  {
    id: "serper",
    title: "Google (Serper)",
    icon: "SearchCheck",
    description:
      "Google natijalari rasmiy API orqali + Knowledge Graph — eng aniq topilma, 403/429/captcha yo'q. Kalit: serper.dev (2500 bepul)",
    appliesTo: ["username", "email", "phone", "name", "domain", "ip"],
  },
  {
    id: "brave-api",
    title: "Brave Search API",
    icon: "Flame",
    description:
      "Brave rasmiy qidiruv API — HTML bloklari va 429 yo'q, kvota bilan ishonchli. Kalit: brave api-dashboard (oyiga 2000 bepul)",
    appliesTo: ["username", "email", "phone", "name", "domain", "ip"],
  },
  {
    id: "google-cse",
    title: "Google Programmable",
    icon: "Globe2",
    description:
      "Google rasmiy CSE API — GOOGLE_CSE_KEY + GOOGLE_CSE_CX (kuniga 100 bepul)",
    appliesTo: ["username", "email", "phone", "name", "domain", "ip"],
  },
  {
    id: "tavily",
    title: "Tavily AI qidiruv",
    icon: "Bot",
    description:
      "AI-optimallashtirilgan qidiruv — shaxs/username izlashda sifatli natija. Kalit: app.tavily.com (oyiga 1000 bepul)",
    appliesTo: ["username", "email", "phone", "name", "domain", "ip"],
  },
  {
    id: "hibp",
    title: "Oqishlar (HIBP)",
    icon: "DatabaseZap",
    description:
      "Eng aniq breach baza: email qaysi oqishlarda, qanday maydonlar oshkor bo'lgan. Kalit: haveibeenpwned.com/API/Key",
    appliesTo: ["email"],
  },
  {
    id: "hunter",
    title: "Hunter.io",
    icon: "MailSearch",
    description:
      "Email tasdiqlash (ishonch bali) va domen bo'yicha xodimlar email/ism-familiyalari. Kalit: hunter.io/api-keys (oyiga 25 bepul)",
    appliesTo: ["email", "domain"],
  },
  {
    id: "shodan",
    title: "Shodan to'liq API",
    icon: "Antenna",
    description:
      "Ochiq portlar, servis bannerlari, tarix — InternetDB'dan ancha chuqur. Kalit: account.shodan.io (bepul hisob)",
    appliesTo: ["ip", "domain"],
  },
  {
    id: "numlookup",
    title: "NumLookup",
    icon: "PhoneCall",
    description:
      "Raqam holati, operator, liniya turi — xalqaro baza. Kalit: numlookupapi.com (kuniga 100 bepul)",
    appliesTo: ["phone"],
  },
  {
    id: "ipinfo",
    title: "IPinfo",
    icon: "MapPin",
    description:
      "Aniq geolokatsiya, ISP/ASN, VPN/proxy aniqlash. Kalit: ipinfo.io/signup (oyiga 50k bepul)",
    appliesTo: ["ip"],
  },
];

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

const ALL: TargetType[] = ["username", "email", "phone", "name", "domain", "ip", "company"];

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
    id: "telegram-search",
    title: "Telegram izlari",
    icon: "MessageCircle",
    description:
      "t.me, telegram.me va telegra.ph domeni bo'ylab maxsus qidiruv — kanal, guruh, profil va postlar",
    appliesTo: ALL,
    queries: (t) => [
      `site:t.me ${q(t)}`,
      `${q(t)} (telegram OR "t.me") (kanal OR guruh OR chat OR profil OR a'zo)`,
    ],
    deepQueries: (t) => [
      `(site:t.me OR site:telegram.me OR site:telegra.ph) ${q(t)}`,
      `${q(t)} ("t.me/s/" OR "t.me/joinchat" OR "t.me/+")`,
      `${q(t)} (tgstat OR telemetr OR lyzem OR telegra.ph)`,
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
    id: "company-registry",
    title: "Reestr va ta'sischilar",
    icon: "Landmark",
    description:
      "Davlat reestrlari: ro'yxatdan o'tgan nomi, ro'yxatga olingan sana, rahbar, ta'sischilar, STIR/rekvizitlar (orginfo.uz, opencorporates, gov.uz)",
    appliesTo: ["company"],
    queries: (t) => [
      `site:orginfo.uz ${q(t)}`,
      `${q(t)} (rahbar OR ta'sischi OR asoschisi OR direksiya OR ustav) (reestr OR ro'yxat OR korxona OR tashkilot)`,
      `${q(t)} (STIR OR INN OR rekvizit OR "ro'yxatga olish sanasi")`,
    ],
    deepQueries: (t) => [
      `site:opencorporates.com ${q(t)}`,
      `${q(t)} (bosh direktor OR rais OR egasi OR mulkdori OR ta'sischilari)`,
      `(site:openbudget.uz OR site:gov.uz OR site:lex.uz OR site:stat.uz) ${q(t)}`,
    ],
    num: 6,
  },
  {
    id: "company-risk",
    title: "Sud, tender va sharhlar",
    icon: "Scale",
    description:
      "Sud qarorlari va da'volar, tender/xarid ishtiroki, mijoz sharhlari va shikoyatlari — kompaniya ishonchliligini baholash",
    appliesTo: ["company"],
    queries: (t) => [
      `${q(t)} (sud OR da'vo OR arbitraj OR javobgarlik OR nizolar)`,
      `${q(t)} (tender OR tanlov OR shartnoma OR xarid OR g'olib)`,
      `${q(t)} (sharh OR izoh OR review OR shikoyat OR murojaat OR fikr)`,
    ],
    deepQueries: (t) => [
      `${q(t)} (site:tender.mf.uz OR site:xarid.uzex.uz OR site:yutuq.uzex.uz OR site:konkur.uz OR site:dxarid.uzex.uz)`,
      `${q(t)} (site:trustpilot.com OR site:otzovik.com OR site:irecommend.ru OR site:olx.uz)`,
      `${q(t)} (qarzdorlik OR bankrot OR likvidatsiya OR reorganizatsiya OR inspeksiya)`,
    ],
    num: 6,
  },
  {
    id: "company-social",
    title: "Rasmiy sahifalar",
    icon: "Building2",
    description:
      "Kompaniyaning ijtimoiy tarmoqdagi rasmiy sahifalari (Instagram, Facebook, Telegram, LinkedIn, YouTube) va ularning haqiqiyligi belgilari",
    appliesTo: ["company"],
    queries: (t) => [
      `${q(t)} (site:instagram.com OR site:facebook.com OR site:t.me)`,
      `${q(t)} (site:linkedin.com OR site:youtube.com OR site:tiktok.com)`,
    ],
    deepQueries: (t) => [
      `(site:linkedin.com/company OR site:linkedin.com/in) ${q(t)}`,
      `${q(t)} ("rasmiy sahifa" OR "official page" OR "rasmiy kanal" OR obunachi OR followers)`,
      `${q(t)} (soxta OR fake OR "rasmiy emas") (sahifa OR kanal OR profil)`,
    ],
    num: 6,
  },
  {
    id: "company-fraud",
    title: "Firibgarlik eslatmalari",
    icon: "ShieldAlert",
    description:
      "Scam bazalari, ishonchsizlik sharhlari, «aldangan mijoz» eslatmalari — kompaniya yoki sayt haqidagi ogohlantirishlar",
    appliesTo: ["company"],
    queries: (t) => [
      `${q(t)} (firibgarlik OR scam OR aldash OR soxta OR ishonchsiz)`,
      `site:scamadviser.com ${q(t)}`,
    ],
    deepQueries: (t) => [
      `${q(t)} (pul o'tkazdim OR to'lov qilmadi OR aldangan OR bedorlik OR pulim ketdi)`,
      `${q(t)} (site:scam-detector.com OR site:scamwatcher.com OR site:trustpilot.com OR site:webparanoid.com)`,
    ],
    num: 6,
  },
  {
    id: "person-public",
    title: "Ommaviy shaxs izlari",
    icon: "UserRoundSearch",
    description:
      "Lavozim va karyera, rasmiy bayonotlar va intervyular, nashrlar, bog'liq tashkilotlar va loyihalar, ochiq indekslangan shaxsiy ma'lumotlar — ommaviy shaxs faoliyati to'liq rasmi",
    appliesTo: ["name"],
    queries: (t) => [
      `${q(t)} (lavozim OR rahbar OR direktor OR karyera OR rezyume OR CV)`,
      `${q(t)} (bayonot OR intervyu OR nutq OR chiqish OR press-konferensiya OR brifing)`,
      `${q(t)} (maqola OR nashr OR publikatsiya OR kitob OR blog OR muallif)`,
    ],
    deepQueries: (t) => [
      `${q(t)} (tashkilot OR fond OR uyushma OR partiya OR kompaniya OR loyiha) (rahbari OR a'zosi OR asoschisi OR ta'sischisi OR maslahatchi)`,
      `${q(t)} ("tarjimai hol" OR biography OR "curriculum vitae")`,
      // Foydalanuvchi so'rovi: ochiq indekslangan uy manzili, oila a'zolari,
      // shaxsiy telefon kabilarni ham ochiq qidiruv orqali ko'rsatish
      `${q(t)} (manzil OR "yashash joyi" OR "oila a'zolari" OR "telefon raqami" OR aloqa OR qarindoshlari)`,
      `${q(t)} (davlat mukofoti OR unvon OR reyting OR boylik deklaratsiyasi OR daromad)`,
    ],
    num: 6,
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
  {
    id: "phone-trace",
    title: "Telefon izlari",
    icon: "Smartphone",
    description:
      "Raqamning barcha formatlari bo'yicha maxsus qidiruv: E.164, milliy, uzluksiz — oddiy qidiruv ko'rmaydigan izlarni topadi",
    appliesTo: ["phone"],
    queries: (t) => {
      const digits = t.replace(/\D/g, "");
      const e164 =
        digits.startsWith("998")
          ? `+${digits}`
          : digits.length === 9
            ? `+998${digits}`
            : `+${digits.replace(/^8/, "7")}`;
      const nat = digits.startsWith("998") ? digits.slice(3) : digits;
      const natFmt =
        nat.length === 9
          ? `${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}`
          : nat;
      return [
        `"${e164}" OR "${natFmt}"`,
        `${nat} (telegram OR instagram OR facebook OR linkedin OR tiktok)`,
        `${nat} (olx OR e'lon OR biznes OR kontakt OR ma'lumotnoma)`,
      ];
    },
    deepQueries: (t) => {
      const digits = t.replace(/\D/g, "");
      const e164 =
        digits.startsWith("998")
          ? `+${digits}`
          : digits.length === 9
            ? `+998${digits}`
            : `+${digits.replace(/^8/, "7")}`;
      const nat = digits.startsWith("998") ? digits.slice(3) : digits;
      return [
        `"${e164}" (oqish OR pastebin OR leak OR ma'lumotlar bazasi)`,
        `${nat} (SMS OR kod OR tasdiqlash OR ro'yxatdan o'tish)`,
        // Telegram ekosistemasi: kanal/post bazalarida raqam izi
        `"${e164}" (site:t.me OR site:telegra.ph OR site:tgstat.ru OR site:lyzem.com)`,
      ];
    },
    num: 6,
  },
  {
    id: "phone-mentions",
    title: "Telefon eslatmalari",
    icon: "Contact",
    description:
      "Raqam QAYERLARDA qoldirilgan: Telegram post va kanallar, tgstat/lyzem Telegram qidiruvi, ijtimoiy tarmoq profillari (Instagram, Facebook, VK), WhatsApp/Viber guruhlar, e'lonlar (OLX), biznes kataloglar, hujjat va bazalar",
    appliesTo: ["phone"],
    queries: (t) => {
      const digits = t.replace(/\D/g, "");
      const e164 =
        digits.startsWith("998")
          ? `+${digits}`
          : digits.length === 9
            ? `+998${digits}`
            : `+${digits.replace(/^8/, "7")}`;
      const nat = digits.startsWith("998") ? digits.slice(3) : digits;
      const spaced = nat.length === 9
        ? `${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}`
        : nat;
      const dashed = nat.length === 9
        ? `${nat.slice(0, 2)}-${nat.slice(2, 5)}-${nat.slice(5, 7)}-${nat.slice(7, 9)}`
        : nat;
      const anyFmt = `("${e164}" OR "${spaced}" OR "${dashed}")`;
      const digitsNoPlus = digits.replace(/^\+/, "");
      return [
        // Telegram post va kanallarda raqam qayerga yozilgan
        `site:t.me ${anyFmt}`,
        // Instagram post/komentlari bevosita indekslanmaydi — lekin mirror
        // viewer saytlar (picuki/imginn/greatfon) indekslanadi va raqam
        // bio/post matnini ko'rsatadi
        `${anyFmt} (site:picuki.com OR site:imginn.com OR site:greatfon.com)`,
        // Telegram qidiruv tizimlari — tgstat, lyzem, telemetr kanal bazalari
        `${anyFmt} (site:tgstat.uz OR site:tgstat.ru OR site:lyzem.com OR site:telemetr.io)`,
        // Ijtimoiy tarmoqlarda profillar/postlar
        `${anyFmt} (site:instagram.com OR site:facebook.com OR site:vk.com OR site:ok.ru)`,
        // WhatsApp havolalari — wa.me/998901234567 ko'rinishida indekslanadi
        `site:wa.me ${digitsNoPlus} OR (site:api.whatsapp.com "phone=${digitsNoPlus}")`,
        // Raqam razvedkasi bazalari — sync.me/truecaller ochiq sahifalari
        `${anyFmt} (site:sync.me OR site:truecaller.com OR site:numlookup.com)`,
        // E'lonlar, biznes kataloglar, ma'lumotnomalar — O'zbekiston bozorlari
        `${anyFmt} (site:olx.uz OR e'lon OR biznes OR kontakt OR menejer OR ma'lumotnoma OR katalog)`,
        // Egasi/mulkdor atamalari — "... raqam egasi", "mulkdor aloqa"
        `${anyFmt} (egasi OR mulkdor OR aloqa raqami)`,
      ];
    },
    deepQueries: (t) => {
      const digits = t.replace(/\D/g, "");
      const nat = digits.startsWith("998") ? digits.slice(3) : digits;
      const e164 = digits.startsWith("998") ? `+${digits}` : `+998${digits}`;
      const spaced = nat.length === 9
        ? `${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}`
        : nat;
      const dashed = nat.length === 9
        ? `${nat.slice(0, 2)}-${nat.slice(2, 5)}-${nat.slice(5, 7)}-${nat.slice(7, 9)}`
        : nat;
      const anyFmt = `("${e164}" OR "${spaced}" OR "${dashed}")`;
      const digitsNoPlus = digits.replace(/^\+/, "");
      return [
        // WhatsApp/Viber havola formatlari — wa.me raqamni "plus"siz indekslaydi
        `(site:wa.me OR site:api.whatsapp.com OR site:viber.com) ${digitsNoPlus}`,
        // Instagram mirror-viewerlarda (post/bio izlari)
        `${anyFmt} (site:picuki.com OR site:imginn.com OR site:greatfon.com)`,
        // Telegram kataloglari — tlgrm, tgstat.com, kanal ro'yxatlari
        `${anyFmt} (site:tlgrm.eu OR site:tgstat.com OR site:telegram-store.com OR site:telemetr.me)`,
        // Hujjatlar va jadvallar — kontakt bazalari, hisobotlar
        `${anyFmt} (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx OR filetype:vcf)`,
        // Oqishlar va yopiq bazalarda eslatma
        `${anyFmt} (pastebin OR leak OR oqish OR bazalar OR tayyorlangan)`,
        // Forum va commentlar
        `${anyFmt} (forum OR izoh OR comment OR sharh OR fikr)`,
        // Telegra.ph postlari — Telegram ekosistemasi ichidagi uzun matnlar
        `site:telegra.ph ${anyFmt}`,
        // Messenjer usernameligi: raqam bio/desc maydonlarida
        `${anyFmt} (bio OR tavsif OR about OR contact OR aloka)`,
      ];
    },
    num: 6,
  },
  {
    id: "username-mentions",
    title: "Username joylari",
    icon: "Fingerprint",
    description:
      "Shu username boshqa QAYERLARDA ishlatilgan: Instagram, TikTok, X/Twitter, GitHub, VK, bio-havolalar, forumlar — platforma bo'yicha aniq qidiruv",
    appliesTo: ["username"],
    queries: (t) => {
      const u = t.replace(/^@/, "").trim();
      return [
        // Foto/video platformalar
        `(site:instagram.com OR site:tiktok.com) "${u}"`,
        // Microblog va kod platformalari
        `(site:x.com OR site:twitter.com OR site:github.com OR site:gitlab.com) "${u}"`,
        // Umumiy: username + profil atamalari
        `"${u}" (profil OR bio OR account OR akkaunt OR foydalanuvchi)`,
      ];
    },
    deepQueries: (t) => {
      const u = t.replace(/^@/, "").trim();
      return [
        // MDH va boshqa platformalar
        `(site:vk.com OR site:ok.ru OR site:pinterest.com OR site:medium.com OR site:steamcommunity.com) "${u}"`,
        // Bio-havola sahifalari — barcha tarmoqlar bitta joyda
        `"${u}" (site:linktr.ee OR site:beacons.ai OR site:bio.link OR site:carrd.co OR site:taptap.io)`,
        // Forum, comment va eslatmalar
        `"${u}" (site:reddit.com OR forum OR izoh OR comment OR sharh)`,
        // Oqishlar va paket menejerlari
        `"${u}" (pastebin OR leak OR dump OR npm OR pypi OR gist)`,
      ];
    },
    num: 6,
  },
  {
    id: "name-variants",
    title: "Ism variantlari",
    icon: "Shuffle",
    description:
      "Ism-familiya BARCHA yozilishlarida: almashtirilgan tartib (Familiya Ism), kirillcha (Камрон Каримов), oʻ/gʻ apostrof shakllari, bosh harf qisqartma (K. Karimov) — o'xshash yozuvlar ham topiladi",
    appliesTo: ["name"],
    queries: (t) => nameVariantCoreQueries(t),
    deepQueries: (t) => nameVariantDeepQueries(t),
    num: 6,
  },
  {
    id: "leak-search",
    title: "Parollar va oqishlar",
    icon: "KeyRound",
    description:
      "Parollar va akkaunt ma'lumotlari OCHIQ oqishlarda: pastebin dump'lari, gist/paste saytlari, fayl bazalar (txt/sql/csv/log), GitHub/GitLab konfiguratsiya fayllari — «parol/password/пароль» belgilari bilan birga qidiriladi",
    appliesTo: ALL,
    queries: (t) => [
      `"${t}" (parol OR password OR пароль) (oqish OR leak OR dump OR bazalar OR reestr)`,
      `site:pastebin.com "${t}"`,
      `"${t}" (filetype:txt OR filetype:sql OR filetype:csv OR filetype:log) (login OR parol OR password OR пароль)`,
    ],
    deepQueries: (t) => [
      `"${t}" (site:controlc.com OR site:dpaste.org OR site:rentry.co OR site:paste.ee OR site:gist.github.com)`,
      `"${t}" (site:github.com OR site:gitlab.com) (password OR parol OR пароль OR credentials OR config OR secret)`,
      `"${t}" (login OR akkaunt OR hisob OR kirish) (sizib OR oqish OR tarqaldi OR sizdi OR leak OR olingan)`,
      `"${t}" (baza OR "ma'lumotlar bazasi" OR ro'yxat) (site:pastebin.com OR leak OR dump OR oqish)`,
    ],
    num: 6,
  },
  {
    id: "document-leaks",
    title: "Pasport va hujjatlar",
    icon: "FileBadge",
    description:
      "Pasport, guvohnoma va shaxsiy hujjatlar ochiq joylarda: PDF/DOC arxivlar, hujjat kutubxonalari (scribd, docdroid, pdfcoffee), Telegram/telegra.ph postlari, JSHSHIR/seriya belgilari bilan hujjat bazalari",
    appliesTo: ALL,
    queries: (t) => [
      `"${t}" (pasport OR passport OR паспорт OR guvohnoma OR hujjat OR "ID karta")`,
      `"${t}" filetype:pdf (pasport OR passport OR паспорт OR guvohnoma OR ariza OR rezyume OR CV OR anketa)`,
      `"${t}" (site:scribd.com OR site:docdroid.net OR site:pdfcoffee.com OR site:vdoc.pub OR site:idoc.pub)`,
    ],
    deepQueries: (t) => [
      `"${t}" (filetype:doc OR filetype:docx OR filetype:xlsx OR filetype:pptx OR filetype:rtf OR filetype:vcf)`,
      `"${t}" (site:t.me OR site:telegra.ph) (pasport OR паспорт OR guvohnoma OR hujjat OR ro'yxat OR baza)`,
      `"${t}" (jshshir OR JSHSHIR OR pinfl OR ПИНФЛ OR seriya OR "passport series" OR "pasport seriya")`,
      `"${t}" (reestr OR baza OR ro'yxat OR ma'lumotnoma OR arxiv) (pasport OR паспорт OR hujjat OR jshshir)`,
    ],
    num: 6,
  },
  {
    id: "photo-search",
    title: "Rasm izlari",
    icon: "Images",
    description:
      "Rasmlar QAYERDA ishlatilgan: Bing Rasm qidiruvi (jonli — har rasmda manba sahifa va to'liq fayl havolasi), foto hostlar (imgur, flickr, postimages, ibb), Instagram mirror foto sahifalari, Telegram/telegra.ph postlari. Faqat maqsadga tegishli rasmlar qoldiriladi",
    appliesTo: ALL,
    queries: (t) => [
      // Maxsus prefiks — scan route shu so'rovni jonli Bing Rasm qidiruviga yuboradi
      `bing-images:${t}`,
      `"${t}" (foto OR rasm OR photo OR img) (site:imgur.com OR site:flickr.com OR site:postimages.org OR site:ibb.co)`,
      `"${t}" (rasmlari OR fotolari OR photos OR gallery OR galereya)`,
    ],
    deepQueries: (t) => [
      `bing-images:${t} (profil OR avatar OR foto)`,
      `"${t}" (site:picuki.com OR site:imginn.com OR site:greatfon.com)`,
      `"${t}" (site:pinterest.com OR site:tumblr.com OR site:imgur.com OR site:flickr.com)`,
      `"${t}" (site:t.me OR site:telegra.ph) (rasm OR foto OR photo OR media)`,
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
    snippet:
      "Jonli tekshiruv o'tkazilmoqda: sayt HTTP javobi bo'yicha profil mavjudligi aniqlanadi. Bloklangan saytlar «aniqlanmadi» deb belgilanadi.",
    host_name: p.host,
    verified: "unknown" as const,
  }));
}

export function getModuleIcon(moduleId: string): string {
  return (
    OSINT_MODULES.find((m) => m.id === moduleId)?.icon ??
    DIRECT_MODULE_META.find((m) => m.id === moduleId)?.icon ??
    "Globe"
  );
}

/** Har qanday modul (qidiruv yoki to'g'ridan-to'g'ri manba) sarlavhasi */
export function anyModuleTitle(moduleId: string): string {
  return (
    OSINT_MODULES.find((m) => m.id === moduleId)?.title ??
    DIRECT_MODULE_META.find((m) => m.id === moduleId)?.title ??
    moduleId
  );
}

// ===== Adaptiv chuqur taramok yordamchilari =====

/** Katta platformalar — ularning hostnomasi "domen pivot" sifatida foydasiz */
export const PLATFORM_DOMAINS = new Set([
  "instagram.com", "facebook.com", "x.com", "twitter.com", "t.me", "telegram.me",
  "linkedin.com", "tiktok.com", "vk.com", "ok.ru", "github.com", "gitlab.com",
  "medium.com", "pinterest.com", "behance.net", "reddit.com", "quora.com",
  "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "twitch.tv",
  "wikipedia.org", "google.com", "yandex.com", "yandex.ru", "mail.ru",
  "pastebin.com", "scribd.com", "docs.google.com", "shodan.io", "censys.io",
  "crt.sh", "stackoverflow.com", "habr.com", "substack.com", "imgur.com",
  "flickr.com", "zoomeye.com", "dailymail.co.uk", "gravatar.com",
  "keybase.io", "steamcommunity.com",
]);

/** Bepul pochta domeni — bundan "domen pivot" chiqarmaymiz */
export const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "proton.me", "protonmail.com", "mail.ru", "yandex.ru",
  "yandex.com", "zoho.com", "gmx.com", "inbox.ru", "bk.ru", "list.ru",
]);

export const PROFILE_URL_SEGMENTS = new Set([
  "p", "reel", "reels", "watch", "user", "users", "in", "pub", "company",
  "channel", "c", "hashtag", "status", "post", "question", "topics", "tag",
  "search", "profile", "u", "id", "share", "shares", "video", "photo",
  "shorts", "playlist", "groups", "events", "comments", "photos", "videos",
  "media", "tagged", "saved", "explore", "stories", "album", "albums",
  "favorites", "followers", "following", "gists",
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
  let t = text.trim();
  // t.me/username yoki telegram.me/username havolasi → username
  const tme = t.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([a-z0-9._-]{3,32})\/?$/i);
  if (tme && !/^\d+$/.test(tme[1])) return "username";
  // @username kiritilgan bo'lsa — @ belgisini tashlab username deb olamiz
  // (aks holda "@durov" "ism" deb aniqlanib, noto'g'ri modullar ishga tushardi)
  t = t.replace(/^@+/, "").trim();
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return "email";
  // IP manzil — nuqtalar telefon formatlash belgilariga o'xshaydi, shuning uchun
  // IP tekshiruvi telefondan OLDIN bo'lishi shart (aks holda 192.168.1.100 → telefon)
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(t)) return "ip";
  // To'liq URL kiritilgan bo'lsa: platforma profili → username, oddiy sayt → domen
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const seg = u.pathname.split("/").filter(Boolean)[0];
      const isPlatformHost =
        PLATFORM_DOMAINS.has(host) || [...PLATFORM_DOMAINS].some((d) => host.endsWith(`.${d}`));
      if (
        seg &&
        isPlatformHost &&
        !PROFILE_URL_SEGMENTS.has(seg.toLowerCase()) &&
        /^[a-z0-9._-]{3,32}$/i.test(seg) &&
        !/^\d+$/.test(seg)
      ) {
        return "username";
      }
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return "domain";
    } catch {
      /* URL noto'g'ri — keyingi tekshiruvlarga o'tamiz */
    }
  }
  // Telefon: "+" bilan yoki'siz — "+998901234567", "998901234567",
  // "+998 90 123 45 67", "(+998) 90-123-45-67" — 7-15 xona raqam
  const digits = t.replace(/[\s().-]/g, "");
  if (/^\+?\d{7,15}$/.test(digits) && !/(\d)\1{5,}/.test(digits)) return "phone";
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) && !t.includes(" ")) return "domain";
  // 3-6 xonali qisqa raqamlar — ba'zi platformalarda raqamli username (VK id)
  if (!t.includes(" ") && /^[a-z0-9._-]{3,32}$/i.test(t) && !/^\+?\d+$/.test(t)) return "username";
  return "name";
}

/**
 * Kiritilgan satrni maqsad turiga qarab tozalaydi:
 * "@durov" → "durov", "t.me/durov" → "durov", "https://t.me/s/kanal" → "kanal".
 * Boshqa turlarda satr o'zgarmaydi. Skaner so'rovlarida tozalangan qiymat ishlatiladi —
 * "@belgisi" va "t.me/" prefiksi qidiruv sifatini pasaytiradi.
 */
export function normalizeTargetValue(kind: TargetType, raw: string): string {
  const t = raw.trim();
  if (kind === "username") {
    const tme = t.match(
      /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([a-z0-9._-]{3,32})\/?$/i
    );
    if (tme) return tme[1];
    return t.replace(/^@+/, "").trim();
  }
  return t;
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
  company: 4,
  ip: 5,
  name: 6,
};
