// OSINT Radar — to'g'ridan-to'g'ri ma'lumot manbalari (server-side)
// OSINT Framework'dagi asosiy BEPUL manbalar integratsiyasi (API kaliti talab qilmaydi):
//   DNS-over-HTTPS (dns.google), RDAP/WHOIS (rdap.org), crt.sh (sertifikat shaffofligi),
//   Wayback Machine (web.archive.org), urlscan.io, Shodan InternetDB, ip-api.com,
//   PTR yozuvlari va HackerTarget reverse IP.
// Email manbalari: XposedOrNot (oqishlar), Gravatar (profil), MX/SPF/DMARC,
//   korporativ domen tahlili va GitHub commit qidiruvi.
// Har bir manba SearchResultItem[] qaytaradi — skaner oqimiga mos keladi.

import { createHash } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { SearchResultItem, TargetType } from "@/lib/osint";
import { FREEMAIL_DOMAINS, PLATFORM_DOMAINS } from "@/lib/osint";
import { scanWhatsMyName, type WmnProgressCb } from "@/lib/whatsmyname";
import { PREMIUM_RUNS } from "@/lib/premium-sources";
import {
  telegramProfileSource,
  telegramFeedSource,
  telegramBotApiSource,
  telegramMentionsSource,
} from "@/lib/telegram";
import { verifyProfileLinks } from "@/lib/profile-verify";

// ===== Yordamchilar =====

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function timeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** JSON fetch — timeout va UA bilan. Natija JSON bo'lmasa null. */
async function fj<T = unknown>(
  url: string,
  ms = 8000,
  extraHeaders?: Record<string, string>
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders },
      signal: timeout(ms),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Matn fetch — timeout va UA bilan. Natija matn bo'lmasa null. */
async function ftext(url: string, ms = 8000, maxBytes = 400_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: timeout(ms),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const dec = new TextDecoder("utf-8", { fatal: false });
    return dec.decode(buf.slice(0, maxBytes));
  } catch {
    return null;
  }
}

const item = (
  name: string,
  url: string,
  snippet: string,
  host: string
): SearchResultItem => ({ name, url, snippet, host_name: host });

/** Foydalanuvchi kiritgan narsadan toza domen ajratadi (URL bo'lsa ham).
 * Natija haqiqiy domen ko'rinishida bo'lmasa (bo'sh joy bor yoki nuqta yo'q —
 * masalan «Uzum Market» kabi kompaniya nomi) — bo'sh satr qaytaradi. */
export function cleanDomain(raw: string): string {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!d || /\s/.test(d) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d)) return "";
  return d;
}

export function isIpv4(s: string): boolean {
  const m = s.trim().match(/^(?:\d{1,3}\.){3}\d{1,3}$/);
  if (!m) return false;
  return s.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
}

const cap = (arr: unknown[], n: number) => arr.slice(0, n);

/** DNS javoblaridagi oxirgi nuqtani olib tashlaydi (mail.nuu.uz. → mail.nuu.uz) */
const nodot = (s: string) => s.replace(/\.$/, "");

/** HTML entitechlarni decode qiladi (sarlavhalar uchun) */
function decodeHtml(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** "C=US, O=Let's Encrypt, CN=R3" → "Let's Encrypt / R3" */
function issuerShort(issuer: string): string {
  const cn = issuer.match(/CN=([^,]+)/)?.[1];
  const o = issuer.match(/O=([^,]+)/)?.[1];
  return [o, cn].filter(Boolean).join(" / ").slice(0, 30) || "sertifikat";
}

// ===== DNS-over-HTTPS =====

interface DohAnswer {
  name: string;
  type: number;
  TTL?: number;
  data: string;
}
interface DohResp {
  Status: number;
  Answer?: DohAnswer[];
}

async function doh(name: string, type: string): Promise<DohAnswer[]> {
  const r = await fj<DohResp>(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    7000
  );
  return r?.Status === 0 && Array.isArray(r.Answer) ? r.Answer : [];
}

const isV4Host = (d: string) => /^\d+\.\d+\.\d+\.\d+$/.test(d);

async function dnsSource(rawTarget: string): Promise<SearchResultItem[]> {
  const domain = cleanDomain(rawTarget);
  if (!domain || isV4Host(domain)) return [];
  const [a, aaaa, mx, ns, txt, soa, caa] = await Promise.all([
    doh(domain, "A"),
    doh(domain, "AAAA"),
    doh(domain, "MX"),
    doh(domain, "NS"),
    doh(domain, "TXT"),
    doh(domain, "SOA"),
    doh(domain, "CAA"),
  ]);

  const out: SearchResultItem[] = [];
  const ips = [...a.map((x) => x.data), ...aaaa.map((x) => x.data)];
  if (ips.length > 0) {
    out.push(
      item(
        `IP manzil: ${ips.slice(0, 2).join(", ")}`,
        `https://www.ip-address.com/site/${domain}`,
        `A/AAAA yozuvlari — ${domain} → ${ips.join(", ")}`,
        "ip-address.com"
      )
    );
  }
  const mxHosts = [...new Set(mx.map((x) => nodot(x.data.replace(/^\d+\s+/, ""))))];
  if (mxHosts.length > 0) {
    out.push(
      item(
        `Pochta serverlari (MX): ${mxHosts[0]}`,
        `https://${mxHosts[0]}`,
        `MX: ${mxHosts.join(", ")}${mxHosts[0].includes("google") ? " — Google Workspace" : mxHosts[0].includes("outlook") || mxHosts[0].includes("microsoft") ? " — Microsoft 365" : mxHosts[0].includes("yandex") ? " — Yandex 360" : mxHosts[0].includes("mail.ru") ? " — Mail.ru" : ""}`,
        mxHosts[0]
      )
    );
  }
  const nsHosts = [...new Set(ns.map((x) => nodot(x.data)))];
  if (nsHosts.length > 0) {
    const soaData = soa[0]?.data ?? "";
    out.push(
      item(
        `DNS serverlari (NS): ${nsHosts.length} ta`,
        `https://www.whois.com/whois/${domain}`,
        `NS: ${nsHosts.join(", ")}${soaData ? ` | SOA: ${nodot(soaData.split(" ")[0] ?? "")}` : ""}`,
        "whois.com"
      )
    );
  }
  if (txt.length > 0) {
    const txts = txt.map((x) => x.data.replace(/^"|"$/g, ""));
    const spf = txts.find((t) => t.toLowerCase().startsWith("v=spf1"));
    const dmarc = txts.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
    const verify = txts.find((t) => /verification|site-?verification|_domainkey|_acme/i.test(t));
    const summary = [
      spf ? `SPF: ${spf}` : "",
      dmarc ? "DMARC siyosati bor" : "",
      verify ? `Tekshiruv yozuvi: ${verify.slice(0, 60)}` : "",
      ...cap(
        txts.filter((t) => t !== spf && t !== dmarc && t !== verify && !t.startsWith("v=")),
        3
      ),
    ]
      .filter(Boolean)
      .join(" | ");
    out.push(
      item(
        `TXT yozuvlari: ${txts.length} ta`,
        `https://dnschecker.org/all-dns-records-of-domain.php?query=${domain}&rtype=ANY&dns=google`,
        `${summary}${caa.length > 0 ? ` | CAA: ${caa.map((x) => x.data).join(" / ")}` : ""}`,
        "dnschecker.org"
      )
    );
  }
  return out;
}

// ===== RDAP / WHOIS (domen) =====

interface RdapEvent {
  eventAction: string;
  eventDate: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown[];
  entities?: RdapEntity[];
  handle?: string;
}
interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: RdapEvent[];
  nameservers?: { ldhName?: string }[];
  entities?: RdapEntity[];
}

function vcardText(e: RdapEntity, key: string): string {
  try {
    const arr = e.vcardArray as unknown[];
    const props = (arr?.[1] ?? []) as unknown[][];
    const found = props.find((p) => p[0] === key);
    return typeof found?.[3] === "string" ? (found[3] as string) : "";
  } catch {
    return "";
  }
}

function rdapEmails(e: RdapEntity, depth = 0): string[] {
  const out: string[] = [];
  const mail = vcardText(e, "email");
  if (mail) out.push(mail);
  for (const sub of e.entities ?? []) out.push(...rdapEmails(sub, depth + 1));
  return out;
}

async function rdapDomainSource(rawTarget: string): Promise<SearchResultItem[]> {
  const domain = cleanDomain(rawTarget);
  if (!domain || isV4Host(domain)) return [];
  const d = await fj<RdapDomain>(`https://rdap.org/domain/${domain}`, 10000);
  if (!d) return [];
  const ev = (act: string) =>
    d.events?.find((e) => e.eventAction === act)?.eventDate?.slice(0, 10) ?? "";
  const registrar = d.entities?.find((e) => e.roles?.includes("registrar"));
  const regName = registrar ? vcardText(registrar, "fn") : "";
  const abuse = [...(d.entities ?? []).flatMap((e) => rdapEmails(e))].filter((m) =>
    /abuse|security|report/i.test(m)
  );
  const emails = [...(d.entities ?? []).flatMap((e) => rdapEmails(e))];
  const facts = [
    regName ? `Registrator: ${regName}` : "",
    ev("registration") ? `Ro'yxatga olingan: ${ev("registration")}` : "",
    ev("expiration") ? `Muddati tugaydi: ${ev("expiration")}` : "",
    ev("last changed") ? `Oxirgi o'zgarish: ${ev("last changed")}` : "",
    d.status?.length ? `Holat: ${d.status.slice(0, 3).join(", ")}` : "",
    (abuse[0] ?? emails[0]) ? `Kontakt: ${(abuse[0] ?? emails[0]).slice(0, 60)}` : "",
  ].filter(Boolean);
  if (facts.length === 0) return [];
  const out = [
    item(
      `WHOIS: ${regName || "registrator ko'rsatilmagan"}`,
      `https://client.rdap.org/?object=${domain}`,
      facts.join(" | "),
      "client.rdap.org"
    ),
  ];
  const ns = (d.nameservers ?? [])
    .map((n) => n.ldhName?.toLowerCase())
    .filter((x): x is string => !!x);
  if (ns.length > 0) {
    out.push(
      item(
        `WHOIS NS: ${ns.slice(0, 2).join(", ")}`,
        `https://www.whois.com/whois/${domain}`,
        `Nameserverlar: ${ns.join(", ")}`,
        "whois.com"
      )
    );
  }
  return out;
}

// ===== Subdomenlar: crt.sh + Wayback =====

interface CrtEntry {
  issuer_name?: string;
  name_value?: string;
  not_before?: string;
}

