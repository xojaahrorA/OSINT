/**
 * v7 ANIQLIK FILTRI TESTI — foydalanuvchi hisobotidagi xatolar takrorlanmasligi:
 *
 *  1. «Parollar chiqgan joylar umuman boshqa ma'lumot qidirayapdi»
 *     → maqsad ismi keltirilmagan «parol/password» sahifalari o'tmaydi
 *  2. «Pasport qidirishda ham unga aloqasi bo'lmagan narsalar chiqyapdi»
 *     → boshqa shaxs («Karimova» ≠ «Karimov») natijalari o'tmaydi
 *  3. «Rasm orqali qidirishda shu odamga tegishli rasimi qidirmasdan
 *     boshqa narsalar qidirib tashlaydi» → subyektga tegishli bo'lmagan
 *     rasmlar chetlanadi
 *  4. «Keraksiz domenlarni ham qo'shib qo'yib qidirib ketayapdi»
 *     → maqsad keltirilmagan har qanday domen natijasi o'tmaydi
 *  5. Telefon formatlari: OR-alternativadan BITTASI bor bo'lsa yetarli
 *     (eski operatorFilter hammasini talab qilardi — haqiqiy natijalar
 *     yo'qolardi)
 */
import {
  relevanceFilter,
  operatorFilter,
  imageSubjectKeep,
  SEARCH_ENGINES_VERSION,
} from "../src/lib/search-engines";
import type { SearchResultItem } from "../src/lib/osint";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ XATO: ${label}`);
  }
}

const mk = (name: string, url: string, snippet: string): SearchResultItem => ({
  name,
  url,
  snippet,
  host_name: (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })(),
});

console.log(`Versiya: ${SEARCH_ENGINES_VERSION}\n`);

// ===== 1. PAROLLAR VA OQISHLAR (leak-search) =====
console.log("1) Parollar va oqishlar — username «dilshod»:");
const leakQuery = `"dilshod" (parol OR password OR пароль) (oqish OR leak OR dump OR bazalar OR reestr)`;
const leakInput = [
  // ✗ Maqsad UMUMAN yo'q — faqat «parol» so'zi uchun chiqqan sahifa (eski filtrda O'TARDI!)
  mk(
    "10 amaliy maslahat: kuchli parol qanday tuziladi",
    "https://habr.com/ru/articles/790123/",
    "Kuchli parol kamida 12 belgidan iborat bo'lishi kerak. Parol menejerlardan foydalaning..."
  ),
  // ✗ Boshqa shaxs — «Dilshodbek» «dilshod»ga substring mos kelardi
  mk(
    "Dilshodbek Axmedov — shaxsiy blog",
    "https://blog.uz/dilshodbek",
    "Shaxsiy blogim, turli mavzularda yozaman"
  ),
  // ✓ Maqsad bor + oqish konteksti
  mk(
    "Pastebin — dilshod akkountlar dump",
    "https://pastebin.com/Xk3d9fQz",
    "dilshod@gmail.com:parol123 leak 2023 combo list"
  ),
  // ✓ Maqsad URL'da + leak konteksti
  mk(
    "Sizib ketgan ma'lumotlar bazasi",
    "https://leakfiles.net/dumps/dilshod.sql",
    "login va parol ro'yxati sql faylda"
  ),
];
const leakOut = relevanceFilter(leakQuery, leakInput);
check("«kuchli parol» sahifasi chetlandi (maqsad yo'q)", !leakOut.some((r) => r.url.includes("habr.com")));
check("«Dilshodbek» blogi chetlandi (so'z chegarasi)", !leakOut.some((r) => r.url.includes("blog.uz")));
check("pastebin dump saqlandi", leakOut.some((r) => r.url.includes("pastebin.com")));
check("leak fayl saqlandi", leakOut.some((r) => r.url.includes("leakfiles.net")));
check("jami 2 ta saqlanishi kerak", leakOut.length === 2);

console.log("\n2) Parollar — CHUQUR so'rov (gist/github):");
const leakDeep = `"dilshod" (site:github.com OR site:gitlab.com) (password OR parol OR пароль OR credentials OR config OR secret)`;
const leakDeepOut = relevanceFilter(leakDeep, [
  mk("GitHub — dilshod config", "https://github.com/dilshod/dotfiles", "config fayllari, secret kalitlar"),
  mk("GitLab CI/CD to'liq qo'llanma", "https://gitlab.com/docs/cicd-guide", "credentials va secret variablelar haqida"),
]);
check("GitHub'dagi maqsad konfiguratsiyasi saqlandi", leakDeepOut.length === 1 && leakDeepOut[0].url.includes("github.com/dilshod"));
check("aloqasiz GitLab doc o'tmadi", !leakDeepOut.some((r) => r.url.includes("docs/cicd")));

// ===== 2. PASPORT VA HUJJATLAR (document-leaks) =====
console.log("\n3) Pasport — ism-familiya «Muhammad Karimov»:");
const docQuery = `"Muhammad Karimov" (pasport OR passport OR паспорт OR guvohnoma OR hujjat OR "ID karta")`;
const docInput = [
  // ✗ Boshqa shaxs: «Karimova» eski filtrda «karimov» substringi orqali O'TARDI!
  mk(
    "Gulnora Karimova pasport ishi qayta ko'rilmoqda",
    "https://kun.uz/news/123456",
    "Gulnora Karimova advokatlarining pasport bilan bog'liq arizasi..."
  ),
  // ✗ Faqat familiyasi mos uchinchi shaxs
  mk(
    "Islom Karimov — Vikipediya",
    "https://uz.wikipedia.org/wiki/Islom_Karimov",
    "Islom Karimov O'zbekiston prezidenti bo'lgan..."
  ),
  // ✓ Initsial bilan maqsad
  mk(
    "M. Karimov guvohnomasi topildi — e'lon",
    "https://elone.uz/announce/9911",
    "Guvohnoma topildi, egasi M. Karimov, hujjatni olib keting"
  ),
  // ✓ To'liq mos maqsad + hujjat konteksti
  mk(
    "Karimov Muhammad — ID karta arizasi (PDF)",
    "https://docs.example.uz/ariza/karimov-muhammad.pdf",
    "ID karta va pasport arizasi nusxasi, filetype hujjat"
  ),
];
const docOut = relevanceFilter(docQuery, docInput);
check("«Gulnora Karimova» chetlandi (boshqa shaxs)", !docOut.some((r) => r.url.includes("kun.uz")));
check("«Islom Karimov» chetlandi (boshqa shaxs)", !docOut.some((r) => r.url.includes("wikipedia")));
check("«M. Karimov» (initsial) saqlandi", docOut.some((r) => r.url.includes("elone.uz")));
check("«Karimov Muhammad» PDF saqlandi", docOut.some((r) => r.url.includes("karimov-muhammad")));
check("jami 2 ta saqlanishi kerak", docOut.length === 2);

console.log("\n4) Pasport — CHUQUR so'rov (jshshir/seriya):");
const docDeep = `"Muhammad Karimov" (jshshir OR JSHSHIR OR pinfl OR ПИНФЛ OR seriya OR "passport series" OR "pasport seriya")`;
const docDeepOut = relevanceFilter(docDeep, [
  mk("JSHSHIR bazasi — Karimov Muhammad", "https://docs-db.uz/rows/karimov-muhammad", "jshshir va pinfl seriya ma'lumotlari"),
  mk("Passport series nima?", "https://passportinfo.com/series-explained", "passport series formatlari tushuntirilgan"),
]);
check("bazadagi maqsad qatori saqlandi", docDeepOut.length === 1 && docDeepOut[0].url.includes("docs-db.uz"));
check("«passport series» tushuntirish maqolasi o'tmadi (maqsad yo'q)", !docDeepOut.some((r) => r.url.includes("passportinfo")));

// ===== 3. RASM IZLARI (photo-search) =====
console.log("\n5) Rasm — username «dilshod_dev» (Bing rasm meta):");
const imgUser = "dilshod_dev";
const imgUserKeep = imageSubjectKeep(imgUser, [
  // ✓ Manba sahifa username'ni o'z ichiga oladi
  { title: "Dilshod (@dilshod_dev) • Instagram rasmlari", page: "https://www.instagram.com/dilshod_dev/", file: "https://scontent.cdninstagram.com/v/t51.2885-15/dilshod_dev_profile.jpg" },
  // ✗ Ommabop rasm — maqsad bilan bog'liq emas (eski kodda O'TARDI)
  { title: "Sunset landscape photography", page: "https://www.flickr.com/photos/naturelover/5327", file: "https://live.staticflickr.com/65535/5327_sunset.jpg" },
  // ✗ Boshqa odam
  { title: "Aziz Karimov portfolio", page: "https://www.behance.net/azizkarimov", file: "https://mir-s3-cdn-cf.behance.net/aziz_profile.png" },
  // ✓ Fayl nomida username bor
  { title: "IMG_20240112", page: "https://ibb.co/xYz123", file: "https://i.ibb.co/xYz123/dilshod_dev_avatar.png" },
]);
check("Instagram profil rasmi saqlandi", imgUserKeep[0] === true);
check("ommabop «sunset» rasmi chetlandi", imgUserKeep[1] === false);
check("boshqa odam rasmi chetlandi", imgUserKeep[2] === false);
check("fayl nomida username bor rasm saqlandi", imgUserKeep[3] === true);

console.log("\n6) Rasm — ism-familiya «Muhammad Karimov»:");
const imgName = "Muhammad Karimov (profil OR avatar OR foto)";
const imgNameKeep = imageSubjectKeep(imgName, [
  { title: "Muhammad Karimov avatar", page: "https://t.me/karimov_m", file: "https://cdn4.telesco.pe/file/karimov_m.jpg" },
  { title: "M. Karimov — profil foto", page: "https://facebook.com/m.karimov", file: "https://scontent.xx.fbcdn.net/mkarimov.jpg" },
  { title: "Generic business team photo", page: "https://unsplash.com/photos/team", file: "https://images.unsplash.com/team.jpg" },
]);
check("t.me avatar saqlandi", imgNameKeep[0] === true);
check("initsial + familiya profil saqlandi", imgNameKeep[1] === true);
check("generic team rasmi chetlandi", imgNameKeep[2] === false);

// ===== 4. TELEFON — OR-alternativa formats (operatorFilter + relevanceFilter) =====
console.log("\n7) Telefon — format alternativalaridan bitasi yetarli:");
const phoneQuery = `site:t.me ("+998901234567" OR "90 123 45 67" OR "90-123-45-67")`;
const phoneInput = [
  // Eski operatorFilter «hammasi bo'lishi kerak» deardi — bu sahifa YO'QOLARDI
  mk("Telegram — Aloqa", "https://t.me/dilshod_k", "Bog'lanish: 90 123 45 67 (faqat bitta format!)"),
  mk("Telegram — Boshqa kanal", "https://t.me/somechannel", "Kanal haqida ma'lumot, boshqa raqam 90 999 88 77"),
];
const phoneOpOut = operatorFilter(phoneQuery, phoneInput);
check("operatorFilter: bitta format bor sahifa qoladi (every bug tuzatildi)", phoneOpOut.length === 1 && phoneOpOut[0].url.includes("dilshod_k"));
const phoneRelOut = relevanceFilter(phoneQuery, phoneInput);
check("relevanceFilter: telefon sahifasi o'tadi", phoneRelOut.length === 1 && phoneRelOut[0].url.includes("dilshod_k"));

// ===== 5. REFORMULATSIYA (soddalashtirilgan so'rov) =====
console.log("\n8) Reformulatsiya qilingan so'rov (operatorlar yo'q):");
const reformQuery = "dilshod parol password пароль oqish leak dump bazalar reestr";
const reformOut = relevanceFilter(reformQuery, [
  mk("Dilshod — parollar oqishi", "https://pastebin.com/aa11", "dilshod parol ro'yxati sizdi"),
  mk("Kuchli parol qanday yaratiladi", "https://security.com/strong-password", "parol xavfsizligi bo'yicha maslahatlar"),
]);
check("reformulatsiyada ham maqsadsiz sahifa chetlandi", reformOut.length === 1 && reformOut[0].url.includes("pastebin"));

// ===== 9. MAVZU-QATTIQ REJIM (leak/document modullari, requireContext) =====
console.log("\n9) Modul mavzusi majburiy (requireContext=true):");
const wikiGarbage = [
  // Jonli testda Bing bot-rejim aynan shunday qaytardi: subyekt bor, mavzu YO'Q
  mk("Dilshod - Wikipedia", "https://en.wikipedia.org/wiki/Dilshod", "Dilshod is a Persian masculine given name"),
  mk("Dilshod Nazarov - Wikipedia", "https://en.wikipedia.org/wiki/Dilshod_Nazarov", "Dilshod Nazarov is a Tajik hammer thrower"),
  mk("Meaning of the name Dilshod", "https://www.wisdomlib.org/name/dilshod", "Dilshod means happy heart"),
  // ✓ Subyekt + mavzu kalit so'zi bor
  mk("Pastebin — dilshod combo", "https://pastebin.com/Xk3d9fQz", "dilshod@gmail.com:parol123 leak"),
];
const leakStrict = relevanceFilter(leakQuery, wikiGarbage, { requireContext: true });
check("Vikipediya/ism-lug'ati natijalari chetlandi (mavzu yo'q)", leakStrict.length === 1 && leakStrict[0].url.includes("pastebin"));
const leakLoose = relevanceFilter(leakQuery, wikiGarbage);
check("requireContext bo'lmaganda faqat subyekt talab qilinadi (4 ta qoladi)", leakLoose.length === 4);
const docStrict = relevanceFilter(docQuery, wikiGarbage, { requireContext: true });
check("pasport modulida ham umumiy sahifalar chetlandi", docStrict.length === 0);
// Pasport modulida mavzuga mos maqsad natijasi qoladi
const docStrict2 = relevanceFilter(docQuery, [
  ...wikiGarbage,
  mk("Karimov Muhammad — ID karta arizasi", "https://docs.example.uz/karimov-muhammad.pdf", "ID karta va pasport arizasi nusxasi"),
], { requireContext: true });
check("pasport modulida mavzuga mos natija saqlanadi", docStrict2.length === 1 && docStrict2[0].url.includes("karimov-muhammad"));

// ===== 6. O'LIK DOMENLAR KODDA QOLMAGANINI TASDIQLASH (statik) =====
console.log("\n9) Domenlar:");
import { OSINT_MODULES } from "../src/lib/osint";
const allQueries: string[] = [];
for (const m of OSINT_MODULES) {
  for (const t of ["dilshod", "Muhammad Karimov", "+998901234567", "info@example.uz", "example.uz"]) {
    allQueries.push(...m.queries(t), ...(m.deepQueries ? m.deepQueries(t) : []));
  }
}
const joined = allQueries.join("\n");
check("avatanak.com (o'lik domen) kodda yo'q", !joined.includes("avatanak"));
check("instanavigation.com (o'lik domen) kodda yo'q", !joined.includes("instanavigation"));
check("ibb.co (jonli foto host) qo'shildi", joined.includes("site:ibb.co"));

console.log(`\n===== NATIJA: ${passed} PASSED, ${failed} FAILED =====`);
if (failed > 0) process.exit(1);
