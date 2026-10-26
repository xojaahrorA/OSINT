// IntelBase uslubidagi email modullari — jonli va unit testlar
// Ishga tushirish: bun scripts/test-email-intel.ts
import {
  hudsonRockSource,
  leakCheckSource,
  breachesSource,
  isRoleLocalPart,
  breachCatalogFacts,
} from "../src/lib/osint-sources";
import {
  emailScoreSource,
  computeEmailAssessment,
  collectOwnerNames,
} from "../src/lib/email-score";
import type { SearchResultItem } from "../src/lib/osint";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const WEBTEST_EMAIL = "test@gmail.com"; // Hudson Rock/LeakCheck hujjatlarida mashhur test manzili

async function main() {
  console.log("\n=== UNIT: yordamchilar ===");
  ok("isRoleLocalPart(info) = true", isRoleLocalPart("info") === true);
  ok("isRoleLocalPart(dilshod) = false", isRoleLocalPart("dilshod") === false);
  ok("isRoleLocalPart(admin1) = true", isRoleLocalPart("admin1") === true);
  const names = collectOwnerNames({
    gravatar: [
      { name: "Gravatar profil: Dilshod Karimov", url: "", snippet: "Ism: Dilshod Karimov | Username: d", host_name: "g" },
    ],
    "github-email": [
      { name: "GitHub: Dilshod Karimov", url: "", snippet: "Git ismi: Dilshod Karimov | 3 ta commit", host_name: "github.com" },
    ],
  });
  ok("collectOwnerNames birlashtiradi (2 → 1)", names.length === 1 && names[0] === "Dilshod Karimov", JSON.stringify(names));

  console.log("\n=== LIVE: Hudson Rock stealer-logs (email) ===");
  const hr = await hudsonRockSource(WEBTEST_EMAIL);
  ok("javob bo'sh emas", hr.length > 0, `${hr.length} ta`);
  ok("topildi yoki yo'q — baribir izohli", hr[0]?.name.includes("Stealer") || hr[0]?.name.includes("yo'q"), hr[0]?.name);
  const hru = await hudsonRockSource("durov");
  ok("username rejimi ham ishlaydi", hru.length > 0, hru[0]?.name);

  console.log("\n=== LIVE: LeakCheck (email) ===");
  const lc = await leakCheckSource(WEBTEST_EMAIL);
  ok("javob bo'sh emas", lc.length > 0);
  ok("yozuv soni ko'rsatiladi", /LeakCheck/.test(lc[0]?.name ?? ""), lc[0]?.name);

  console.log("\n=== LIVE: breaches + HIBP katalog boyitishi ===");
  const br = await breachesSource(WEBTEST_EMAIL);
  ok("asosiy oqish kartasi bor", br.some((r) => r.name.startsWith("Oqishlarda topildi")));
  const enriched = br.filter((r) => r.host_name === "haveibeenpwned.com");
  ok("HIBP katalogdan boyitilgan kartalar chiqdi", enriched.length > 0, `${enriched.length} ta`);
  if (enriched.length > 0) {
    ok("boyitishda sana bor", /Oqish sanasi/.test(enriched[0].snippet), enriched[0].snippet.slice(0, 80));
  }

  console.log("\n=== LIVE: breachCatalogFacts nom moslash ===");
  const facts = await breachCatalogFacts(["LinkedInScrape-2021", "Adobe", "YoqBoshidanomaslashNomiXYZ"]);
  ok("LinkedInScrape-2021 mosladi", facts.some((f) => /linkedin/i.test(f.title)), JSON.stringify(facts.map((f) => f.title)));
  ok("Adobe mosladi", facts.some((f) => /adobe/i.test(f.title)));
  ok("nomuvchiq nom chetlanadi", !facts.some((f) => /XYZ/i.test(f.title)));

  console.log("\n=== LIVE: email-score (IntelBase assessment) ===");
  const items = await emailScoreSource(WEBTEST_EMAIL, {});
  ok("baho kartasi bor", items.length >= 2, `${items.length} ta`);
  const main = items.find((r) => r.name.startsWith("Umumiy baho"));
  ok("ballar formatda", /Haqiqiyligi \d+\/100 · Ochiqlik \d+\/100/.test(main?.name ?? ""), main?.name);
  const asmt = await computeEmailAssessment(WEBTEST_EMAIL, {});
  ok("authenticity 0-100", asmt.authenticity >= 0 && asmt.authenticity <= 100, String(asmt.authenticity));
  ok("exposure 0-100 va yuqori (test manzili oqishlarda)", asmt.exposure > 40, String(asmt.exposure));
  ok("timeline to'ldi", asmt.timeline.length > 0, `${asmt.timeline.length} voqea`);
  ok(
    "timeline kronologik kamayish tartibda",
    asmt.timeline.every((t, i) => i === 0 || asmt.timeline[i - 1].date >= t.date)
  );
  ok("stealer asosida +40 bor", asmt.exposureReasons.some((r) => r.includes("stealer") || r.includes("Zararlangan")));
  console.log(`  Baho: Authenticity=${asmt.authenticity} Exposure=${asmt.exposure} Timeline=${asmt.timeline.length}`);
  console.log(`  Asoslar: ${[...asmt.exposureReasons.slice(0, 3)].join(" · ")}`);

  console.log("\n=== Nativ: non-email target email-score'da bo'sh ===");
  const empty = await emailScoreSource("dilshod_dev", {});
  ok("non-email → 0 natija", empty.length === 0);

  console.log(`\n=== NATIJA: ${pass} ✓ / ${fail} ✗ ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test xatosi:", e);
  process.exit(1);
});
