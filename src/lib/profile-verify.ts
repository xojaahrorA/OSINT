// Profil havolalarini JONLI mavjudlik tekshiruvi bilan tasdiqlash
//
// Foydalanuvchi shikoyati: «username bilan shu saytlar boromi yo'qmi —
// keraksiz (mavjud bo'lmagan) profillar chiqarilardi».
//
// Sabab: avvalgi «Profil havolalari» moduli 12 ta platformaga soqqa havola
// qo'yardi — Instagram/TikTok'da profil yo'q bo'lsa ham natijada turavergan.
// Yechim: har bir platforma uchun jonli HTTP tekshiruv:
//   404/410 yoki «sahifa topilmadi» imzosi → profil YO'Q (natijadan OLIB TASHLANADI)
//   aniq imzo (t.me tgme_page_title, GitHub 200, Reddit 200...) → TASDIQLANDI
//   login-devor / captcha / 403 / 429 → ANIQLANMADI (izoh bilan qoladi)
//
// Bu — OSINT'dagi «kross-validatsiya» qadami: hech qanday ma'lumot
// o'ylab topilmaydi, faqat saytning o'z javobi asosida hukm chiqariladi.

import type { SearchResultItem } from "@/lib/osint";

const UA_VERIFY =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 9_000;
const BODY_MAX = 200_000;

export interface VerifyOutcome {
  state: "yes" | "no" | "unknown";
  note: string;
}

interface PageResponse {
  status: number;
  body: string;
  finalUrl: string;
}

async function fetchPage(url: string): Promise<PageResponse | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": UA_VERIFY,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,uz;q=0.8,ru;q=0.7",
      },
    });
    const buf = await res.arrayBuffer();
    const body = new TextDecoder("utf-8", { fatal: false })
      .decode(buf.slice(0, BODY_MAX))
      .toLowerCase();
    return { status: res.status, body, finalUrl: res.url || url };
  } catch {
    return null;
  }
}

const UNKNOWN_NOTE = "Sayt bot so'rovlarini bloklaydi (login-devor/captcha) — qo'lda ochib tekshiring";
const GONE_NOTE = "Sayt profil yo'q deb javob berdi (HTTP 404) — natijadan olib tashlandi";

/**
 * Umumiy qoida: 404/410 → yo'q; imzo ro'yxatida bittasi bo'lsa shunga qarab;
 * qolgani aniqlanmadi. Har bir platforma o'z imzolarini qo'shadi.
 */
async function genericCheck(
  url: string,
  opts: {
    yesSignatures?: { s: string; note?: string }[];
    noSignatures?: { s: string; note?: string }[];
    twoHundredIsYes?: boolean;
  } = {}
): Promise<VerifyOutcome> {
  const page = await fetchPage(url);
  if (!page) return { state: "unknown", note: "Saytga ulanib bo'lmadi (tarmoq/timeout) — qo'lda tekshiring" };
  if (page.status === 404 || page.status === 410) return { state: "no", note: GONE_NOTE };
  for (const { s, note } of opts.noSignatures ?? []) {
    if (page.body.includes(s)) return { state: "no", note: note ?? GONE_NOTE };
  }
  for (const { s, note } of opts.yesSignatures ?? []) {
    if (page.body.includes(s)) return { state: "yes", note: note ?? "Profil tasdiqlandi — sahifa javobida profil imzosi bor" };
  }
  if (page.status >= 200 && page.status < 300) {
    return opts.twoHundredIsYes
      ? { state: "yes", note: "Profil tasdiqlandi (HTTP 200)" }
      : { state: "unknown", note: UNKNOWN_NOTE };
  }
  return { state: "unknown", note: `Sayt ${page.status} javob berdi — ${UNKNOWN_NOTE.toLowerCase()}` };
}

interface PlatformCheck {
  name: string;
  host: string;
  url: (u: string) => string;
  check: (u: string) => Promise<VerifyOutcome>;
}

