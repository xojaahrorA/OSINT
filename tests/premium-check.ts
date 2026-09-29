// Premium manbalar + yangi telefon izlari moduli testi (jiti bilan ishga tushiriladi)
//   npx jiti -e 'import("./src/lib/premium-sources")' o'rniga to'g'ridan-to'g'ri:
//   npx jiti tests/premium-check.ts
import {
  PREMIUM_SOURCES,
  premiumKeySet,
  premiumMissing,
  PREMIUM_RUNS,
} from "@/lib/premium-sources";
import { DIRECT_RUNS, directSourceIdsFor } from "@/lib/osint-sources";
import { OSINT_MODULES } from "@/lib/osint";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
};

console.log("=== 1. Premium metalar ===");
ok(PREMIUM_SOURCES.length === 11, `11 ta premium manba aniqlangan (${PREMIUM_SOURCES.length})`);
ok(
  PREMIUM_SOURCES.every((s) => s.envKey && s.getKeyUrl && s.what),
  "har bir meta envKey/getKeyUrl/what maydonlariga ega"
);

console.log("=== 2. Kalit holati (env bo'sh — hammasi missing) ===");
const missing = premiumMissing();
ok(missing.length === 11, `kalitsizlar ro'yxati 11 ta (${missing.length})`);
ok(PREMIUM_SOURCES.every((s) => !premiumKeySet(s.id)), "env bo'sh — premiumKeySet false");

console.log("=== 3. DIRECT_RUNS'ga ulanganligi ===");
for (const s of PREMIUM_SOURCES) {
  ok(typeof DIRECT_RUNS[s.id] === "function", `DIRECT_RUNS["${s.id}"] funksiya`);
}

console.log("=== 4. directSourceIdsFor premium id'larni qaytaradi ===");
const emailIds = directSourceIdsFor("email");
ok(emailIds.includes("hibp") && emailIds.includes("hunter"), "email: hibp + hunter bor");
const phoneIds = directSourceIdsFor("phone");
ok(phoneIds.includes("numlookup"), "phone: numlookup bor");
const ipIds = directSourceIdsFor("ip");
ok(ipIds.includes("ipinfo") && ipIds.includes("shodan"), "ip: ipinfo + shodan bor");
ok(ipIds.includes("otx"), "ip: otx (Maltego transformi) bor");
const emIds = directSourceIdsFor("email");
ok(
  emIds.includes("reverse-whois"),
  "email: reverse-whois (Maltego transformi) bor"
);
const nmIds = directSourceIdsFor("name");
ok(nmIds.includes("reverse-whois"), "name: reverse-whois bor");
const unIds = directSourceIdsFor("username");
ok(
  ["telegram", "telegram-feed", "telegram-bot"].every((x) => unIds.includes(x)),
  "username: telegram modullari ro'yxatda"
);
for (const t of ["username", "email", "phone", "name", "domain", "ip"] as const) {
  const ids = directSourceIdsFor(t);
  ok(
    ["serper", "brave-api", "google-cse", "tavily"].every((x) => ids.includes(x)),
    `${t}: kalitli qidiruv dvigatellari (serper/brave/cse/tavily) ro'yxatda`
  );
}

console.log("=== 5. Telefon izlari moduli formatlari ===");
const pt = OSINT_MODULES.find((m) => m.id === "phone-trace");
ok(!!pt, "phone-trace moduli mavjud");
if (pt) {
  const qs = pt.queries("+998 90 123 45 67");
  ok(qs.length >= 3, `3+ ta so'rov generatsiya qilindi (${qs.length})`);
  ok(qs[0]?.includes("+998901234567"), `E.164 format bor: "${qs[0]?.slice(0, 40)}..."`);
  ok(qs[0]?.includes("90 123 45 67"), `milliy format bor: "${qs[0]?.slice(0, 60)}..."`);
  const qs2 = pt.queries("901234567");
  ok(qs2[0]?.includes("+998901234567"), "9 xonali kirish ham E.164 ga normalizatsiya qilindi");
  const qs3 = pt.queries("+79261234567");
  ok(qs3[0]?.includes("+79261234567"), "RU raqami ham to'g'ri");
}

console.log("=== 6. Premium source — kalit yo'q = [] (xato tashlamaydi) ===");
const noKeyResults = await Promise.all([
  PREMIUM_RUNS.serper("test user"),
  PREMIUM_RUNS["brave-api"]("test user"),
  PREMIUM_RUNS.tavily("test user"),
  PREMIUM_RUNS.hibp("test@example.com"),
  PREMIUM_RUNS.hunter("example.com"),
  PREMIUM_RUNS.shodan("8.8.8.8"),
  PREMIUM_RUNS.numlookup("+998901234567"),
  PREMIUM_RUNS.ipinfo("8.8.8.8"),
  PREMIUM_RUNS.otx("example.com"),
]);
ok(
  noKeyResults.every((r) => Array.isArray(r) && r.length === 0),
  "kalit yo'qida hammasi bo'sh ro'yxat qaytardi (skaner to'xtamaydi)"
);

console.log("=== 7. Telegram modullari ===");
ok(typeof DIRECT_RUNS.telegram === "function", "DIRECT_RUNS.telegram funksiya");
ok(typeof DIRECT_RUNS["telegram-feed"] === "function", "DIRECT_RUNS['telegram-feed'] funksiya");
ok(typeof DIRECT_RUNS["telegram-bot"] === "function", "DIRECT_RUNS['telegram-bot'] funksiya");
const tgSearch = OSINT_MODULES.find((m) => m.id === "telegram-search");
ok(!!tgSearch, "telegram-search moduli mavjud");
ok(tgSearch?.queries("durov")[0]?.includes("site:t.me") ?? false, "telegram-search: site:t.me so'rovi");
// kalit yo'qida telegram-bot bo'sh ro'yxat qaytaradi (xato tashlamaydi)
const tgNoKey = await DIRECT_RUNS["telegram-bot"]("durov");
ok(Array.isArray(tgNoKey) && tgNoKey.length === 0, "telegram-bot: kalit yo'q — bo'sh ro'yxat");

// Faqat CSE — ikkala kalit kerakligi alohida test
process.env.GOOGLE_CSE_KEY = "fake";
ok(!premiumKeySet("google-cse"), "CSE: faqat KEY bilan — hali ham yo'q");
process.env.GOOGLE_CSE_CX = "fakecx";
ok(premiumKeySet("google-cse"), "CSE: KEY+CX bilan faol");
process.env.SERPER_API_KEY = "fakeserper";
ok(premiumKeySet("serper"), "SERPER_API_KEY bilan serper faol");

console.log(`\nNatija: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
