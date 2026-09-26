#!/usr/bin/env node
/**
 * OSINT Radar — tashxis (diagnostika)
 *   npm run doctor
 *
 * Lokal mashinada qidiruv ishlamasa, shu skript aynan nima buzilganini
 * ko'rsatadi: Node versiyasi, kod versiyasi, DNS, har bir qidiruv
 * dvigateli alohida tekshiriladi va xulosa chiqariladi.
 */

const c = {
  reset: "\x1b[0m",
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

const UA_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": opts.ua ?? UA_FIREFOX,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ===== Minimal dvigatel testlari (ilovadagi parse bilan bir xil mantiq) =====

async function ddg(q) {
  const h = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  if (/anomaly|challenge|blocked/i.test(h.slice(0, 2000))) throw new Error("DDG blok");
  return (h.match(/class="[^"]*result__a/g) ?? []).length;
}
async function ddgLite(q) {
  const h = await fetchHtml(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
  if (/anomaly|challenge|blocked/i.test(h.slice(0, 2000))) throw new Error("DDG blok");
  return (h.match(/result-link/g) ?? []).length;
}
async function mojeek(q) {
  const h = await fetchHtml(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`, {
    ua: UA_CHROME,
    headers: {
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      Referer: "https://www.mojeek.com/",
    },
  });
  return (h.match(/<h2[^>]*><a[^>]+href="https?:\/\//g) ?? []).length;
}
async function brave(q) {
  const h = await fetchHtml(`https://search.brave.com/search?q=${encodeURIComponent(q)}`, {
    ua: UA_CHROME,
    headers: {
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  });
  if (/captcha/i.test(h.slice(0, 4000))) throw new Error("captcha");
  return (h.match(/heading-serpresult/g) ?? []).length;
}
async function qwant(q) {
  const h = await fetchHtml(
    `https://api.qwant.com/v3/search/web?q=${encodeURIComponent(q)}&count=10&locale=en_US&offset=0&device=desktop&safesearch=1`,
    { ua: UA_CHROME, headers: { Accept: "application/json", Referer: "https://www.qwant.com/", Origin: "https://www.qwant.com" } }
  );
  const j = JSON.parse(h);
  const groups = j?.data?.result?.items?.mainline?.data ?? [];
  return groups.reduce((a, g) => a + (g.items?.length ?? 0), 0);
}
async function bing(q) {
  const h = await fetchHtml(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10&mkt=en-US&setlang=en`);
  return (h.match(/<li class="b_algo/g) ?? []).length;
}
async function gnews(q) {
  const h = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { ua: UA_CHROME });
  return (h.match(/<item>/g) ?? []).length;
}
async function bnews(q) {
  const h = await fetchHtml(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`);
  return (h.match(/<item>/g) ?? []).length;
}
async function searx(q) {
  // paulgo.io — server tomonda to'liq render qilinadigan instans (2025-09 tekshirildi)
  for (const inst of ["https://paulgo.io", "https://searx.tiekoetter.com", "https://searx.be"]) {
    try {
      const h = await fetchHtml(`${inst}/search?q=${encodeURIComponent(q)}`, { ua: UA_CHROME, timeoutMs: 7000 });
      // yangi markup: <article class="result..."> ... <h3><a href=
      let n = (h.match(/<article[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<h3[^>]*><a[^>]+href="https?:\/\//g) ?? []).length;
      if (n === 0) n = (h.match(/<h3[^>]*><a[^>]+href="https?:\/\//g) ?? []).length; // eskicha markup
      if (n > 0) return n;
    } catch {
      /* keyingi instans */
    }
  }
  throw new Error("hech bir instans javob bermadi");
}
async function marginalia(q) {
  const h = await fetchHtml(
    `https://api.marginalia.nu/public/search/${encodeURIComponent(q)}`,
    { ua: UA_CHROME, timeoutMs: 6000, headers: { Accept: "application/json" } }
  );
  const j = JSON.parse(h);
  return (j?.results ?? []).filter((r) => r.url).length;
}

const ENGINES = [
  ["DuckDuckGo", ddg],
  ["DuckDuckGo Lite", ddgLite],
  ["Bing", bing],
  ["Google Yangiliklar", gnews],
  ["Bing Yangiliklar", bnews],
  ["SearXNG", searx],
  ["Marginalia", marginalia],
  ["Mojeek", mojeek],
  ["Brave", brave],
  ["Qwant", qwant],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n${c.bold(c.cyan("OSINT Radar — tashxis"))}`);
  console.log(`${c.gray("=".repeat(52))}\n`);

  let allOk = true;
  const working = [];

  // 1) Node
  const major = parseInt(process.versions.node.split(".")[0], 10);
  const nodeOk = major >= 18;
  console.log(
    `  ${nodeOk ? c.green("[OK]") : c.red("[XATO]")} Node.js: ${process.versions.node}${
      nodeOk ? "" : ` — ${c.red("juda eskirgan, fetch yo'q. Node 20+ o'rnating!")}`
    }`
  );
  if (!nodeOk) {
    console.log(`\n  ${c.red("Eski Node bilan davom etishning foydasi yo'q — avval Node o'rnating.")}`);
    process.exit(1);
  }

  // 2) Kod versiyasi
  const fs = await import("node:fs");
  const path = await import("node:path");
  let codeOk = false;
  try {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "search-engines.ts"), "utf-8");
    codeOk = src.includes("multi-10-engines");
  } catch {
    /* yo'q */
  }
  console.log(
    `  ${codeOk ? c.green("[OK]") : c.red("[XATO]")} Kod versiyasi: ${
      codeOk
        ? "yangi (multi-10-engines)"
        : `${c.red("eskirgan — \"git pull\" qiling!")}`
    }`
  );

  // 3) .env
  let envVal = null;
  try {
    const env = fs.readFileSync(path.join(process.cwd(), ".env"), "utf-8");
    const m = env.match(/^SEARCH_ENGINE=(.*)$/m);
    if (m) envVal = m[1].trim();
  } catch {
    /* .env yo'q */
  }
  console.log(
    `  ${c.cyan("[INFO]")} SEARCH_ENGINE: ${envVal ?? "o'rnatilmagan (auto rejim)"}`
  );

  // 4) DNS
  const dnsmod = await import("node:dns/promises");
  const dnsTargets = ["www.bing.com", "html.duckduckgo.com", "search.brave.com"];
  let dnsOk = 0;
  for (const t of dnsTargets) {
    try {
      await Promise.race([
        dnsmod.lookup(t),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      dnsOk++;
    } catch {
      /* fail */
    }
  }
  console.log(
    `  ${dnsOk === 3 ? c.green("[OK]") : dnsOk > 0 ? c.yellow("[OGOHLANTIRISH]") : c.red("[XATO]")} DNS: ${dnsOk}/${dnsTargets.length} doman tarjima qilindi${
      dnsOk === 0 ? ` — ${c.red("internet yoki DNS buzilgan (8.8.8.8 ni sinang)")}` : ""
    }`
  );

  // 5) Dvigatellar
  console.log(`\n${c.bold("Qidiruv dvigatellari (har biri real so'rov bilan):")}\n`);
  for (const [label, fn] of ENGINES) {
    const t0 = Date.now();
    try {
      const n = await fn("Tashkent");
      const ms = Date.now() - t0;
      if (n > 0) {
        working.push(label);
        console.log(`  ${c.green("[ISHLAYAPTI]")} ${label.padEnd(20)} ${String(n).padStart(3)} natija  ${c.gray(`${ms}ms`)}`);
      } else {
        console.log(`  ${c.yellow("[BO'SH]")} ${label.padEnd(20)} javob bor, natija yo'q (blok)  ${c.gray(`${ms}ms`)}`);
      }
    } catch (e) {
      const ms = Date.now() - t0;
      console.log(`  ${c.red("[MUAMMO]")} ${label.padEnd(20)} ${String(e).slice(0, 46).padEnd(46)}  ${c.gray(`${ms}ms`)}`);
    }
    await sleep(500);
  }

  // Xulosa
  console.log(`\n${c.gray("=".repeat(52))}`);
  if (working.length === 0) {
    allOk = false;
    console.log(`\n${c.bold(c.red("Hech bir dvigatel javob bermadi."))} Tekshiring:`);
    console.log(`  1. Internet: ${c.cyan("curl -I https://www.bing.com")}`);
    console.log(`  2. DNS'ni 8.8.8.8 ga o'tkazing yoki routeringizni qayta yoqing`);
    console.log(`  3. VPN/Proksi yoqilganini tekshiring (Kali'da proksi o'zgaruvchilari)`);
    console.log(`  4. 5-10 daqiqa kutib qayta sinang — dvigatellar vaqtinchalik blok qo'yadi`);
  } else {
    console.log(`\n${c.green(c.bold(`Ishlayotgan dvigatellar: ${working.join(", ")}`))}`);
    console.log(`  Skaner shu dvigatellar orqali ishlaydi — bemalol foydalaning.`);
    if (working.length < 3) {
      console.log(`  ${c.yellow("Biroz dvigatel bloklangan — sekinroq ishlaydi, biroz kuting.")}`);
    }
  }
  console.log(`\n${c.gray("Maslahat: .env faylida SEARCH_ENGINE=open yozsangiz, Z.ai'ni umuman tekshirmaydi (tezlashadi).")}\n`);
  process.exit(allOk ? 0 : 0);
}

main().catch((e) => {
  console.error(`${c.red(`Tashxis xatosi: ${e.message}`)}`);
  process.exit(1);
});
