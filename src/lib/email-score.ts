// OSINT Radar — IntelBase uslubidagi EMAIL UMUMIY BAHO dvigateli.
// IntelBase.is'ning imzo xususiyati: har lookup uchun 3 ball (Authenticity /
// Exposure / Ownership) va har ball UCHUN asoslar ("Why this score").
// Bizning versiyasi bepul manbalardan hisoblanadi:
//   DNS-over-HTTPS (MX/SPF/DMARC), XposedOrNot (oqishlar), Hudson Rock
//   (stealer loglar), LeakCheck (o'g'irlangan yozuvlar) + boshqa modullar
//   natijalaridan (Gravatar/GitHub ismlari, tasdiqlangan username profillar).
// Natija: oddiy SearchResultItem[] — skaner UI'siga o'zgarishsiz qo'shiladi.

import type { SearchResultItem } from "@/lib/osint";
import { breachCatalogFacts, FREEMAIL_SET, isRoleLocalPart } from "@/lib/osint-sources";
import { collectLinkedIntel, linkedCard } from "@/lib/target-score";

// Vaqtinchalik pochta domenlari (eng ko'p ishlatiladiganlar — to'liq ro'yxat kalitsiz manbalarda)
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "throwawaymail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "tempmail.plus",
  "mohmal.com", "emailondeck.com", "tempr.email", "1secmail.com",
  "mailnesia.com", "tempmailo.com", "moakt.com", "linshiym.com",
]);

const item = (
  name: string,
  url: string,
  snippet: string,
  host: string
): SearchResultItem => ({ name, url, snippet, host_name: host });

// ===== Kichik yordamchilar (o'z fetch'i — osint-sources ichki yordamchilariga bog'lanmaydi) =====

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

// ===== Manba javoblari (bo'laklab tiplangan) =====

interface XonCheck {
  breaches?: string[][];
}
interface XonAnalytics {
  BreachMetrics?: {
    risk?: { risk_label?: string; risk_score?: number }[];
    passwords_strength?: Record<string, number> | Record<string, number>[];
  };
}

interface HudStealer {
  date_compromised?: string;
  computer_name?: string;
  operating_system?: string;
  malware_path?: string;
  stealer_family?: string;
  total_corporate_services?: number;
  total_user_services?: number;
}
interface HudResp {
  stealers?: HudStealer[];
}

interface LcResp {
  success?: boolean;
  found?: number;
  fields?: string[];
  sources?: { name?: string; date?: string }[];
}

// ===== Ismlarni ajratish (Ownership uchun) =====

function cleanName(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesSimilar(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z\u0400-\u04FF]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z\u0400-\u04FF]/g, "");
  if (na.length < 2 || nb.length < 2) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/** Modul natijalaridan (Gravatar «Ism:», GitHub «Git ismi:») odam ismlarini yig'adi */
export function collectOwnerNames(moduleResults: Record<string, SearchResultItem[]>): string[] {
  const names: string[] = [];
  const push = (raw?: string) => {
    const n = cleanName(raw ?? "");
    if (n.length >= 3 && n.length <= 60 && !n.includes("@")) names.push(n);
  };
  for (const r of moduleResults["gravatar"] ?? []) {
    push(r.name.replace(/^Gravatar profil:\s*/, ""));
    const m = r.snippet.match(/Ism:\s*([^|]+?)(?:\s*\||$)/);
    if (m) push(m[1]);
  }
  for (const r of moduleResults["github-email"] ?? []) {
    const m = r.snippet.match(/Git ismi:\s*([^|]+?)(?:\s*\||$)/);
    if (m) push(m[1]);
    const nm = r.name.replace(/^GitHub:\s*/, "");
    if (nm && !nm.includes("@") && nm !== "GitHub") push(nm);
  }
  // Bir xil ismlarni birlashtirish (namesSimilar bo'lsa birinchisini qoldiradi)
  const unique: string[] = [];
  for (const n of names) {
    if (!unique.some((u) => namesSimilar(u, n))) unique.push(n);
  }
  return unique.slice(0, 6);
}

// ===== Timeline =====

interface TimelineEvent {
  date: string; // ISO yoki YYYY-MM
  label: string;
  score?: number; // tartiblash uchun ikkilamchi
}

function fmtDate(d: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(d)) return d;
  return d.slice(0, 10);
}

