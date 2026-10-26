// OSINT Radar — API kalitlari boshqaruvi
//
// MUAMMO: platforma qayta ishga tushganda .env fayli tozalanib qoladi
// (faqat DATABASE_URL qoladi) — foydalanuvchi kiritgan kalitlar YO'QOLARDI.
//
// YECHIM: kalitlar SQLite bazada (ApiKey modeli) saqlanadi. Har skan/diagnostika
// ishga tushganda loadDbKeys() bazadagi kalitlarni process.env'ga birlashtiradi —
// premium-sources.ts'dagi keyOf() va barcha modullar avtomatik o'qiy oladi.
//
// XAVFSIZLIK: kalitlar faqat server tomonda o'qiladi; API javoblarida MASKALANADI
// (faqat oxirgi 4 belgi ko'rinadi), to'liq qiymat qaytarmaydi.

import { db } from "@/lib/db";

/** Bazadagi kalitlarni process.env'ga birlashtirish.
 *  DB band bo'lsa ham hech qachon tashlamaydi (env'dagi kalitlar ishlaydi). */
export async function loadDbKeys(): Promise<number> {
  try {
    const rows = await db.apiKey.findMany();
    if (rows.length === 0) return 0;
    let n = 0;
    for (const r of rows) {
      const k = r.envKey.trim();
      const v = r.value.trim();
      if (!k || !v) continue;
      if (!/^[A-Z0-9_]{3,64}$/.test(k)) continue; // faqat to'g'ri formatli kalitlar
      process.env[k] = v;
      n++;
    }
    return n;
  } catch {
    return 0; // DB yo'q/toshlangan — env'dagi kalitlar bilan davom etamiz
  }
}

/** Kalit qiymatini maskalash — UI/diagnostikada ko'rsatish uchun */
export function maskKey(v: string): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (s.length <= 8) return "••••";
  return `••••••••${s.slice(-4)}`;
}

/** Bazadagi barcha kalitlar (maskalangan) — /api/keys GET javobi uchun */
export async function listStoredKeys(): Promise<
  { envKey: string; masked: string; updatedAt: Date }[]
> {
  try {
    const rows = await db.apiKey.findMany();
    return rows.map((r) => ({
      envKey: r.envKey,
      masked: maskKey(r.value),
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

/** Kalitni saqlash/upsert — /api/keys POST uchun */
export async function saveStoredKey(envKey: string, value: string): Promise<boolean> {
  const k = envKey.trim();
  const v = value.trim();
  if (!/^[A-Z0-9_]{3,64}$/.test(k) || !v) return false;
  try {
    await db.apiKey.upsert({
      where: { envKey: k },
      update: { value: v },
      create: { envKey: k, value: v },
    });
    process.env[k] = v; // shu jarayonda darhol faol
    return true;
  } catch {
    return false;
  }
}

/** Kalitni o'chirish — /api/keys DELETE uchun */
export async function deleteStoredKey(envKey: string): Promise<boolean> {
  const k = envKey.trim();
  if (!k) return false;
  try {
    await db.apiKey.delete({ where: { envKey: k } });
    delete process.env[k];
    return true;
  } catch {
    return false;
  }
}
