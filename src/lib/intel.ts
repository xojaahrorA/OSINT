// ===== «Topilgan ma'lumotlar» yig'imi =====
// Skaner natijalari (sarlavha + snippet + URL) ichidan qo'shimcha ma'lumotlarni
// — telefon, email, ism-familiya, username, domen, IP — ajratib oladi va
// bitta ro'yxatga yig'adi. Tizim bu ma'lumotlar bo'yicha O'ZI qidiradi EMAS:
// foydalanuvchi panelidan birini tanlasa, keyin shu bo'yicha qidiriladi.
// Faqat klient tomonda ishlaydi (server importi yo'q).

import {
  FREEMAIL_DOMAINS,
  PLATFORM_DOMAINS,
  PROFILE_URL_SEGMENTS,
  type SearchResultItem,
  type TargetType,
} from "@/lib/osint";

export interface IntelEntry {
  kind: TargetType;
  /** Normallashgan qiymat — qidiruvga tayyor */
  value: string;
  /** Nechta manbada uchragan */
  count: number;
  /** Qaysi modullarda topilgan */
  sources: string[];
  /** Qaysi saytlarda topilgan */
  hosts: string[];
}

export interface IntelSourceItem {
  item: SearchResultItem;
  moduleTitle: string;
  /** Modul id — profil sanovchi modullardan domen chiqarmaslik uchun */
  moduleId?: string;
}

/** Profil sanovchi modullar — ularning URL hostlari profil saytlari, "domen" iz emas */
const PROFILE_ENUM_MODULES = new Set(["whatsmyname", "profiles", "username-probe"]);

/** Har bir turdan eng ko'pi bilan qancha saqlanadi (shovqinni cheklash) */
const CAPS: Record<TargetType, number> = {
  phone: 20,
  email: 20,
  username: 30,
  name: 12,
  domain: 20,
  ip: 10,
};

const KIND_ORDER: TargetType[] = ["phone", "email", "username", "name", "domain", "ip"];

/** Ism deb tan olinmaydigan so'zlar — platforma nomlari va umumiy atamalar */
const NAME_STOPWORDS = new Set([
  // platforma / sayt nomlari
  "github", "gitlab", "steam", "telegram", "reddit", "instagram", "facebook",
  "twitter", "linkedin", "vk", "gravatar", "keybase", "youtube", "tiktok",
  "medium", "pinterest", "behance", "wikipedia", "wiki", "shodan", "pastebin",
  "quora", "habr", "stackoverflow", "urlscan", "wayback", "archive", "google",
  "bing", "duckduckgo", "yandex", "mail", "ok", "x", "crt", "web", "site",
  // umumiy atamalar (uz / ru / en)
  "profil", "profile", "user", "users", "username", "bio", "kanal", "channel",
  "rasmiy", "official", "page", "sahifa", "sahifasi", "home", "main", "index",
  "yangiliklar", "news", "video", "forum", "jamoat", "community", "post",
  "posts", "photo", "photos", "album", "top", "best", "live", "online",
  "sayt", "com", "net", "org", "uz", "ru", "www", "http", "https", "dan",
  "bilan", "uchun", "haqida", "the", "and", "for", "with", "from", "about",
  "view", "watch", "download", "yuklash", "university", "institut", "maktab",
  "company", "kompaniya", "ltd", "llc", "group", "guruh", "team", "jamoa",
  "ism", "familiya", "name", "jinsiyat", "joylashuv", "location", "bio'si",
  "obunachi", "followers", "repos", "holat", "state", "javob", "topilmadi",
  "profil topilmadi", "mavjud", "error", "xato", "not", "found", "member",
  "a'zosi", "shaxs", "person", "people", "author", "muallif", "admin",
  "moderator", "tahrirchi", "editor",
  // sarlavha shovqini — lavozim/jons o'rinlar va hodisa so'zlari
  "ceo", "cto", "cfo", "president", "minister", "judge", "lawyer", "mayor",
  "docker", "hub", "lab", "laboratory", "api", "sdk", "inc", "corp",
  "meeting", "summit", "conference", "interview", "statement", "report",
  "arrest", "arrested", "detained", "court", "case", "trial", "verdict",
  "warrant", "police", "prosecutor", "charge", "charges", "lawsuit",
  "founder", "asoschisi", "direktor", "bosh", "rahbar", "head", "chief",
  "owner", "egasi", "founder's", "visit", "visits", "visited", "arrives",
  "leaves", "returns", "says", "said", "told", "speaks", "meets", "met",
  "dies", "wins", "loses", "sent", "held", "under", "amid", "after",
  "before", "over", "into", "against", "with", "france", "paris", "dubai",
  "uzbekistan", "tashkent", "russia", "moscow", "ukraine", "kyiv", "usa",
]);