// ===== Asosiy hisob =====

export interface EmailAssessment {
  authenticity: number;
  authenticityReasons: string[];
  exposure: number;
  exposureReasons: string[];
  ownershipLabel: string;
  ownershipNote: string;
  timeline: TimelineEvent[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function computeEmailAssessment(
  target: string,
  moduleResults: Record<string, SearchResultItem[]>
): Promise<EmailAssessment> {
  const em = target.trim().toLowerCase().match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  const local = em?.[1] ?? "";
  const domain = em?.[2] ?? "";

  // Paralel yengil tekshiruvlar: DoH + XON + Hudson Rock + LeakCheck
  const [mx, txt, dmarc, xon, xonAna, hud, lc] = await Promise.all([
    domain ? dohJson(domain, "MX") : Promise.resolve([]),
    domain ? dohJson(domain, "TXT") : Promise.resolve([]),
    domain ? dohJson(`_dmarc.${domain}`, "TXT") : Promise.resolve([]),
    em
      ? fjLocal<XonCheck>(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(`${local}@${domain}`)}`, 9000)
      : Promise.resolve(null),
    em
      ? fjLocal<XonAnalytics>(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(`${local}@${domain}`)}`, 9000)
      : Promise.resolve(null),
    em
      ? fjLocal<HudResp>(`https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(`${local}@${domain}`)}`, 10000)
      : Promise.resolve(null),
    em
      ? fjLocal<LcResp>(`https://leakcheck.io/api/public?check=${encodeURIComponent(`${local}@${domain}`)}`, 10000)
      : Promise.resolve(null),
  ]);

  const hasMx = mx.some((a) => /\s*\d+\s+/.test(a.data) || a.data.includes("."));
  const txts = txt.map((a) => a.data.replace(/^"|"$/g, ""));
  const spf = txts.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const dmarcRec = dmarc
    .map((a) => a.data.replace(/^"|"$/g, ""))
    .find((t) => t.toLowerCase().startsWith("v=dmarc1"));

  const breachNames = [...new Set((xon?.breaches ?? []).flat())].filter(Boolean);
  const catalog = breachNames.length > 0 ? await breachCatalogFacts(breachNames) : [];
  const matched = breachNames
    .map((n) => catalog.find((c) => c.norm === n.toLowerCase().replace(/[^a-z0-9]/g, "")))
    .filter(Boolean) as { title: string; date: string; dataClasses: string[] }[];
  const breachYears = matched
    .map((m) => m.date?.slice(0, 4))
    .filter((y) => /^\d{4}$/.test(y))
    .map(Number);

  const stealers = hud?.stealers ?? [];
  const lcFound = lc?.found ?? 0;
  const lcFields = (lc?.fields ?? []).map((f) => f.toLowerCase());
  const risk = xonAna?.BreachMetrics?.risk?.[0];
  const psRaw = xonAna?.BreachMetrics?.passwords_strength;
  const ps = Array.isArray(psRaw) ? psRaw[0] : psRaw;
  const plainText = ps?.PlainText ?? 0;

  const rolePart = isRoleLocalPart(local);
  const isFreemail = FREEMAIL_SET.has(domain);
  const disposable = DISPOSABLE_DOMAINS.has(domain);

  // ---- Haqiqiyligi (Authenticity) ----
  const aReasons: string[] = [];
  let aScore = 0;
  if (hasMx) {
    aScore += 15;
    aReasons.push("Domen pochta qabul qiladi (MX yozuvi bor) +15");
  } else if (domain) {
    aScore -= 20;
    aReasons.push("Domen MX yozuviga ega emas — manzil yetib bormaydi yoki o'lik −20");
  }
  if (spf) {
    aScore += 5;
    aReasons.push("SPF yozuvi mavjud +5");
  }
  if (dmarcRec) {
    aScore += 5;
    const pol = dmarcRec.match(/p=(\w+)/)?.[1] ?? "";
    aReasons.push(`DMARC mavjud${pol ? ` (p=${pol})` : ""} +5`);
  }
  const ownerNames = collectOwnerNames(moduleResults);
  if (ownerNames.length > 0) {
    aScore += 20;
    aReasons.push(`Profillardan ism aniqlandi (${ownerNames[0]}) +20`);
  }
  const verifiedProfiles = (moduleResults["email-username"] ?? []).filter(
    (r) => r.verified === "yes"
  ).length;
  if (verifiedProfiles > 0) {
    const pts = Math.min(15, verifiedProfiles * 5);
    aScore += pts;
    aReasons.push(`${verifiedProfiles} platformada username profili jonli tasdiqlandi +${pts}`);
  }
  const oldestYear = Math.min(...(breachYears.length ? breachYears : [9999]));
  const ghActivity = (moduleResults["github-email"] ?? [])
    .map((r) => r.snippet.match(/Faollik:\s*(\d{4})/)?.[1])
    .filter(Boolean) as string[];
  const ghEarliest = ghActivity.length ? Math.min(...ghActivity.map(Number)) : 9999;
  const estYear = Math.min(oldestYear, ghEarliest);
  if (estYear <= 2019) {
    aScore += 20;
    aReasons.push(`Uzoq tarix — eng erta iz ${estYear}-yilga borib taqaladi +20`);
  } else if (estYear <= 2023) {
    aScore += 10;
    aReasons.push(`O'rtacha tarix — eng erta iz ${estYear}-yil +10`);
  }
  if (breachNames.length >= 3) {
    aScore += 10;
    aReasons.push(`${breachNames.length} ta ommaviy oqishda qatnashgan — uzoq ishlatilgan manzil +10`);
  } else if (breachNames.length > 0) {
    aScore += 5;
    aReasons.push(`${breachNames.length} ta oqishda qatnashgan +5`);
  }
  if (rolePart) {
    aScore -= 25;
    aReasons.push("Rol manzili (info/admin/support...) — shaxsga bog'lab bo'lmaydi −25");
  } else if (isFreemail) {
    aScore += 5;
    aReasons.push("Shaxsiy quti (freemail), rol manzili emas +5");
  }
  if (disposable) {
    aScore -= 40;
    aReasons.push("Vaqtinchalik pochta domeni −40");
  }

  // ---- Ochiqlik (Exposure) ----
  const eReasons: string[] = [];
  let eScore = 0;
  if (stealers.length > 0) {
    eScore += 40;
    eReasons.push(
      `Zararlangan kompyuter (infostealer) logida topildi — ${stealers.length} qurilma +40`
    );
  }
  if (lcFound > 0) {
    eScore += 15;
    eReasons.push(`LeakCheck bazasida ${lcFound.toLocaleString("en-US")} yozuv +15`);
    if (lcFields.some((f) => f.includes("password"))) {
      eScore += 10;
      eReasons.push("Oshkor bo'lgan maydonlar orasida PAROL bor +10");
    }
    if (lcFields.some((f) => ["address", "street", "phone", "ssn", "dob"].includes(f))) {
      eScore += 5;
      eReasons.push("Shaxsiy ma'lumotlar (manzil/telefon/sana) ham oshkor +5");
    }
  }
  if (breachNames.length >= 3) {
    eScore += 20;
    eReasons.push(`${breachNames.length} ta oqish (XposedOrNot) +20`);
  } else if (breachNames.length > 0) {
    eScore += 10;
    eReasons.push(`${breachNames.length} ta oqish (XposedOrNot) +10`);
  }
  if (plainText > 0) {
    eScore += 15;
    eReasons.push(`Ochiq matn parollar oshkor bo'lgan (${plainText} holat) +15`);
  }
  if (risk?.risk_label === "Critical" || risk?.risk_label === "High") {
    eScore += 10;
    eReasons.push(`XposedOrNot xavf darajasi: ${risk?.risk_label} +10`);
  }

  // ---- Ownership ----
  let ownershipLabel = "—";
  let ownershipNote = "Ismlar aniqlanmadi — Gravatar/GitHub profilida ism bo'lsa hisoblanadi.";
  if (ownerNames.length === 1) {
    ownershipLabel = "5/5 — bitta shaxsga mos";
    ownershipNote = `Barcha ism manbalari bir xil: "${ownerNames[0]}"`;
  } else if (ownerNames.length === 2) {
    const similar = namesSimilar(ownerNames[0], ownerNames[1]);
    ownershipLabel = similar ? "4/5 — ehtimol bitta shaxs" : "3/5 — aralash";
    ownershipNote = similar
      ? `"${ownerNames[0]}" va "${ownerNames[1]}" o'xshash yozilish — variant bo'lishi mumkin`
      : `"${ownerNames[0]}" va "${ownerNames[1]}" bir-biriga mos emas — manzil qayta ishlatilgan bo'lishi mumkin`;
  } else if (ownerNames.length >= 3) {
    ownershipLabel = "2/5 — aralash";
    ownershipNote = `${ownerNames.length} xil ism topildi: ${ownerNames.join(", ")}`;
  }

  // ---- Timeline ----
  const timeline: TimelineEvent[] = [];
  for (const s of stealers.slice(0, 6)) {
    if (s.date_compromised)
      timeline.push({
        date: s.date_compromised,
        label: `Zararlangan kompyuter (stealer log: ${s.stealer_family || "stealer"})`,
      });
  }
  for (const m of matched.slice(0, 12)) {
    if (m.date)
      timeline.push({
        date: m.date,
        label: `${m.title} oqishi — ${m.dataClasses.slice(0, 3).join(", ") || "ma'lumotlar"} oshkor bo'ldi`,
      });
  }
  for (const s of (lc?.sources ?? []).slice(0, 10)) {
    if (s.name && s.date)
      timeline.push({ date: s.date, label: `${s.name} bazasida chiqdi (LeakCheck)` });
  }
  for (const r of moduleResults["github-email"] ?? []) {
    const m = r.snippet.match(/Faollik:\s*(\d{4}-\d{2}-\d{2})\s*—\s*(\d{4}-\d{2}-\d{2})/);
    if (m) {
      timeline.push({ date: m[1], label: "GitHub'dagi birinchi ommaviy commit" });
      timeline.push({ date: m[2], label: "GitHub'dagi so'nggi ommaviy commit" });
    }
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date));

