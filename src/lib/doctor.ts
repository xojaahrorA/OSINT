import * as dns from "node:dns/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ddgHtmlSearch,
  ddgLiteSearch,
  mojeekSearch,
  braveSearch,
  qwantSearch,
  bingSearch,
  googleNewsRssSearch,
  bingNewsRssSearch,
  searxSearch,
  marginaliaSearch,
  isCoolingDown,
  cooldownMinutesLeft,
  SEARCH_ENGINES_VERSION,
} from "./search-engines";
import type { SearchResultItem } from "./osint";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
  ms?: number;
}

export interface DoctorReport {
  generatedAt: string;
  nodeVersion: string;
  searchEngineEnv: string | null;
  codeVersion: string | null;
  checks: DoctorCheck[];
  workingEngines: string[];
  recommendation: string;
}

type EngineFn = (query: string, num: number) => Promise<SearchResultItem[]>;

const ENGINES: { id: string; label: string; fn: EngineFn }[] = [
  { id: "ddg", label: "DuckDuckGo", fn: ddgHtmlSearch },
  { id: "ddg-lite", label: "DuckDuckGo Lite", fn: ddgLiteSearch },
  { id: "bing", label: "Bing", fn: bingSearch },
  { id: "gnews", label: "Google Yangiliklar", fn: googleNewsRssSearch },
  { id: "bnews", label: "Bing Yangiliklar", fn: bingNewsRssSearch },
  { id: "searx", label: "SearXNG", fn: searxSearch },
  { id: "marginalia", label: "Marginalia", fn: marginaliaSearch },
  { id: "mojeek", label: "Mojeek", fn: mojeekSearch },
  { id: "brave", label: "Brave", fn: braveSearch },
  { id: "qwant", label: "Qwant", fn: qwantSearch },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    ),
  ]);
}

async function dnsLookupSafe(host: string): Promise<string | null> {
  try {
    const r = await withTimeout(dns.lookup(host), 5000);
    return r.address;
  } catch {
    return null;
  }
}

