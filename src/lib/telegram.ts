// OSINT Radar — TELEGRAM manbalari (OSINT Framework "Instant Messaging" bo'limi)
// Telegram — O'zbekistondagi 1-raqamli platforma; oddiy qidiruv tizimlari t.me
// ichidagi kontentni deyarli indekslamaydi, shuning uchun bu yerdan TO'G'RIDAN-TO'G'RI
// o'qiymiz — API kaliti talab qilinmaydi:
//
//   1. t.me/<username>          — profil/kanal/bot mavjudligi, ism, bio, obunachilar
//   2. t.me/s/<kanal>           — ochiq kanalning WEB PREVIEW: so'nggi posti (sana,
//                                 ko'rishlar, matn) — Telegram'dagi faoliyatning isboti
//   3. api.telegram.org Bot API — TELEGRAM_BOT_TOKEN bo'lsa rasmiy API'dan ANIQ
//                                 ma'lumot (chat id, turi, bio, a'zolar soni) — mutlaqo bepul
//
// Har bir manba SearchResultItem[] qaytaradi — skaner oqimiga mos; tarmoq xatosida
// bo'sh ro'yxat qaytadi (skaner hech qachon to'xtamaydi).

import type { SearchResultItem } from "@/lib/osint";

// ===== Yordamchilar =====

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function timeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

const item = (name: string, url: string, snippet: string, host: string, date?: string): SearchResultItem => ({
  name,
  url,
  snippet,
  host_name: host,
  ...(date ? { date } : {}),
});

/** HTML entity + teglarni oddiy matnga aylantirish */
function cleanHtml(raw: string): string {
  let s = raw;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&hellip;/g, "…")
    .replace(/&#x?([0-9a-f]+);/gi, (_, h) => {
      try {
        const n = /^x/i.test(_) ? parseInt(h, 16) : parseInt(h, 10);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
      } catch {
        return "";
      }
    });
  return s.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** @belgi, bo'shliq, nuqtali transportlarni tozalab Telegram username normasi */
function normUser(raw: string): string | null {
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(u)) return null;
  return u;
}

async function fstatus(
  url: string,
  ms = 8000,
  maxBytes = 220_000
): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en" },
      signal: timeout(ms),
      redirect: "follow",
    });
    const buf = await res.arrayBuffer();
    const dec = new TextDecoder("utf-8", { fatal: false });
    return { status: res.status, text: dec.decode(buf.slice(0, maxBytes)) };
  } catch {
    return null;
  }
}

async function fjson<T>(
  url: string,
  ms = 10_000
): Promise<(T & { ok?: boolean; description?: string }) | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: timeout(ms),
    });
    if (!res.ok) return null;
    return (await res.json()) as T & { ok?: boolean; description?: string };
  } catch {
    return null;
  }
}

function ogMeta(html: string, prop: string): string {
  return cleanHtml(
    (html.match(new RegExp(`property=["']${prop}["'][^>]*content=["']([^"']*)`)) ??
      html.match(new RegExp(`content=["']([^"']*)["'][^>]*property=["']${prop}["']`)) ??
      [])[1] ?? ""
  ).trim();
}

/** "1 234 567 subscribers" / "1.2M members" / "@durov, 1.2M subscribers" → {count, label} */
function parseExtra(extra: string): { count: string; label: string; kind: string } | null {
  if (!extra) return null;
  const e = extra.replace(/&nbsp;/g, " ");
  const mNum = e.match(/([\d\s.,]+)\s*([KM]?)\s*(subscribers|members)/i);
  if (!mNum) return null;
  let count = "";
  if (mNum[2]?.toUpperCase() === "K" || mNum[2]?.toUpperCase() === "M") {
    count = `${mNum[1].trim()}${mNum[2].toUpperCase()}`;
  } else {
    count = mNum[1].replace(/\s+/g, "").replace(/,$/, "").trim();
  }
  const kind = /subscribers/i.test(mNum[3]) ? "kanal" : "guruh";
  return { count, label: mNum[3].toLowerCase(), kind };
}