  return {
    authenticity: clamp(aScore),
    authenticityReasons: aReasons,
    exposure: clamp(eScore),
    exposureReasons: eReasons,
    ownershipLabel,
    ownershipNote,
    timeline: timeline.slice(0, 10),
  };
}

// ===== Skaner moduli sifatida natijalar =====

function scoreLabel(v: number): string {
  if (v >= 75) return "Kritik";
  if (v >= 50) return "Yuqori";
  if (v >= 25) return "O'rtacha";
  return "Past";
}

export async function emailScoreSource(
  target: string,
  moduleResults: Record<string, SearchResultItem[]>
): Promise<SearchResultItem[]> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target.trim())) return [];
  const a = await computeEmailAssessment(target, moduleResults);
  const out: SearchResultItem[] = [];

  out.push(
    item(
      `Umumiy baho — Haqiqiyligi ${a.authenticity}/100 · Ochiqlik ${a.exposure}/100 (${scoreLabel(a.exposure)})`,
      "https://xposedornot.com/breach-explorer",
      [
        `HAQIQIYLIGI ${a.authenticity}/100 — ${a.authenticityReasons.length ? a.authenticityReasons.join(" · ") : "asoslar aniqlanmadi"}`,
        `OCHIQLIK ${a.exposure}/100 (${scoreLabel(a.exposure)}) — ${a.exposureReasons.length ? a.exposureReasons.join(" · ") : "oshkor bo'lgan ma'lumot aniqlanmadi"}`,
        a.exposure >= 50
          ? "TAVSIYA: parollarni zudlik bilan yangilang va 2FA'ni yoqing."
          : "TAVSIYA: parol menejer va 2FA bilan himoyani davom ettiring.",
      ].join(" || "),
      "osint-radar"
    )
  );

  out.push(
    item(
      `Egalik: ${a.ownershipLabel}`,
      "https://gravatar.com/",
      a.ownershipNote,
      "osint-radar"
    )
  );

  if (a.timeline.length > 0) {
    out.push(
      item(
        `Timeline — ${a.timeline.length} ta voqea`,
        "https://leakcheck.io/",
        a.timeline
          .map((t) => `${fmtDate(t.date)} — ${t.label}`)
          .join(" · "),
        "osint-radar"
      )
    );
  }

  // Bog'lanishlar (korelyatsiya): barcha modullar natijalaridan ajratilgan,
  // maqsad email bilan bog'langan entitetlar — username profillar, korporativ
  // domen, telefon va h.k. IntelBase'dagi yagona rasm tamoyili.
  const lcCard = linkedCard(collectLinkedIntel(target, "email", moduleResults), target.trim().toLowerCase());
  if (lcCard) out.push(lcCard);
  return out;
}