async function crtShNames(domain: string): Promise<Map<string, string>> {
  const rows = await fj<CrtEntry[]>(
    `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
    12000
  );
  const map = new Map<string, string>();
  if (Array.isArray(rows)) {
    for (const r of rows.slice(0, 400)) {
      for (const nm of (r.name_value ?? "").split("\n")) {
        const n = nm.trim().toLowerCase().replace(/^\*\./, "");
        if (n.endsWith(`.${domain}`) && n !== domain && n !== `www.${domain}` && !map.has(n)) {
          map.set(n, issuerShort(r.issuer_name ?? ""));
        }
      }
    }
  }
  return map;
}

async function waybackNames(domain: string): Promise<Set<string>> {
  const rows = await fj<unknown[][]>(
    `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(
      domain
    )}&output=json&collapse=urlkey&fl=original&limit=500`,
    10000
  );
  const hosts = new Set<string>();
  if (Array.isArray(rows)) {
    for (const row of rows.slice(1)) {
      const orig = typeof row?.[0] === "string" ? (row[0] as string) : "";
      if (!orig) continue;
      try {
        const h = new URL(orig).hostname.replace(/^www\./, "");
        if (h.endsWith(`.${domain}`) && h !== domain) hosts.add(h);
      } catch {
        /* skip */
      }
    }
  }
  return hosts;
}

async function subdomainsSource(rawTarget: string): Promise<SearchResultItem[]> {
  const domain = cleanDomain(rawTarget);
  if (!domain || isV4Host(domain)) return [];
  const [crt, wb] = await Promise.all([crtShNames(domain), waybackNames(domain)]);
  const all = new Map<string, string>(crt);
  for (const h of wb) if (!all.has(h)) all.set(h, "wayback");
  return [...all.entries()].slice(0, 18).map(([sub, src]) =>
    item(
      sub,
      `https://${sub}`,
      src === "wayback"
        ? "Wayback Machine arxivida uchraydi"
        : `SSL sertifikatida uchraydi (${src})`,
      sub
    )
  );
}

// ===== Sayt tahlili (HTTP probe) =====

const TECH_MARKERS: [string, string][] = [
  ["wp-content", "WordPress"],
  ["/_next/static", "Next.js"],
  ["__NEXT_DATA__", "Next.js"],
  ["cdn.shopify.com", "Shopify"],
  ["bitrix", "1C-Bitrix"],
  ["Drupal.settings", "Drupal"],
  ["data-framer", "Framer"],
  ["cdn.jsdelivr.net/gh/jquery", "jQuery"],
];

function extractSocials(html: string): string[] {
  const out = new Set<string>();
  const re =
    /https?:\/\/(?:www\.)?(t\.me|telegram\.me|instagram\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|linkedin\.com|tiktok\.com|github\.com|ok\.ru|vk\.com)\/[A-Za-z0-9_.@/-]{2,40}/g;
  for (const m of html.matchAll(re)) out.add(m[0].replace(/[)"']+$/, ""));
  return [...out].slice(0, 6);
}

async function siteProbeSource(rawTarget: string): Promise<SearchResultItem[]> {
  const domain = cleanDomain(rawTarget);
  if (!domain || isV4Host(domain)) return [];

  const [html, robots, sectxt, sitemap] = await Promise.all([
    ftext(`https://${domain}/`, 11000),
    ftext(`https://${domain}/robots.txt`, 6000, 20_000),
    ftext(`https://${domain}/.well-known/security.txt`, 6000, 8000),
    ftext(`https://${domain}/sitemap.xml`, 7000, 60_000),
  ]);

  const out: SearchResultItem[] = [];
  if (html) {
    const title = decodeHtml((html.match(/<title[^>]*>([^<]{1,120})/i)?.[1] ?? "").trim());
    const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,60})/i)?.[1];
    const markers = TECH_MARKERS.filter(([m]) => html.includes(m)).map(([, n]) => n);
    const socials = extractSocials(html);
    const emails = [...new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))]
      .filter((e) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e))
      .slice(0, 5);
    out.push(
      item(
        `Sayt ishlayapti: ${title || domain}`,
        `https://${domain}`,
        [
          `Title: ${title || "—"}`,
          gen ? `Generator: ${gen}` : "",
          markers.length ? `Texnologiyalar: ${[...new Set(markers)].join(", ")}` : "",
          emails.length ? `Email: ${emails.join(", ")}` : "",
          socials.length ? `Ijtimoiy tarmoqlar: ${socials.map((s) => new URL(s).hostname.replace("www.", "")).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        domain
      )
    );
  } else {
    out.push(
      item(
        `Sayt javob bermayapti`,
        `https://web.archive.org/web/*/${domain}`,
        `https://${domain} ochilmadi (server o'chiq yoki faqat www varianti ishlaydi). Arxivdagi tarixini tekshiring.`,
        "web.archive.org"
      )
    );
  }

  if (robots) {
    const sm = robots.match(/Sitemap:\s*(\S+)/i)?.[1];
    out.push(
      item(
        `robots.txt mavjud`,
        `https://${domain}/robots.txt`,
        `Sayt robots.txt ochiq: ${robots.slice(0, 160).replace(/\s+/g, " ")}${sm ? ` | Sitemap: ${sm}` : ""}`,
        domain
      )
    );
  }
  if (sectxt) {
    out.push(
      item(
        `security.txt mavjud`,
        `https://${domain}/.well-known/security.txt`,
        `Xavfsizlik bog'lanish siyosati: ${sectxt.replace(/\s+/g, " ").slice(0, 160)}`,
        domain
      )
    );
  }
  if (sitemap && sitemap.includes("<loc")) {
    const n = (sitemap.match(/<loc>/g) ?? []).length;
    out.push(
      item(
        `sitemap.xml — ${n}+ URL`,
        `https://${domain}/sitemap.xml`,
        `Sayt xaritasi ochiq, kamida ${n} ta sahifa indekslangan.`,
        domain
      )
    );
  }
  return out;
}

// ===== Tashqi rekon: urlscan.io + HackerTarget =====

interface UrlscanResp {
  results?: {
    _id?: string;
    task?: { time?: string };
    page?: { url?: string; domain?: string; ip?: string; country?: string };
  }[];
}