// ===== 1. Telegram profili (t.me/<username>) =====

export async function telegramProfileSource(rawTarget: string): Promise<SearchResultItem[]> {
  const u = normUser(rawTarget);
  if (!u) return [];
  const url = `https://t.me/${u}`;
  const r = await fstatus(url, 8000);
  if (!r) return []; // tarmoq xatosi — jimgina o'tamiz

  // Mavjud emas: t.me javobida tgme_page_title yo'q (free username sahifasi)
  if (!r.text.includes("tgme_page_title")) {
    return [
      item(
        `Telegram: @${u} band emas`,
        url,
        "Bu username bilan ochiq profil, kanal yoki bot topilmadi (t.me javobi). Username bo'sh yoki profil yashirilgan bo'lishi mumkin.",
        "t.me"
      ),
    ];
  }

  const title = ogMeta(r.text, "og:title");
  const desc = ogMeta(r.text, "og:description");
  const extra = (r.text.match(/tgme_page_extra[^>]*>([^<]*)/)?.[1] ?? "").trim();
  const verified = r.text.includes("verified-icon");
  const parsed = parseExtra(extra);

  // Turi: subscribers = kanal, members = guruh, aks holda shaxs/bot
  let kind = "Shaxs yoki bot";
  if (parsed?.kind === "kanal") kind = "Kanal";
  else if (parsed?.kind === "guruh") kind = "Guruh";
  else if (extra.startsWith("@")) kind = "Shaxs yoki bot";

  const facts = [
    `Turi: ${kind}${verified ? " · tasdiqlangan (verified)" : ""}`,
    parsed
      ? `Obunachi/a'zolar: ${/^\d+$/.test(parsed.count) ? Number(parsed.count).toLocaleString("en-US") : parsed.count}`
      : extra
        ? extra
        : "",
    desc ? `Tavsif: ${desc.slice(0, 220)}` : "",
  ].filter(Boolean);

  const out: SearchResultItem[] = [
    item(
      `Telegram ${kind.toLowerCase()}: ${title || `@${u}`}`,
      url,
      facts.join(" · ") || "Telegram'da ochiq profil topildi",
      "t.me"
    ),
  ];

  // Avatar mavjudligi — profil rasmi OSINT uchun qimmatli (yuz aniqlashda ishlatiladi)
  const avatar = ogMeta(r.text, "og:image");
  if (avatar) {
    out.push(
      item(
        `Telegram avatar: ${title || `@${u}`}`,
        avatar,
        `Profil rasmi (cdn-telegram.org). @${u} hisobiga tegishli — tasvir qidiruvida solishtirish uchun saqlang.`,
        "cdn-telegram.org"
      )
    );
  }
  return out;
}

// ===== 2. Ochiq kanal posti (t.me/s/<kanal> — web preview) =====

interface FeedPost {
  id: string;
  date: string;
  views: string;
  text: string;
}

