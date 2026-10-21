// OSINT Radar — IntelBase uslubidagi UMUMIY BAHO dvigateli: email'dan tashqari
// BARCHA maqsad turlari (username, telefon, ism, domen, IP, kompaniya) uchun.
// Har tur uchun sintez kartalari:
//   1) Umumiy baho — 2-3 ball va har ball NIMA UCHUN shunday ekanini asoslar bilan
//      (IntelBase'ning «Why this score» tamoyili)
//   2) Timeline — voqealar xronologiyasi (oqishlar, postlar, yangiliklar, o'zgarishlar)
//   3) BOG'LANISHLAR — barcha modullar natijalaridan ajratilgan, maqsad bilan
//      bir-biriga bog'langan entitetlar (email↔username↔domen↔telefon↔IP↔ism).
//      Bu skaner modullarini yagona rasmda BIRLASHTIRADI — «birlashmay qolgan»
//      ma'lumotlar shu karta orqali ko'rinadi.
// Hammasi bepul manbalar bilan; sintez katta qismi modul natijalaridan, kerak
// bo'lganda 1-2 ta yengil jonli tekshiruv (DoH, RDAP, Hudson Rock, Shodan DB).
// Natija: oddiy SearchResultItem[] — skaner UI'siga o'zgarishsiz qo'shiladi.

import type { SearchResultItem, TargetType } from "@/lib/osint";
import { FREEMAIL_DOMAINS } from "@/lib/osint";
import { extractIntelBatch, type IntelEntry, type IntelSourceItem } from "@/lib/intel";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const item = (
  name: string,
  url: string,
  snippet: string,
  host: string
): SearchResultItem => ({ name, url, snippet, host_name: host });

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Ochiqlik/xavf ballari uchun daraja (yuqori = yomon) */
function scoreLabel(v: number): string {
  if (v >= 75) return "Kritik";
  if (v >= 50) return "Yuqori";
  if (v >= 25) return "O'rtacha";
  return "Past";
}

/** Musbat ballar uchun daraja (yuqori = yaxshi) */
function strengthLabel(v: number): string {
  if (v >= 75) return "Kuchli";
  if (v >= 50) return "O'rtacha";
  if (v >= 25) return "Zaif";
  return "Aniqlanmagan";
}

function cardLine(label: string, score: number, reasons: string[]): string {
  return `${label} ${score}/100 — ${reasons.length ? reasons.join(" · ") : "asos aniqlanmadi"}`;
}

// ===== Kichik yordamchilar =====

interface DohResp {
  Status?: number;
  Answer?: { data: string }[];
}

async function dohJson(name: string, type: string): Promise<{ data: string }[]> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return [];
    const j = (await res.json()) as DohResp;
    return j.Status === 0 && Array.isArray(j.Answer) ? j.Answer : [];
  } catch {
    return [];
  }
}

async function fjLocal<T>(url: string, ms = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(ms),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function cleanDomainInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

const ISO_DATE = /\b(\d{4}-\d{2}(?:-\d{2})?)\b/g;

function collectDates(text: string): string[] {
  return [...text.matchAll(ISO_DATE)].map((m) => m[1]);
}

function itemsOf(
  mr: Record<string, SearchResultItem[]>,
  ...ids: string[]
): SearchResultItem[] {
  const out: SearchResultItem[] = [];
  for (const id of ids) out.push(...(mr[id] ?? []));
  return out;
}

function hostOf(r: SearchResultItem): string {
  try {
    return new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    return r.host_name ?? "";
  }
}

function uniqHosts(items: SearchResultItem[]): string[] {
  return [...new Set(items.map(hostOf).filter(Boolean))];
}

function namesSimilar(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z\u0400-\u04FF]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z\u0400-\u04FF]/g, "");
  if (na.length < 2 || nb.length < 2) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

// ===== Timeline =====

interface TimelineEvent {
  date: string; // ISO yoki YYYY-MM
  label: string;
}

function fmtDate(d: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return d.slice(0, 10);
}

function pushTimeline(tl: TimelineEvent[], date: string | undefined, label: string) {
  if (!date) return;
  const d = date.trim();
  if (!/^\d{4}-\d{2}/.test(d)) return;
  tl.push({ date: d, label });
}

function sortTimeline(tl: TimelineEvent[]): TimelineEvent[] {
  return tl.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

function timelineCard(events: TimelineEvent[], url: string): SearchResultItem | null {
  if (events.length === 0) return null;
  return item(
    `Timeline — ${events.length} ta voqea`,
    url,
    events.map((t) => `${fmtDate(t.date)} — ${t.label}`).join(" · "),
    "osint-radar"
  );
}

// ===== BOG'LANISHLAR — modullararo korelyatsiya dvigateli =====
/**
 * Barcha modullar natijalaridan entitetlar ajratiladi (extractIntelBatch) va
 * maqsad bilan ANIQ bog'lanish qoidalari orqali birlashtiriladi:
 *   - domen maqsad: @domen pochtalar, subdomenlar
 *   - username maqsad: lokal qismi bir xil bo'lgan email (kuchli bog'lanish)
 *   - email maqsad: lokal qismiga mos username, bir xil domenli pochtalar
 *   - telefon maqsad: t.me profil/kanal izlari
 *   - IP maqsad: shu IP atrofidagi domenlar
 *   - ism maqsad: birga kelgan username/telefonlar
 * Sintez kartalari (*-score) manba sifatida ishtirok etmaydi — ular xulosalar.
 */

export const SYNTHESIS_SCORE_IDS = new Set([
  "email-score",
  "username-score",
  "phone-score",
  "name-score",
  "domain-score",
  "ip-score",
  "company-score",
]);

export interface LinkedIntel {
  entries: IntelEntry[];
  matches: string[];
}

export function collectLinkedIntel(
  target: string,
  type: TargetType,
  mr: Record<string, SearchResultItem[]>
): LinkedIntel {
  const batch: IntelSourceItem[] = [];
  const t = target.trim().toLowerCase();
  const tClean = t.replace(/^@/, "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  for (const [moduleId, items] of Object.entries(mr)) {
    if (SYNTHESIS_SCORE_IDS.has(moduleId)) continue;
    for (const it of items ?? []) {
      batch.push({ item: it, moduleTitle: moduleId, moduleId });
    }
  }
  const entries = extractIntelBatch(batch, [t, tClean]).filter((e) => {
    if (e.kind === "name" && t.split(/\s+/).length >= 2) {
      // ism maqsadning aniq o'zi (tartibi bilan) — bog'lanish emas
      if (e.value.toLowerCase() === t.toLowerCase()) return false;
    }
    return true;
  });

  const matches: string[] = [];
  const emails = entries.filter((e) => e.kind === "email");
  const usernames = entries.filter((e) => e.kind === "username");
  const domains = entries.filter((e) => e.kind === "domain");
  const phones = entries.filter((e) => e.kind === "phone");

  if (type === "domain") {
    const corp = emails.filter((e) => e.value.endsWith(`@${tClean}`));
    if (corp.length > 0)
      matches.push(
        `Korporativ pochta (${corp.length}): ${corp.slice(0, 3).map((e) => e.value).join(", ")}`
      );
    const subs = domains.filter((d) => d.value.endsWith(`.${tClean}`));
    if (subs.length > 0)
      matches.push(
        `Subdomenlar (${subs.length}): ${subs.slice(0, 4).map((d) => d.value).join(", ")}`
      );
  }

  if (type === "username") {
    const u = tClean;
    const own = emails.filter((e) => e.value.split("@")[0] === u);
    if (own.length > 0)
      matches.push(
        `Email lokal qismi shu username bilan bir xil: ${own[0].value} — KUCHLI bog'lanish`
      );
  }

  if (type === "email") {
    const [local, dom] = t.split("@");
    const own = usernames.filter((x) => x.value === local);
    if (own.length > 0)
      matches.push(`«${own[0].value}» username'i email lokal qismi bilan mos — KUCHLI bog'lanish`);
    const corp = emails.filter((e) => e.value.endsWith(`@${dom}`) && e.value !== t);
    if (corp.length > 0)
      matches.push(
        `Bir xil domenli boshqa pochtalar (${corp.length}): ${corp.slice(0, 2).map((e) => e.value).join(", ")}`
      );
  }

  if (type === "phone") {
    const tme = new Set<string>();
    for (const it of itemsOf(mr, "phone-mentions", "phone-trace", "telegram-search", "search")) {
      const hay = `${it.url} ${it.name} ${it.snippet}`;
      for (const m of hay.matchAll(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-z0-9._-]{3,32})/gi)) {
        tme.add(m[1].toLowerCase());
      }
    }
    if (tme.size > 0)
      matches.push(
        `Telegram'da bog'langan profil/kanallar (${tme.size}): ${[...tme].slice(0, 4).join(", ")}`
      );
  }

  if (type === "ip") {
    const hosts = domains
      .filter((d) => !FREEMAIL_DOMAINS.has(d.value) && !d.value.endsWith(".in-addr.arpa"))
      .slice(0, 4);
    if (hosts.length > 0)
      matches.push(`Shu IP atrofida tilga olingan domenlar: ${hosts.map((d) => d.value).join(", ")}`);
  }

  if (type === "name") {
    if (usernames.length > 0)
      matches.push(
        `Ism bilan birga tilga olingan username'lar: ${usernames.slice(0, 4).map((x) => x.value).join(", ")}`
      );
    if (phones.length > 0)
      matches.push(`Ism bilan birga kelgan telefonlar: ${phones.slice(0, 3).map((p) => p.value).join(", ")}`);
  }

  return { entries, matches };
}