async function reconSource(rawTarget: string): Promise<SearchResultItem[]> {
  const domain = cleanDomain(rawTarget);
  if (!domain || isV4Host(domain)) return [];
  const out: SearchResultItem[] = [];

  const us = await fj<UrlscanResp>(
    `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}&size=8`,
    8000
  );
  for (const r of (us?.results ?? []).slice(0, 6)) {
    if (!r._id || !r.page?.url) continue;
    out.push(
      item(
        `urlscan: ${r.page.url.slice(0, 80)}`,
        `https://urlscan.io/result/${r._id}/`,
        [
          r.page.ip ? `IP: ${r.page.ip}` : "",
          r.page.country ? `Mamlakat: ${r.page.country}` : "",
          r.task?.time ? `Skanerlangan: ${r.task.time.slice(0, 10)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        "urlscan.io"
      )
    );
  }

  const ht = await ftext(`https://api.hackertarget.com/reverseiplookup/?q=${domain}`, 8000, 20_000);
  if (ht && !/error|exceeded|invalid/i.test(ht.slice(0, 40))) {
    const list = ht
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && s !== domain);
    if (list.length > 0) {
      out.push(
        item(
          `Qo'shni domenlar (bir IP'da): ${list.length} ta`,
          `https://api.hackertarget.com/reverseiplookup/?q=${domain}`,
          `Xuddi shu serverda joylashgan boshqa saytlar: ${cap(list, 10).join(", ")}`,
          "api.hackertarget.com"
        )
      );
    }
  }
  return out;
}

// ===== Maltego uslubidagi transformlar: email/ism → bog'liq domenlar =====
// Maltego'dagi pullik transformlarga o'xshash ish — bepul manba bilan:
//   Reverse WHOIS (ViewDNS) — shu email/ism egasining boshqa ro'yxatga olingan domenlari

async function reverseWhoisSource(rawTarget: string): Promise<SearchResultItem[]> {
  const q = rawTarget.trim();
  if (q.length < 5) return [];
  const html = await ftext(
    `https://viewdns.info/reversewhois/?q=${encodeURIComponent(q)}`,
    12_000,
    300_000
  );
  if (!html || /captcha|attention required|access denied/i.test(html.slice(0, 2000))) return [];
  // Yangi ViewDNS UI: <tbody><tr><td>akdenizdenge.com</td><td>2011-12-26</td><td>NAME.COM, INC.</td></tr>
  // Butun hujayra faqat bitta token bo'lgani uchun sana (nuqtasiz) va registrator (ko'p so'zli) mos kelmadi
  const ti = html.search(/<tbody/i);
  const te = html.search(/<\/tbody>/i);
  if (ti < 0 || te < 0) return [];
  const domains = [
    ...new Set(
      [...html.slice(ti, te).matchAll(/<td[^>]*>\s*([a-z0-9][a-z0-9.-]+\.[a-z]{2,})\s*<\/td>/gi)].map(
        (m) => m[1].toLowerCase()
      )
    ),
  ].filter((d) => d !== q.toLowerCase());
  if (domains.length === 0) return [];
  const isEmail = q.includes("@");
  const out: SearchResultItem[] = [
    item(
      `Reverse WHOIS: ${domains.length} ta domen — shu ${isEmail ? "email" : "ism"} egasidan`,
      `https://viewdns.info/reversewhois/?q=${encodeURIComponent(q)}`,
      `Bu ${isEmail ? "email" : "ism-familiya"} bilan ro'yxatga olingan domenlar: ${cap(domains, 10).join(", ")}${domains.length > 10 ? "..." : ""} — Maltego'dagi «Domains by Registrant» transformi.`,
      "viewdns.info"
    ),
  ];
  for (const d of domains.slice(0, 8)) {
    out.push(
      item(
        `Ega domeni: ${d}`,
        `https://viewdns.info/whois/${d}`,
        `Reverse WHOIS: «${q}» ko'rsatkichi bilan ro'yxatga olingan. Ega/aloqa uchun WHOIS yozuvini oching.`,
        "viewdns.info"
      )
    );
  }
  return out;
}

// ===== Kompaniya firibgarlik signallari (company-signals) =====

const PRIVACY_WHOIS_RE = /(privacy|whoisguard|proxy|redact|protect|withheld|domainsbyproxy|anonim)/i;

async function companySignalsSource(rawTarget: string): Promise<SearchResultItem[]> {
  const t = rawTarget.trim();
  const domain = cleanDomain(t);
  const out: SearchResultItem[] = [];
  const risky: string[] = [];
  const good: string[] = [];

  if (domain) {
    // 1) Domen yoshi — RDAP ro'yxatga olish sanasi
    try {
      const d = await fj<RdapDomain>(`https://rdap.org/domain/${domain}`, 9000);
      const regISO = d?.events?.find((e) => e.eventAction === "registration")?.eventDate;
      if (regISO) {
        const days = Math.floor((Date.now() - new Date(regISO).getTime()) / 86400000);
        const years = Math.max(0, days / 365.25).toFixed(1);
        if (days < 180) {
          risky.push("yosh domen");
          out.push(
            item(
              `Xavf belgisi: domeni juda yosh (${years} yil)`,
              `https://client.rdap.org/?object=${domain}`,
              `Domen ${regISO.slice(0, 10)} da ro'yxatdan o'tgan. 6 oydan yangi domenlar «bugun ochilgan do'kon» firibgarliklarida ko'p uchraydi — rasmiy kompaniyalar odatda eski domendan foydalanadi.`,
              "client.rdap.org"
            )
          );
        } else {
          good.push(`domen ${years} yil`);
          out.push(
            item(
              `Domen yoshi: ${years} yil — ijobiy belgi`,
              `https://client.rdap.org/?object=${domain}`,
              `Domen ${regISO.slice(0, 10)} da ro'yxatga olingan. Uzoq tarix — firibgarlik ehtimolini kamaytiradi (eskirgan sayt bo'lsa, Wayback arxivida tarixini ko'ring).`,
              "client.rdap.org"
            )
          );
        }
      }
      // 2) WHOIS maxfiyligi — egasi yashirilganmi
      const mails = [...(d?.entities ?? []).flatMap((e) => rdapEmails(e))];
      const privacyMail = mails.find((m) => PRIVACY_WHOIS_RE.test(m));
      if (privacyMail) {
        risky.push("WHOIS maxfiy");
        out.push(
          item(
            "Xavf belgisi: WHOIS ma'lumotlari maxfiylashtirilgan",
            `https://client.rdap.org/?object=${domain}`,
            `Egasi identifikatsiyasi privacy/proxy xizmati orqali yashirilgan (${privacyMail.slice(0, 50)}). Bu o'z-o'zidan xato emas — lekin firibgar saytlarda tez-tez uchraydi, rasmiy kompaniyalar odatda ochiq yoziladi.`,
            "client.rdap.org"
          )
        );
      }
    } catch {
      /* RDAP javob bermadi — keyingi tekshiruvga o'tamiz */
    }

    // 3) Server egasi, proxy/hosting belgilari — ip-api.com
    try {
      const ans = await doh(domain, "A");
      const ip = ans[0]?.data;
      if (ip && isIpv4(ip)) {
        const geo = await fj<IpApiResp>(
          `http://ip-api.com/json/${ip}?fields=status,country,city,isp,org,proxy,hosting,reverse`,
          8000
        );
        if (geo?.status === "success") {
          const flags = [geo.proxy ? "PROXY/VPN" : "", geo.hosting ? "hosting" : ""].filter(Boolean);
          if (geo.proxy) risky.push("IP proxy orqali");
          out.push(
            item(
              `Server: ${[geo.isp ?? geo.org, geo.country].filter(Boolean).join(", ")}`,
              `https://ipinfo.io/${ip}`,
              [
                geo.reverse ? `Reverse DNS: ${geo.reverse}` : "",
                flags.length ? `Belgilar: ${flags.join(", ")}` : "",
                geo.proxy
                  ? "Diqqat: sayt IP si proxy orqali yashirilgan — anonimlashtirish belgisi, kelib chiqishini aniqlash qiyinlashadi"
                  : "",
              ]
                .filter(Boolean)
                .join(" | ") || "Hosting/IP ma'lumotlari",
              "ipinfo.io"
            )
          );
        }
      }
    } catch {
      /* IP aniqlanmadi */
    }
  }

  // 4) Davlat reestri havolasi — kompaniya NOMI bo'lsa ham ishlaydi
  out.push(
    item(
      `Davlat reestrida tekshiring: ${t}`,
      `https://orginfo.uz/search?q=${encodeURIComponent(t)}`,
      "orginfo.uz — O'zbekiston yuridik shaxslari reestri: rasmiy nomi, ro'yxatga olingan sana, rahbar, ta'sischilar, STIR va faoliyat holati. Kompaniya bu yerda topilmasa — rasmiy ro'yxatdan o'tmagan bo'lishi mumkin, bu kuchli xavf belgisi.",
      "orginfo.uz"
    )
  );

  // 5) Umumiy xulosa
  out.push(
    item(
      risky.length > 0
        ? `Firibgarlik signallari: ${risky.length} ta shubhali belgi — ${risky.join(", ")}`
        : `Firibgarlik signallari: aniq xavf belgisi yo'q${good.length ? ` (${good.join(", ")})` : ""}`,
      domain
        ? `https://www.scamadviser.com/check-website/${domain}`
        : `https://orginfo.uz/search?q=${encodeURIComponent(t)}`,
      risky.length > 0
        ? "Yuqoridagi belgilar o'zi firibgarlik isboti EMAS — lekin to'lov yoki kelishuvdan oldin reestr (orginfo.uz), mijoz sharhlari va rasmiy sahifalarni birga tekshiring. Rasmiy sahifalar haqiqiyligini obunachilar soni, posting sanasi va domendagi havolalardan solishtiring."
        : "Aniq xavf belgisi topilmadi. Baribir «Sud, tender va sharhlar» hamda «Firibgarlik eslatmalari» modullari natijalarini ko'rib chiqing — ochiq manbalarda shikoyat bo'lsa shu yerda ko'rinadi.",
      "scamadviser.com"
    )
  );
  return out;
}

// ===== IP razvedka: ip-api + Shodan InternetDB =====

interface IpApiResp {
  status?: string;
  country?: string;
  regionName?: string;
  city?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  lat?: number;
  lon?: number;
}

interface ShodanDb {
  ip?: string;
  ports?: number[];
  hostnames?: string[];
  cpes?: string[];
  vulns?: string[];
  tags?: string[];
}

async function ipIntelSource(rawTarget: string): Promise<SearchResultItem[]> {
  const ip = rawTarget.trim();
  if (!isIpv4(ip)) return [];
  const [geo, sh] = await Promise.all([
    fj<IpApiResp>(
      `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,asname,reverse,mobile,proxy,hosting,lat,lon`,
      8000
    ),
    fj<ShodanDb>(`https://internetdb.shodan.io/${ip}`, 8000),
  ]);

  const out: SearchResultItem[] = [];
  if (geo?.status === "success") {
    const flags = [
      geo.hosting ? "hosting/data-markaz" : "",
      geo.proxy ? "proksi" : "",
      geo.mobile ? "mobil tarmoq" : "",
    ].filter(Boolean);
    out.push(
      item(
        `Joylashuv: ${[geo.city, geo.country].filter(Boolean).join(", ")}`,
        `https://ipinfo.io/${ip}`,
        [
          geo.isp ? `ISP: ${geo.isp}` : "",
          geo.as ? `AS: ${geo.as}` : "",
          geo.org && geo.org !== geo.isp ? `Tashkilot: ${geo.org}` : "",
          geo.reverse ? `Reverse DNS: ${geo.reverse}` : "",
          flags.length ? `Belgilar: ${flags.join(", ")}` : "",
          geo.lat ? `Koordinata: ${geo.lat}, ${geo.lon}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        "ipinfo.io"
      )
    );
  }
  if (sh && (sh.ports?.length || sh.hostnames?.length || sh.vulns?.length)) {
    const parts = [
      sh.ports?.length ? `Ochiq portlar: ${cap(sh.ports, 15).join(", ")}` : "",
      sh.hostnames?.length ? `Hostnames: ${cap(sh.hostnames, 5).join(", ")}` : "",
      sh.vulns?.length ? `Zaifliklar: ${cap(sh.vulns, 6).join(", ")}${sh.vulns.length > 6 ? " ..." : ""}` : "",
      sh.cpes?.length ? `Dasturlar: ${cap(sh.cpes, 4).join(", ")}` : "",
      sh.tags?.length ? `Teglar: ${sh.tags.join(", ")}` : "",
    ].filter(Boolean);
    out.push(
      item(
        sh.vulns?.length
          ? `Shodan: ${sh.ports?.length ?? 0} port, ${sh.vulns.length} zaiflik!`
          : `Shodan: ${sh.ports?.length ?? 0} ta ochiq port`,
        `https://www.shodan.io/host/${ip}`,
        parts.join(" | "),
        "shodan.io"
      )
    );
  }
  return out;
}

// ===== Tarmoq egasi: RDAP IP =====

interface RdapIp {
  handle?: string;
  name?: string;
  ipVersion?: string;
  startAddress?: string;
  endAddress?: string;
  country?: string;
  type?: string;
  remarks?: { description?: string[] }[];
  entities?: RdapEntity[];
  events?: RdapEvent[];
}

async function rdapIpSource(rawTarget: string): Promise<SearchResultItem[]> {
  const ip = rawTarget.trim();
  if (!isIpv4(ip)) return [];
  // rdap.org yo'naltirish xizmati vaqti-vaqti bilan sekinlashadi —
  // RIR serverlariga to'g'ridan-to'g'ri zaxira so'rovlar bilan ishonchlilik oshiriladi
  const endpoints = [
    `https://rdap.org/ip/${ip}`,
    `https://rdap.ripe.net/ip/${ip}`,
    `https://rdap.arin.net/registry/ip/${ip}`,
    `https://rdap.apnic.net/ip/${ip}`,
  ];
  let d: RdapIp | null = null;
  for (const ep of endpoints) {
    d = await fj<RdapIp>(ep, 7000);
    if (d) break;
  }
  if (!d) return [];
  const org = (d.entities ?? []).map((e) => vcardText(e, "fn")).find(Boolean) ?? "";
  const emails = (d.entities ?? []).flatMap((e) => rdapEmails(e));
  const remark = d.remarks?.flatMap((r) => r.description ?? [])[0] ?? "";
  const facts = [
    d.name ? `Tarmoq nomi: ${d.name}` : "",
    org ? `Egasi: ${org}` : "",
    d.country ? `Mamlakat: ${d.country}` : "",
    d.startAddress ? `Diapazon: ${d.startAddress} — ${d.endAddress}` : "",
    d.type ? `Tur: ${d.type}` : "",
    remark ? remark.slice(0, 100) : "",
    emails[0] ? `Kontakt: ${emails[0].slice(0, 60)}` : "",
  ].filter(Boolean);
  if (facts.length === 0) return [];
  return [
    item(
      d.name ? `Tarmoq: ${d.name}` : `IP blok ma'lumotlari`,
      `https://client.rdap.org/?object=${ip}`,
      facts.join(" | "),
      "client.rdap.org"
    ),
  ];
}

// ===== PTR + qo'shni domenlar (IP) =====

async function ptrReconSource(rawTarget: string): Promise<SearchResultItem[]> {
  const ip = rawTarget.trim();
  if (!isIpv4(ip)) return [];
  const out: SearchResultItem[] = [];
  const oct = ip.split(".");
  const [ptr, ht] = await Promise.all([
    doh(`${oct[3]}.${oct[2]}.${oct[1]}.${oct[0]}.in-addr.arpa`, "PTR"),
    ftext(`https://api.hackertarget.com/reverseiplookup/?q=${ip}`, 8000, 20_000),
  ]);
  const ptrs = [...new Set(ptr.map((a) => a.data.replace(/\.$/, "")))];
  if (ptrs.length > 0) {
    out.push(
      item(
        `PTR: ${ptrs[0]}`,
        `https://dnschecker.org/#PTR/${ip}`,
        `Reverse DNS (PTR): ${ptrs.join(", ")}`,
        "dnschecker.org"
      )
    );
  }
  if (ht && !/error|exceeded|invalid/i.test(ht.slice(0, 40))) {
    const list = ht.split("\n").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      out.push(
        item(
          `Shu IP'dagi saytlar: ${list.length} ta`,
          `https://api.hackertarget.com/reverseiplookup/?q=${ip}`,
          `Bir xil serverda joylashgan domenlar: ${cap(list, 10).join(", ")}`,
          "api.hackertarget.com"
        )
      );
    }
  }
  return out;
}

// ===== Email yordamchilari =====

export interface ParsedEmail {
  local: string;
  domain: string;
  md5: string;
}

export function parseEmail(raw: string): ParsedEmail | null {
  const t = raw.trim().toLowerCase();
  const m = t.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
  if (!m) return null;
  return { local: m[1], domain: m[2], md5: createHash("md5").update(t).digest("hex") };
}

function mailProvider(mx: string): string {
  const h = mx.toLowerCase();
  if (h.includes("google") || h.includes("googlemail")) return "Google Workspace";
  if (h.includes("outlook") || h.includes("microsoft")) return "Microsoft 365";
  if (h.includes("yandex")) return "Yandex 360";
  if (h.includes("mail.ru")) return "Mail.ru Cloud";
  if (h.includes("zoho")) return "Zoho Mail";
  if (h.includes("proton")) return "Proton Mail";
  if (h.includes("pphosted") || h.includes("proofpoint")) return "Proofpoint (korporativ himoya)";
  if (h.includes("mimecast")) return "Mimecast (korporativ himoya)";
  if (h.includes("qq.com") || h.includes("tencent")) return "Tencent QQ Mail";
  if (h.includes("secureserver")) return "GoDaddy";
  if (h.includes("mailgun") || h.includes("sendgrid") || h.includes("amazonses")) return "ESP (yuborish xizmati)";
  if (h.includes("icloud")) return "Apple iCloud";
  return "";
}

// ===== Email yordamchilari — eksport (email-score.ts ishlatadi) =====

export const FREEMAIL_SET = FREEMAIL_DOMAINS;

/** Rol manzili lokal qismi — info@, admin@, support@... shaxsga bog'lab bo'lmaydi */
export function isRoleLocalPart(local: string): boolean {
  return /^(info|admin|administrator|support|contact|help|mail|sales|office|billing|hr|jobs|careers|noreply|no-reply|donotreply|postmaster|webmaster|hostmaster|abuse|security|marketing|pr|press|team|hello|service|order|shop|finance|legal|media)\d*$/.test(
    local.toLowerCase()
  );
}

// ===== HIBP breach katalogi (bepul, kalitsiz) — oqish nomlarini boyitish uchun =====
// https://haveibeenpwned.com/api/v3/breaches — to'liq katalog: sana, soni, DataClasses.
// 6 soat kesh — bir server jarayonida faqat bir marta yuklanadi.

interface HibpCatalogEntry {
  Name?: string;
  Title?: string;
  BreachDate?: string;
  DataClasses?: string[];
  PwnCount?: number;
}

interface CatalogFact {
  title: string;
  date: string;
  dataClasses: string[];
  norm: string;
}

let breachCatalogCache: { at: number; entries: HibpCatalogEntry[] } | null = null;

const normBreachName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchBreachCatalog(): Promise<HibpCatalogEntry[]> {
  if (breachCatalogCache && Date.now() - breachCatalogCache.at < 6 * 3600_000) {
    return breachCatalogCache.entries;
  }
  const r = await fj<HibpCatalogEntry[]>("https://haveibeenpwned.com/api/v3/breaches", 12000, {
    "User-Agent": "OSINT-Radar",
  });
  if (Array.isArray(r) && r.length > 0) {
    breachCatalogCache = { at: Date.now(), entries: r };
    return r;
  }
  return breachCatalogCache?.entries ?? [];
}

/** Oqish nomlari → katalog faktlari (sana + qanday maydonlar oshkor bo'lgan).
 * Nom moslash: normalizatsiyadan keyin to'liq tenglik yoki o'zaro qamrab olish (min 5 belgi). */
export async function breachCatalogFacts(
  names: string[]
): Promise<CatalogFact[]> {
  const catalog = await fetchBreachCatalog();
  if (catalog.length === 0) return [];
  const out: CatalogFact[] = [];
  for (const raw of names) {
    const norm = normBreachName(raw);
    if (!norm) continue;
    const hit =
      catalog.find((c) => normBreachName(c.Name ?? c.Title ?? "") === norm) ??
      catalog.find((c) => {
        const cn = normBreachName(c.Name ?? c.Title ?? "");
        if (cn.length < 5 || norm.length < 5) return false;
        return cn.startsWith(norm) || norm.startsWith(cn) || cn.includes(norm) || norm.includes(cn);
      });
    if (!hit) continue;
    out.push({
      title: hit.Title ?? hit.Name ?? raw,
      date: hit.BreachDate ?? "",
      dataClasses: (hit.DataClasses ?? []).slice(0, 5),
      norm,
    });
  }
  return out;
}

// ===== Email: ma'lumot oqishlari (XposedOrNot + HIBP katalog boyitishi) =====

interface XonCheck {
  breaches?: string[][];
}
interface XonAnalytics {
  BreachMetrics?: {
    risk?: { risk_label?: string; risk_score?: number }[];
    passwords_strength?: Record<string, number> | Record<string, number>[];
  };
}

export async function breachesSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  const email = `${em.local}@${em.domain}`;
  const [chk, ana] = await Promise.all([
    fj<XonCheck>(
      `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`,
      9000
    ),
    fj<XonAnalytics>(
      `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`,
      9000
    ),
  ]);
  // chk === null — manba javob bermadi (natija yo'q deb hisoblamaymiz)
  if (!chk) return [];
  const names = [...new Set((chk.breaches ?? []).flat())].filter(Boolean);
  if (names.length === 0) {
    return [
      item(
        "Oqishlarda topilmadi",
        "https://xposedornot.com/",
        `Bu email XposedOrNot bazasidagi ommaviy ma'lumot oqishlarida qatnashmagan — yaxshi belgi. Baribir parollarni davriy yangilab turish tavsiya etiladi.`,
        "xposedornot.com"
      ),
    ];
  }
  const out: SearchResultItem[] = [
    item(
      `Oqishlarda topildi: ${names.length} ta`,
      "https://xposedornot.com/breach-explorer",
      `Email ${names.length} ta ommaviy oqishga duch kelgan: ${cap(names, 14).join(", ")}${names.length > 14 ? " ..." : ""}`,
      "xposedornot.com"
    ),
  ];
  // HIBP katalog boyitishi — har oqish uchun SANA va qanday maydonlar oshkor bo'lgani
  // (IntelBase «Breach details: what data was exposed» uslubi, bepul manbalar bilan)
  try {
    const facts = await breachCatalogFacts(names);
    if (facts.length > 0) {
      const DC_UZ: Record<string, string> = {
        "Email addresses": "email",
        Passwords: "parollar",
        "Usernames": "username",
        Names: "ism",
        "Phone numbers": "telefon",
        "Physical addresses": "manzil",
        "Dates of birth": "tug'ilgan sana",
        "Geographic locations": "joylashuv",
        "Social media profiles": "ijtimoiy profil",
        "IP addresses": "IP manzil",
        "Browser user agent details": "brauzer ma'lumotlari",
        "Auth tokens": "tokenlar",
        "Security questions and answers": "xavfsizlik savollari",
        "Credit cards": "karta",
        "Payment histories": "to'lovlar tarixi",
        "Private messages": "shaxsiy xabarlar",
        "Chat logs": "chat jurnali",
        Purchases: "xaridlar",
        Employers: "ish joyi",
        "Job titles": "lavozim",
      };
      for (const f of facts.slice(0, 10)) {
        const dc = f.dataClasses.map((d) => DC_UZ[d] ?? d.toLowerCase());
        out.push(
          item(
            `${f.title} oqishi${f.date ? ` (${f.date.slice(0, 4)})` : ""}`,
            `https://haveibeenpwned.com/PwnedWebsites#${f.title.replace(/\s+/g, "")}`,
            [
              f.date ? `Oqish sanasi: ${f.date}` : "",
              dc.length ? `Oshkor bo'lganlar: ${dc.join(", ")}` : "",
              "Batafsil: HIBP Pwned Websites katalogi",
            ]
              .filter(Boolean)
              .join(" | "),
            "haveibeenpwned.com"
          )
        );
      }
      if (facts.length > 10) {
        out.push(
          item(
            `Yana ${facts.length - 10} oqish katalogdan moslandi`,
            "https://haveibeenpwned.com/PwnedWebsites",
            `To'liq ro'yxat: ${facts.slice(10).map((f) => f.title).join(", ")}`,
            "haveibeenpwned.com"
          )
        );
      }
    }
  } catch {
    /* katalog ishlamadi — asosiy natijalar qoladi */
  }
  const risk = ana?.BreachMetrics?.risk?.[0];
  const psRaw = ana?.BreachMetrics?.passwords_strength;
  // API ba'zan massiv ichida qaytaradi: [{"EasyToCrack":120,...}]
  const ps = Array.isArray(psRaw) ? psRaw[0] : psRaw;
  if (risk?.risk_label || ps) {
    const riskUz: Record<string, string> = {
      Critical: "Juda xavfli",
      High: "Xavfli",
      Medium: "O'rtacha",
      Low: "Past",
    };
    const psParts = ps
      ? [`Oson ochiladigan: ${ps.EasyToCrack ?? 0}`, `Ochiq matn: ${ps.PlainText ?? 0}`, `Kuchli xesh: ${ps.StrongHash ?? 0}`]
      : [];
    out.push(
      item(
        `Xavf darajasi: ${riskUz[risk?.risk_label ?? ""] ?? risk?.risk_label ?? "noma'lum"}`,
        "https://xposedornot.com/",
        [
          risk?.risk_score !== undefined ? `Risk ball: ${risk.risk_score}/100` : "",
          psParts.length ? `Oqishlarda oshkor bo'lgan parollar — ${psParts.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        "xposedornot.com"
      )
    );
  }
  return out;
}

// ===== Email: Gravatar profili =====

interface GravatarEntry {
  hash?: string;
  profileUrl?: string;
  preferredUsername?: string;
  displayName?: string;
  aboutMe?: string;
  currentLocation?: string;
  photos?: { value?: string; type?: string }[];
  accounts?: { domain?: string; url?: string; shortname?: string }[];
  urls?: { title?: string; value?: string }[];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function gravatarSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  const r = await fj<{ entry?: GravatarEntry[] }>(
    `https://en.gravatar.com/${em.md5}.json`,
    8000
  );
  const e = r?.entry?.[0];
  if (!e) return [];
  const profileUrl = e.profileUrl || `https://gravatar.com/${em.md5}`;
  const out: SearchResultItem[] = [];
  const facts = [
    e.displayName ? `Ism: ${e.displayName}` : "",
    e.preferredUsername ? `Username: ${e.preferredUsername}` : "",
    e.currentLocation ? `Joylashuv: ${e.currentLocation}` : "",
    e.aboutMe ? `Bio: ${stripHtml(e.aboutMe).slice(0, 140)}` : "",
  ].filter(Boolean);
  out.push(
    item(
      `Gravatar profil: ${e.displayName || e.preferredUsername || em.local}`,
      profileUrl,
      facts.join(" | ") || "Email bilan bog'langan Gravatar profili mavjud",
      "gravatar.com"
    )
  );
  const accts = (e.accounts ?? []).filter((a) => a.url && a.shortname).slice(0, 6);
  if (accts.length > 0) {
    out.push(
      item(
        `Bog'langan profillar: ${accts.length} ta`,
        profileUrl,
        accts.map((a) => `${a.shortname}: ${a.url}`).join(", "),
        "gravatar.com"
      )
    );
  }
  const links = (e.urls ?? []).filter((u) => u.value).slice(0, 3);
  if (links.length > 0) {
    out.push(
      item(
        `Saytlar: ${links.length} ta`,
        links[0].value!,
        links.map((u) => `${u.title || "havola"}: ${u.value}`).join(", "),
        new URL(links[0].value!).hostname
      )
    );
  }
  return out;
}

// ===== Email/Username: Infostealer loglari (Hudson Rock — bepul, kalitsiz) =====
// IntelBase'ning «Infostealer Logs» xususiyatining bepul analogi: zararlangan
// kompyuterlardan o'g'irlangan ma'lumotlar (parollar, cookie, sessiyalar, autofill).
// Email va username endpointlari bir xil javob shakliga ega.

interface HudStealerHit {
  date_compromised?: string;
  computer_name?: string;
  operating_system?: string;
  malware_path?: string;
  stealer_family?: string;
  total_corporate_services?: number;
  total_user_services?: number;
  antiviruses?: string[];
  ip?: string;
}

export async function hudsonRockSource(rawTarget: string): Promise<SearchResultItem[]> {
  const t = rawTarget.trim();
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
  const isUser = /^[a-zA-Z0-9._-]{2,64}$/.test(t);
  if (!isEmail && !isUser) return [];
  const url = isEmail
    ? `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(t)}`
    : `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-username?username=${encodeURIComponent(t)}`;
  const r = await fj<{ stealers?: HudStealerHit[] }>(url, 11000);
  if (!r) return [];
  const hits = (r.stealers ?? []).filter(Boolean);
  if (hits.length === 0) {
    return [
      item(
        "Stealer loglarida yo'q",
        "https://www.hudsonrock.com/free-tools",
        `Hudson Rock infostealer bazasida shu ${isEmail ? "email" : "username"} bilan bog'langan zararlangan kompyuter topilmadi — yaxshi belgi. Bu bazada 100+ mln o'g'irlangan qurilma yozuvlari bor.`,
        "hudsonrock.com"
      ),
    ];
  }
  const out: SearchResultItem[] = [
    item(
      `Stealer logda topildi: ${hits.length} zararlangan kompyuter`,
      "https://www.hudsonrock.com/free-tools",
      `Shu ${isEmail ? "email" : "username"} infostealer (parol/cookie/sessiya o'g'rilovchi virus) uchragan qurilmalardan topildi — bu qurilmalardagi BARCHA saqlangan parollar va sessiyalar jinoyachilar qo'lida. Eng erta: ${hits.map((h) => h.date_compromised?.slice(0, 10)).filter(Boolean).sort()[0] ?? "?"}`,
      "hudsonrock.com"
    ),
  ];
  for (const h of hits.slice(0, 3)) {
    const corp = h.total_corporate_services ?? 0;
    const facts = [
      h.date_compromised ? `Zararlanish sanasi: ${h.date_compromised.slice(0, 10)}` : "",
      h.stealer_family ? `Malumot o'g'risi: ${h.stealer_family}` : "",
      h.operating_system ? `OS: ${h.operating_system}` : "",
      h.computer_name ? `Kompyuter: ${h.computer_name}` : "",
      h.malware_path ? `Zararli fayl: ${h.malware_path.slice(0, 90)}` : "",
      h.ip ? `IP: ${h.ip}` : "",
      `Korporativ xizmatlar: ${corp} · Foydalanuvchi xizmatlari: ${h.total_user_services ?? 0}`,
      corp > 0 ? "DIQQAT: korporativ hisoblarga kirish ma'lumotlari ham o'g'irlangan" : "",
    ].filter(Boolean);
    out.push(
      item(
        `Zararlangan qurilma${h.stealer_family ? ` (${h.stealer_family})` : ""}`, 
        "https://cavalier.hudsonrock.com/",
        facts.join(" | "),
        "hudsonrock.com"
      )
    );
  }
  return out;
}

// ===== Email: LeakCheck ommaviy baza (bepul, kalitsiz) =====

interface LcPublicResp {
  success?: boolean;
  found?: number;
  fields?: string[];
  sources?: { name?: string; date?: string }[];
}

const LC_FIELD_UZ: Record<string, string> = {
  password: "parol",
  username: "username",
  name: "ism",
  first_name: "ism",
  last_name: "familiya",
  middle_name: "otasining ismi",
  surnames: "familiyalar",
  dob: "tug'ilgan sana",
  address: "manzil",
  address1: "manzil",
  street: "ko'cha",
  city: "shahar",
  state: "viloyat",
  region: "region",
  province: "viloyat",
  area: "hudud",
  zip: "pochta indeksi",
  country: "mamlakat",
  phone: "telefon",
  ip: "IP manzil",
  ip1: "IP manzil",
  ip2: "IP manzil",
  ssn: "SSN (soliq/sug'urta raqami)",
  gender: "jins",
  company_name: "kompaniya",
  profile_name: "profil nomi",
  title: "unvon",
  id: "ID",
  origin: "chegara chiqish",
  location: "joylashuv",
  qqmail: "QQ mail",
};

export async function leakCheckSource(rawTarget: string): Promise<SearchResultItem[]> {
  const t = rawTarget.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return [];
  const r = await fj<LcPublicResp>(
    `https://leakcheck.io/api/public?check=${encodeURIComponent(t)}`,
    11000
  );
  if (!r || r.success !== true) return [];
  const found = r.found ?? 0;
  const fields = (r.fields ?? []).map((f) => LC_FIELD_UZ[f.toLowerCase()] ?? f);
  if (found === 0) {
    return [
      item(
        "LeakCheck bazasida yo'q",
        "https://leakcheck.io/",
        `LeakCheck o'g'irlangan yozuvlar bazasida (70+ mln email, ko'p manbalardan yig'ilgan) bu manzil uchun yozuv topilmadi.`,
        "leakcheck.io"
      ),
    ];
  }
  const out: SearchResultItem[] = [
    item(
      `LeakCheck: ${found.toLocaleString("en-US")} yozuv topildi`,
      `https://leakcheck.io/?check=${encodeURIComponent(t)}`,
      [
        `Oshkor bo'lgan maydonlar: ${fields.slice(0, 12).join(", ") || "aniqlanmagan"}`,
        `Manbalar soni: ${r.sources?.length ?? 0}`,
        fields.some((f) => f === "parol")
          ? "DIQQAT: parollar ham oshkor bo'lgan — 2FA yoqing"
          : "",
      ]
        .filter(Boolean)
        .join(" | "),
      "leakcheck.io"
    ),
  ];
  const srcs = (r.sources ?? []).filter((s) => s.name).slice(0, 10);
  if (srcs.length > 0) {
    out.push(
      item(
        `Oqish manbalari: ${srcs.length} ta`,
        "https://leakcheck.io/",
        srcs.map((s) => `${s.name}${s.date ? ` (${s.date})` : ""}`).join(", "),
        "leakcheck.io"
      )
    );
  }
  return out;
}

// ===== Email: pochta serveri (MX/SPF/DMARC) =====

async function mailboxSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  const [mx, txt, dmarc] = await Promise.all([
    doh(em.domain, "MX"),
    doh(em.domain, "TXT"),
    doh(`_dmarc.${em.domain}`, "TXT"),
  ]);
  const out: SearchResultItem[] = [];
  const mxHosts = [...new Set(mx.map((x) => nodot(x.data.replace(/^\d+\s+/, ""))))];
  if (mxHosts.length === 0) {
    out.push(
      item(
        "Pochta qabul qilmaydi",
        `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${em.domain}`,
        `${em.domain} domeni MX yozuviga ega emas — bu manzilga email yetib bormaydi (manzil noto'g'ri yoki domen o'lik).`,
        "mxtoolbox.com"
      )
    );
    return out;
  }
  const prov = mailProvider(mxHosts[0]);
  out.push(
    item(
      `Pochta serveri: ${prov || mxHosts[0]}`,
      `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${em.domain}`,
      `MX: ${mxHosts.join(", ")}${prov ? ` — ${prov} orqali ishlaydi` : ""} | Domen pochtani qabul qiladi — manzil haqiqiy bo'lish ehtimoli yuqori`,
      "mxtoolbox.com"
    )
  );
  const txts = txt.map((x) => x.data.replace(/^"|"$/g, ""));
  const spf = txts.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const dmarcRec = dmarc
    .map((x) => x.data.replace(/^"|"$/g, ""))
    .find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  if (spf || dmarcRec) {
    const pol = dmarcRec?.match(/p=(\w+)/)?.[1];
    out.push(
      item(
        "SPF/DMARC himoyasi",
        `https://dnschecker.org/all-dns-records-of-domain.php?query=${em.domain}&rtype=ANY&dns=google`,
        [
          spf ? `SPF: ${spf.slice(0, 120)}` : "",
          dmarcRec ? `DMARC: p=${pol ?? "?"}` : "",
          pol === "none" ? "DMARC kuchsiz sozlangan (p=none) — soxta xatlar osonroq yuboriladi" : "",
          pol === "reject" ? "DMARC qat'iy rejimda (p=reject)" : "",
        ]
          .filter(Boolean)
          .join(" | "),
        "dnschecker.org"
      )
    );
  }
  return out;
}

// ===== Email: korporativ domen tahlili (freemail bo'lmagan) =====

async function corpDomainSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  if (
    FREEMAIL_DOMAINS.has(em.domain) ||
    PLATFORM_DOMAINS.has(em.domain) ||
    [...PLATFORM_DOMAINS].some((d) => em.domain.endsWith(`.${d}`))
  ) {
    return [];
  }
  const [whois, site, a] = await Promise.all([
    rdapDomainSource(em.domain),
    siteProbeSource(em.domain),
    doh(em.domain, "A"),
  ]);
  const out = [...whois, ...site];
  const ips = a.map((x) => x.data).filter((d) => isV4Host(d));
  if (ips.length > 0) {
    out.push(
      item(
        `Sayt serveri: ${ips[0]}`,
        `https://ipinfo.io/${ips[0]}`,
        `${em.domain} sayti ${ips.join(", ")} serverida joylashgan — IP manzilni alohida skanerlash mumkin (portlar, tashkilot, qo'shnilar).`,
        "ipinfo.io"
      )
    );
  }
  return out;
}

// ===== Email: GitHub commitlari =====

interface GhCommitItem {
  html_url?: string;
  repository?: { full_name?: string; owner?: { login?: string } };
  author?: { login?: string };
  commit?: { author?: { name?: string; date?: string } };
}

async function githubSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  const email = `${em.local}@${em.domain}`;
  const r = await fj<{ total_count?: number; items?: GhCommitItem[] }>(
    `https://api.github.com/search/commits?q=author-email%3A${encodeURIComponent(email)}&per_page=20&sort=author-date&order=desc`,
    9000,
    { Accept: "application/vnd.github+json" }
  );
  if (!r || typeof r.total_count !== "number" || !r.items?.length) return [];
  const items = r.items;
  const names = [...new Set(items.map((c) => c.commit?.author?.name).filter(Boolean))] as string[];
  const logins = [
    ...new Set(items.map((c) => c.author?.login || c.repository?.owner?.login).filter(Boolean)),
  ] as string[];
  const repos = [...new Set(items.map((c) => c.repository?.full_name).filter(Boolean))] as string[];
  const dates = (items.map((c) => c.commit?.author?.date).filter(Boolean) as string[]).sort();
  const facts = [
    names[0] ? `Git ismi: ${names[0]}` : "",
    logins[0] ? `Profil: github.com/${logins[0]}` : "",
    `${items.length < r.total_count ? "20+" : r.total_count} ta ommaviy commit`,
    repos.length ? `Repozitoriyalar: ${cap(repos, 4).join(", ")}` : "",
    dates.length ? `Faollik: ${dates[0].slice(0, 10)} — ${dates[dates.length - 1].slice(0, 10)}` : "",
  ].filter(Boolean);
  const firstUrl =
    items[0]?.html_url ||
    `https://github.com/search?q=author-email%3A${encodeURIComponent(email)}&type=commits`;
  return [
    item(`GitHub: ${logins[0] || names[0] || em.local}`, firstUrl, facts.join(" | "), "github.com"),
  ];
}

// ===== Status-bilgan fetch (profil tekshiruvi uchun) =====
/** 404 va tarmoq xatosini ajratadi: null = javob yo'q (noma'lum), status = HTTP kod */
async function fstatus(
  url: string,
  ms = 7000,
  maxBytes = 150_000
): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*" },
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

function ogMeta(html: string, prop: string): string {
  return decodeHtml(
    (html.match(new RegExp(`property=["']${prop}["'][^>]*content=["']([^"']*)`)) ??
      html.match(new RegExp(`content=["']([^"']*)["'][^>]*property=["']${prop}["']`)) ??
      [])[1] ?? ""
  ).trim();
}

// ===== Username: platforma profil tekshiruvi =====

interface ProbeResult {
  platform: string;
  host: string;
  url: string;
  state: "found" | "missing" | "unknown";
  info: string;
}

async function probeTelegram(u: string): Promise<ProbeResult> {
  const url = `https://t.me/${encodeURIComponent(u)}`;
  const r = await fstatus(url, 7000);
  if (!r) return { platform: "Telegram", host: "t.me", url, state: "unknown", info: "javob yo'q" };
  if (!r.text.includes("tgme_page_title"))
    return { platform: "Telegram", host: "t.me", url, state: "missing", info: "profil/kanal topilmadi" };
  const title = ogMeta(r.text, "og:title");
  const desc = ogMeta(r.text, "og:description");
  const extra = (r.text.match(/tgme_page_extra[^>]*>([^<]*)/)?.[1] ?? "").trim();
  return {
    platform: "Telegram", host: "t.me", url, state: "found",
    info: [title, extra, desc.slice(0, 100)].filter(Boolean).join(" | "),
  };
}

async function probeSteam(u: string): Promise<ProbeResult> {
  const url = `https://steamcommunity.com/id/${encodeURIComponent(u)}`;
  const r = await fstatus(url, 7000);
  if (!r) return { platform: "Steam", host: "steamcommunity.com", url, state: "unknown", info: "javob yo'q" };
  const title = (r.text.match(/<title>Steam Community :: ([^<]+)<\/title>/)?.[1] ?? "").trim();
  if (r.status === 404 || !title || /error/i.test(title))
    return { platform: "Steam", host: "steamcommunity.com", url, state: "missing", info: "profil topilmadi" };
  return { platform: "Steam", host: "steamcommunity.com", url, state: "found", info: decodeHtml(title) };
}

async function probeKeybase(u: string): Promise<ProbeResult> {
  const url = `https://keybase.io/${encodeURIComponent(u)}`;
  const r = await fstatus(url, 7000);
  if (!r) return { platform: "Keybase", host: "keybase.io", url, state: "unknown", info: "javob yo'q" };
  if (r.status === 404)
    return { platform: "Keybase", host: "keybase.io", url, state: "missing", info: "profil topilmadi" };
  const desc = ogMeta(r.text, "og:description");
  return { platform: "Keybase", host: "keybase.io", url, state: "found", info: desc.slice(0, 120) || "Keybase profili" };
}

async function probeGitlab(u: string): Promise<ProbeResult> {
  const url = `https://gitlab.com/${encodeURIComponent(u)}`;
  const rows = await fj<{ username?: string; name?: string; state?: string; avatar_url?: string }[]>(
    `https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`,
    7000
  );
  if (rows === null)
    return { platform: "GitLab", host: "gitlab.com", url, state: "unknown", info: "javob yo'q" };
  if (!Array.isArray(rows) || rows.length === 0)
    return { platform: "GitLab", host: "gitlab.com", url, state: "missing", info: "profil topilmadi" };
  const p = rows[0];
  return {
    platform: "GitLab", host: "gitlab.com", url, state: "found",
    info: [p.name, p.state ? `holat: ${p.state}` : ""].filter(Boolean).join(" | "),
  };
}

async function probeGithub(u: string): Promise<ProbeResult> {
  const url = `https://github.com/${encodeURIComponent(u)}`;
  const r = await fstatus(`https://api.github.com/users/${encodeURIComponent(u)}`, 7000, 40_000);
  if (!r) return { platform: "GitHub", host: "github.com", url, state: "unknown", info: "javob yo'q" };
  if (r.status === 404)
    return { platform: "GitHub", host: "github.com", url, state: "missing", info: "profil topilmadi" };
  if (r.status !== 200)
    return { platform: "GitHub", host: "github.com", url, state: "unknown", info: `rate-limit (${r.status})` };
  try {
    const j = JSON.parse(r.text) as { name?: string; bio?: string; followers?: number; public_repos?: number };
    return {
      platform: "GitHub", host: "github.com", url, state: "found",
      info: [j.name, j.bio ? `bio: ${j.bio.slice(0, 80)}` : "", j.followers !== undefined ? `${j.followers} obunachi, ${j.public_repos ?? 0} repo` : ""]
        .filter(Boolean)
        .join(" | "),
    };
  } catch {
    return { platform: "GitHub", host: "github.com", url, state: "found", info: "profil mavjud" };
  }
}

async function probeVk(u: string): Promise<ProbeResult> {
  const url = `https://vk.com/${encodeURIComponent(u)}`;
  const r = await fstatus(url, 7000, 60_000);
  if (!r) return { platform: "VK", host: "vk.com", url, state: "unknown", info: "javob yo'q" };
  if (r.status === 404)
    return { platform: "VK", host: "vk.com", url, state: "missing", info: "sahifa o'chirilgan yoki yo'q" };
  const title = (r.text.match(/<title>([^<]+)<\/title>/)?.[1] ?? "").trim();
  return { platform: "VK", host: "vk.com", url, state: "found", info: decodeHtml(title).slice(0, 100) };
}

async function probeGravatar(u: string): Promise<ProbeResult> {
  const url = `https://gravatar.com/${encodeURIComponent(u)}`;
  const md5 = createHash("md5").update(u.toLowerCase().trim()).digest("hex");
  const r = await fstatus(`https://en.gravatar.com/${md5}.json`, 7000, 30_000);
  if (!r) return { platform: "Gravatar", host: "gravatar.com", url, state: "unknown", info: "javob yo'q" };
  if (r.status === 404)
    return { platform: "Gravatar", host: "gravatar.com", url, state: "missing", info: "profil topilmadi" };
  try {
    const j = JSON.parse(r.text) as { entry?: { displayName?: string }[] };
    const e = j?.entry?.[0];
    if (!e) return { platform: "Gravatar", host: "gravatar.com", url, state: "missing", info: "profil topilmadi" };
    return { platform: "Gravatar", host: "gravatar.com", url, state: "found", info: e.displayName ?? "profil mavjud" };
  } catch {
    return { platform: "Gravatar", host: "gravatar.com", url, state: "unknown", info: "javobni o'qib bo'lmadi" };
  }
}

async function usernameProbeSource(rawTarget: string): Promise<SearchResultItem[]> {
  const u = rawTarget.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(u)) return [];
  const probes = [
    probeTelegram(u), probeSteam(u), probeKeybase(u), probeGitlab(u),
    probeGithub(u), probeVk(u), probeGravatar(u),
  ];
  const settled = await Promise.allSettled(probes);
  const results = settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter((x): x is ProbeResult => x !== null);
  const found = results.filter((r) => r.state === "found");
  const missing = results.filter((r) => r.state === "missing");
  const unknown = results.filter((r) => r.state === "unknown");
  const out: SearchResultItem[] = found.map((r) =>
    item(`${r.platform}: mavjud`, r.url, r.info || "Profil ochiq manbada topildi", r.host)
  );
  out.push(
    item(
      `Profil tekshiruvi: ${found.length}/${results.length} ta platformada topildi`,
      `https://whatsmyname.app/?q=${encodeURIComponent(u)}`,
      [
        found.length ? `Mavjud: ${found.map((r) => r.platform).join(", ")}` : "",
        missing.length ? `Yo'q: ${missing.map((r) => r.platform).join(", ")}` : "",
        unknown.length ? `Aniqlanmadi: ${unknown.map((r) => `${r.platform} (${r.info})`).join(", ")}` : "",
        "700+ sayt to'liq tekshiruvi — «WhatsMyName — 700+ sayt» modulida",
      ]
        .filter(Boolean)
        .join(" | "),
      "whatsmyname.app"
    )
  );
  return out;
}

// ===== WhatsMyName — 700+ sayt dataset bilan username tekshiruvi =====
// whatsmyname.app bilan BIR XIL dataset va deteksiya qoidalari (src/lib/whatsmyname.ts).

const WMN_MAX_RESULTS = 200;

async function whatsMyNameSource(
  rawTarget: string,
  onProgress?: WmnProgressCb
): Promise<SearchResultItem[]> {
  const u = rawTarget.trim().replace(/^@/, "");
  // WhatsMyName username'lari: harf/raqam/._- (dataset'dagi saytlar shu formatda ishlaydi)
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(u)) return [];
  const scan = await scanWhatsMyName(u, {
    concurrency: 32,
    timeoutMs: 9_000,
    onProgress,
  });
  const out: SearchResultItem[] = scan.hits.slice(0, WMN_MAX_RESULTS).map((h) => {
    let host = "whatsmyname.app";
    try {
      host = new URL(h.url).hostname.replace(/^www\./, "");
    } catch {
      /* standart host qoladi */
    }
    const cat = h.site.cat ? ` · ${h.site.cat}` : "";
    return item(
      `${h.site.name} — @${h.username} profili topildi`,
      h.url,
      `WhatsMyName dataset: profil mavjud [HTTP ${h.site.e_code} + imzo]${cat}`,
      host
    );
  });
  return out;
}