export async function telegramFeedSource(rawTarget: string): Promise<SearchResultItem[]> {
  const u = normUser(rawTarget);
  if (!u) return [];
  const r = await fstatus(`https://t.me/s/${u}`, 9000, 400_000);
  if (!r || !r.text.includes("tgme_widget_message")) return []; // yopiq kanal / posti yo'q / mavjud emas

  // Kanal nomi (sahifa sarlavhasidan)
  const chTitle = ogMeta(r.text, "og:title") || u;

  // Xabar bloklarini ajratish — har biri "tgme_widget_message ..." div'idan boshlanadi
  const chunks = r.text.split(/<div class="tgme_widget_message[\s"]/).slice(1);
  const posts: FeedPost[] = [];
  for (const ch of chunks) {
    const id = (ch.match(/data-post="[^/]+\/(\d+)"/)?.[1] ?? "").trim();
    if (!id) continue;
    const iso = (ch.match(/<time datetime="([^"]+)"/)?.[1] ?? "").trim();
    const date = iso.slice(0, 10);
    const views = (ch.match(/tgme_widget_message_views">([^<]+)</)?.[1] ?? "").trim();

    // Matn: js-message_text div'idan footer gacha — ichma-ich <div> bo'lsa ham
    // indexOf bilan kesib olamiz, keyin teglarni tozalaymiz
    let text = "";
    const ti = ch.indexOf("js-message_text");
    if (ti >= 0) {
      const fi = ch.indexOf("tgme_widget_message_footer", ti);
      const raw = ch.slice(ch.indexOf(">", ti) + 1, fi > ti ? fi : Math.min(ti + 4000, ch.length));
      text = cleanHtml(raw);
    }
    posts.push({ id, date, views, text });
  }

  if (posts.length === 0) return [];

  // Eng oxirgi 10 ta post
  const last = posts.slice(-10).reverse();
  const out: SearchResultItem[] = [
    item(
      `Telegram kanal faoliyati: ${chTitle} (${u})`,
      `https://t.me/s/${u}`,
      `Ochiq kanalning so'nggi posti o'qildi — ${last.length} ta post, eng oxirgisi ${last[0]?.date ?? "?"}. Post matnlarida email/telefon/username bo'lsa «Topilgan qo'shimcha ma'lumotlar» paneliga tushadi.`,
      "t.me"
    ),
  ];
  for (const p of last) {
    out.push(
      item(
        `Telegram posti #${p.id}${p.views ? ` — ${p.views} ko'rish` : ""}`,
        `https://t.me/${u}/${p.id}`,
        p.text.slice(0, 320) || "(media post — matn yo'q)",
        "t.me",
        p.date || undefined
      )
    );
  }
  return out;
}

// ===== 3. Telegram Bot API (TELEGRAM_BOT_TOKEN — mutlaqo bepul, @BotFather) =====

interface TgChat {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  bio?: string;
  description?: string;
  active_usernames?: string[];
}

const CHAT_TYPE_UZ: Record<string, string> = {
  channel: "Kanal",
  group: "Guruh",
  supergroup: "Guruh (supergroup)",
  private: "Shaxsiy hisob",
  bot: "Bot",
};

export async function telegramBotApiSource(rawTarget: string): Promise<SearchResultItem[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return [];
  const u = normUser(rawTarget);
  if (!u) return [];

  const base = `https://api.telegram.org/bot${token}`;
  const chat = await fjson<{ result?: TgChat }>(
    `${base}/getChat?chat_id=@${encodeURIComponent(u)}`,
    10_000
  );
  if (!chat?.ok || !chat.result) return [];

  const c = chat.result as TgChat;
  const title = c.title ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? "";
  const kind = CHAT_TYPE_UZ[c.type ?? ""] ?? c.type ?? "noma'lum";
  const facts = [
    `Turi: ${kind}`,
    c.id !== undefined ? `Chat ID: ${c.id}` : "",
    c.username ? `Username: @${c.username}` : "",
    c.active_usernames?.length ? `Boshqa username: ${c.active_usernames.map((x) => `@${x}`).join(", ")}` : "",
    c.description ? `Tavsif: ${c.description.slice(0, 220)}` : "",
    c.bio ? `Bio: ${c.bio.slice(0, 160)}` : "",
  ].filter(Boolean);

  const url = `https://t.me/${u}`;
  const out: SearchResultItem[] = [
    item(
      `Telegram Bot API: ${title || `@${u}`}`,
      url,
      facts.join(" · ") || "Rasmiy API javobi — chat topildi",
      "api.telegram.org"
    ),
  ];

  // A'zolar/obunachilar soni — kanal/guruh uchun aniq raqam
  const cnt = await fjson<{ result?: number }>(
    `${base}/getChatMemberCount?chat_id=@${encodeURIComponent(u)}`,
    10_000
  );
  if (cnt?.ok && typeof cnt.result === "number") {
    out.push(
      item(
        `Telegram Bot API: ${cnt.result.toLocaleString("en-US")} obunachi/a'zo`,
        url,
        `getChatMemberCount — @${u} uchun aynan raqam (${cnt.result}). Eng yangi holat: ${new Date().toISOString().slice(0, 10)}.`,
        "api.telegram.org"
      )
    );
  }
  return out;
}