/** Bog'lanish turlari tartibi — «name» eng oxirida (shovqin ko'p) */
const LINK_KIND_ORDER: IntelEntry["kind"][] = [
  "email",
  "phone",
  "username",
  "domain",
  "ip",
  "company",
  "name",
];
const LINK_KIND_UZ: Record<IntelEntry["kind"], string> = {
  email: "Email",
  phone: "Telefon",
  username: "Username",
  domain: "Domen",
  ip: "IP",
  company: "Kompaniya",
  name: "Ism",
};

export function linkedCard(li: LinkedIntel, target: string): SearchResultItem | null {
  if (li.entries.length === 0 && li.matches.length === 0) return null;
  const parts: string[] = [];
  for (const kind of LINK_KIND_ORDER) {
    const arr = li.entries.filter((e) => e.kind === kind);
    if (arr.length === 0) continue;
    const top = arr.slice(0, 3).map((e) => `${e.value}${e.count > 1 ? ` (${e.count} manba)` : ""}`);
    parts.push(`${LINK_KIND_UZ[kind]} (${arr.length}): ${top.join(" · ")}`);
  }
  const name = `Bog'lanishlar — ${li.entries.length} ta bog'langan ma'lumot${
    li.matches.length ? ` · ${li.matches.length} kuchli bog'lanish` : ""
  }`;
  const snippet = [
    ...li.matches,
    ...parts,
    "Bular skaner modullari natijalaridan ajratilgan bog'langan entitetlar — ularning istalganini «+» bilan yangi maqsad sifatida tekshirish mumkin.",
  ].join(" || ");
  return item(name, `https://osintframework.com/`, snippet, "osint-radar");
}

// ===== USERNAME — Kenglik / Ochiqlik / Ishonchlilik =====

interface HudStealerHit {
  date_compromised?: string;
  stealer_family?: string;
  total_corporate_services?: number;
}
interface HudResp {
  stealers?: HudStealerHit[];
}

export interface UsernameAssessment {
  reach: { score: number; reasons: string[] };
  exposure: { score: number; reasons: string[] };
  identityLabel: string;
  identityNote: string;
  timeline: TimelineEvent[];
}