// ===== Email kashf qilish (username → email) — foydalanuvchining asosiy so'rovi =====
// «Bitta username orqali email va boshqa narsalar topilsin». Maltego'dagi
// eMailAddress transform analogi — hammasi BEPUL, API kaliti shart emas:
//
//  1. GRAVATAR PROBASI: username@<domen> variantlari md5 hash qilib
//     gravatar.com/avatar/<md5>?d=404 ga so'raladi — HTTP 200 = o'sha email
//     uchun Gravatar akkaunti MAVJUD (bu odam o'sha email bilan bir joyda
//     foydalangan) — 2010-yildan beri ma'lum OSINT usuli (email existence check).
//     Topilgan email uchun profil JSON o'qilib ism/bio/lokatsiya solishtiriladi:
//     mos kelsa «TASDIQLANDI», aks holda «kandidat».
//  2. GITHUB CHUQUR: public email/blog/twitter/lokatsiya — profil bo'lsa darhol.
//  3. KEYBASE API: ism, bio, twitter/github/sayt dalillari (proofs).
//  4. STEAM: haqiqiy ism (real name), davlat bayrog'i, a'zolik yoshi.

const EMAIL_DISCOVERY_PROVIDERS = [
  "gmail.com", "proton.me", "protonmail.com", "outlook.com", "hotmail.com",
  "yahoo.com", "icloud.com", "yandex.ru", "mail.ru", "inbox.ru", "list.ru",
  "bk.ru", "ukr.net", "gmx.com",
];

