// Task 26 jonli testi — parollar/oqishlar, pasport hujjatlari va rasm qidiruvi
// Ishga tushirish: bun scripts/test-leaks-photo.ts
import { bingImagesSearch } from "../src/lib/search-engines";
import { OSINT_MODULES } from "../src/lib/osint";

async function main() {
  let fails = 0;

  // 1) Yangi modullar ta'riflari va so'rov generatorlari
  console.log("=== 1. Yangi modullar ===");
  for (const id of ["leak-search", "document-leaks", "photo-search"]) {
    const m = OSINT_MODULES.find((x) => x.id === id);
    if (!m) {
      console.error(`XATO: ${id} moduli yo'q`);
      fails++;
      continue;
    }
    const qs = [
      ...m.queries("+998901234567"),
      ...(m.deepQueries ? m.deepQueries("Pavel Durov") : []),
    ];
    console.log(`[${m.title}] ${qs.length} ta so'rov generatori OK`);
    for (const q of qs.slice(0, 2)) console.log("   -", q.slice(0, 96));
  }

  // 2) bing-images prefiksli so'rov faqat photo-searchda
  const prefCount = OSINT_MODULES.filter((m) =>
    JSON.stringify([m.queries("x"), m.deepQueries ? m.deepQueries("x") : []]).includes(
      "bing-images:"
    )
  ).length;
  if (prefCount !== 1) {
    console.error(`XATO: bing-images prefiks ${prefCount} modulda (1 bo'lishi kerak)`);
    fails++;
  } else {
    console.log("bing-images prefiks faqat photo-search modulida OK");
  }

  // 3) Jonli Bing Rasm qidiruvi
  console.log("\n=== 2. Jonli Bing Rasm qidiruvi ===");
  const imgs = await bingImagesSearch("pavel durov", 8);
  console.log(`${imgs.length} ta rasm topildi`);
  for (const i of imgs.slice(0, 5)) {
    console.log(`   • ${i.name.slice(0, 46)} → ${i.url.slice(0, 78)}`);
  }
  if (imgs.length === 0) {
    console.log("   (bo'sh — soft-blok yoki rasm yo'q; xato emas, modul [] qaytaradi)");
  } else {
    const bad = imgs.filter((i) => !/^https?:\/\//.test(i.url));
    if (bad.length > 0) {
      console.error(`XATO: ${bad.length} ta noto'g'ri URL`);
      fails++;
    }
  }

  // 4) Xatolarsiz rejim — noto'g'ri so'rov ham crash qilmasligi
  console.log("\n=== 3. Xatolarsiz rejim ===");
  const empty = await bingImagesSearch("", 5);
  console.log(`Bo'sh so'rov: ${empty.length} natija (crash yo'q) OK`);

  console.log(fails === 0 ? "\nBARCHA TESTLAR OTDI" : `\n${fails} TA XATO`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