export async function computeUsernameAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<UsernameAssessment> {
  const u = target.trim().replace(/^@/, "");
  const wmn = (mr["whatsmyname"] ?? []).filter((r) => /profili topildi/i.test(r.name));
  const profiles = (mr["profiles"] ?? []).filter((r) => r.verified === "yes");
  const probeFound = (mr["username-probe"] ?? []).filter((r) => /:\s*mavjud$/i.test(r.name));
  const tgAlive = itemsOf(mr, "telegram", "telegram-bot", "telegram-feed").filter(
    (r) => !/topilmadi|mavjud emas|not found|yo'q/i.test(`${r.name} ${r.snippet}`)
  );

  // Stealer loglar: modul natijasidan, bo'lmasa jonli Hudson Rock tekshiruvi
  const stItems = mr["stealer-logs"] ?? [];
  let stealers: HudStealerHit[] = [];
  const stHit = stItems.find((r) => /Stealer logda topildi/i.test(r.name));
  if (stHit) {
    // hudsonRockSource formati: [0] xulosa kartasi, keyin har qurilma uchun karta
    const deviceItems = stItems.slice(1).slice(0, 4);
    for (const r of deviceItems) {
      stealers.push({
        date_compromised: r.snippet.match(/Zararlanish sanasi:\s*(\d{4}-\d{2}-\d{2})/)?.[1],
        stealer_family: r.snippet.match(/Malumot o'g'risi:\s*([^|]+)/)?.[1]?.trim(),
        total_corporate_services:
          Number(r.snippet.match(/Korporativ xizmatlar:\s*(\d+)/)?.[1] ?? 0) || undefined,
      });
    }
    if (stealers.length === 0) {
      // xulosa kartasidagi son bo'yicha umumiy yozuv
      const n = Number(stHit.name.match(/topildi:\s*(\d+)/i)?.[1] ?? 1);
      for (let i = 0; i < Math.min(n, 4); i++) stealers.push({});
    }
  } else if (stItems.length === 0 && /^[a-zA-Z0-9._-]{2,64}$/.test(u)) {
    const r = await fjLocal<HudResp>(
      `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-username?username=${encodeURIComponent(u)}`,
      9000
    );
    stealers = (r?.stealers ?? []).slice(0, 4);
  }

  // ---- Kenglik (Reach) ----
  const rReasons: string[] = [];
  let rScore = 0;
  if (wmn.length > 0) {
    const pts = Math.min(45, wmn.length * 3);
    rScore += pts;
    rReasons.push(`${wmn.length} platformada profil topildi (WhatsMyName 700+ sayt) +${pts}`);
  }
  if (profiles.length > 0) {
    const pts = Math.min(15, profiles.length * 3);
    rScore += pts;
    rReasons.push(`${profiles.length} platformada profil JONLI tasdiqlandi +${pts}`);
  }
  if (probeFound.length > 0) {
    const pts = Math.min(15, probeFound.length * 5);
    rScore += pts;
    rReasons.push(`Profil tekshiruvi: ${probeFound.map((r) => r.name.split(":")[0]).join(", ")} +${pts}`);
  }
  if (tgAlive.length > 0) {
    rScore += 10;
    rReasons.push("Telegram'da profil/kanal mavjud +10");
  }
  rScore = clamp(rScore);

  // ---- Ochiqlik (Exposure) ----
  const eReasons: string[] = [];
  let eScore = 0;
  if (stealers.length > 0) {
    eScore += 45;
    const earliest = stealers.map((s) => s.date_compromised).filter(Boolean).sort()[0];
    const corp = stealers.some((s) => (s.total_corporate_services ?? 0) > 0);
    eReasons.push(
      `Infostealer logida topildi — ${stealers.length} zararlangan qurilma${earliest ? `, eng erta ${earliest.slice(0, 10)}` : ""} +45`
    );
    if (corp) eReasons.push("Korporativ xizmatlarga kirish ma'lumotlari ham o'g'rilangan — qo'shimcha xavf");
  } else if (stItems.length > 0 || stealers !== null) {
    eReasons.push("Hudson Rock stealer bazasida yo'q — yaxshi belgi +0");
  }
  const leakish = itemsOf(mr, "username-mentions", "leak-search").filter((r) =>
    /pastebin|leak|dump|oqish|bazalar/i.test(`${r.name} ${r.snippet}`)
  );
  if (leakish.length > 0) {
    eScore += 10;
    eReasons.push(`Oqish/pastebin eslatmalari: ${leakish.length} natija +10`);
  }
  eScore = clamp(eScore);

  // ---- Ishonchlilik (Identity) ----
  const names: string[] = [];
  for (const r of [...probeFound, ...itemsOf(mr, "telegram", "telegram-bot")]) {
    const m = `${r.name} ${r.snippet}`.match(/(?:Ism|Name|Ismi|Full name)\s*:\s*([^|·]+)/i);
    const n = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (n.length >= 3 && n.length <= 60 && !n.includes("@") && !names.some((x) => namesSimilar(x, n)))
      names.push(n);
  }
  let identityLabel = "—";
  let identityNote = "Profillarda ism maydoni topilmadi — nom aniqlash uchun Telegram/GitHub profillarini oching.";
  if (names.length === 1) {
    identityLabel = "4/5 — bitta nom bilan mos";
    identityNote = `Barcha profil manbalari bitta nomni ko'rsatadi: "${names[0]}"`;
  } else if (names.length === 2) {
    const similar = namesSimilar(names[0], names[1]);
    identityLabel = similar ? "4/5 — ehtimol bitta shaxs" : "2/5 — aralash nomlar";
    identityNote = similar
      ? `"${names[0]}" va "${names[1]}" o'xshash — variant bo'lishi mumkin`
      : `"${names[0]}" va "${names[1]}" mos emas — username bir necha shaxs tomonidan ishlatilgan bo'lishi mumkin`;
  } else if (names.length >= 3) {
    identityLabel = "1/5 — juda aralash";
    identityNote = `${names.length} xil ism topildi: ${names.slice(0, 4).join(", ")}`;
  }

  // ---- Timeline ----
  const tl: TimelineEvent[] = [];
  for (const s of stealers) pushTimeline(tl, s.date_compromised, `Zararlangan qurilma (stealer log${s.stealer_family ? `: ${s.stealer_family}` : ""})`);
  for (const r of itemsOf(mr, "username-mentions", "telegram-feed", "news")) {
    for (const d of collectDates(r.date ?? "").slice(0, 1)) {
      pushTimeline(tl, d, `Eslatma: ${hostOf(r)}${r.name ? ` — ${r.name.slice(0, 50)}` : ""}`);
    }
  }

  return {
    reach: { score: rScore, reasons: rReasons },
    exposure: { score: eScore, reasons: eReasons },
    identityLabel,
    identityNote,
    timeline: sortTimeline(tl),
  };
}

/** yordamchi: stealers massivining navbatdagi bo'sh indeksini qaytaradi */
function i0(arr: unknown[]): number {
  return Math.min(arr.length - 1, 3);
}

export async function usernameScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(target.trim().replace(/^@/, ""))) return [];
  const a = await computeUsernameAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Kenglik ${a.reach.score}/100 (${strengthLabel(a.reach.score)}) · Ochiqlik ${a.exposure.score}/100 (${scoreLabel(a.exposure.score)})`,
      `https://whatsmyname.app/?q=${encodeURIComponent(target.replace(/^@/, ""))}`,
      [
        cardLine("KENGLIK", a.reach.score, a.reach.reasons),
        cardLine("OCHIQLIK", a.exposure.score, a.exposure.reasons),
        a.exposure.score >= 50
          ? "TAVSIYA: shu username bilan bog'langan parollarni yangilang va 2FA'ni yoqing."
          : "TAVSIYA: profil mavjudligini tasdiqlangan platformalarda nazoratda saqlang.",
      ].join(" || "),
      "osint-radar"
    )
  );
  out.push(
    item(
      `Ishonchlilik (egalik): ${a.identityLabel}`,
      `https://whatsmyname.app/?q=${encodeURIComponent(target.replace(/^@/, ""))}`,
      a.identityNote,
      "osint-radar"
    )
  );
  const tlc = timelineCard(a.timeline, `https://t.me/${encodeURIComponent(target.replace(/^@/, ""))}`);
  if (tlc) out.push(tlc);
  const lc = linkedCard(collectLinkedIntel(target, "username", mr), target);
  if (lc) out.push(lc);
  return out;
}

// ===== TELEFON — Haqiqiyligi / Faollik / Ochiqlik =====

export interface PhoneAssessment {
  validity: { score: number; reasons: string[] };
  activity: { score: number; reasons: string[] };
  exposure: { score: number; reasons: string[] };
  timeline: TimelineEvent[];
}

