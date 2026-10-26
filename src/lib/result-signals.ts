// OSINT Radar — natija signallari (IntelBase uslubi: har topilma NIMA UCHUN
// chiqqani ko'rsatiladi). Parollar/oqishlar (leak-search), Pasport va hujjatlar
// (document-leaks) va Rasm izlari (photo-search) modullari uchun:
//
//   strong — topilmada MODUL mavzusining ANIQ izi:
//            «password: abc123», email:pass kombinatsiyalari, pasport
//            seriyasi (AA1234567), JSHSHIR/PINFL (14 raqam), rasm fayli...
//   medium — topilma modul manbalarida (paste-sayt, hujjat arxivi, foto host)
//            lekin aniq iz yo'q.
//
// Signal faqat SARLASH va tushuntirish uchun — natijani olib tashlamaydi
// (aniqlik uchun relevanceFilter v7 allaqachon javob beradi).

import type { ResultSignal, SearchResultItem } from "./osint";

export type SignalKind = "leak" | "doc" | "photo";

/** Natija haysteki — URL decode bilan (moslik kengroq bo'lishi uchun) */
function hayOf(r: SearchResultItem, lower = true): string {
  let url = r.url;
  try {
    url = decodeURIComponent(url);
  } catch {
    /* xom holda qoladi */
  }
  const text = `${r.name} ${r.snippet} ${url}`;
  return lower ? text.toLowerCase() : text;
}

function hostOf(r: SearchResultItem): string {
  return (r.host_name || "").toLowerCase().replace(/^www\./, "");
}

// ===== 1. PAROLLAR VA OQISHLAR (leak-search) =====

/** KUCHLI iz: aniq kredential/parol qolipi matnda ko'rinadi */
const CRED_STRONG: RegExp[] = [
  /(?:password|passwd|pwd|parol|пароль)\s*[:=]\s*\S{3,}/i,
  // email:pass yoki login:pass kombinatsiya (combo dump qolipi)
  /\b[\w.+-]{2,}@[\w.-]+\.[a-z]{2,}:[^\s:;,]{3,}\b/,
  /\b(?:login|user|acc(?:oun)?t?)\s*[:=]\s*[^\s;|]{2,}\s*[;|,]\s*(?:pass(?:word)?|pwd|parol|пароль)\s*[:=]/i,
  // atayin saqlangan dump fayllari
  /(?:combo|credentials?|passwords?|parollar|akkauntlar)[/_. -]?(?:list|dump|\.txt|\.csv|\.sql|\.json)/i,
  // hujjat ichida parol jadvali sarlavhasi
  /(?:пароль|password|parol)\s*[—–-]\s*(?:почта|mail|email|login|логин)/i,
];

/** PASTE/DUMP manba hostlari — bu saytlarda chiqsa kamida «oqish manbasi» */
const PASTE_HOSTS = new Set([
  "pastebin.com",
  "gist.github.com",
  "rentry.co",
  "controlc.com",
  "dpaste.org",
  "paste.ee",
  "justpaste.it",
  "ghostbin.com",
  "textbin.net",
  "pastes.io",
  "paste2.org",
  "hastebin.com",
  "dumpz.org",
]);

function detectLeakSignal(r: SearchResultItem): ResultSignal | null {
  const hay = hayOf(r);
  if (CRED_STRONG.some((re) => re.test(hay))) {
    return {
      level: "strong",
      label: "Parol izi",
      note: "Bu topilmaning matnida aniq kredential qolipi uchradi (masalan: password:, email:pass, combo list) — oqish bazasining o'zi bo'lishi mumkin. Havolani ochishdan oldin havfsizlikka e'tibor bering.",
    };
  }
  const host = hostOf(r);
  if (PASTE_HOSTS.has(host)) {
    return {
      level: "medium",
      label: "Paste manbasi",
      note: `Topilma ${host} paste-saytida — shu sahifada maqsad keltirilgan, ichida parollar bo'lishi mumkin (qo'lda ko'rib chiqing).`,
    };
  }
  if (/\b(leak|oqish|sizib|dump|сайт утеч|sliv)\b/i.test(hay)) {
    return {
      level: "medium",
      label: "Oqish eslatmasi",
      note: "Sahifada maqsad bilan birga oqish/leak haqida gapirilgan — ammo aniq parol qolipi topilmadi.",
    };
  }
  return null;
}