interface GravatarProbeHit {
  email: string;
  md5: string;
}

/** Gravatar profil mosligini baholash (test uchun eksport qilingan sof funksiya).
 *  username/dots-strip moslik yoki ism ichida username bo'lishi — TASDIQLANGAN. */
export function assessGravatarMatch(
  u: string,
  preferredUsername?: string,
  displayName?: string
): { verified: boolean; reason: "username" | "ism" | "yo'q" } {
  const un = u.toLowerCase().replace(/[.\-_]/g, "");
  const gu = (preferredUsername ?? "").toLowerCase().replace(/[.\-_]/g, "");
  if (gu && (gu === un || gu.includes(un))) return { verified: true, reason: "username" };
  const disp = (displayName ?? "").trim().toLowerCase();
  if (disp && un.length >= 4 && disp.includes(un)) return { verified: true, reason: "ism" };
  return { verified: false, reason: "yo'q" };
}

async function gravatarEmailProbe(u: string): Promise<SearchResultItem[]> {
  const cands = EMAIL_DISCOVERY_PROVIDERS.map((d) => `${u}@${d}`);
  const md5s = new Map(
    cands.map((e) => [e, createHash("md5").update(e.toLowerCase()).digest("hex")])
  );
  const hits: GravatarProbeHit[] = [];
  const CONC = 5;
  for (let i = 0; i < cands.length; i += CONC) {
    const slice = cands.slice(i, i + CONC);
    const codes = await Promise.all(
      slice.map(async (e) => {
        try {
          const res = await fetch(`https://www.gravatar.com/avatar/${md5s.get(e)}?d=404`, {
            headers: { "User-Agent": UA, Accept: "*/*" },
            signal: timeout(6000),
            redirect: "follow",
          });
          return res.status;
        } catch {
          return 0;
        }
      })
    );
    slice.forEach((e, j) => {
      if (codes[j] === 200) hits.push({ email: e, md5: md5s.get(e)! });
    });
    if (i + CONC < cands.length) await new Promise((r) => setTimeout(r, 300)); // yumshoq pauza
  }

  if (hits.length === 0) {
    return [
      item(
        "Email kashf qilish: mashhur provayderlarda mos email topilmadi",
        `https://gravatar.com/${encodeURIComponent(u)}`,
        `${EMAIL_DISCOVERY_PROVIDERS.length} ta mashhur provayder (gmail, proton, outlook, yandex...) ${u}@... ko'rinishida Gravatar bazasida tekshirildi — faol akkaunt yo'q. Bu odam asosiy emailini ochiq gravatar'da bog'lamagan bo'lishi mumkin.`,
        "gravatar.com"
      ),
    ];
  }

  // Har topilgan email uchun profil solishtirish
  const out: SearchResultItem[] = [];
  for (const h of hits.slice(0, 6)) {
    const prof = await fj<{ entry?: GravatarEntry[] }>(
      `https://en.gravatar.com/${h.md5}.json`,
      7000
    );
    const e = prof?.entry?.[0];
    const verified = assessGravatarMatch(u, e?.preferredUsername, e?.displayName).verified;
    const accounts = (e?.accounts ?? [])
      .map((a) => a.shortname)
      .filter(Boolean)
      .slice(0, 6)
      .join(", ");
    out.push(
      item(
        verified
          ? `Email TASDIQLANDI: ${h.email}`
          : `Email kandidat: ${h.email}`,
        `https://gravatar.com/${encodeURIComponent(e?.preferredUsername ?? u)}`,
        [
          verified
            ? "Gravatar profili username/ism bilan MOS KELDI — bu email ko'pincha shu odamniki (Gravatar har email uchun yagona hash asosida ishlaydi, boshqa odam bo'lishi deyarli imkonsiz)"
            : "Gravatar akkaunti faol — email mavjud, ammo profil ismi mos kelmadi (boshqa odam yoki eski username bo'lishi mumkin)",
          e?.displayName ? `Ism: ${e.displayName}` : "",
          e?.currentLocation ? `Lokatsiya: ${e.currentLocation}` : "",
          e?.aboutMe ? `Bio: ${e.aboutMe.slice(0, 140)}` : "",
          accounts ? `Bog'langan akkauntlar: ${accounts}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        "gravatar.com"
      )
    );
  }
  return out;
}

async function githubDeepSource(u: string): Promise<SearchResultItem[]> {
  const j = await fj<{
    login?: string;
    name?: string;
    email?: string;
    blog?: string;
    twitter_username?: string;
    location?: string;
    created_at?: string;
    company?: string;
    bio?: string;
    followers?: number;
  }>(`https://api.github.com/users/${encodeURIComponent(u)}`, 8000, {
    Accept: "application/vnd.github+json",
  });
  if (!j?.login) return []; // 404 / rate-limit — jimgina
  const out: SearchResultItem[] = [
    item(
      `GitHub chuqur profil: ${j.name ?? j.login}`,
      `https://github.com/${j.login}`,
      [
        j.email ? `Public email: ${j.email} — profil ochiq ko'rsatgan!` : "",
        j.blog ? `Sayt/blog: ${j.blog}` : "",
        j.twitter_username ? `Twitter/X: @${j.twitter_username}` : "",
        j.company ? `Kompaniya: ${j.company}` : "",
        j.location ? `Lokatsiya: ${j.location}` : "",
        j.created_at ? `GitHub'ga qo'shilgan: ${j.created_at.slice(0, 10)}` : "",
        j.followers !== undefined ? `${j.followers} obunachi` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Profil mavjud",
      "github.com"
    ),
  ];
  return out;
}

async function keybaseDeepSource(u: string): Promise<SearchResultItem[]> {
  const j = await fj<{
    them?: {
      profile?: { full_name?: string; bio?: string; location?: string };
      proofs_summary?: { by_presentation_group?: Record<string, unknown> };
    };
  }>(`https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(u)}`, 8000);
  const t = j?.them;
  if (!t || (t.profile === undefined && !t.proofs_summary)) return [];
  const proofs = Object.keys(t.proofs_summary?.by_presentation_group ?? {}).filter(
    (k) => k !== "null"
  );
  if (!t.profile && proofs.length === 0) return [];
  return [
    item(
      `Keybase profili: ${t.profile?.full_name ?? u}`,
      `https://keybase.io/${encodeURIComponent(u)}`,
      [
        t.profile?.full_name ? `Ism: ${t.profile.full_name}` : "",
        t.profile?.bio ? `Bio: ${t.profile.bio.slice(0, 120)}` : "",
        t.profile?.location ? `Lokatsiya: ${t.profile.location}` : "",
        proofs.length ? `Tasdiqlangan akkauntlar: ${proofs.slice(0, 8).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Profil mavjud",
      "keybase.io"
    ),
  ];
}

async function steamDeepSource(u: string): Promise<SearchResultItem[]> {
  const r = await fstatus(`https://steamcommunity.com/id/${encodeURIComponent(u)}`, 8000, 120_000);
  if (!r || r.status !== 200) return [];
  const title = (r.text.match(/<title>Steam Community :: ([^<]+)<\/title>/)?.[1] ?? "").trim();
  if (!title || /error/i.test(title)) return [];
  const realName = decodeHtml(
    (r.text.match(/profile_real_name">([^<]+)</)?.[1] ?? "").trim()
  );
  const flag = (r.text.match(/countryflags\/([A-Za-z]{2})\.gif/)?.[1] ?? "").toUpperCase();
  const level = (r.text.match(/friendPlayerLevel(?:\s|\w)*\D*(\d+)/)?.[1] ?? "").trim();
  const summary = (r.text.match(/header_summary[^>]*>([^<]*)</)?.[1] ?? "").trim();
  if (!realName && !flag && !level) return [];
  return [
    item(
      `Steam profili: ${decodeHtml(title)}`,
      `https://steamcommunity.com/id/${encodeURIComponent(u)}`,
      [
        realName ? `Haqiqiy ism: ${realName} — Steam real name ommaviy!` : "",
        flag ? `Davlat: ${flag} (bayroq belgisidan)` : "",
        level ? `Daraja: ${level}` : "",
        summary ? decodeHtml(summary).slice(0, 120) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      "steamcommunity.com"
    ),
  ];
}

/** Asosiy modul — 4 manba parallel: Gravatar email probasi + GitHub + Keybase + Steam */
async function emailDiscoverySource(rawTarget: string): Promise<SearchResultItem[]> {
  const u = rawTarget.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(u)) return [];
  const [grav, gh, kb, steam] = await Promise.allSettled([
    gravatarEmailProbe(u),
    githubDeepSource(u),
    keybaseDeepSource(u),
    steamDeepSource(u),
  ]);
  const take = (x: PromiseSettledResult<SearchResultItem[]>) =>
    x.status === "fulfilled" ? x.value : [];
  return [...take(grav), ...take(gh), ...take(kb), ...take(steam)];
}

// ===== Telefon: razvedka (libphonenumber — offline, bloklanmaydi) =====

const UZ_OPERATORS: [string, string][] = [
  ["20", "Humans"], ["33", "Beeline"], ["88", "Humans / Uztelecom"],
  ["90", "Ucell"], ["91", "Ucell"], ["93", "Mobiuz"], ["94", "Mobiuz"],
  ["95", "Mobiuz / Uzmobile"], ["97", "Uzmobile (Uztelecom)"], ["99", "Uzmobile (Uztelecom)"],
];

const PHONE_TYPE_UZ: Record<string, string> = {
  MOBILE: "mobil telefon",
  FIXED_LINE: "qotirilgan liniya",
  FIXED_LINE_OR_MOBILE: "mobil/qotirilgan liniya",
  TOLL_FREE: "bepul raqam (8-800)",
  PREMIUM_RATE: "pullik premium raqam",
  VOIP: "VoIP (internet-telefoniya)",
  PERSONAL: "shaxsiy raqam",
  PAGER: "peyjer",
  UAN: "universal raqam",
  SHARED_COST: "bo'linadigan to'lov",
  VOICEMAIL: "ovozli pochta",
};

async function phoneMetaSource(rawTarget: string): Promise<SearchResultItem[]> {
  let input = rawTarget.replace(/[\s().-]/g, "").trim();
  if (!input.startsWith("+")) input = `+${input.replace(/^8(?=9\d{9}$)/, "7")}`; // 8...RU format → +7
  const p = parsePhoneNumberFromString(input);
  if (!p || !p.isValid()) {
    return [
      item(
        "Raqam haqiqiy emas",
        "https://libphonenumber.appspot.com/phonenumberparser?number=" + encodeURIComponent(rawTarget),
        `"${rawTarget}" xalqaro formatga mos kelmadi — mamlakat kodi bilan kiriting (masalan +998901234567).`,
        "libphonenumber"
      ),
    ];
  }
  const typeUz = p.getType() ? (PHONE_TYPE_UZ[p.getType() ?? ""] ?? p.getType()) : "aniqlanmadi";
  const facts = [
    `Mamlakat: ${p.country ?? "?"} (+${p.countryCallingCode})`,
    `Tur: ${typeUz}`,
    `Xalqaro: ${p.formatInternational()}`,
    `Milliy: ${p.formatNational()}`,
    `E.164: ${p.number}`,
  ];
  if (p.country === "UZ") {
    const pref = p.nationalNumber.slice(0, 2);
    const op = UZ_OPERATORS.find(([c]) => c === pref)?.[1];
    if (op) facts.push(`Operator kodi ${pref}: ${op} (portatsiya mumkin)`);
  }
  return [
    item(
      `Telefon razvedka: ${p.country ?? "?"} — ${typeUz}`,
      `https://www.sync.me/search/?number=${encodeURIComponent(p.number)}`,
      `${facts.join(" | ")} | Raqam format bo'yicha haqiqiy — egasi haqida sync.me va qidiruv tizimlarida tekshiring.`,
      "sync.me"
    ),
  ];
}

// ===== Ism-familiya: DuckDuckGo Knowledge Graph (Vikipediya asosidagi ma'lumotnoma) =====
/**
 * QAYD: Wikimedia API'ları (wikipedia/wikidata) server TLS barmoq iziga qarab
 * 403 qaytaradi (curl o'tadi, Node fetch o'tmaydi) — shuning uchun shaxs
 * ma'lumotnomasi DDG rasmiy Instant Answer API'si orqali olinadi: u Vikipediya
 * abstract/infobox ma'lumotlarini bepul, kalitsiz qaytaradi.
 */

interface DdgIaResp {
  Heading?: string;
  Abstract?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Infobox?: { content?: { label?: string; value?: string }[] };
  Answer?: string;
  Definition?: string;
  DefinitionURL?: string;
}

async function wikiPeopleSource(rawTarget: string): Promise<SearchResultItem[]> {
  const q = rawTarget.trim().slice(0, 80);
  if (q.length < 3) return [];
  const r = await fj<DdgIaResp>(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
    8000
  );
  if (!r) return [];
  const out: SearchResultItem[] = [];
  if (r.Heading && (r.Abstract || r.Definition)) {
    const infoboxFacts = (r.Infobox?.content ?? [])
      .filter((c) => c.label && c.value)
      .slice(0, 6)
      .map((c) => `${c.label}: ${c.value}`);
    const abstract = (r.Abstract || r.Definition || "").slice(0, 280);
    out.push(
      item(
        `Ma'lumotnoma: ${r.Heading}`,
        r.AbstractURL || r.DefinitionURL || `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
        [
          abstract,
          infoboxFacts.length ? infoboxFacts.join(" | ") : "",
          r.AbstractSource ? `Manba: ${r.AbstractSource}` : "",
        ]
          .filter(Boolean)
          .join(" — "),
        "duckduckgo.com"
      )
    );
  }
  return out;
}

// ===== Email → Username transformi (Maltego uslubi) =====
/**
 * Email lokal qismi (@dan oldingi) ko'pincha odamning asosiy username'i hamdir:
 *   durov@gmail.com → "durov" → t.me/durov, github.com/durov...
 * Bu transform lokal qismni 12 platformada JONLI tekshiradi — Task 24'dagi
 * verify-first prinsipi: faqat HAQIQAT mavjud profillar qoladi, yo'qlar
 * olib tashlanadi. Ishonch: 100% jonli HTTP javobi.
 */
export async function emailUsernameSource(rawTarget: string): Promise<SearchResultItem[]> {
  const em = parseEmail(rawTarget);
  if (!em) return [];
  const local = em.local
    .replace(/\d+$/, "") // oxiridagi raqamlar (dilshod97 → dilshod) — variant
    .replace(/[._-]+$/, "")
    .trim();
  // Juda umumiy lokal qismlar (info/admin/support) — odamga tegishli emas
  if (local.length < 3 || /^(info|admin|support|contact|help|mail|sales|office)$/.test(local)) {
    return [];
  }
  const candidates = [...new Set([em.local, local])].filter((c) => c.length >= 3);
  const out: SearchResultItem[] = [];
  for (const cand of candidates.slice(0, 2)) {
    try {
      const v = await verifyProfileLinks(cand);
      // Faqat TASDIQLANGAN profillar — aniqlanmaganlar ham shovqin bo'ladi
      for (const it of v.items) {
        if (it.verified !== "yes") continue;
        out.push({
          ...it,
          name: it.name.replace(`@${cand}`, `@${cand} (email'dan)`),
          snippet: `Email lokal qismi "${cand}" bu platformada HAQIQIY profil topildi. ${it.snippet}`,
        });
      }
    } catch {
      /* tekshiruv bajarilmadi — o'tkazamiz */
    }
  }
  return out;
}

// ===== Manbalar ro'yxati =====

export interface DirectSourceDef {
  id: string;
  /** onProgress — og'ir manbalar (WhatsMyName) jonli progress log uchun */
  run: (target: string, onProgress?: WmnProgressCb) => Promise<SearchResultItem[]>;
}

export const DIRECT_RUNS: Record<
  string,
  (target: string, onProgress?: WmnProgressCb) => Promise<SearchResultItem[]>
> = {
  // Domen
  dns: dnsSource,
  whois: rdapDomainSource,
  subdomains: subdomainsSource,
  "site-probe": siteProbeSource,
  recon: reconSource,
  "company-signals": companySignalsSource,
  // IP
  "ip-intel": ipIntelSource,
  "whois-ip": rdapIpSource,
  "ptr-recon": ptrReconSource,
  // Email
  breaches: breachesSource,
  "stealer-logs": hudsonRockSource,
  leakcheck: leakCheckSource,
  gravatar: gravatarSource,
  mailbox: mailboxSource,
  "corp-domain": corpDomainSource,
  "github-email": githubSource,
  "email-username": emailUsernameSource,
  // Username / Telefon / Ism
  whatsmyname: whatsMyNameSource,
  "username-probe": usernameProbeSource,
  "email-discovery": emailDiscoverySource,
  "phone-meta": phoneMetaSource,
  "wiki-people": wikiPeopleSource,
  // Telegram — Instant Messaging manbalari (API kaliti shart emas, Bot API kalitli)
  telegram: telegramProfileSource,
  "telegram-feed": telegramFeedSource,
  "telegram-bot": telegramBotApiSource,
  "telegram-mentions": telegramMentionsSource,
  // Maltego uslubidagi transformlar (email/ism → bog'liq domenlar; otx premium'da)
  "reverse-whois": reverseWhoisSource,
  // Premium (API kalitli) manbalar — .env'dagi kalitlar bilan faollashadi
  ...PREMIUM_RUNS,
};

// Kalitli (premium) qidiruv dvigatellari — barcha maqsad turlarida ishlaydi
const PREMIUM_SEARCH_IDS = ["serper", "brave-api", "google-cse", "tavily"];

export function directSourceIdsFor(type: TargetType): string[] {
  return type === "company"
    ? ["company-signals", "whois", "dns", "subdomains", "site-probe", "recon", ...PREMIUM_SEARCH_IDS]
    : type === "domain"
    ? ["dns", "whois", "subdomains", "site-probe", "recon", "company-signals", "shodan", "hunter", "otx", ...PREMIUM_SEARCH_IDS]
    : type === "ip"
      ? ["ip-intel", "whois-ip", "ptr-recon", "shodan", "ipinfo", "otx", ...PREMIUM_SEARCH_IDS]
      : type === "email"
        ? ["breaches", "stealer-logs", "leakcheck", "gravatar", "mailbox", "corp-domain", "github-email", "email-username", "hibp", "hunter", "reverse-whois", "email-score", ...PREMIUM_SEARCH_IDS]
        : type === "username"
          ? ["stealer-logs", "whatsmyname", "username-probe", "email-discovery", "telegram", "telegram-feed", "telegram-bot", "telegram-mentions", ...PREMIUM_SEARCH_IDS]
          : type === "phone"
            ? ["phone-meta", "numlookup", ...PREMIUM_SEARCH_IDS]
            : type === "name"
              ? ["wiki-people", "reverse-whois", ...PREMIUM_SEARCH_IDS]
              : [];
}