export async function computePhoneAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<PhoneAssessment> {
  const digits = target.replace(/\D/g, "");

  const meta = (mr["phone-meta"] ?? [])[0];
  const valid = meta && !/haqiqiy emas/i.test(meta.name);
  const operator = meta?.snippet.match(/Operator kodi (\d+):\s*([^|]+)/);
  const phoneType = meta?.snippet.match(/Tur:\s*([^|]+)/)?.[1]?.trim() ?? "";

  // phone-meta moduli o'chirilgan bo'lsa — oflayn libphonenumber bilan jonli tekshiruv
  // (offline kutubxona, bloklanmaydi) — HAQIQIYLIGI har doim hisoblanadi
  let fallbackValid = false;
  let fallbackType = "";
  if (!meta) {
    const input = target.replace(/[\s().-]/g, "").trim().startsWith("+")
      ? target.replace(/[\s().-]/g, "").trim()
      : `+${target.replace(/\D/g, "")}`;
    const p = parsePhoneNumberFromString(input);
    if (p && p.isValid()) {
      fallbackValid = true;
      fallbackType = p.getType() ?? "";
    }
  }

  const mentions = itemsOf(mr, "phone-mentions", "phone-trace", "telegram-search", "search", "social");
  const hosts = uniqHosts(mentions);
  const waHits = mentions.filter((r) => /wa\.me|whatsapp|viber/i.test(`${r.url} ${r.snippet}`));
  const tgHits = mentions.filter((r) => /t\.me|telegram/i.test(`${r.url} ${r.snippet}`));
  const leakish = mentions.filter((r) =>
    /pastebin|leak|oqish|dump|baza|ma'lumotlar bazasi/i.test(`${r.name} ${r.snippet}`)
  );
  const docHits = mentions.filter((r) => /filetype:|\.pdf|\.xlsx|\.csv|\.vcf/i.test(`${r.url} ${r.snippet}`));

  // ---- Haqiqiyligi (Validity) ----
  const vReasons: string[] = [];
  let vScore = 0;
  if (valid) {
    vScore += 40;
    vReasons.push("Raqam format bo'yicha haqiqiy (libphonenumber bazasi) +40");
  } else if (fallbackValid) {
    vScore += 40;
    vReasons.push("Raqam format bo'yicha haqiqiy (libphonenumber, jonli tekshiruv) +40");
  } else if (meta) {
    vReasons.push("Raqam xalqaro formatga mos kelmadi — mamlakat kodi bilan tekshiring");
  } else {
    vReasons.push("Raqam format bo'yicha haqiqiy emas yoki aniqlanmadi");
  }
  if (operator) {
    vScore += 15;
    vReasons.push(`Operator aniqlandi: ${operator[2].trim()} (+${operator[1]}) +15`);
  }
  if (/mobil/i.test(phoneType) || /MOBILE/i.test(fallbackType)) {
    vScore += 10;
    vReasons.push("Mobil liniya — messenjerlarda mavjud bo'lishi ehtimoli yuqori +10");
  }
  vScore = clamp(vScore);

  // ---- Faollik (Activity) ----
  const aReasons: string[] = [];
  let aScore = 0;
  if (hosts.length > 0) {
    const pts = Math.min(45, hosts.length * 8);
    aScore += pts;
    aReasons.push(`${hosts.length} xil saytda eslatib o'tilgan +${pts}`);
  }
  if (waHits.length > 0) {
    aScore += 10;
    aReasons.push("WhatsApp/Viber havolasi ochiq manbada +10");
  }
  if (tgHits.length > 0) {
    aScore += 10;
    aReasons.push("Telegram ekosistemada izi bor (t.me/telegra.ph) +10");
  }
  aScore = clamp(aScore);

  // ---- Ochiqlik (Exposure) ----
  const eReasons: string[] = [];
  let eScore = 0;
  if (leakish.length > 0) {
    eScore += 35;
    eReasons.push(`Oqish/pastebin eslatmalari: ${leakish.length} natija +35`);
  }
  if (docHits.length > 0) {
    eScore += 10;
    eReasons.push(`Hujjat/jadval fayllarida uchraydi: ${docHits.length} natija +10`);
  }
  if (leakish.length === 0 && docHits.length === 0) {
    eReasons.push("Ochiq oqish manbalarida eslatma topilmadi — yaxshi belgi +0");
  }
  eScore = clamp(eScore);

  // ---- Timeline ----
  const tl: TimelineEvent[] = [];
  for (const r of mentions) {
    const d = (r.date ?? collectDates(`${r.name} ${r.snippet}`)[0]) ?? "";
    pushTimeline(tl, d, `Eslatma: ${hostOf(r)}${r.name ? ` — ${r.name.slice(0, 50)}` : ""}`);
  }

  return {
    validity: { score: vScore, reasons: vReasons },
    activity: { score: aScore, reasons: aReasons },
    exposure: { score: eScore, reasons: eReasons },
    timeline: sortTimeline(tl),
  };
}

export async function phoneScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  const digits = target.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return [];
  const a = await computePhoneAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Haqiqiyligi ${a.validity.score}/100 (${strengthLabel(a.validity.score)}) · Faollik ${a.activity.score}/100 (${strengthLabel(a.activity.score)}) · Ochiqlik ${a.exposure.score}/100 (${scoreLabel(a.exposure.score)})`,
      `https://www.sync.me/search/?number=${encodeURIComponent(target.startsWith("+") ? target : `+${digits}`)}`,
      [
        cardLine("HAQIQIYLIGI", a.validity.score, a.validity.reasons),
        cardLine("FAOLLIK", a.activity.score, a.activity.reasons),
        cardLine("OCHIQLIK", a.exposure.score, a.exposure.reasons),
        a.exposure.score >= 25
          ? "TAVSIYA: raqam ochiq manbalarda uchraydi — nomaqbul qo'ng'iroqlar/SMS uchun ehtiyot bo'ling."
          : "TAVSIYA: raqam ochiq manbalarda kam qoldirilgan — xavf past.",
      ].join(" || "),
      "osint-radar"
    )
  );
  const tlc = timelineCard(a.timeline, `https://www.sync.me/search/?number=${encodeURIComponent(target.startsWith("+") ? target : `+${digits}`)}`);
  if (tlc) out.push(tlc);
  const lc = linkedCard(collectLinkedIntel(target, "phone", mr), target);
  if (lc) out.push(lc);
  return out;
}

// ===== ISM-FAMILIYA — Ommaviyligi / Aniqlilik =====
// Maxfiylik chegarasi: faqat OCHIQ rasmiy manbalar (yangiliklar, vikipediya,
// rasmiy sahifalar) — yopiq bazalar hech qachon tekshirilmaydi.

export interface NameAssessment {
  presence: { score: number; reasons: string[] };
  identity: { score: number; reasons: string[] };
  privacyNote: string;
  timeline: TimelineEvent[];
}

