// Task 25 — yangi dvigatellar jonli test: Yandex, Startpage, Ecosia, Yep
// Ishga tushirish: bun scripts/test-engines-v5.ts
import {
  yandexSearch,
  startpageSearch,
  ecosiaSearch,
  yepSearch,
  SEARCH_ENGINES_VERSION,
} from "../src/lib/search-engines";

const QUERY = `"durov" telegram`;

async function main() {
  console.log(`Versiya: ${SEARCH_ENGINES_VERSION}\n`);
  const engines: [string, (q: string, n: number) => Promise<unknown[]>][] = [
    ["Yandex", yandexSearch],
    ["Startpage", startpageSearch],
    ["Ecosia", ecosiaSearch],
    ["Yep", yepSearch],
  ];
  for (const [name, fn] of engines) {
    const t0 = Date.now();
    try {
      const results = (await fn(QUERY, 6)) as { name: string; url: string; host_name: string }[];
      const ms = Date.now() - t0;
      console.log(`✓ ${name}: ${results.length} natija (${ms}ms)`);
      for (const r of results.slice(0, 3)) {
        console.log(`   - ${r.host_name} · ${r.name.slice(0, 60)}`);
      }
    } catch (e) {
      const ms = Date.now() - t0;
      console.log(`✗ ${name}: ${String(e).slice(0, 90)} (${ms}ms)`);
    }
  }
}

main();
