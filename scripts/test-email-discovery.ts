// Email kashf qilish (username → email) moduli testlari
// ishga tushirish: bun scripts/test-email-discovery.ts

import { assessGravatarMatch } from "../src/lib/osint-sources";
import { DIRECT_RUNS, directSourceIdsFor } from "../src/lib/osint-sources";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

// ===== 1. Gravatar moslik bahosi (sof funksiya) =====
console.log("1. Gravatar moslik bahosi");
check("username aynan mos → TASDIQLANGAN (username)",
  assessGravatarMatch("sindresorhus", "sindresorhus", "Sindre Sorhus").verified === true);
check("dots-strip moslik: u.name == uname → TASDIQLANGAN",
  assessGravatarMatch("u.name", "uname").verified === true);
check("ism ichida username (5+ belgi) → TASDIQLANGAN (ism)",
  assessGravatarMatch("sindre", undefined, "Sindre Sorhus").verified === true);
check("qisqa username (3 belgi) ism ichida → kandidat (yolg'on musbat himoyasi)",
  assessGravatarMatch("abc", undefined, "Mr Abcdef").verified === false);
check("hech biri mos kelmasa → kandidat",
  assessGravatarMatch("pavel", "somebody_else", "John Smith").verified === false);
check("bo'sh profil → kandidat",
  assessGravatarMatch("durov", "", "").verified === false);
check("sabab to'g'ri qaytadi: username",
  assessGravatarMatch("durov", "durov", "").reason === "username");

// ===== 2. Modul ulanishi =====
console.log("2. Modul ulanishi");
check("email-discovery DIRECT_RUNS'da mavjud", typeof DIRECT_RUNS["email-discovery"] === "function");
check("email-discovery username turi uchun rejalashadi",
  directSourceIdsFor("username").includes("email-discovery"));
check("email turi uchun email-discovery YO'Q (faqat username'da)",
  !directSourceIdsFor("email").includes("email-discovery"));

// ===== 3. Jonli: gravatar email probasi (bepul manba) =====
console.log("3. Jonli: email kashf qilish (sindresorhus — ma'lum gravatar foydalanuvchisi)");
{
  const run = DIRECT_RUNS["email-discovery"];
  const results = await run("sindresorhus");
  check("natijalar qaytdi (>= 2: email + keybase)", results.length >= 2);
  const verif = results.find((r) => r.name.includes("TASDIQLANDI"));
  check("tasdiqlangan email topildi", Boolean(verif));
  if (verif) {
    check("tasdiqlangan email @gmail.com", verif.name.includes("gmail.com"));
    check("snippet'da ism bor", (verif.snippet ?? "").toLowerCase().includes("sindre"));
  }
  const kb = results.find((r) => r.name.includes("Keybase"));
  check("Keybase profili topildi", Boolean(kb));
  if (kb) check("Keybase'da dalillar bor (github/twitter)", (kb.snippet ?? "").includes("github") || (kb.snippet ?? "").includes("twitter"));
}

console.log("4. Jonli: email topilmasa ham informativ xulosa (tasodifiy username)");
{
  const run = DIRECT_RUNS["email-discovery"];
  const results = await run("zxq_nonexistent_user_9381");
  check("bo'sh emas — xulosa kartasi chiqadi", results.length >= 1);
  const note = results.find((r) => r.name.includes("Email kashf qilish"));
  check("«mos email topilmadi» xulosasi aniq sabab bilan", Boolean(note && (note.snippet ?? "").includes("Gravatar")));
}

console.log("\n===== NATIJA: %d o'tdi, %d xato =====", passed, failed);
if (failed > 0) process.exit(1);