export async function computeNameAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<NameAssessment> {
  const wiki = mr["wiki-people"] ?? [];
  const wikiHit = wiki.length > 0 && !/topilmadi|not found/i.test(`${wiki[0].name} ${wiki[0].snippet}`);
  const person = mr["person-public"] ?? [];
  const news = mr["news"] ?? [];
  const social = mr["social"] ?? [];
  const variants = mr["name-variants"] ?? [];
  const all = itemsOf(mr, "search", "social", "news", "person-public", "forums", "docs", "name-variants");
  const hosts = uniqHosts(all);

  const tokens = target.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const boundaryRe = (w: string) =>
    new RegExp(`(?<![a-z0-9\\u0400-\\u04ff])${w}(?![a-z0-9\\u0400-\\u04ff])`, "i");
  const bothTokens = all.filter((r) => {
    const hay = `${r.name} ${r.snippet}`.toLowerCase();
    return tokens.length >= 2 ? tokens.every((t) => boundaryRe(t).test(hay)) : tokens.some((t) => boundaryRe(t).test(hay));
  }).length;

  // ---- Ommaviyligi (Public presence) ----
  const pReasons: string[] = [];
  let pScore = 0;
  if (wikiHit) {
    pScore += 35;
    pReasons.push("Ma'lumotnomada (Vikipediya/DDG Knowledge Graph) mavjud +35");
  }
  if (news.length > 0) {
    const pts = Math.min(20, news.length * 4);
    pScore += pts;
    pReasons.push(`${news.length} ta yangilik/nashr eslatmasi +${pts}`);
  }
  if (person.length > 0) {
    const pts = Math.min(25, person.length * 5);
    pScore += pts;
    pReasons.push(`Ommaviy shaxs izlari (lavozim/bayonot/nashr): ${person.length} topilma +${pts}`);
  }
  if (social.length > 0) {
    const pts = Math.min(15, social.length * 3);
    pScore += pts;
    pReasons.push(`Ijtimoiy tarmoq profillari: ${social.length} topilma +${pts}`);
  }
  pScore = clamp(pScore);

  // ---- Aniqlilik (Identity resolution) ----
  const iReasons: string[] = [];
  let iScore = 0;
  if (hosts.length > 0) {
    const pts = Math.min(20, hosts.length * 2);
    iScore += pts;
    iReasons.push(`${hosts.length} xil manbadan ma'lumot +${pts}`);
  }
  if (all.length > 0) {
    const ratio = bothTokens / all.length;
    const pts = Math.round(ratio * 30);
    iScore += pts;
    if (ratio >= 0.7) {
      iReasons.push(`Natijalarning ${Math.round(ratio * 100)}%da IKKALA so'z birga uchraydi — bitta shaxs ehtimoli yuqori +${pts}`);
    } else if (ratio >= 0.4) {
      iReasons.push(`Ikkala so'z ${Math.round(ratio * 100)}% natijada birga — bir necha shaxs aralashgan bo'lishi mumkin +${pts}`);
    } else {
      iReasons.push("Ko'p natijada faqat familiya yoki faqat ism uchraydi — bir xil ismli boshqa shaxslar bo'lishi mumkin");
    }
  }
  if (variants.length > 0) {
    iScore += 5;
    iReasons.push(`Ism variantlari yozilishlari ham tekshirildi (${variants.length} topilma) +5`);
  }
  if (all.length < 3) {
    iReasons.push("Ma'lumot kam — aniqlash uchun ko'p maqsadli rejimda username/telefon bilan BIRGA bering");
  }
  iScore = clamp(iScore);

  // ---- Timeline ----
  const tl: TimelineEvent[] = [];
  for (const r of [...news, ...person]) {
    const d = (r.date ?? collectDates(`${r.name} ${r.snippet}`)[0]) ?? "";
    pushTimeline(tl, d, `Eslatma: ${hostOf(r)}${r.name ? ` — ${r.name.slice(0, 50)}` : ""}`);
  }

  return {
    presence: { score: pScore, reasons: pReasons },
    identity: { score: iScore, reasons: iReasons },
    privacyNote: "Faqat ochiq rasmiy manbalar ko'rsatiladi — yopiq bazalar va maxfiy ma'lumotlar tekshirilmaydi.",
    timeline: sortTimeline(tl),
  };
}

export async function nameScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  if (target.trim().split(/\s+/).length < 2) return [];
  const a = await computeNameAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Ommaviyligi ${a.presence.score}/100 (${strengthLabel(a.presence.score)}) · Aniqlilik ${a.identity.score}/100 (${strengthLabel(a.identity.score)})`,
      `https://duckduckgo.com/?q=${encodeURIComponent(target)}`,
      [
        cardLine("OMMAVIYLIGI", a.presence.score, a.presence.reasons),
        cardLine("ANIQLILIK", a.identity.score, a.identity.reasons),
        a.identity.score < 50
          ? "TAVSIYA: aniqlikni oshirish uchun ushbu ismni username yoki telefon bilan birga ko'p maqsadli rejimda skanerlang."
          : "TAVSIYA: natijalar yagona shaxsga jamlangan ko'rinyapti — «Bog'lanishlar» kartasidagi entitetlar bilan chuqurroq tekshiring.",
        a.privacyNote,
      ].join(" || "),
      "osint-radar"
    )
  );
  const tlc = timelineCard(a.timeline, `https://duckduckgo.com/?q=${encodeURIComponent(target)}`);
  if (tlc) out.push(tlc);
  const lc = linkedCard(collectLinkedIntel(target, "name", mr), target);
  if (lc) out.push(lc);
  return out;
}

// ===== DOMEN — Salomatlik / Qadimiyligi / Ochiqlik =====

interface RdapDomainLite {
  events?: { eventAction?: string; eventDate?: string }[];
}

export interface DomainAssessment {
  health: { score: number; reasons: string[] };
  age: { score: number; reasons: string[] };
  exposure: { score: number; reasons: string[] };
  timeline: TimelineEvent[];
}