// ===== 2. PASPORT VA HUJJATLAR (document-leaks) =====

/** Hujjat mavzusi so'zlari — o'zbekcha qo'shimchalar bilan («pasporti», «hujjati») */
const DOC_WORDS =
  /\b(pasport\w{0,5}|passport|паспорт\w{0,4}|guvohnoma\w{0,5}|jshshir\w{0,4}|жшшир\w{0,4}|pinfl|пинфл|hujjat\w{0,5}|документ\w{0,5}|ID karta|pasport seriyasi)\b/i;

/** UZ pasport seriyasi: 2 katta harf + 6-7 raqam (AA1234567 yoki AB 123456).
 * KATTA harf talabi atayin: seriyalar katta harf bilan yoziladi — kichik
 * harfli «aa1234567» username'lari yolg'on musbat bo'lib qolmasligi uchun.
 * Bu qoida KELLIKLASHTIRILMAGAN matnda tekshiriladi (hayOf(r, false)). */
const UZ_SERIES = /\b[A-ZА-Я]{2}\s?-?\d{6,7}\b/;

/** JSHSHIR/PINFL — aynan so'z bilan kelgan 14-raqam (faqat raqam emas!) */
const PINFL_WITH_WORD = /\b(?:jshshir|жшшир|pinfl|пинфл|jshshir raqami)\b[^0-9]{0,24}\d{14}\b/i;
const PINFL_BARE14 = /\b\d{14}\b/;

/** RF pasporti: 6+6 raqam guruhlari (12 34 567890) */
const RU_SERIES = /\b\d{2}\s?\d{2}\s?\d{6}\b/;

/** Hujjat kutubxona/arxiv hostlari */
const DOC_HOSTS = new Set([
  "scribd.com",
  "docdroid.net",
  "docdroid.com",
  "pdfcoffee.com",
  "vdoc.pub",
  "idoc.pub",
  "dokumen.pub",
  "vdocuments.mx",
  "drive.google.com",
  "docs.google.com",
  "archive.org",
  "telegra.ph",
  "justpaste.it",
  "dropbox.com",
]);