const PLATFORMS: PlatformCheck[] = [
  {
    name: "Telegram",
    host: "t.me",
    url: (u) => `https://t.me/${u}`,
    // t.me HAR DOIM 200 qaytaradi: profil bo'lsa tgme_page_title klassi bor,
    // bo'lmasa umumiy «Telegram Messenger» sahifasi (title yo'q) — shunga tayanamiz
    check: async (u) => {
      const page = await fetchPage(`https://t.me/${u}`);
      if (!page) return { state: "unknown", note: "Saytga ulanib bo'lmadi (tarmoq/timeout) — qo'lda tekshiring" };
      if (page.body.includes("tgme_page_title")) {
        return { state: "yes", note: "Telegram: profil/kanal tasdiqlandi (t.me javobida sarlavha bor)" };
      }
      return { state: "no", note: "Telegram: bunday akkaunt topilmadi (olib tashlandi)" };
    },
  },
  {
    name: "GitHub",
    host: "github.com",
    url: (u) => `https://github.com/${u}`,
    check: (u) => genericCheck(`https://github.com/${u}`, { twoHundredIsYes: true }),
  },
  {
    name: "X (Twitter)",
    host: "x.com",
    url: (u) => `https://x.com/${u}`,
    check: (u) =>
      genericCheck(`https://x.com/${u}`, {
        noSignatures: [{ s: "that page does\u2019t exist", note: "X: profil yo'q (olib tashlandi)" }],
      }),
  },
  {
    name: "Instagram",
    host: "instagram.com",
    url: (u) => `https://instagram.com/${u}/`,
    check: (u) =>
      genericCheck(`https://instagram.com/${u}/`, {
        noSignatures: [
          { s: "sorry, this page isn't available", note: "Instagram: sahifa mavjud emas (olib tashlandi)" },
          { s: "page not found", note: "Instagram: sahifa topilmadi (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "Facebook",
    host: "facebook.com",
    url: (u) => `https://facebook.com/${u}`,
    check: (u) =>
      genericCheck(`https://facebook.com/${u}`, {
        noSignatures: [
          { s: "this page isn't available", note: "Facebook: sahifa mavjud emas (olib tashlandi)" },
          { s: "content isn't available", note: "Facebook: kontent mavjud emas (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "Reddit",
    host: "reddit.com",
    url: (u) => `https://reddit.com/user/${u}/about.json`,
    // Reddit toza JSON javob beradi — login-devor kamroq
    check: (u) =>
      genericCheck(`https://reddit.com/user/${u}/about.json`, {
        yesSignatures: [{ s: `"name":"${u.toLowerCase()}"`, note: "Reddit: profil tasdiqlandi (about.json javobi)" }],
        noSignatures: [
          { s: "not_found", note: "Reddit: bunday foydalanuvchi yo'q (olib tashlandi)" },
          { s: "nobody on reddit goes by that name", note: "Reddit: bunday foydalanuvchi yo'q (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "YouTube",
    host: "youtube.com",
    url: (u) => `https://youtube.com/@${u}`,
    check: (u) =>
      genericCheck(`https://youtube.com/@${u}`, {
        noSignatures: [
          { s: "this page isn't available", note: "YouTube: kanal mavjud emas (olib tashlandi)" },
          { s: "404 not found", note: "YouTube: kanal topilmadi (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "TikTok",
    host: "tiktok.com",
    url: (u) => `https://tiktok.com/@${u}`,
    check: (u) =>
      genericCheck(`https://tiktok.com/@${u}`, {
        noSignatures: [
          { s: "couldn't find this account", note: "TikTok: akkaunt mavjud emas (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "VK",
    host: "vk.com",
    url: (u) => `https://vk.com/${u}`,
    check: (u) =>
      genericCheck(`https://vk.com/${u}`, {
        noSignatures: [
          { s: "страница не найдена", note: "VK: sahifa topilmadi (olib tashlandi)" },
          { s: "page not found", note: "VK: sahifa topilmadi (olib tashlandi)" },
          { s: "нельзя открыть страницу", note: "VK: sahifa ochilmaydi — mavjud emas (olib tashlandi)" },
        ],
      }),
  },
  {
    name: "Medium",
    host: "medium.com",
    url: (u) => `https://medium.com/@${u}`,
    check: (u) => genericCheck(`https://medium.com/@${u}`, { twoHundredIsYes: true }),
  },
  {
    name: "Pinterest",
    host: "pinterest.com",
    url: (u) => `https://pinterest.com/${u}/`,
    check: (u) =>
      genericCheck(`https://pinterest.com/${u}/`, {
        noSignatures: [{ s: "we couldn't find", note: "Pinterest: profil topilmadi (olib tashlandi)" }],
      }),
  },
  {
    name: "Behance",
    host: "behance.net",
    url: (u) => `https://behance.net/${u}`,
    check: (u) => genericCheck(`https://behance.net/${u}`, { twoHundredIsYes: true }),
  },
];

export interface VerifiedProfiles {
  /** Faqat tasdiqlangan + aniqlanmadi (yo'qlar OLIB TASHLANGAN) */
  items: SearchResultItem[];
  verified: number;
  dropped: number;
  unknown: number;
}

/**
 * Username bo'yicha barcha platformalarni parallel tekshiradi.
 * Natija: faqat haqiqatan mavjud (yes) yoki aniqlanmagan (unknown) profillar.
 * «no» javob berganlar butunlay olib tashlanadi — foydalanuvchi bo'lmagan
 * saytlarga borda-borda ko'z qo'ymaydi.
 */
export async function verifyProfileLinks(rawUsername: string): Promise<VerifiedProfiles> {
  const u = rawUsername.trim().replace(/^@/, "");
  const outcomes = await Promise.all(
    PLATFORMS.map(async (p): Promise<{ p: PlatformCheck; out: VerifyOutcome }> => {
      try {
        const out = await p.check(u);
        return { p, out };
      } catch {
        return { p, out: { state: "unknown" as const, note: "Tekshiruv bajarilmadi — qo'lda ochib ko'ring" } };
      }
    })
  );

  const items: SearchResultItem[] = [];
  let verified = 0;
  let dropped = 0;
  let unknown = 0;

  // Tasdiqlanganlar birinchi, keyin aniqlanmaganlar
  for (const pass of ["yes", "unknown"] as const) {
    for (const { p, out } of outcomes) {
      if (out.state !== pass) continue;
      if (pass === "yes") verified++;
      else unknown++;
      items.push({
        name: `${p.name} — @${u}`,
        url: p.url(u),
        snippet: out.note,
        host_name: p.host,
        verified: out.state,
        verifyNote: out.note,
      });
    }
  }
  dropped = outcomes.length - verified - unknown;

  return { items, verified, dropped, unknown };
}