export async function computeDomainAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<DomainAssessment> {
  const domain = cleanDomainInput(target);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return {
      health: { score: 0, reasons: ["Domen formati aniqlanmadi"] },
      age: { score: 0, reasons: [] },
      exposure: { score: 0, reasons: [] },
      timeline: [],
    };
  }

  const [ns, mx, aRec, rdapFallback] = await Promise.all([
    dohJson(domain, "NS"),
    dohJson(domain, "MX"),
    dohJson(domain, "A"),
    // whois moduli natija bermasa — jonli RDAP zaxira so'rov
    (mr["whois"] ?? []).length > 0
      ? Promise.resolve(null)
      : fjLocal<RdapDomainLite>(`https://rdap.org/domain/${domain}`, 9000),
  ]);

  const whoisItems = mr["whois"] ?? [];
  const regDate =
    whoisItems.map((r) => r.snippet.match(/Ro'yxatga olingan:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "").find(Boolean) ??
    rdapFallback?.events?.find((e) => e.eventAction === "registration")?.eventDate?.slice(0, 10) ??
    "";
  const expDate =
    whoisItems.map((r) => r.snippet.match(/Muddati tugaydi:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "").find(Boolean) ??
    rdapFallback?.events?.find((e) => e.eventAction === "expiration")?.eventDate?.slice(0, 10) ??
    "";

  const siteProbe = mr["site-probe"] ?? [];
  const siteLive = siteProbe.some((r) => /^Sayt ishlayapti/i.test(r.name));
  const siteDead = siteProbe.some((r) => /javob bermayapti/i.test(r.name));
  const robots = siteProbe.some((r) => /robots\.txt/i.test(r.name));
  const subdomains = mr["subdomains"] ?? [];
  const probeEmails = siteProbe.flatMap((r) => r.snippet.match(/Email:\s*([^|]+)/)?.[1]?.split(", ") ?? []);
  const whoisEmails = whoisItems.flatMap((r) => r.snippet.match(/Kontakt:\s*([^|]+)/)?.[1]?.trim() ?? []);
  const exposedEmails = [...new Set([...probeEmails, ...whoisEmails].filter((e) => e.includes("@")))].slice(0, 4);

  // ---- Salomatlik (Health) ----
  const hReasons: string[] = [];
  let hScore = 0;
  if (ns.length > 0) {
    hScore += 15;
    hReasons.push(`NS yozuvlari ishlayapti (${ns.length} ta) +15`);
  }
  if (mx.length > 0) {
    hScore += 15;
    hReasons.push("Pochta qabul qilinadi (MX yozuvi bor) +15");
  }
  if (aRec.length > 0) {
    hScore += 10;
    hReasons.push(`A yozuvi bor — IP: ${aRec[0].data} +10`);
  }
  if (siteLive) {
    hScore += 30;
    hReasons.push("Sayt jonli javob beradi (HTTP probe) +30");
  } else if (siteDead) {
    hReasons.push("Sayt javob bermayapti — server o'chiq yoki faqat www varianti ishlaydi");
  }
  if (robots) {
    hScore += 10;
    hReasons.push("robots.txt ochiq — sayt boshqariladi +10");
  }
  hScore = clamp(hScore);

  // ---- Qadimiyligi (Age) ----
  const gReasons: string[] = [];
  let gScore = 0;
  if (regDate) {
    const days = Math.floor((Date.now() - new Date(regDate).getTime()) / 86400000);
    const years = Math.max(0, days / 365.25);
    gReasons.push(`Domen ${regDate} da ro'yxatga olingan (${years.toFixed(1)} yil)`);
    if (years >= 7) {
      gScore += 30;
      gReasons.push("Uzoq tarix — ishonchli belgi +30");
    } else if (years >= 3) {
      gScore += 20;
      gReasons.push("O'rtacha tarix +20");
    } else if (years >= 1) {
      gScore += 10;
      gReasons.push("+10");
    } else {
      gReasons.push("DIQQAT: domen 1 yildan yangi — firibgarlik saytlarida ko'p uchraydi (ehtiyot bo'ling)");
    }
  } else {
    gReasons.push("Ro'yxatga olish sanasi aniqlanmadi (WHOIS/RDAP javob bermadi)");
  }
  if (expDate) {
    const days = Math.floor((new Date(expDate).getTime() - Date.now()) / 86400000);
    if (days > 0 && days < 30) {
      gReasons.push(`DIQQAT: domen muddati ${expDate} da tugaydi — ${days} kun qoldi`);
    }
  }
  gScore = clamp(gScore);

  // ---- Ochiqlik (Exposure) ----
  const eReasons: string[] = [];
  let eScore = 0;
  if (subdomains.length > 0) {
    const pts = Math.min(20, subdomains.length * 2);
    eScore += pts;
    eReasons.push(`${subdomains.length} ta subdomen aniqlandi (SSL/wayback) +${pts}`);
  }
  if (exposedEmails.length > 0) {
    eScore += 10;
    eReasons.push(`WHOIS/saytda ochiq pochta: ${exposedEmails.slice(0, 2).join(", ")} +10`);
  }
  if (eScore === 0) {
    eReasons.push("Ochiq manbalarda qo'shimcha ochiqlik topilmadi");
  }
  eScore = clamp(eScore);

  // ---- Timeline ----
  const tl: TimelineEvent[] = [];
  pushTimeline(tl, regDate, "Domen ro'yxatdan o'tgan");
  pushTimeline(tl, expDate, "Domen muddati tugaydi");

  return {
    health: { score: hScore, reasons: hReasons },
    age: { score: gScore, reasons: gReasons },
    exposure: { score: eScore, reasons: eReasons },
    timeline: sortTimeline(tl),
  };
}

export async function domainScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  const domain = cleanDomainInput(target);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return [];
  const a = await computeDomainAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Salomatlik ${a.health.score}/100 (${strengthLabel(a.health.score)}) · Qadimiyligi ${a.age.score}/100 (${strengthLabel(a.age.score)}) · Ochiqlik ${a.exposure.score}/100 (${scoreLabel(a.exposure.score)})`,
      `https://client.rdap.org/?object=${domain}`,
      [
        cardLine("SALOMATLIK", a.health.score, a.health.reasons),
        cardLine("QADIMIYLIGI", a.age.score, a.age.reasons),
        cardLine("OCHIQLIK", a.exposure.score, a.exposure.reasons),
        a.health.score < 50
          ? "TAVSIYA: DNS/sayt salomatligi past — domendan foydalanishdan oldin qo'lda tekshiring."
          : "TAVSIYA: infratuzilma ishonchli ko'rinyapti — subdomenlar va ochiq pochtalar bilan davom eting.",
      ].join(" || "),
      "osint-radar"
    )
  );
  const tlc = timelineCard(a.timeline, `https://client.rdap.org/?object=${domain}`);
  if (tlc) out.push(tlc);
  const lc = linkedCard(collectLinkedIntel(target, "domain", mr), domain);
  if (lc) out.push(lc);
  return out;
}

// ===== IP — Tarmoq profili / Ochiqligi =====

interface IpApiLite {
  status?: string;
  country?: string;
  city?: string;
  isp?: string;
  org?: string;
  as?: string;
  proxy?: boolean;
  hosting?: boolean;
  mobile?: boolean;
  reverse?: string;
}
interface ShodanDbLite {
  ports?: number[];
  hostnames?: string[];
  vulns?: string[];
  tags?: string[];
}

export interface IpAssessment {
  network: { score: number; reasons: string[] };
  exposure: { score: number; reasons: string[] };
  riskFlags: string[];
}

