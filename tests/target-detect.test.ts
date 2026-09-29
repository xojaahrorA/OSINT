// Maqsad turi aniqlash (detectTargetType) va qiymat tozalash (normalizeTargetValue)
// testlari — ko'p maqsadli batch rejimdagi noto'g'ri aniqlash xatolarining qopqog'i.
// Ishga tushirish: bun tests/target-detect.test.ts

import {
  OSINT_MODULES,
  detectTargetType,
  normalizeTargetValue,
  type TargetType,
} from "@/lib/osint";

let passed = 0;
let failed = 0;

function expectType(input: string, expected: TargetType, note = "") {
  const got = detectTargetType(input);
  if (got === expected) {
    passed++;
    console.log(`  ✓ "${input}" → ${got} ${note}`);
  } else {
    failed++;
    console.error(`  ✗ "${input}" → ${got}, kutilgan: ${expected} ${note}`);
  }
}

function expectValue(input: string, kind: TargetType, expected: string) {
  const got = normalizeTargetValue(kind, input);
  if (got === expected) {
    passed++;
    console.log(`  ✓ normalize("${input}", ${kind}) → "${got}"`);
  } else {
    failed++;
    console.error(`  ✗ normalize("${input}", ${kind}) → "${got}", kutilgan: "${expected}"`);
  }
}

console.log("=== 1. Username aniqlash — @belgisi va t.me havolalari ===");
expectType("durov", "username");
expectType("@durov", "username", "@ bilan — avval 'name' deb aniqlanardi");
expectType("@dilshod_dev", "username");
expectType("t.me/durov", "username", "t.me havolasi");
expectType("https://t.me/durov", "username");
expectType("https://t.me/s/durovcha", "username", "kanal web preview");
expectType("https://telegram.me/someuser", "username");
expectType("dilshod.dev", "domain", "nuqtali — haqiqiy domen formati");

console.log("=== 2. Telefon aniqlash — '+' siz ham ===");
expectType("+998901234567", "phone");
expectType("998901234567", "phone", "+ siz — avval 'name' deb aniqlanardi");
expectType("+998 90 123 45 67", "phone", "probelli format");
expectType("998 90 123 45 67", "phone", "+siz probelli");
expectType("8 901 234 56 78", "phone", "RU formati");
expectType("(+998) 90-123-45-67", "phone", "qavs va tire bilan");
expectType("901234567", "phone", "9 xonali mahalliy");

console.log("=== 3. IP — nuqtalar telefon formatiga o'xshaydi ===");
expectType("8.8.8.8", "ip");
expectType("192.168.1.100", "ip", "avval telefon deb aniqlanardi (10 xona)!");

console.log("=== 4. Email / Domen / Ism ===");
expectType("info@example.uz", "email");
expectType("example.uz", "domain");
expectType("https://example.uz", "domain", "URL protokoli bilan");
expectType("https://instagram.com/durov", "username", "platforma profil URL'i");
expectType("https://github.com/dilshoddev", "username", "GitHub profil URL'i");
expectType("Pavel Durov", "name");
expectType("Muhammad Karimov", "name");

console.log("=== 5. normalizeTargetValue ===");
expectValue("@durov", "username", "durov");
expectValue("t.me/durov", "username", "durov");
expectValue("https://t.me/s/kanal", "username", "kanal");
expectValue("durov", "username", "durov");
expectValue("+998 90 123 45 67", "phone", "+998 90 123 45 67");
expectValue("Pavel Durov", "name", "Pavel Durov");

console.log("=== 6. Yangi chuqur modullar ===");
const pm = OSINT_MODULES.find((m) => m.id === "phone-mentions");
if (pm && pm.appliesTo.includes("phone")) {
  passed++;
  console.log("  ✓ phone-mentions moduli mavjud, phone ga tegishli");
} else {
  failed++;
  console.error("  ✗ phone-mentions moduli topilmadi yoki appliesTo noto'g'ri");
}
const pmQ = pm?.queries("+998 90 123 45 67") ?? [];
if (pmQ.some((q) => q.includes("site:t.me")) && pmQ.some((q) => q.includes("instagram"))) {
  passed++;
  console.log(`  ✓ phone-mentions: ${pmQ.length} ta so'rov — t.me + ijtimoiy tarmoq`);
} else {
  failed++;
  console.error("  ✗ phone-mentions so'rovlarida site:t.me / instagram yo'q");
}
const pmDeep = pm?.deepQueries?.("+998901234567") ?? [];
if (pmDeep.some((q) => q.includes("filetype:"))) {
  passed++;
  console.log("  ✓ phone-mentions deep: hujjat/baza qidiruvi bor");
} else {
  failed++;
  console.error("  ✗ phone-mentions deep so'rovlarida filetype yo'q");
}

const um = OSINT_MODULES.find((m) => m.id === "username-mentions");
if (um && um.appliesTo.includes("username")) {
  passed++;
  console.log("  ✓ username-mentions moduli mavjud, username ga tegishli");
} else {
  failed++;
  console.error("  ✗ username-mentions moduli topilmadi yoki appliesTo noto'g'ri");
}
const umQ = um?.queries("@dilshod_dev") ?? [];
if (umQ.some((q) => q.includes("instagram")) && umQ.some((q) => q.includes("github"))) {
  passed++;
  console.log(`  ✓ username-mentions: ${umQ.length} ta so'rov — platforma bo'yicha`);
} else {
  failed++;
  console.error("  ✗ username-mentions so'rovlarida platformalar yo'q");
}
const umDeep = um?.deepQueries?.("dilshod_dev") ?? [];
if (umDeep.some((q) => q.includes("linktr.ee")) && umDeep.some((q) => q.includes("pastebin"))) {
  passed++;
  console.log("  ✓ username-mentions deep: bio-havola + oqish qidiruvi bor");
} else {
  failed++;
  console.error("  ✗ username-mentions deep so'rovlarida bio-havola yo'q");
}

// @belgisi so'rovga tushmasligi kerak — qidiruv sifati
const umRaw = um?.queries("@durov").join(" ") ?? "";
if (!umRaw.includes("@durov") && umRaw.includes("durov")) {
  passed++;
  console.log("  ✓ username-mentions: @belgisi so'rovlarga tushmaydi");
} else {
  failed++;
  console.error("  ✗ username-mentions: @belgisi so'rovda qolgan");
}

console.log(`\nNatija: ${passed} ✓ / ${failed} ✗`);
if (failed > 0) process.exit(1);
export {};
