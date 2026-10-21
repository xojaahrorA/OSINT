// profile-verify jonli test — real HTTP tekshiruvlari
// Ishlatish: bun scripts/test-profile-verify.ts
// Durov — barcha platformalarda mavjud; "nonexistent_user_zzz9x" — hech qayerda yo'q.

import { verifyProfileLinks } from "@/lib/profile-verify";

async function run(u: string, expectDropped: boolean) {
  const t0 = Date.now();
  const v = await verifyProfileLinks(u);
  const ms = Date.now() - t0;
  console.log(`\n=== @${u} — ${ms}ms`);
  console.log(`  tasdiqlandi: ${v.verified} · olib tashlandi: ${v.dropped} · aniqlanmadi: ${v.unknown}`);
  for (const it of v.items) {
    console.log(`  [${it.verified?.toUpperCase()}] ${it.host_name} — ${it.verifyNote?.slice(0, 80)}`);
  }
  if (expectDropped) {
    if (v.dropped === 0) {
      console.log(`  ❌ KUTILGAN: mavjud bo'lmagan username uchun kamida 1 ta sayt "yo'q" deb topilishi kerak edi`);
      process.exitCode = 1;
    } else {
      console.log(`  ✓ Mavjud bo'lmagan profillar olib tashlandi (${v.dropped} ta)`);
    }
  }
}

const u1 = process.argv[2] ?? "durov";
const u2 = process.argv[3] ?? "nonexistent_user_zzz9x_qq";
await run(u1, false);
await run(u2, true);