export async function computeIpAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<IpAssessment> {
  const ip = target.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return {
      network: { score: 0, reasons: ["IPv4 formati aniqlanmadi"] },
      exposure: { score: 0, reasons: [] },
      riskFlags: [],
    };
  }

  // Modul natijalari bo'lmasa — jonli zaxira so'rovlar (ip-api + Shodan InternetDB, ikkalasi bepul)
  const intelItems = mr["ip-intel"] ?? [];
  let geo = intelItems.length > 0 ? null : await fjLocal<IpApiLite>(
    `http://ip-api.com/json/${ip}?fields=status,country,city,isp,org,as,proxy,hosting,mobile,reverse`,
    8000
  );
  const shodanItems = mr["ip-intel"] ?? [];
  let shodan = shodanItems.length > 0 ? null : await fjLocal<ShodanDbLite>(
    `https://internetdb.shodan.io/${ip}`,
    8000
  );

  // Modul natijalaridan o'qish
  const geoItem = intelItems.find((r) => /^Joylashuv:/i.test(r.name));
  const isp = geo?.isp ?? geoItem?.snippet.match(/ISP:\s*([^|]+)/)?.[1]?.trim() ?? "";
  const asName = geo?.as ?? geoItem?.snippet.match(/AS:\s*([^|]+)/)?.[1]?.trim() ?? "";
  const org = geo?.org ?? geoItem?.snippet.match(/Tashkilot:\s*([^|]+)/)?.[1]?.trim() ?? "";
  const geoPlace = geoItem?.name.match(/Joylashuv:\s*(.+)/i)?.[1]?.trim() ?? (geo ? [geo.city, geo.country].filter(Boolean).join(", ") : "");
  const flags = geoItem?.snippet.match(/Belgilar:\s*([^|]+)/)?.[1] ?? "";
  const isProxy = geo?.proxy ?? /proksi/i.test(flags);
  const isHosting = geo?.hosting ?? /hosting|data-markaz/i.test(flags);
  const isMobile = geo?.mobile ?? /mobil tarmoq/i.test(flags);

  const shodanItem = shodanItems.find((r) => /^Shodan:/i.test(r.name));
  const portsText = shodanItem?.name.match(/Shodan:\s*(\d+)\s*ta?\s*ochiq port/i)?.[1] ?? shodanItem?.name.match(/Shodan:\s*(\d+)\s*port/i)?.[1] ?? "";
  const ports = shodan?.ports ?? (portsText ? Array.from({ length: Number(portsText) }, () => 0) : []);
  const vulnsText = shodanItem?.snippet.match(/Zaifliklar:\s*([^|]+)/)?.[1] ?? "";
  const vulns = shodan?.vulns ?? (vulnsText ? vulnsText.split(",").map((s) => s.trim()).filter(Boolean) : []);

  const ptrItems = mr["ptr-recon"] ?? [];
  const ptrHit = ptrItems.find((r) => /^PTR:/i.test(r.name));
  const ptrValue = ptrHit?.name.match(/PTR:\s*(.+)/)?.[1]?.trim() ?? "";
  const whoisIpItems = mr["whois-ip"] ?? [];
  const netName = whoisIpItems.map((r) => r.snippet.match(/Tarmoq nomi:\s*([^|]+)/)?.[1]?.trim() ?? "").find(Boolean) ?? "";
  const ipOrg = whoisIpItems.map((r) => r.snippet.match(/Egasi:\s*([^|]+)/)?.[1]?.trim() ?? "").find(Boolean) ?? "";

  // ---- Tarmoq profili (Network identity) ----
  const nReasons: string[] = [];
  let nScore = 0;
  if (isp || asName || org) {
    nScore += 30;
    nReasons.push(`ISP/AS aniqlandi: ${[isp, asName, org].filter(Boolean).slice(0, 2).join(", ")} +30`);
  }
  if (geoPlace || geo?.country) {
    nScore += 10;
    nReasons.push(`Geolokatsiya: ${geoPlace || geo?.country} +10`);
  }
  if (netName || ipOrg) {
    nScore += 15;
    nReasons.push(`IP blok egasi (RDAP): ${netName || ipOrg} +15`);
  }
  if (ptrValue) {
    nScore += 15;
    nReasons.push(`PTR yozuvi: ${ptrValue} +15`);
  }
  nScore = clamp(nScore);

  // ---- Ochiqligi (Exposure) ----
  const eReasons: string[] = [];
  let eScore = 0;
  const riskFlags: string[] = [];
  if (ports.length > 0) {
    const pts = Math.min(35, ports.length * 5);
    eScore += pts;
    eReasons.push(`${ports.length} ta ochiq port (Shodan InternetDB) +${pts}`);
  } else if (shodanItem || shodan) {
    eReasons.push("Ochiq port aniqlanmadi (Shodan InternetDB) — yaxshi belgi +0");
  }
  if (vulns.length > 0) {
    eScore += 30;
    eReasons.push(`${vulns.length} ta zaiflik qayd etilgan (${vulns.slice(0, 3).join(", ")}) +30`);
    riskFlags.push("zaifliklar mavjud");
  }
  if (isProxy) {
    eScore += 15;
    eReasons.push("IP proxy/VPN orqali ishlatilyapti +15");
    riskFlags.push("proxy/VPN");
  }
  if (isHosting) {
    eReasons.push("Hosting/data-markaz IP — shaxsiy qurilma emas, bulutli server");
  }
  if (isMobile) {
    eReasons.push("Mobil operator tarmog'i — foydalanuvchi joylashuvi o'zgaruvchan");
  }
  eScore = clamp(eScore);

  return {
    network: { score: nScore, reasons: nReasons },
    exposure: { score: eScore, reasons: eReasons },
    riskFlags,
  };
}

export async function ipScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  const ip = target.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return [];
  const a = await computeIpAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Tarmoq profili ${a.network.score}/100 (${strengthLabel(a.network.score)}) · Ochiqligi ${a.exposure.score}/100 (${scoreLabel(a.exposure.score)})${a.riskFlags.length ? ` · Xavf: ${a.riskFlags.join(", ")}` : ""}`,
      `https://www.shodan.io/host/${ip}`,
      [
        cardLine("TARMOQ PROFILI", a.network.score, a.network.reasons),
        cardLine("OCHIQLIGI", a.exposure.score, a.exposure.reasons),
        a.exposure.score >= 50
          ? "TAVSIYA: ochiq port/zaifliklar mavjud — server administratoriga darhol xabar bering."
          : "TAVSIYA: tarmoq yuzasi keng emas — doimiy monitoring tavsiya etiladi.",
      ].join(" || "),
      "osint-radar"
    )
  );
  const lc = linkedCard(collectLinkedIntel(target, "ip", mr), ip);
  if (lc) out.push(lc);
  return out;
}

// ===== KOMPANIYA — Rasmiylik / Ishonchlilik / Raqamli iz =====

export interface CompanyAssessment {
  legitimacy: { score: number; reasons: string[] };
  trust: { score: number; reasons: string[] };
  footprint: { score: number; reasons: string[] };
  timeline: TimelineEvent[];
}

