// Bog'lanish grafigi (entity-graph) testlari — bun tests/entity-graph.test.ts
import { buildEntityGraph } from "../src/lib/entity-graph";
import type { ModuleResult, SearchResultItem } from "../src/lib/osint";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

const item = (over: Partial<SearchResultItem> = {}): SearchResultItem => ({
  name: "Test natija",
  url: "https://example.com/sahifa",
  snippet: "oddiy matn",
  host_name: "example.com",
  ...over,
});

const mod = (id: string, title: string, results: SearchResultItem[]): ModuleResult => ({
  moduleId: id,
  moduleTitle: title,
  status: "done",
  count: results.length,
  results,
});

console.log("\n=== 1. Bo'sh holat ===");
{
  const g = buildEntityGraph({ type: "username", query: "durov" }, []);
  ok(g.nodes.length === 1, "faqat maqsad tuguni bor");
  ok(g.nodes[0]?.kind === "target" && g.nodes[0]?.label === "durov", "maqsad tuguni to'g'ri");
  ok(g.links.length === 0, "bog'lanish yo'q");
}

console.log("\n=== 2. Maqsad → sahifa bog'lanishi ===");
{
  const g = buildEntityGraph(
    { type: "domain", query: "nexa.uz" },
    [mod("dns", "DNS yozuvlari", [item({ url: "https://nexa.uz/", name: "Nexa sayti" })])]
  );
  const res = g.nodes.find((n) => n.kind === "result");
  ok(!!res, "sahifa tuguni bor");
  ok(
    g.links.some((l) => l.source === "target" && l.target === res?.id && l.kind === "found"),
    "maqsad→sahifa 'found' bog'lanishi bor"
  );
  ok(res?.modules.includes("DNS yozuvlari") === true, "sahifada modul nomi saqlangan");
}

console.log("\n=== 3. Sahifadan entitet ajratilishi (email + korporativ domen) ===");
{
  const g = buildEntityGraph(
    { type: "name", query: "Ali Valiyev" },
    [
      mod(
        "search",
        "Qidiruv tizimlari",
        [
          item({
            url: "https://nexa.uz/ali",
            name: "Ali Valiyev — Nexa",
            snippet: "Bog'lanish: ali@nexa.uz tel +998901234567",
          }),
        ]
      ),
    ]
  );
  const email = g.nodes.find((n) => n.kind === "email");
  const domain = g.nodes.find((n) => n.kind === "domain");
  const phone = g.nodes.find((n) => n.kind === "phone");
  const res = g.nodes.find((n) => n.kind === "result")!;
  ok(email?.label === "ali@nexa.uz", "email entiteti ajratildi");
  ok(!!phone, "telefon entiteti ajratildi");
  ok(domain?.label === "nexa.uz", "korporativ domen entiteti ajratildi");
  ok(
    g.links.some((l) => l.source === res.id && l.target === email?.id && l.kind === "mentions"),
    "sahifa→email 'mentions' bog'lanishi bor"
  );
  ok(
    g.links.some((l) => l.source === email?.id && l.target === domain?.id && l.kind === "linked"),
    "email→domen 'linked' bog'lanishi bor"
  );
}

console.log("\n=== 4. Platforma profili → username ===");
{
  const g = buildEntityGraph(
    { type: "username", query: "durov" },
    [
      mod(
        "social",
        "Ijtimoiy tarmoqlar",
        [item({ url: "https://instagram.com/durov", name: "Pavel Durov on Instagram" })]
      ),
    ]
  );
  const uname = g.nodes.find((n) => n.kind === "username");
  ok(uname?.label === "durov", "platforma URL segmentidan username chiqdi");
  // Platforma domenlari "domen iz" sifatida chiqmasligi kerak
  ok(!g.nodes.some((n) => n.kind === "domain" && n.label === "instagram.com"), "instagram.com domen entitet sifatida chiqmaydi");
}

