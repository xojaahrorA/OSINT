// API kalitlari boshqaruvi — sozlamalar sahifasi uchun.
// GET: bazadagi kalitlar (MASKALANGAN) + .env'dagi holat
// POST: kalitni saqlash (SQLite — platforma qayta ishga tushsa ham o'chmaydi)
// DELETE: kalitni o'chirish

import { NextRequest } from "next/server";
import {
  listStoredKeys,
  loadDbKeys,
  saveStoredKey,
  deleteStoredKey,
  maskKey,
} from "@/lib/keys";
import { PREMIUM_SOURCES, premiumKeySet } from "@/lib/premium-sources";

export async function GET() {
  await loadDbKeys(); // env'dagi kalitlar bilan birga holatni yangilaymiz
  const stored = await listStoredKeys();
  const sources = PREMIUM_SOURCES.map((s) => {
    const envKeys = [s.envKey, ...(s.envKey2 ? [s.envKey2] : [])];
    const parts = envKeys.map((ek) => {
      const storedRow = stored.find((x) => x.envKey === ek);
      const envVal = process.env[ek]?.trim();
      return {
        envKey: ek,
        set: Boolean(storedRow || envVal),
        masked: storedRow?.masked ?? (envVal ? maskKey(envVal) : ""),
        from: storedRow ? "db" : envVal ? "env" : "",
      };
    });
    return {
      id: s.id,
      title: s.title,
      what: s.what,
      getKeyUrl: s.getKeyUrl,
      free: s.free,
      appliesTo: s.appliesTo,
      keys: parts,
      active: premiumKeySet(s.id),
    };
  });
  return Response.json({ sources });
}

export async function POST(req: NextRequest) {
  let body: { envKey?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov tanasi" }, { status: 400 });
  }
  const envKey = (body.envKey ?? "").trim();
  const value = (body.value ?? "").trim();
  if (!envKey || !value) {
    return Response.json(
      { error: "envKey va value maydonlari talab qilinadi" },
      { status: 400 }
    );
  }
  // Faqat ma'lum kalit nomlariga ruxsat (PREMIUM_SOURCES envKey'lari)
  const allowed = new Set(
    PREMIUM_SOURCES.flatMap((s) => [s.envKey, ...(s.envKey2 ? [s.envKey2] : [])])
  );
  if (!allowed.has(envKey)) {
    return Response.json({ error: `Noma'lum kalit nomi: ${envKey}` }, { status: 400 });
  }
  const ok = await saveStoredKey(envKey, value);
  if (!ok) {
    return Response.json({ error: "Bazaga yozish amalga oshmadi" }, { status: 500 });
  }
  return Response.json({ ok: true, envKey, masked: maskKey(value) });
}

export async function DELETE(req: NextRequest) {
  const envKey = req.nextUrl.searchParams.get("envKey") ?? "";
  const allowed = new Set(
    PREMIUM_SOURCES.flatMap((s) => [s.envKey, ...(s.envKey2 ? [s.envKey2] : [])])
  );
  if (!envKey || !allowed.has(envKey)) {
    return Response.json({ error: "Noma'lum kalit nomi" }, { status: 400 });
  }
  const ok = await deleteStoredKey(envKey);
  if (!ok) {
    return Response.json({ error: "O'chirish amalga oshmadi" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
