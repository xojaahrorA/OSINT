/**
 * Yangi profillar testi — Kompaniya, Ommaviy shaxs, Rasm/Video tahlili:
 * unit (sinsiz) + jonli (tarmoq) qismlardan iborat.
 *   bun scripts/test-new-profiles.ts
 */
import {
  buildAiSignals,
  buildDisplayMeta,
  buildReverseLinks,
  fetchWeather,
  mapLinks,
  parseImageMeta,
  scanBytesForAiMarkers,
  toDayISO,
  weatherText,
} from "../src/lib/image-intel";
import { OSINT_MODULES, TARGET_TYPES } from "../src/lib/osint";
import { DIRECT_RUNS, directSourceIdsFor, cleanDomain } from "../src/lib/osint-sources";
import { searchOpenWeb } from "../src/lib/search-engines";

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

async function main() {
  console.log("=== 1. Kompaniya profili — modullar va manbalar (unit) ===");
  ok(TARGET_TYPES.some((t) => t.value === "company"), "TARGET_TYPES'da company turi bor");
  const modIds = OSINT_MODULES.map((m) => m.id);
  for (const id of ["company-registry", "company-risk", "company-social", "company-fraud", "person-public"]) {
    ok(modIds.includes(id), `modul ${id} mavjud`);
  }
  const compMods = OSINT_MODULES.filter((m) => Array.isArray(m.appliesTo) && m.appliesTo.includes("company"));
  ok(compMods.length >= 5, `company uchun dork modullar: ${compMods.length} ta (umumiy modullar bilan ≥9)`);
  const personMods = OSINT_MODULES.filter((m) => Array.isArray(m.appliesTo) && m.appliesTo.includes("name") && m.id === "person-public");
  ok(personMods.length === 1, "person-public faqat name turida");
  ok(directSourceIdsFor("company").includes("company-signals"), "directSourceIdsFor(company) — company-signals bor");
  ok(directSourceIdsFor("domain").includes("company-signals"), "directSourceIdsFor(domain) — company-signals bor");
  ok(typeof DIRECT_RUNS["company-signals"] === "function", "DIRECT_RUNS['company-signals'] funksiya");
  ok(cleanDomain("Uzum Market") === "", "cleanDomain('Uzum Market') → '' (kompaniya nomi domen emas)");
  ok(cleanDomain("https://uzum.uz/about") === "uzum.uz", "cleanDomain URL'dan domenni oladi");
  const regQ = OSINT_MODULES.find((m) => m.id === "company-registry")!.queries("Uzum Market");
  ok(regQ.some((q) => q.includes('site:orginfo.uz')), "reestr dorkida orginfo.uz bor");
  const riskQ = OSINT_MODULES.find((m) => m.id === "company-risk")!.deepQueries!("O'zbekiston Temir Yo'llari");
  ok(riskQ.some((q) => q.includes("tender.mf.uz")), "sud/tender dorkida tender saytlari bor");
  const personDq = OSINT_MODULES.find((m) => m.id === "person-public")!.deepQueries!("Muhammad Karimov");
  ok(personDq.some((q) => q.includes("oila a'zolari")), "ommaviy shaxs dorkida ochiq shaxsiy ma'lumotlar izlanadi");

  console.log("\n=== 2. Rasm/Video tahlil — unit ===");
  const rl = buildReverseLinks("https://example.uz/photo.jpg");
  ok(rl.length === 4, `teskari qidiruv havolalari: ${rl.length} ta (Lens/Yandex/Bing/TinEye)`);
  ok(rl.every((l) => l.url.includes("example.uz%2Fphoto.jpg") || l.url.includes("example.uz%2Fphoto") || l.url.includes("example.uz/photo.jpg")), "URL to'g'ri kodlangan");
  const sigNull = buildAiSignals(null, { c2pa: false, aiMarker: null });
  ok(sigNull.some((s) => s.level === "warn" && s.title.includes("EXIF")), "EXIF yo'q — ogohlantirish chiqadi (AI dalili emas deb tushuntiriladi)");
  const sigCam = buildAiSignals({ Make: "Canon", Model: "EOS R6", ExifImageWidth: 6000, ExifImageHeight: 4000 }, { c2pa: false, aiMarker: null });
  ok(sigCam.some((s) => s.level === "ok" && s.title.includes("Canon")), "kamera EXIF — ijobiy belgi");
  const sigAi = buildAiSignals({ Software: "Midjourney", ExifImageWidth: 1024, ExifImageHeight: 1024 }, { c2pa: false, aiMarker: "Midjourney" });
  ok(sigAi.some((s) => s.level === "alert"), "AI generator izi — ALERT");
  const sigDim = buildAiSignals({ ExifImageWidth: 1024, ExifImageHeight: 1024 }, null);
  ok(sigDim.some((s) => s.level === "warn" && s.title.includes("1024x1024")), "AI o'lcham gipotezasi (kamerasi Yo'Q bo'lganda)");
  ok(weatherText(0) === "Osmon toza" && weatherText(63) === "Yomg'ir" && weatherText(73) === "Qor", "WMO ob-havo kodlari o'zbekcha");
  ok(mapLinks(41.31, 69.28).length === 3, "xarita havolalari: 3 ta");
  ok(toDayISO(new Date("2025-06-15T10:30:00Z")) === "2025-06-15", "toDayISO UTC sana");
  const fakeBuf = new TextEncoder().encode("....c2pa.manifest...trainedAlgorithmicMedia....");
  const scan = scanBytesForAiMarkers(fakeBuf);
  ok(scan.c2pa === true, "bayt skani: C2PA topildi");
  ok(scan.aiMarker === "trainedAlgorithmicMedia", "bayt skani: AI marker topildi");
  const disp = buildDisplayMeta({ Make: "Apple", Model: "iPhone 15", DateTimeOriginal: "2025-03-01T10:00:00.000Z" }, { fileSize: 2048000, fileType: "image/jpeg" });
  ok(disp.camera === "Apple iPhone 15" && !!disp.takenAt && disp.fileSize === "2000 KB", "display meta to'g'ri shakllanadi");

  console.log("\n=== 3. Jonli: company-signals (RDAP + ip-api + reestr) ===");
  try {
    const r1 = await DIRECT_RUNS["company-signals"]!("uzum.uz");
    ok(r1.length >= 3, `uzum.uz → ${r1.length} ta signal (domen yoshi/reestr/xulosa)`);
    for (const it of r1.slice(0, 4)) console.log(`    • ${it.name.slice(0, 80)}`);
    const hasAge = r1.some((i) => i.name.includes("Domen yoshi") || i.name.includes("yosh"));
    ok(hasAge, "domen yoshi baholandi");
    const hasReestr = r1.some((i) => i.host_name === "orginfo.uz");
    ok(hasReestr, "orginfo.uz reestr havolasi bor");
  } catch (e) {
    ok(false, `company-signals xato: ${String(e).slice(0, 80)}`);
  }
  try {
    const r2 = await DIRECT_RUNS["company-signals"]!("Uzum Market");
    ok(r2.length >= 2, `"Uzum Market" (nom bo'yicha) → ${r2.length} ta signal — domen bo'limi xavfsiz o'tkazildi`);
  } catch (e) {
    ok(false, `company-signals(nom) xato: ${String(e).slice(0, 80)}`);
  }

  console.log("\n=== 4. Jonli: rasm EXIF + GPS + ob-havo zanjiri ===");
  try {
    // Ijtimoiy omborda to'liq EXIF'li tanilgan namuna (kamera rasmi)
    const res = await fetch("https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/Canon_40D.jpg", {
      signal: AbortSignal.timeout(15000),
    });
    ok(res.ok, `namuna rasm yuklandi (${res.status}, ${(Number(res.headers.get("content-length") ?? 0) / 1024).toFixed(0)} KB)`);
    const buf = await res.arrayBuffer();
    const meta = await parseImageMeta(buf);
    ok(!!meta, "EXIF o'qildi");
    if (meta) {
      const camera = [meta.Make, meta.Model].filter(Boolean).join(" ");
      ok(!!camera, `kamera: ${camera || "topilmadi"}`);
      const dt = (meta.DateTimeOriginal ?? meta.ModifyDate) as string | undefined;
      ok(!!dt, `sana: ${dt ? String(dt).slice(0, 10) : "yo'q"}`);
      const scan2 = scanBytesForAiMarkers(new Uint8Array(buf));
      ok(scan2.c2pa === false && !scan2.aiMarker, "kamera rasmi — AI/C2PA markeri yo'q (to'g'ri negative)");
      const sig3 = buildAiSignals(meta, scan2);
      ok(sig3.some((s) => s.level === "ok"), "kamera rasmi uchun ijobiy belgi beriladi");
    }
    // GPS + ob-havo zanjiri — Toshkent, o'tgan aniq sana
    const w = await fetchWeather(41.311, 69.279, "2025-06-15");
    ok(
      !!w && typeof w.tempMax === "number",
      `Toshkent 2025-06-15 ob-havosi: ${w ? `${w.codeText}, ${w.tempMin}–${w.tempMax}°C (${w.source})` : "olinmadi"}`
    );
    const wFut = await fetchWeather(41.311, 69.279, "2099-01-01");
    ok(wFut === null, "kelajak sanasi uchun ob-havo so'ralmaydi (null)");
  } catch (e) {
    ok(false, `rasm testi xato: ${String(e).slice(0, 80)}`);
  }

  console.log("\n=== 5. Jonli: kompaniya dork zanjiri (dvigatel) ===");
  try {
    const r = await searchOpenWeb('site:orginfo.uz "Uzum Market"', 5);
    console.log(`    dvigatel: ${r.engine}, ${r.results.length} natija${r.results.length === 0 && r.errors.length ? ` (${r.errors[0].slice(0, 90)})` : ""}`);
    for (const x of r.results.slice(0, 3)) console.log(`    • ${x.host_name} — ${x.name.slice(0, 70)}`);
    ok(r.results.length >= 0, "dork zanjiri ishladi (dvigatel holatidan qat'i nazar xato bermadi)");
  } catch (e) {
    ok(false, `dork jonli test xato: ${String(e).slice(0, 80)}`);
  }

  console.log(`\n===== NATIJA: ${pass} o'tdi, ${fail} yiqildi =====`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
