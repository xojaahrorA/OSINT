// IntelBase uslubidagi sintez baholari (barcha maqsad turlari) — unit + jonli testlar
// Ishga tushirish: bun scripts/test-target-score.ts
import type { SearchResultItem, TargetType } from "../src/lib/osint";
import {
  collectLinkedIntel,
  linkedCard,
  computeUsernameAssessment,
  computePhoneAssessment,
  computeNameAssessment,
  computeDomainAssessment,
  computeIpAssessment,
  computeCompanyAssessment,
  SYNTHESIS_MODULES,
  SYNTHESIS_RUNS,
  usernameScoreSource,
  phoneScoreSource,
  nameScoreSource,
  domainScoreSource,
  ipScoreSource,
  companyScoreSource,
} from "../src/lib/target-score";
import { buildEntityGraph } from "../src/lib/entity-graph";
import type { ModuleResult } from "../src/lib/osint";

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

const it = (
  name: string,
  url: string,
  snippet: string,
  host: string,
  verified?: "yes" | "no" | "unknown"
): SearchResultItem => ({ name, url, snippet, host_name: host, verified });

async function main() {
  console.log("\n=== UNIT: SYNTHESIS xaritasi ===");
  const types: TargetType[] = ["username", "email", "phone", "name", "domain", "ip", "company"];
  ok(
    "SYNTHESIS_MODULES barcha 7 tur uchun ta'riflangan",
    types.every((t) => SYNTHESIS_MODULES[t] !== null),
  );
  ok(
    "SYNTHESIS_RUNS barcha sintez id larida runner bor",
    types.every((t) => !!SYNTHESIS_RUNS[SYNTHESIS_MODULES[t]!.id]),
  );

  console.log("\n=== UNIT: Bog'lanishlar (korelyatsiya) ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      "site-probe": [
        it(
          "Sayt ishlayapti: Example",
          "https://example.uz",
          "Title: Example | Email: info@example.uz, support@example.uz | Texnologiyalar: Next.js",
          "example.uz",
        ),
      ],
      whois: [
        it(
          "WHOIS: UZDOMAIN",
          "https://client.rdap.org/?object=example.uz",
          "Registrator: UZDOMAIN | Ro'yxatga olingan: 2015-03-10 | Kontakt: admin@other.org",
          "client.rdap.org",
        ),
      ],
      "username-probe": [
        it("Telegram: mavjud", "https://t.me/example_uz", "Ismi: Example UZ | Kanal", "t.me"),
      ],
    };
    const li = collectLinkedIntel("example.uz", "domain", mr);
    ok("korporativ pochtalar topildi", li.matches.some((m) => m.includes("Korporativ pochta")), JSON.stringify(li.matches));
    ok("maqsad domeni o'zi bog'lanish emas", !li.entries.some((e) => e.kind === "domain" && e.value === "example.uz"));
    ok("username entiteti chiqdi", li.entries.some((e) => e.kind === "username" && e.value.includes("example")));
    const card = linkedCard(li, "example.uz");
    ok("Bog'lanishlar kartasi yasaldi", !!card && card.name.includes("Bog'lanishlar"), card?.name ?? "null");

    // username maqsad: lokal qism mosligi
    const li2 = collectLinkedIntel("example_uz", "username", {
      search: [it("Kontakt", "https://example.uz/about", "Bog'lanish: example_uz@gmail.com", "example.uz")],
    });
    ok(
      "email lokal qismi username bilan mos — KUCHLI",
      li2.matches.some((m) => m.includes("KUCHLI")),
      JSON.stringify(li2.matches),
    );

    // email maqsad: lokal qismiga mos username
    const li3 = collectLinkedIntel("example_uz@gmail.com", "email", {
      whatsmyname: [it("Instagram — @example_uz profili topildi", "https://instagram.com/example_uz", "WhatsMyName: profil mavjud", "instagram.com")],
    });
    ok(
      "username profil email lokal qismi bilan mos",
      li3.matches.some((m) => m.includes("username'i email lokal qismi bilan mos")),
      JSON.stringify(li3.matches),
    );

    // phone maqsad: t.me izlari
    const li4 = collectLinkedIntel("+998901234567", "phone", {
      "phone-mentions": [it("Telegram post", "https://t.me/somechannel/123", "Kontakt: +998901234567", "t.me")],
    });
    ok("telefon → telegram profillar", li4.matches.some((m) => m.includes("Telegram'da bog'langan")), JSON.stringify(li4.matches));

    // bo'sh holat
    const empty = linkedCard(collectLinkedIntel("qqqq", "name", {}), "qqqq");
    ok("natija bo'lmasa karta ham yo'q", empty === null);
  }

  console.log("\n=== UNIT: username bahosi (stealer log bilan) ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      whatsmyname: [
        ...Array.from({ length: 15 }, (_, i) =>
          it(`Platform${i} — @durov profili topildi`, `https://p${i}.example.com/durov`, "WhatsMyName dataset: profil mavjud [HTTP 200 + imzo]", `p${i}.example.com`),
        ),
        it("Telegram — @durov profili topildi", "https://t.me/durov", "WhatsMyName dataset: profil mavjud [HTTP 200 + imzo] · social", "t.me"),
      ],
      "stealer-logs": [
        it("Stealer logda topildi: 2 zararlangan kompyuter", "https://www.hudsonrock.com/free-tools", "Shu username infostealer ...", "hudsonrock.com"),
        it("Zararlangan qurilma (RedLine)", "https://cavalier.hudsonrock.com/", "Zararlanish sanasi: 2023-05-12 | Malumot o'g'risi: RedLine | Korporativ xizmatlar: 3 · Foydalanuvchi xizmatlari: 10", "hudsonrock.com"),
      ],
      "username-probe": [it("GitHub: mavjud", "https://github.com/durov", "Ism: Pavel Durov | 5 repo", "github.com")],
    };
    const a = await computeUsernameAssessment("durov", mr);
    ok("Kenglik 50+ (16 platforma + probe)", a.reach.score >= 50, `score=${a.reach.score} ${JSON.stringify(a.reach.reasons)}`);
    ok("Ochiqlik 45+ (stealer log)", a.exposure.score >= 45, `score=${a.exposure.score}`);
    ok("stealer sanasi timeline'da", a.timeline.some((t) => t.date.startsWith("2023-05-12")), JSON.stringify(a.timeline.slice(0, 2)));
    ok("ism aniqlandi (Pavel Durov)", a.identityNote.includes("Pavel"), a.identityNote);
    const items = await usernameScoreSource("durov", mr);
    ok("username-score kamida 3 karta (baho+ishonch+timeline)", items.length >= 3, `${items.length} karta`);
    ok("baho kartasida KENGLIK va OCHIQLIK", /KENGLIK[\s\S]*OCHIQLIK/.test(items[0]?.snippet ?? ""));
  }

  console.log("\n=== UNIT: telefon bahosi ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      "phone-meta": [
        it("Telefon razvedka: UZ — mobil telefon", "https://www.sync.me/search/?number=%2B998901234567", "Mamlakat: UZ (+998) | Tur: mobil telefon | Operator kodi 90: Ucell (portatsiya mumkin)", "sync.me"),
      ],
      "phone-mentions": [
        it("OLX e'lon", "https://www.olx.uz/ud/123/", "+998 90 123 45 67 qo'ng'iroq qiling", "olx.uz"),
        it("Telegram kanal", "https://t.me/uz_kanal/45", "Aloha: +998901234567", "t.me"),
      ],
    };
    const a = await computePhoneAssessment("+998901234567", mr);
    ok("Haqiqiyligi 65 (format+operator+mobil)", a.validity.score >= 65, `score=${a.validity.score}`);
    ok("Faollik > 20 (2 host + telegram)", a.activity.score >= 20, `score=${a.activity.score}`);
    ok("Ochiqlik 0 (oqish yo'q)", a.exposure.score === 0, `score=${a.exposure.score}`);
    const items = await phoneScoreSource("+998901234567", mr);
    ok("phone-score kamida 2 karta", items.length >= 2, `${items.length}`);
    ok("baho kartasida HAQIQIYLIGI/FAOLLIK/OCHIQLIK", /HAQIQIYLIGI[\s\S]*FAOLLIK[\s\S]*OCHIQLIK/.test(items[0]?.snippet ?? ""));
  }

  console.log("\n=== UNIT: ism bahosi ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      "wiki-people": [it("Pavel Durov", "https://duckduckgo.com/c/durov", "Pavel Durov — Telegram asoschisi. Abstract: ...", "duckduckgo.com")],
      news: [
        it("Durov bayonot berdi", "https://example-news.com/durov", "Pavel Durov bayonot", "example-news.com"),
        it("Durov intervyu", "https://example-news2.com/durov", "Pavel Durov intervyu", "example-news2.com"),
      ],
      "person-public": [
        it("Lavozim", "https://example.org/person", "Telegram CEO Pavel Durov", "example.org"),
      ],
      social: [
        it("Instagram", "https://instagram.com/durov", "Pavel Durov profil", "instagram.com"),
        it("X", "https://x.com/durov", "Pavel Durov profil", "x.com"),
        it("VK", "https://vk.com/durov", "Pavel Durov profil", "vk.com"),
        it("Facebook", "https://facebook.com/durov", "Pavel Durov profil", "facebook.com"),
      ],
    };
    const a = await computeNameAssessment("Pavel Durov", mr);
    ok("Ommaviyligi 60+ (wiki+news+person+social)", a.presence.score >= 60, `score=${a.presence.score} ${JSON.stringify(a.presence.reasons)}`);
    ok("aniqlilik mosligi hisoblangan", a.identity.score > 0, `score=${a.identity.score}`);
    ok("maxfiylik eslatmasi bor", a.privacyNote.includes("ochiq"));
    const items = await nameScoreSource("Pavel Durov", mr);
    ok("name-score kamida 2 karta", items.length >= 2, `${items.length}`);
    ok("bir so'zli ism uchun bo'sh", (await nameScoreSource("Durov", {})).length === 0);
  }

  console.log("\n=== UNIT: domen bahosi ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      whois: [
        it("WHOIS: UZINFOCOM", "https://client.rdap.org/?object=reg.uz", "Registrator: UZINFOCOM | Ro'yxatga olingan: 2000-01-01 | Muddati tugaydi: 2030-01-01 | Kontakt: admin@reg.uz", "client.rdap.org"),
      ],
      "site-probe": [
        it("Sayt ishlayapti: REG", "https://reg.uz", "Title: REG | Email: info@reg.uz", "reg.uz"),
        it("robots.txt mavjud", "https://reg.uz/robots.txt", "User-agent: *", "reg.uz"),
      ],
      subdomains: [
        it("api.reg.uz", "https://api.reg.uz", "SSL sertifikatida uchraydi", "api.reg.uz"),
        it("mail.reg.uz", "https://mail.reg.uz", "SSL sertifikatida uchraydi", "mail.reg.uz"),
      ],
    };
    const a = await computeDomainAssessment("reg.uz", mr);
    // DoH jonli tekshiruv muhitga bog'liq (reg.uz NS/MX bo'lmasa ham live+robots 40 beradi)
    ok("Salomatlik 40+ (live+robots, DoH qo'shiladi)", a.health.score >= 40, `score=${a.health.score} ${JSON.stringify(a.health.reasons)}`);
    ok("Qadimiyligi 30 (2000-yildan)", a.age.score >= 30, `score=${a.age.score}`);
    ok("Ochiqlik 14 (2 subdomen + email)", a.exposure.score >= 14, `score=${a.exposure.score}`);
    ok("timeline'da ro'yxatga olish sanasi", a.timeline.some((t) => t.label.includes("ro'yxatdan o'tgan")));
    const items = await domainScoreSource("reg.uz", mr);
    ok("domain-score kamida 3 karta", items.length >= 3, `${items.length}`);
    // Bog'lanishlar: korporativ pochta
    ok("domen skanida korporativ pochta bog'lanishi", items.some((r) => r.name.includes("Bog'lanishlar") && r.snippet.includes("Korporativ pochta")), items.map((r) => r.name).join(" | "));
  }

  console.log("\n=== UNIT: IP bahosi ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      "ip-intel": [
        it("Joylashuv: Ashburn, United States", "https://ipinfo.io/8.8.8.8", "ISP: Google LLC | AS: AS15169 | Reverse DNS: dns.google | Belgilar: hosting/data-markaz", "ipinfo.io"),
        it("Shodan: 3 ta ochiq port", "https://www.shodan.io/host/8.8.8.8", "Ochiq portlar: 53, 443, 853 | Hostnames: dns.google", "shodan.io"),
      ],
      "whois-ip": [it("Tarmoq: GOOGLE", "https://client.rdap.org/?object=8.8.8.8", "Tarmoq nomi: GOOGLE | Egasi: Google LLC | Mamlakat: US", "client.rdap.org")],
      "ptr-recon": [it("PTR: dns.google", "https://dnschecker.org/#PTR/8.8.8.8", "Reverse DNS (PTR): dns.google", "dnschecker.org")],
    };
    const a = await computeIpAssessment("8.8.8.8", mr);
    ok("Tarmoq profili 70 (ISP+geo+netname+PTR)", a.network.score >= 70, `score=${a.network.score} ${JSON.stringify(a.network.reasons)}`);
    ok("Ochiqligi 15 (3 port ×5)", a.exposure.score === 15, `score=${a.exposure.score}`);
    const items = await ipScoreSource("8.8.8.8", mr);
    ok("ip-score kamida 1 karta", items.length >= 1, `${items.length}`);
    ok("IP bo'lmasa bo'sh", (await ipScoreSource("not-an-ip", {})).length === 0);
  }

  console.log("\n=== UNIT: kompaniya bahosi ===");
  {
    const mr: Record<string, SearchResultItem[]> = {
      "company-signals": [
        it("Domen yoshi: 12.0 yil — ijobiy belgi", "https://client.rdap.org/?object=example.uz", "Domen 2014-01-01 da ro'yxatga olingan.", "client.rdap.org"),
        it("Xavf belgisi: domeni juda yosh (0.3 yil)", "https://client.rdap.org/?object=shop.uz", "Domen 2026-08-01 da ro'yxatdan o'tgan.", "client.rdap.org"),
      ],
      "company-registry": [it("Reestr topildi", "https://orginfo.uz/search?q=example", "Ro'yxatga olingan: 2014-05-01 | Rahbar: Karimov", "orginfo.uz")],
      "company-fraud": [
        it("Soxta sahifa haqida shikoyat", "https://scamadviser.com/check-website/example.uz", "Bu sayt firibgarlik belgilarini ko'rsatmoqda", "scamadviser.com"),
      ],
      "company-risk": [
        it("Sud da'vosi", "https://sud.uz/case/1", "Kompaniya ustidan da'vo arizasi", "sud.uz"),
      ],
    };
    const a = await computeCompanyAssessment("Example MChJ", mr);
    ok("Rasmiylik: reestr+25, ijobiy+5, yosh domen −15 → 15", a.legitimacy.score === 15, `score=${a.legitimacy.score} ${JSON.stringify(a.legitimacy.reasons)}`);
    ok("Ishonchlilik 50'dan past (fraud+sud)", a.trust.score < 50, `score=${a.trust.score} ${JSON.stringify(a.trust.reasons)}`);
    const items = await companyScoreSource("Example MChJ", mr);
    ok("company-score kamida 2 karta", items.length >= 2, `${items.length}`);
    ok("baho kartasida RASMIYLIK/ISHONCHLILIK/RAQAMLI IZ", /RASMIYLIK[\s\S]*ISHONCHLILIK[\s\S]*RAQAMLI IZ/.test(items[0]?.snippet ?? ""));
  }

  console.log("\n=== UNIT: entity-graph qo'shimcha bog'lanishlar ===");
  {
    const modules: ModuleResult[] = [
      {
        moduleId: "search",
        moduleTitle: "Qidiruv",
        status: "done",
        count: 3,
        results: [
          it("Telegram API xizmati", "https://api.telegram.org/durov", "Telegram bot API uchun domen", "api.telegram.org"),
          it("Telegram rasmiy", "https://telegram.org/faq", "Telegram savol-javob", "telegram.org"),
          it("Kontakt sahifa", "https://example.org/contact", "Bog'lanish: durov@example.org yoki @durov", "example.org"),
        ],
      },
    ];
    const g = buildEntityGraph({ type: "username", query: "durov" }, modules);
    const hasSubLink = g.links.some(
      (l) => l.kind === "linked" && l.source.includes("api.telegram.org") && l.target.includes("telegram.org"),
    );
    ok("subdomen → asosiy domen qirrasi", hasSubLink, JSON.stringify(g.links.filter((l) => l.kind === "linked")));
    const hasLocalLink = g.links.some(
      (l) => l.kind === "linked" && l.source.includes("ent:username:durov") && l.target.includes("ent:email:durov@example.org"),
    );
    ok("username ↔ email lokal qismi qirrasi", hasLocalLink);
  }

  console.log("\n=== LIVE: sintez manbalari ===");
  {
    const items = await usernameScoreSource("durov", {});
    ok("LIVE username-score: jonli Hudson Rock ishlaydi", items.length >= 2, `${items.length} karta`);
    const ipItems = await ipScoreSource("8.8.8.8", {});
    ok("LIVE ip-score: ip-api+ShodanDB zaxira so'rovlar", ipItems.length >= 1 && /TARMOQ PROFILI/.test(ipItems[0]?.snippet ?? ""));
    const domItems = await domainScoreSource("example.com", {});
    ok("LIVE domain-score: DoH + RDAP jonli", domItems.length >= 1 && /SALOMATLIK/.test(domItems[0]?.snippet ?? ""), `${domItems.length} karta`);
  }

  console.log(`\n===== NATIJA: ${pass} o'tdi, ${fail} xato =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test xatosi:", e);
  process.exit(1);
});
