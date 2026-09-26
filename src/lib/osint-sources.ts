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

/** Foydalanuvchi kiritgan narsadan toza domen ajratadi (URL bo'lsa ham) */
export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
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

// ===== Email: ma'lumot oqishlari (XposedOrNot) =====

interface XonCheck {
  breaches?: string[][];
}
interface XonAnalytics {
  BreachMetrics?: {
    risk?: { risk_label?: string; risk_score?: number }[];
    passwords_strength?: Record<string, number> | Record<string, number>[];
  };
}

async function breachesSource(rawTarget: string): Promise<SearchResultItem[]> {
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
        "Qolgan 600+ saytni whatsmyname.app bilan tekshirish mumkin",
      ]
        .filter(Boolean)
        .join(" | "),
      "whatsmyname.app"
    )
  );
  return out;
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

// ===== Manbalar ro'yxati =====

export interface DirectSourceDef {
  id: string;
  run: (target: string) => Promise<SearchResultItem[]>;
}

export const DIRECT_RUNS: Record<string, (target: string) => Promise<SearchResultItem[]>> = {
  // Domen
  dns: dnsSource,
  whois: rdapDomainSource,
  subdomains: subdomainsSource,
  "site-probe": siteProbeSource,
  recon: reconSource,
  // IP
  "ip-intel": ipIntelSource,
  "whois-ip": rdapIpSource,
  "ptr-recon": ptrReconSource,
  // Email
  breaches: breachesSource,
  gravatar: gravatarSource,
  mailbox: mailboxSource,
  "corp-domain": corpDomainSource,
  "github-email": githubSource,
  // Username / Telefon / Ism
  "username-probe": usernameProbeSource,
  "phone-meta": phoneMetaSource,
  "wiki-people": wikiPeopleSource,
};

export function directSourceIdsFor(type: TargetType): string[] {
  return type === "domain"
    ? ["dns", "whois", "subdomains", "site-probe", "recon"]
    : type === "ip"
      ? ["ip-intel", "whois-ip", "ptr-recon"]
      : type === "email"
        ? ["breaches", "gravatar", "mailbox", "corp-domain", "github-email"]
        : type === "username"
          ? ["username-probe"]
          : type === "phone"
            ? ["phone-meta"]
            : type === "name"
              ? ["wiki-people"]
              : [];
}