function detectDocSignal(r: SearchResultItem): ResultSignal | null {
  const hay = hayOf(r);
  const hayRaw = hayOf(r, false); // seriya qoliplari KATTA harf bilan — kelliqlashsiz tekshiriladi
  const docWord = DOC_WORDS.test(hay);
  // Kuchli: seriya qolipi + hujjat so'zi birga (faqat raqam bo'lsa boshqa
  // kodlar bilan aralashib ketadi — aynan hujjat so'zi bilan tasdiqlaymiz)
  if ((UZ_SERIES.test(hayRaw) || RU_SERIES.test(hayRaw)) && docWord) {
    return {
      level: "strong",
      label: "Hujjat belgisi",
      note: "Matnda hujjat so'zi bilan birga pasport seriyasi ko'rinishidagi raqam qolipi uchradi — hujjat nusxasi yoki bazasi bo'lishi mumkin. Maxfiylik chegarasi: faqat ochiq manbalar ko'rsatiladi.",
    };
  }
  if (PINFL_WITH_WORD.test(hay) || (PINFL_BARE14.test(hayRaw) && docWord)) {
    return {
      level: "strong",
      label: "JSHSHIR belgisi",
      note: "Matnda JSHSHIR/PINFL (14 raqamli shaxsiy raqam) hujjat so'zi bilan birga uchradi — hujjat bazasi bo'lishi ehtimoli yuqori.",
    };
  }
  const host = hostOf(r);
  if (DOC_HOSTS.has(host)) {
    return {
      level: "medium",
      label: "Hujjat arxivi",
      note: `Topilma ${host} hujjat kutubxonasida — sahifada maqsadga oid hujjat bo'lishi mumkin (qo'lda ko'rib chiqing).`,
    };
  }
  if (/\.(pdf|docx?|xlsx?|rtf|vcf)(\?|#|$)/i.test(r.url) && docWord) {
    return {
      level: "medium",
      label: "Hujjat fayli",
      note: "To'g'ridan-to'g'ri hujjat fayl havolasi va hujjat so'zi birga uchradi.",
    };
  }
  if (docWord) {
    return {
      level: "medium",
      label: "Hujjat eslatmasi",
      note: "Sahifada maqsad bilan birga pasport/hujjat haqida eslatma bor — aniq hujjat qolipi topilmadi.",
    };
  }
  return null;
}

// ===== 3. RASMLAR (photo-search) =====

const PHOTO_HOSTS = new Set([
  "imgur.com",
  "flickr.com",
  "postimages.org",
  "postimg.cc",
  "ibb.co",
  "picuki.com",
  "imginn.com",
  "greatfon.com",
  "pinterest.com",
  "tumblr.com",
  "500px.com",
  "deviantart.com",
  "behance.net",
  "telegra.ph",
  "t.me",
]);

const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

function detectPhotoSignal(r: SearchResultItem): ResultSignal | null {
  const hay = hayOf(r);
  // snippet Bing rasm natijasida to'liq fayl havolasi (murl) bo'ladi
  const fileIsImage = IMAGE_FILE.test(r.snippet) || IMAGE_FILE.test(r.url);
  const hasThumb = !!r.favicon && /^https?:\/\//i.test(r.favicon);
  if (fileIsImage && hasThumb) {
    return {
      level: "strong",
      label: "Rasm topilma",
      note: "Maqsadga tegishli rasm fayli topildi — kartada ko'rinishi bor, bosib manba sahifani oching.",
    };
  }
  const host = hostOf(r);
  if (PHOTO_HOSTS.has(host)) {
    return {
      level: "medium",
      label: "Foto host",
      note: `Rasm ${host} foto xizmatida joylashgan — sahifada maqsad rasmlari bo'lishi mumkin.`,
    };
  }
  if (fileIsImage) {
    return {
      level: "medium",
      label: "Rasm havolasi",
      note: "Sahifada maqsad nomi bilan rasm fayli havolasi uchradi.",
    };
  }
  return null;
}

// ===== Umumiy interfeys =====

const DETECTORS: Record<SignalKind, (r: SearchResultItem) => ResultSignal | null> = {
  leak: detectLeakSignal,
  doc: detectDocSignal,
  photo: detectPhotoSignal,
};

export function signalForModule(moduleId: string): SignalKind | null {
  if (moduleId === "leak-search") return "leak";
  if (moduleId === "document-leaks") return "doc";
  if (moduleId === "photo-search") return "photo";
  return null;
}

/** Signal darajasi — saralash uchun (kichik = yuqorida) */
function rank(r: SearchResultItem): number {
  if (r.signal?.level === "strong") return 0;
  if (r.signal?.level === "medium") return 1;
  return 2;
}

/**
 * Modul natijalariga signal BELGISI qo'shadi va kuchlilik bo'yicha saralaydi
 * (strong → medium → signal'siz, ichki tartib saqlanadi). Reyting ichida
 * qolgan natijalar ham yo'qolmaydi — faqat aniq izlar yuqoriga chiqadi.
 */
export function annotateAndSort(
  kind: SignalKind,
  items: SearchResultItem[]
): SearchResultItem[] {
  if (items.length <= 1) {
    return items.map((r) => (r.signal ? r : { ...r, signal: DETECTORS[kind](r) ?? undefined }));
  }
  const annotated = items.map((r) => ({ ...r, signal: DETECTORS[kind](r) ?? undefined }));
  return annotated.sort((a, b) => rank(a) - rank(b)); // Array.sort — barqaror
}
