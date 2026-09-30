// Dvigatel HTML tashxisi — nima kelganini ko'rish uchun
import {
  yandexSearch,
  startpageSearch,
  ecosiaSearch,
  yepSearch,
} from "../src/lib/search-engines";

async function probe(name: string, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,uz;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...headers,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    console.log(
      `=== ${name}: HTTP ${res.status}, ${text.length} bayt, final: ${res.url.slice(0, 90)}`
    );
    console.log(text.slice(0, 400).replace(/\s+/g, " "));
    // h2/a patternlar bor-yo'qligini tekshirish
    console.log(`   h2>h avlolar: ${(text.match(/<h2[^>]*><a/g) ?? []).length}`);
    console.log(`   organic__url: ${(text.match(/organic__url/g) ?? []).length}`);
    console.log(`   wgl-link: ${(text.match(/wgl-link/g) ?? []).length}`);
    console.log(`   captcha so'zi: ${/captcha/i.test(text.slice(0, 8000))}`);
    console.log();
  } catch (e) {
    console.log(`=== ${name}: XATO ${String(e).slice(0, 90)}\n`);
  }
}

async function main() {
  await probe("Yandex", "https://yandex.com/search/?text=%22durov%22%20telegram", {
    Referer: "https://yandex.com/",
  });
  await probe("Startpage", "https://www.startpage.com/sp/search?query=%22durov%22%20telegram", {
    Referer: "https://www.startpage.com/",
  });
  // Ecosia/Yep 403 — shunchaki natija holati
  try {
    await ecosiaSearch("test", 3);
    console.log("Ecosia OK");
  } catch (e) {
    console.log(`Ecosia: ${String(e).slice(0, 60)}`);
  }
  try {
    await yepSearch("test", 3);
    console.log("Yep OK");
  } catch (e) {
    console.log(`Yep: ${String(e).slice(0, 60)}`);
  }
}

main();