export async function computeCompanyAssessment(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<CompanyAssessment> {
  const signals = mr["company-signals"] ?? [];
  const riskyItems = signals.filter((r) => /Xavf belgisi/i.test(r.name));
  const goodItems = signals.filter((r) => /ijobiy belgi/i.test(r.name));
  const registry = mr["company-registry"] ?? [];
  const risk = mr["company-risk"] ?? [];
  const fraud = mr["company-fraud"] ?? [];
  const social = mr["company-social"] ?? [];
  const news = mr["news"] ?? [];

  const courtHits = risk.filter((r) => /sud|da'vo|arbitraj|nizolar/i.test(`${r.name} ${r.snippet}`));
  const tenderHits = risk.filter((r) => /tender|tanlov|g'olib|shartnoma/i.test(`${r.name} ${r.snippet}`));
  const complaintHits = risk.filter((r) => /shikoyat|aldangan|pulim|qaytarmadi/i.test(`${r.name} ${r.snippet}`));
  const fraudHits = fraud.filter(
    (r) => /scam|firibgar|aldash|soxta|ishonchsiz/i.test(`${r.name} ${r.snippet}`) &&
      !/aniq xavf belgisi yo'q/i.test(r.name)
  );

  // ---- Rasmiylik (Legitimacy) ----
  const lReasons: string[] = [];
  let lScore = 0;
  if (registry.length > 0) {
    lScore += 25;
    lReasons.push(`Davlat reestrlari bo'yicha topilmalar bor (${registry.length}) +25`);
  } else {
    lReasons.push("Davlat reestrlarida topilma yo'q — ro'yxatdan o'tmagan yoki indekslanmagan");
  }
  if (goodItems.length > 0) {
    const pts = Math.min(15, goodItems.length * 5);
    lScore += pts;
    lReasons.push(`Ijobiy belgilar: ${goodItems.map((r) => r.name.replace(/^Xavf belgisi.*?:\s*/, "").replace(/Domen yoshi.*?:\s*/, "")).join(", ")} +${pts}`);
  }
  for (const r of riskyItems) {
    if (/juda yosh/i.test(r.name)) {
      lScore -= 15;
      lReasons.push("Domen juda yosh — «bugun ochilgan do'kon» xavfi −15");
    } else if (/maxfiylashtirilgan/i.test(r.name)) {
      lScore -= 5;
      lReasons.push("WHOIS maxfiy — anonimlashtirish belgisi −5");
    }
  }
  lScore = clamp(lScore);

  // ---- Ishonchlilik (Trust) ----
  const tReasons: string[] = [];
  let tScore = 50; // neytral boshlanish
  if (fraudHits.length > 0) {
    const pts = Math.min(40, fraudHits.length * 10);
    tScore -= pts;
    tReasons.push(`Firibgarlik eslatmalari manbalarda: ${fraudHits.length} natija −${pts}`);
  }
  if (courtHits.length > 0) {
    tScore -= 10;
    tReasons.push(`Sud/da'vo eslatmalari: ${courtHits.length} natija −10`);
  }
  if (complaintHits.length > 0) {
    tScore -= 10;
    tReasons.push(`Mijoz shikoyatlari: ${complaintHits.length} natija −10`);
  }
  if (tenderHits.length > 0) {
    tScore += 10;
    tReasons.push(`Tender/shartnoma faolligi: ${tenderHits.length} natija +10`);
  }
  if (fraudHits.length === 0 && courtHits.length === 0 && complaintHits.length === 0) {
    tReasons.push("Aniq salbiy belgi (firibgarlik/sud/shikoyat) topilmadi");
  }
  tReasons.push("Diqqat: belgilar ishonch ko'rsatkichi, firibgarlik isboti emas — reestr va rasmiy sahifalar bilan birga baholang.");
  tScore = clamp(tScore);

  // ---- Raqamli iz (Footprint) ----
  const fReasons: string[] = [];
  let fScore = 0;
  if (social.length > 0) {
    const pts = Math.min(25, social.length * 5);
    fScore += pts;
    fReasons.push(`Rasmiy sahifalar: ${social.length} topilma +${pts}`);
  }
  if (news.length > 0) {
    const pts = Math.min(20, news.length * 4);
    fScore += pts;
    fReasons.push(`Yangiliklar/media: ${news.length} eslatma +${pts}`);
  }
  const linked = collectLinkedIntel(target, "company", mr);
  if (linked.entries.some((e) => e.kind === "email" || e.kind === "domain")) {
    fScore += 10;
    fReasons.push("Korporativ pochta/domen bog'lanishlari aniqlandi +10");
  }
  if (fScore === 0) {
    fReasons.push("Raqamli iz kam — kompaniya ochiq tarmoqda kam faol");
  }
  fScore = clamp(fScore);

  // ---- Timeline ----
  const tl: TimelineEvent[] = [];
  for (const r of [...risk, ...news]) {
    const d = (r.date ?? collectDates(`${r.name} ${r.snippet}`)[0]) ?? "";
    pushTimeline(tl, d, `Eslatma: ${hostOf(r)}${r.name ? ` — ${r.name.slice(0, 50)}` : ""}`);
  }

  return {
    legitimacy: { score: lScore, reasons: lReasons },
    trust: { score: tScore, reasons: tReasons },
    footprint: { score: fScore, reasons: fReasons },
    timeline: sortTimeline(tl),
  };
}

export async function companyScoreSource(
  target: string,
  mr: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  const t = target.trim();
  if (t.length < 2) return [];
  const a = await computeCompanyAssessment(target, mr);
  const out: SearchResultItem[] = [];
  out.push(
    item(
      `Umumiy baho — Rasmiylik ${a.legitimacy.score}/100 (${strengthLabel(a.legitimacy.score)}) · Ishonchlilik ${a.trust.score}/100 (${strengthLabel(a.trust.score)}) · Raqamli iz ${a.footprint.score}/100 (${strengthLabel(a.footprint.score)})`,
      `https://orginfo.uz/search?q=${encodeURIComponent(t)}`,
      [
        cardLine("RASMIYLIK", a.legitimacy.score, a.legitimacy.reasons),
        cardLine("ISHONCHLILIK", a.trust.score, a.trust.reasons),
        cardLine("RAQAMLI IZ", a.footprint.score, a.footprint.reasons),
        a.legitimacy.score < 50
          ? "TAVSIYA: to'lov/shartnomadan oldin orginfo.uz reestrida ro'yxatdan o'tganini va rahbarini birga tekshiring."
          : "TAVSIYA: rasmiy belgilar yaxshi — faoliyatini davomiy monitoring qiling.",
      ].join(" || "),
      "osint-radar"
    )
  );
  const tlc = timelineCard(a.timeline, `https://orginfo.uz/search?q=${encodeURIComponent(t)}`);
  if (tlc) out.push(tlc);
  const lc = linkedCard(collectLinkedIntel(target, "company", mr), t);
  if (lc) out.push(lc);
  return out;
}

// ===== Skaner route uchun sintez xaritasi =====
// Har maqsad turi uchun qaysi sintez moduli ishga tushadi (deep-only'da YO'Q —
// sintez uchun boshqa modullar natijalari kerak).

export const SYNTHESIS_MODULES: Record<TargetType, { id: string; title: string } | null> = {
  email: { id: "email-score", title: "Umumiy baho va Timeline" },
  username: { id: "username-score", title: "Umumiy baho va bog'lanishlar" },
  phone: { id: "phone-score", title: "Umumiy baho va bog'lanishlar" },
  name: { id: "name-score", title: "Umumiy baho va aniqlilik" },
  domain: { id: "domain-score", title: "Umumiy baho va bog'lanishlar" },
  ip: { id: "ip-score", title: "Umumiy baho va tarmoq profili" },
  company: { id: "company-score", title: "Umumiy baho va ishonchlilik" },
};

export type TargetScoreSource = (
  target: string,
  moduleResults: Record<string, SearchResultItem[]>
) => Promise<SearchResultItem[]>;

export const SYNTHESIS_RUNS: Record<string, TargetScoreSource> = {
  "email-score": (t, mr) => import("@/lib/email-score").then((m) => m.emailScoreSource(t, mr)),
  "username-score": usernameScoreSource,
  "phone-score": phoneScoreSource,
  "name-score": nameScoreSource,
  "domain-score": domainScoreSource,
  "ip-score": ipScoreSource,
  "company-score": companyScoreSource,
};