export async function runDiagnostics(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. Node versiyasi (global fetch uchun >= 18 kerak)
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    id: "node",
    label: "Node.js versiyasi",
    status: nodeMajor >= 18 ? "ok" : "fail",
    detail:
      nodeMajor >= 18
        ? `Node ${process.versions.node} — global fetch mavjud`
        : `Node ${process.versions.node} — juda eskirgan (>=18 kerak, fetch yo'q). Node 20+ o'rnating.`,
  });

  // 2. Kod versiyasi — clone yangilanmagan bo'lsa diagnostika shuni ko'rsatadi
  let codeVersion: string | null = null;
  try {
    const src = await readFile(
      path.join(process.cwd(), "src", "lib", "search-engines.ts"),
      "utf-8"
    );
    codeVersion = src.includes(SEARCH_ENGINES_VERSION)
      ? SEARCH_ENGINES_VERSION
      : null;
    checks.push({
      id: "code",
      label: "Kod versiyasi",
      status: codeVersion ? "ok" : "fail",
      detail: codeVersion
        ? `Qidiruv dvigatellari moduli yangi versiyada (${SEARCH_ENGINES_VERSION})`
        : "src/lib/search-engines.ts eskirgan — 'git pull' qilib yangilang",
    });
  } catch {
    checks.push({
      id: "code",
      label: "Kod versiyasi",
      status: "fail",
      detail: "src/lib/search-engines.ts topilmadi — to'g'ri papkada ishga tushirilganini tekshiring",
    });
  }

  // 3. .env va SEARCH_ENGINE
  let searchEngineEnv: string | null = null;
  try {
    const env = await readFile(path.join(process.cwd(), ".env"), "utf-8");
    const m = env.match(/^SEARCH_ENGINE=(.*)$/m);
    searchEngineEnv = m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    /* .env yo'q — muhim emas, auto rejim ishlaydi */
  }
  checks.push({
    id: "env",
    label: "SEARCH_ENGINE sozlamasi",
    status: "ok",
    detail: searchEngineEnv
      ? `SEARCH_ENGINE=${searchEngineEnv}`
      : "O'rnatilmagan (auto rejim: Z.ai → ochiq dvigatellar)",
  });

  // 4. DNS
  const dnsTargets = ["www.bing.com", "html.duckduckgo.com", "search.brave.com"];
  const dnsResults = await Promise.all(dnsTargets.map(dnsLookupSafe));
  const dnsOk = dnsResults.filter(Boolean).length;
  checks.push({
    id: "dns",
    label: "DNS tarjimoni",
    status: dnsOk === 3 ? "ok" : dnsOk > 0 ? "warn" : "fail",
    detail:
      dnsOk === 0
        ? "Hech bir doman tarjima qilinmadi — internet ulanishi yoki DNS serverini tekshiring (8.8.8.8)"
        : `${dnsOk}/${dnsTargets.length} doman tarjima qilindi: ${dnsTargets
            .map((t, i) => `${t}=${dnsResults[i] ?? "xato"}`)
            .join(", ")}`,
  });

  // 5. Har bir dvigatelni real so'rov bilan tekshirish ( stagger bilan parallellashgan )
  const workingEngines: string[] = [];
  await Promise.all(
    ENGINES.map(async (e, idx) => {
      await sleep(idx * 300); // bir vaqtda yuborilmasligi uchun stagger
      const t0 = Date.now();
      try {
        const results = await withTimeout(e.fn("Tashkent", 5), 8000);
        const ms = Date.now() - t0;
        if (results.length > 0) {
          workingEngines.push(e.label);
          checks.push({
            id: `engine-${e.id}`,
            label: e.label,
            status: "ok",
            detail: `${results.length} natija — ishlayapti`,
            ms,
          });
        } else {
          checks.push({
            id: `engine-${e.id}`,
            label: e.label,
            status: "warn",
            detail: "Javob berdi, lekin 0 natija (blok yoki soxta javob filtri)",
            ms,
          });
        }
      } catch (err) {
        const msg = String(err).slice(0, 90);
        // Sovitish rejimi haqida qo'shimcha ma'lumot
        const cooling = isCoolingDown(e.label)
          ? ` (skanerda ${cooldownMinutesLeft(e.label)} daqiqagacha o'tkazib yuboriladi)`
          : "";
        checks.push({
          id: `engine-${e.id}`,
          label: e.label,
          status: "fail",
          detail: `${msg}${cooling}`,
          ms: Date.now() - t0,
        });
      }
    })
  );
  // Asl ro'yxat tartibiga qaytarish
  const order = new Map(ENGINES.map((e, i) => [`engine-${e.id}`, i]));
  checks.sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)
  );

  // 6. Xulosa
  let recommendation: string;
  if (nodeMajor < 18) {
    recommendation =
      "Node.js 20+ o'rnating (nodejs.org yoki nvm install 20) — eski Node'da fetch ishlamaydi.";
  } else if (workingEngines.length === 0) {
    recommendation =
      "Hech bir qidiruv dvigateli javob bermadi. (1) Internetni tekshiring, (2) Kali'da 'sudo systemctl restart networking' yoki VPN/Proksi sozlamalarini tekshiring, (3) DNS'ni 8.8.8.8 ga o'zgartiring, (4) Bir necha daqiqadan keyin qayta tekshiring — ba'zi dvigatellar vaqtinchalik blok qo'yadi.";
  } else if (workingEngines.length < 3) {
    recommendation = `Faol dvigatellar: ${workingEngines.join(", ")}. Skaner ular orqali ishlaydi, lekin bir nechta dvigatel bloklangan — oddiy rejimda sekinroq ishlaydi. Biroz kutib tursangiz, bloklar ochiladi.`;
  } else {
    recommendation = `Hammasi joyida — ${workingEngines.length} ta dvigatel ishlayapti (${workingEngines.slice(0, 4).join(", ")}${workingEngines.length > 4 ? "..." : ""}). Skaner bemalol ishlaydi.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.versions.node,
    searchEngineEnv,
    codeVersion,
    checks,
    workingEngines,
    recommendation,
  };
}