console.log("\n=== 5. Profil sanovchi modul — domen shovqini yo'q ===");
{
  const g = buildEntityGraph(
    { type: "username", query: "durov" },
    [
      mod(
        "whatsmyname",
        "WhatsMyName — 700+ sayt",
        [item({ url: "https://some-forum.net/user/durov", name: "durov — SomeForum" })]
      ),
    ]
  );
  ok(!g.nodes.some((n) => n.kind === "domain"), "whatsmyname natijasidan domen chiqmaydi");
  ok(g.nodes.some((n) => n.kind === "result"), "lekin sahifa tuguni bor");
}

console.log("\n=== 6. Chegaralar (caps) ===");
{
  const results: SearchResultItem[] = [];
  for (let i = 0; i < 120; i++) {
    results.push(
      item({
        url: `https://sayt${i}.uz/page`,
        name: `Sayt ${i}`,
        snippet: `aloqa: admin@sayt${i}.uz`,
      })
    );
  }
  const g = buildEntityGraph({ type: "name", query: "Test Kimdir" }, [mod("search", "Qidiruv", results)]);
  const resCount = g.nodes.filter((n) => n.kind === "result").length;
  ok(resCount <= 72, `sahifalar chegarasi: ${resCount} ≤ 72`);
  ok(g.droppedResults === 48, `tushgan sahifalar hisoblangan: ${g.droppedResults} = 48`);
  ok(g.nodes.filter((n) => n.kind === "email").length <= 8, "email entitetlari chegarasi ≤ 8");
  // Entitetga ega sahifalar birinchi tushadi
  const firstRes = g.nodes.find((n) => n.kind === "result");
  ok(!!firstRes && (firstRes.weight ?? 0) >= 2, "entitetga ega sahifalar ustuvor");
}

console.log("\n=== 7. Takroriy URL dedupe ===");
{
  const g = buildEntityGraph(
    { type: "domain", query: "nexa.uz" },
    [
      mod("recon", "Tashqi rekon", [item({ url: "https://nexa.uz/a" }), item({ url: "https://nexa.uz/a#x" })]),
    ]
  );
  ok(g.nodes.filter((n) => n.kind === "result").length === 1, "bir xil sahifa bir marta chiqadi");
}

console.log("\n=== 8. Ishlov berilmagan modul o'tkazib yuboriladi ===");
{
  const g = buildEntityGraph(
    { type: "domain", query: "nexa.uz" },
    [
      { moduleId: "dns", moduleTitle: "DNS", status: "running", count: 0, results: [] },
      mod("whois", "WHOIS", [item({ url: "https://nexa.uz/" })]),
    ]
  );
  ok(g.nodes.filter((n) => n.kind === "result").length === 1, "running modul natijasi tushmaydi");
}

console.log("\n=== 9. Izolyatsiya — chegara ortida qolgan entitetlar grafga tushmaydi ===");
{
  // 90 ta entitetli sahifa: har birida o'z email'i bor. Sahifa cap'i 72,
  // email cap'i 8 — grafdagi HAR BIR email bog'lanishga ega bo'lishi kerak
  const results: SearchResultItem[] = [];
  for (let i = 0; i < 90; i++) {
    results.push(
      item({ url: `https://s${i}.uz/`, name: `S${i}`, snippet: `yoz: admin@s${i}.uz` })
    );
  }
  const g = buildEntityGraph({ type: "name", query: "Kimdir" }, [mod("search", "Q", results)]);
  const emails = g.nodes.filter((n) => n.kind === "email");
  ok(emails.length <= 8, `email entitetlari chegarasi: ${emails.length} ≤ 8`);
  const linkedIds = new Set(g.links.flatMap((l) => [l.source, l.target]));
  ok(emails.every((e) => linkedIds.has(e.id)), "grafdagi har bir email bog'lanishga ega (izolyatsiya yo'q)");
  ok(g.droppedResults >= 18, `cap ortida qolgan sahifalar: ${g.droppedResults} ≥ 18`);
}

console.log("\n========================");
console.log(`Natija: ${passed} o'tdi, ${failed} o'tmadi`);
if (failed > 0) {
  console.log("O'tmaganlar:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