/** Ushbu so'zlar bilan boshlanadigan/orasida bo'lgan "ism"lar shovqin */
const NAME_PHRASE_NOISE = [
  "profil topilmadi", "javob yo'q", "rate limit", "profil mavjud",
  "official page", "rasmiy sahifa", "kanal rasmiy", "yangi post",
  "steam community", "github gists", "pull request", "stack overflow",
];

const normText = (s: string) => s.replace(/\s+/g, " ").trim();

/** Faqat Titlecase so'z: "Pavel", "Durov" — apostrofsiz, all-caps emas */
function isTitleWord(w: string): boolean {
  return /^[A-ZÀ-ÖØ-ÞЎҢ][a-zà-öø-ÿ'’-]{1,14}$/.test(w) || /^[А-ЯЁЎ][а-яё'’-]{1,14}$/.test(w);
}

/** Bo'sh prose all-caps ham bo'lishi mumkin: "KARIMOV ALI" (strukturaviy maydonlar uchun) */
function isAnyNameWord(w: string): boolean {
  return isTitleWord(w) || /^[A-ZÀ-ÖØ-ÞЎҢ]{2,14}$/.test(w);
}

function phraseOk(words: string[], allowAllCaps: boolean): string | null {
  if (words.length < 2 || words.length > 3) return null;
  if (new Set(words.map((w) => w.toLowerCase())).size !== words.length) return null;
  const phrase = words.join(" ");
  if (phrase.length < 5 || phrase.length > 40) return null;
  const low = phrase.toLowerCase();
  if (NAME_PHRASE_NOISE.some((n) => low.includes(n))) return null;
  for (const w of words) {
    if (!(allowAllCaps ? isAnyNameWord(w) : isTitleWord(w))) return null;
    // Generik yo'lda apostrofli so'zlar ("Durov's") — sarlavha grammatikasi, ism emas
    if (!allowAllCaps && /['’]/.test(w)) return null;
    if (NAME_STOPWORDS.has(w.toLowerCase())) return null;
  }
  return phrase;
}

/**
 * Ketma-ket katta harfli so'zlarni guruhlaydi — orasida FAQAT probil bo'lsa.
 * Sarlavhalarda ism uzun fragments ("Telegram CEO Pavel Durov Arrives")
 * 4+ so'zlik guruh hosil qiladi va rad etiladi, mustaqil
 * "Pavel Durov" (2 so'zlik guruh) esa qabul qilinadi.
 */
function capRuns(text: string): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  let prevEnd = -1;
  for (const m of text.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЁё'’-]+/g)) {
    const w = m[0];
    const start = m.index ?? 0;
    const gap = text.slice(prevEnd, start);
    const contiguous = cur.length > 0 && /^[ ]{1,2}$/.test(gap);
    if (!contiguous && cur.length > 0) {
      runs.push(cur);
      cur = [];
    }
    if (/^[A-ZÀ-ÖØ-ÞА-ЯЁ]/.test(w) && w.length >= 2) {
      cur.push(w);
    } else if (cur.length > 0) {
      runs.push(cur);
      cur = [];
    }
    prevEnd = start + w.length;
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/** Matndan ism-familiya nomzodlarini ajratadi */
function extractNames(text: string): string[] {
  const out: string[] = [];
  // 1) Strukturaviy maydonlar: "Ism: Pavel Durov", "Name: ..." — ishonchli,
  //    all-caps ham ruxsat ("KARIMOV ALI"), 2-3 so'z
  for (const m of text.matchAll(/(?:^|[\s|·—–-])(?:Ism|Name)\s*:\s*([^\n|·,;(]{3,48})/gi)) {
    const words = normText(m[1])
      .replace(/\((?:[^()]*)\)/g, " ")
      .replace(/[.,;:!?\?“”«»]+$/g, "")
      .split(/\s+/)
      .filter(Boolean);
    const v = phraseOk(words, true);
    if (v) out.push(v);
  }
  // 2) Generik: aynan 2 so'zlik mustaqil Titlecase guruhlar (sarlavha fragmentlari 4+ so'z — rad)
  for (const run of capRuns(text)) {
    if (run.length !== 2) continue;
    const v = phraseOk(run, false);
    if (v) out.push(v);
  }
  return out;
}

function isValidPhoneDigits(digits: string): boolean {
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^0+\d*$/.test(digits) && digits.replace(/0/g, "").length < 2) return false;
  // Ketma-ket 7+ bir xil raqam — ID/indifikator, telefon emas
  // (6 ta ruxsat etiladi: real raqamlarda "200 00 00" kabi ketma-ket nollar uchraydi)
  if (/(\d)\1{6,}/.test(digits)) return false;
  // Orraqliq tekshiruvi: raqamlar segmentlari 1-4 xonali bo'lishi tabiiy
  return true;
}

/**
 * Yangi natijalar to'plamidan intel nomzodlarini ajratadi.
 * exclude — sessiya ildiz maqsadi (o'zi qidirilgan qiymat ro'yxatga tushmaydi).
 */
export function extractIntelBatch(
  batch: IntelSourceItem[],
  exclude: string[] = []
): IntelEntry[] {
  const map = new Map<string, IntelEntry>();
  const excludeSet = new Set(exclude.map((v) => v.trim().toLowerCase().replace(/^@/, "")));

  const push = (kind: TargetType, raw: string, source: string, host: string) => {
    let value = normText(raw).toLowerCase();
    if (kind === "phone") {
      value = "+" + value.replace(/\D/g, "");
    } else if (kind === "username") {
      value = value.replace(/^@+/, "").replace(/[._-]+$/, "");
    }
    if (!value || value.length < 3 || value.length > 254) return;
    if (excludeSet.has(value.replace(/^@/, ""))) return;
    // Username sifatida qabul qilinadigan qiymatlar raqam bo'lmaydi
    if (kind === "username" && (/^\d+$/.test(value) || value.length < 3 || value.length > 30)) return;
    const key = `${kind}:${value}`;
    const ex = map.get(key);
    if (ex) {
      ex.count++;
      if (source && !ex.sources.includes(source) && ex.sources.length < 4) ex.sources.push(source);
      if (host && !ex.hosts.includes(host) && ex.hosts.length < 4) ex.hosts.push(host);
      return;
    }
    map.set(key, {
      kind,
      value,
      count: 1,
      sources: source ? [source] : [],
      hosts: host ? [host] : [],
    });
  };

  for (const { item, moduleTitle, moduleId } of batch) {
    const text = `${item.name ?? ""} ${item.snippet ?? ""}`;
    const host = (() => {
      try {
        return new URL(item.url).hostname.replace(/^www\./, "");
      } catch {
        return item.host_name ?? "";
      }
    })();

    // 1) Email — korporativ domendan domen nomzodi ham chiqadi
    for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      const email = m[0].toLowerCase();
      push("email", email, moduleTitle, host);
      const dom = email.split("@")[1] ?? "";
      if (dom && !FREEMAIL_DOMAINS.has(dom) && !PLATFORM_DOMAINS.has(dom)) {
        push("domain", dom, moduleTitle, host);
      }
    }

    // 2) Telefon — faqat "+" bilan (xalqaro format, false-positive kam)
    for (const m of text.matchAll(/\+\d[\d\s().-]{6,16}\d/g)) {
      const digits = m[0].replace(/\D/g, "");
      if (isValidPhoneDigits(digits)) push("phone", digits, moduleTitle, host);
    }

    // 3) IP manzil
    for (const m of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const parts = m[0].split(".").map(Number);
      if (parts.every((n) => n <= 255) && parts[0] >= 1 && parts[3] >= 1) {
        push("ip", m[0], moduleTitle, host);
      }
    }

    // 4) @username izohlari va t.me havolalari
    for (const m of text.matchAll(/(^|[\s(@:])@([a-z0-9._-]{3,30})/gi)) {
      push("username", m[2], moduleTitle, host);
    }
    for (const m of text.matchAll(/https?:\/\/(?:t|telegram)\.me\/([a-z0-9._-]{3,32})/gi)) {
      push("username", m[1], moduleTitle, host);
    }

    // 5) URL tahlili — platforma profil username'lari va alohida domenlar.
    //    Profil sanovchi modullarda (WhatsMyName va h.k.) URL hostlari —
    //    profil saytlarining o'zi, ular "domen iz" sifatida foydasiz shovqin.
    const isProfileEnum = moduleId ? PROFILE_ENUM_MODULES.has(moduleId) : false;
    try {
      const u = new URL(item.url);
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      const isPlatform =
        PLATFORM_DOMAINS.has(h) || [...PLATFORM_DOMAINS].some((d) => h.endsWith(`.${d}`));
      if (!isProfileEnum && !isPlatform && !FREEMAIL_DOMAINS.has(h) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h)) {
        push("domain", h, moduleTitle, host);
      }
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (
        isPlatform &&
        seg &&
        !PROFILE_URL_SEGMENTS.has(seg.toLowerCase()) &&
        /^[a-z0-9._-]{3,30}$/i.test(seg) &&
        !/^\d+$/.test(seg)
      ) {
        push("username", seg, moduleTitle, host);
      }
    } catch {
      /* URL noto'g'ri — tashlab ketamiz */
    }

    // 6) Ism-familiya — sarlavha va snippetni ALOHIDA tekshiramiz,
    // aks holda ular orasidagi chegarada yolg'on 3-so'zli kombinatsiyalar chiqadi
    for (const src of [item.name ?? "", item.snippet ?? ""]) {
      for (const n of extractNames(src)) {
        if (excludeSet.has(n.toLowerCase())) continue;
        push("name", n, moduleTitle, host);
      }
    }
  }

  // Turlar bo'yicha saralash va chegara qo'yish: ko'p uchraganlari birinchi
  const out: IntelEntry[] = [];
  for (const kind of KIND_ORDER) {
    const arr = [...map.values()].filter((e) => e.kind === kind);
    arr.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.push(...arr.slice(0, CAPS[kind]));
  }
  return out;
}

/** Avvalgi ro'yxat bilan birlashtiradi (manbalar va sonlar yig'iladi) */
export function mergeIntel(prev: IntelEntry[], add: IntelEntry[]): IntelEntry[] {
  const map = new Map<string, IntelEntry>();
  for (const e of prev) map.set(`${e.kind}:${e.value}`, { ...e, sources: [...e.sources], hosts: [...e.hosts] });
  for (const e of add) {
    const key = `${e.kind}:${e.value}`;
    const ex = map.get(key);
    if (ex) {
      ex.count += e.count;
      for (const s of e.sources) if (!ex.sources.includes(s) && ex.sources.length < 4) ex.sources.push(s);
      for (const h of e.hosts) if (!ex.hosts.includes(h) && ex.hosts.length < 4) ex.hosts.push(h);
    } else {
      map.set(key, { ...e, sources: [...e.sources], hosts: [...e.hosts] });
    }
  }
  const out: IntelEntry[] = [];
  for (const kind of KIND_ORDER) {
    const arr = [...map.values()].filter((e) => e.kind === kind);
    arr.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.push(...arr.slice(0, CAPS[kind]));
  }
  return out;
}
