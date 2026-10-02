/**
 * Jonli E2E — foydalanuvchi hisobotidagi modullar yangi v7 filtr bilan:
 * har modul so'rovi real dvigatel zanjiridan o'tadi va faqat maqsadga
 * tegishli natijalar qolishi ko'riladi.
 */
import { searchOpenWeb } from "../src/lib/search-engines";

const target = process.argv[2] ?? "Dilshod";

async function run(label: string, q: string, requireContext = false) {
  const t0 = Date.now();
  try {
    const r = await searchOpenWeb(q, 6, { requireContext });
    console.log(`\n[${label}] ${r.engine} · ${r.results.length} natija · ${Date.now() - t0}ms`);
    for (const x of r.results.slice(0, 4)) {
      console.log(`  • ${x.host_name} — ${x.name.slice(0, 70)}`);
    }
    if (r.results.length === 0 && r.errors.length) {
      console.log(`  (natija yo'q: ${r.errors.slice(0, 2).join(" | ").slice(0, 140)})`);
    }
  } catch (e) {
    console.log(`\n[${label}] XATO: ${String(e).slice(0, 100)}`);
  }
}

async function main() {
  console.log(`Maqsad: "${target}"`);
  // Parollar va oqishlar (leak-search core) — scan route'da requireContext=true
  await run(
    "Parollar/oqishlar",
    `"${target}" (parol OR password OR пароль) (oqish OR leak OR dump OR bazalar OR reestr)`,
    true
  );
  // Pasport va hujjatlar (document-leaks core) — requireContext=true
  await run(
    "Pasport",
    `"${target}" (pasport OR passport OR паспорт OR guvohnoma OR hujjat OR "ID karta")`,
    true
  );
  // Pasport — jshshir (deep) — requireContext=true
  await run(
    "Pasport JSHSHIR",
    `"${target}" (jshshir OR JSHSHIR OR pinfl OR ПИНФЛ OR seriya OR "passport series" OR "pasport seriya")`,
    true
  );
  // Rasm dork (photo-search core #2 — ibb.co bilan) — scan route'da requireContext=true
  await run(
    "Rasm dork",
    `"${target}" (foto OR rasm OR photo OR img) (site:imgur.com OR site:flickr.com OR site:postimages.org OR site:ibb.co)`,
    true
  );
}

main();
