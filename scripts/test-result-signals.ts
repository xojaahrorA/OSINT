// Task 34 testi — parol/pasport/rasm modullari signallari va aniqlik yaxshilanishlari
// Ishga tushirish: bun scripts/test-result-signals.ts
import {
  annotateAndSort,
  signalForModule,
  type SignalKind,
} from "../src/lib/result-signals";
import {
  imageSubjectKeep,
  imageQueryCore,
  relevanceFilter,
  bingImagesSearch,
} from "../src/lib/search-engines";
import { OSINT_MODULES, type SearchResultItem } from "../src/lib/osint";

let passed = 0;
let fails = 0;
function ok(cond: boolean, name: string, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    fails++;
    console.error(`  ✗ XATO: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function item(partial: Partial<SearchResultItem>): SearchResultItem {
  return {
    name: partial.name ?? "",
    url: partial.url ?? "https://example.com/x",
    snippet: partial.snippet ?? "",
    host_name: partial.host_name ?? "example.com",
    favicon: partial.favicon,
  };
}

async function main() {
  console.log("=== 1. Parol signallari (leak-search) ===");
  const sig = (kind: SignalKind, r: SearchResultItem) => {
    const out = annotateAndSort(kind, [r]);
    return out[0].signal ?? null;
  };
  ok(
    sig("leak", item({ name: "combo", snippet: "user password: abc12345", host_name: "somewhere.io" }))
      ?.level === "strong",
    "«password:» qolipi → strong"
  );
  ok(
    sig("leak", item({ name: "dump", snippet: "alisher@gmail.com:Pa55word123", host_name: "x.com" }))
      ?.level === "strong",
    "email:pass kombinatsiyasi → strong"
  );
  ok(
    sig("leak", item({ name: "Combo List 2024", snippet: "credentials.txt to'plami", host_name: "y.io" }))
      ?.level === "strong",
    "combo/credentials.txt → strong"
  );
  ok(
    sig("leak", item({ host_name: "pastebin.com", url: "https://pastebin.com/abc", name: "baza" }))
      ?.label === "Paste manbasi",
    "pastebin host → medium"
  );
  ok(
    sig("leak", item({ name: "Dilshod ma'lumotlari sizib qoldi", snippet: "oqish holati" }))
      ?.label === "Oqish eslatmasi",
    "oqish/leak eslatmasi → medium"
  );
  ok(
    sig("leak", item({ name: "Dilshod Karimov — Vikipediya", snippet: "taniqli shaxs" })) === null,
    "oddiy sahifa → signal yo'q"
  );

  console.log("\n=== 2. Hujjat signallari (document-leaks) ===");
  ok(
    sig("doc", item({ name: "Hisobot", snippet: "pasport AA1234567 bo'yicha" }))?.level === "strong",
    "UZ seriyasi (AA1234567) + hujjat so'zi → strong"
  );
  ok(
    sig("doc", item({ snippet: "JSHSHIR 34567890123456 raqami", host_name: "a.uz" }))?.label ===
      "JSHSHIR belgisi",
    "JSHSHIR + 14 raqam → strong"
  );
  ok(
    sig("doc", item({ name: "Kod CD 123456", snippet: "mahsulot katalogi" })) === null,
    "seriya qolipi HUJJAT SO'ZISIZ → null (yolg'on musbat himoyasi)"
  );
  ok(
    sig("doc", item({ host_name: "scribd.com", url: "https://scribd.com/doc/1", name: "Ariza" }))
      ?.label === "Hujjat arxivi",
    "scribd host → medium"
  );
  ok(
    sig("doc", item({ name: "Dilshod pasporti haqida", snippet: "eslatma" }))?.label ===
      "Hujjat eslatmasi",
    "hujjat so'zi yolg'iz → medium"
  );

  console.log("\n=== 3. Rasm signallari (photo-search) ===");
  ok(
    sig(
      "photo",
      item({
        name: "Dilshod rasmi",
        snippet: "https://x.com/img/dilshod.jpg",
        favicon: "https://x.com/thumb.jpg",
      })
    )?.label === "Rasm topilma",
    "rasm fayli + thumbnail → strong"
  );
  ok(
    sig("photo", item({ host_name: "imgur.com", name: "galereya" }))?.label === "Foto host",
    "imgur host → medium"
  );
  ok(sig("photo", item({ name: "Dilshod — yangiliklar" })) === null, "oddiy sahifa → null");

  console.log("\n=== 4. annotateAndSort saralash ===");
  const mixed: SearchResultItem[] = [
    item({ name: "oddiy yangilik", snippet: "Dilshod haqida" }),
    item({ host_name: "pastebin.com", name: "paste", snippet: "dilshod" }),
    item({ name: "dump", snippet: "dilshod password: q12345", host_name: "z.io" }),
  ];
  const sorted = annotateAndSort("leak", mixed);
  ok(sorted.length === 3, "barcha natijalar saqlanadi");
  ok(sorted[0].signal?.level === "strong", "strong birinchi o'rinda");
  ok(sorted[1].signal?.label === "Paste manbasi", "keyin medium");
  ok(!sorted[2].signal, "oxirda signal'siz");
  ok(signalForModule("leak-search") === "leak" && signalForModule("photo-search") === "photo" &&
     signalForModule("document-leaks") === "doc" && signalForModule("other") === null,
    "signalForModule xaritalash to'g'ri");

  console.log("\n=== 5. Rasm subyekti — email lokal qismi zaxirasi ===");
  const keeps = imageSubjectKeep("durov@gmail.com", [
    { title: "Durov gallery", page: "https://imgur.com/u/durov", file: "https://i.imgur.com/durov.jpg" },
    { title: "Boshqa odam rasmi", page: "https://imgur.com/u/muslim", file: "https://i.imgur.com/muslim.jpg" },
  ]);
  ok(keeps[0] === true, "lokal qism «durov» mos → saqlanadi");
  ok(keeps[1] === false, "loqaysiz rasm → chetlanadi");
  const roleKeeps = imageSubjectKeep("support@gmail.com", [
    { title: "support page", page: "https://imgur.com/support", file: "https://i.imgur.com/support.jpg" },
  ]);
  ok(roleKeeps[0] === false, "rol-so'z lokal qismi (support@) ishonchsiz → saqlanmaydi");
  const fullNameKeeps = imageSubjectKeep("Pavel Durov (profil OR avatar OR foto)", [
    { title: "Pavel Durov — foto", page: "https://flickr.com/pd", file: "https://flickr.com/pd.jpg" },
    { title: "Random person", page: "https://imgur.com/x", file: "https://imgur.com/x.jpg" },
  ]);
  ok(fullNameKeeps[0] === true && fullNameKeeps[1] === false, "ism-familiya rejimi: faqat o'zi saqlanadi");

  console.log("\n=== 6. imageQueryCore (qo'shtirnoqli zaxira uchun) ===");
  ok(imageQueryCore("Pavel Durov (profil OR avatar OR foto)") === "Pavel durov".replace("durov","Durov") ||
     imageQueryCore("Pavel Durov (profil OR avatar OR foto)") === "Pavel Durov",
    "qavslar/OR tozalanadi");
  ok(imageQueryCore("site:imgur.com \"Dilshod Karimov\"") === "Dilshod Karimov", "operatorlar tozalanadi");
  ok(imageQueryCore("durov") === "durov", "bir so'z qoladi");

  console.log("\n=== 7. v7 aniqlik filtri regressiyasi ===");
  const wiki = [item({ name: "Dilshod Karimov — Vikipediya", snippet: "taniqli shaxs", url: "https://uz.wikipedia.org/wiki/Dilshod" })];
  const leakQ = `site:pastebin.com "Dilshod Karimov"`;
  ok(relevanceFilter(leakQ, wiki, { requireContext: true }).length === 0,
    "leak modulda mavzusiz umumiy sahifa o'tmaydi");
  const dump = [item({ name: "pastebin", snippet: "Dilshod Karimov password: 123", url: "https://pastebin.com/aaa" })];
  ok(relevanceFilter(leakQ, dump, { requireContext: true }).length === 1,
    "mavzuli pastebin topilma o'tadi");

  console.log("\n=== 8. Yangi so'rovlar modullarda ===");
  for (const [id, needle] of [
    ["leak-search", "justpaste.it"],
    ["leak-search", "combo list"],
    ["document-leaks", "drive.google.com"],
    ["document-leaks", "pasport seriyasi"],
    ["photo-search", "500px.com"],
    ["photo-search", "profile photo"],
  ] as [string, string][]) {
    const m = OSINT_MODULES.find((x) => x.id === id)!;
    const all = [...m.queries("x"), ...(m.deepQueries ? m.deepQueries("x") : [])];
    ok(all.some((q) => q.includes(needle)), `${id} yangi so'rov: ${needle}`);
  }

  console.log("\n=== 9. Jonli Bing rasm zanjiri (subyekt filtri bilan) ===");
  const imgs = await bingImagesSearch("pavel durov", 6);
  console.log(`  ${imgs.length} ta rasm keldi`);
  for (const i of imgs.slice(0, 3)) console.log(`   • ${i.name.slice(0, 44)} → ${i.url.slice(0, 70)}`);
  ok(
    imgs.every((i) => /^https?:\/\//.test(i.url)),
    "barcha rasm URL'lari to'g'ri"
  );
  if (imgs.length > 0) {
    const hay = (i: SearchResultItem) =>
      `${i.name} ${i.snippet} ${i.url}`.toLowerCase();
    ok(imgs.some((i) => hay(i).includes("durov")), "subyekt izi kamida bitta natijada bor");
  }

  console.log(
    fails === 0
      ? `\nBARCHA TESTLAR OTDI — ${passed}/${passed + fails}`
      : `\n${fails} TA XATO (${passed}/${passed + fails} o'tdi)`
  );
  process.exit(fails === 0 ? 0 : 1);
}

main();
