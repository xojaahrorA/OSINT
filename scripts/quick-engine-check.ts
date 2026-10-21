// v6 tekshiruv: transient-retry + UA rotatsiyasi bilan zanjir
import { searchOpenWeb, SEARCH_ENGINES_VERSION } from "../src/lib/search-engines";

async function main() {
  console.log(`Versiya: ${SEARCH_ENGINES_VERSION}`);
  const t0 = Date.now();
  const r = await searchOpenWeb("site:t.me durov", 5);
  console.log(`Dvigatel: ${r.engine} · ${r.results.length} natija · ${Date.now() - t0}ms`);
  for (const x of r.results.slice(0, 3)) console.log(`  - ${x.host_name} · ${x.name.slice(0, 50)}`);
  if (r.errors.length) console.log(`Xatolar: ${r.errors.slice(0, 4).join(" | ")}`);
}
main();
