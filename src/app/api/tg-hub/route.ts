// TG Guruh/Kanal skaneri API — GET (holat) + POST (harakatlar).
// Barcha harakatlar READ-ONLY: hech kimga yozilmaydi, hech qayerga qo'shilmaydi.
// Login: telefon + Telegram kodi + (2FA bo'lsa) parol — sessiya faylga saqlanadi.

import { NextRequest, NextResponse } from "next/server";
import hub, { type TgTarget } from "@/lib/tg-hub";
import tgLogin from "@/lib/tg-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full") === "1";
  const needCreds = req.nextUrl.searchParams.get("creds") === "1";
  const status = hub.status();
  const groups = full ? await hub.listGroups() : null;
  const presets = await hub.presetsStatus();
  const login = tgLogin.getState();
  // Login formasi uchun: saqlangan apiId/apiHash (faqat so'ralganda qaytariladi)
  const stored = needCreds ? tgLogin.storedCredsForClient() : null;
  return NextResponse.json({
    ...status,
    groups,
    presets,
    login,
    build: 7,
    storedCreds: stored ? { apiId: stored.apiId, apiHash: stored.apiHash } : null,
  });
}

interface ActionBody {
  action?: string;
  username?: string;
  ids?: string[];
  usernames?: string[];
  target?: TgTarget;
  // login
  apiId?: string | number;
  apiHash?: string;
  phone?: string;
  code?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ ok: false, message: "JSON noto'g'ri" }, { status: 400 });
  }

  try {
    switch (body.action) {
      // ---------- LOGIN ----------
      case "login-send-code": {
        if (!body.phone?.trim())
          return NextResponse.json({ ok: false, message: "Telefon raqamini kiriting" }, { status: 400 });
        const r = await tgLogin.sendCode({
          apiId: body.apiId,
          apiHash: body.apiHash,
          phone: body.phone,
        });
        return NextResponse.json(r);
      }
      case "login-verify": {
        const r = await tgLogin.verify(body.code ?? "");
        if (tgLogin.getState().stage === "success") hub.resetClient();
        return NextResponse.json(r);
      }
      case "login-password": {
        if (!body.password)
          return NextResponse.json({ ok: false, message: "Parolni kiriting" }, { status: 400 });
        const r = await tgLogin.checkPassword(body.password);
        if (tgLogin.getState().stage === "success") hub.resetClient();
        return NextResponse.json(r);
      }
      case "login-cancel": {
        const r = await tgLogin.cancel();
        return NextResponse.json(r);
      }
      // ---------- SKAN ----------
      case "start-scan": {
        const r = await hub.startScan(body.target ?? {});
        return NextResponse.json(r);
      }
      case "stop-scan": {
        hub.stopScan();
        return NextResponse.json({ ok: true, message: "To'xtatilmoqda..." });
      }
      case "clear-last-scan": {
        hub.clearLastScan();
        return NextResponse.json({ ok: true, message: "Oxirgi skan natijalari tozalandi" });
      }
      // ---------- GURUHLAR ----------
      case "add-group": {
        if (!body.username) return NextResponse.json({ ok: false, message: "Username bo'sh" }, { status: 400 });
        const r = await hub.addGroup(body.username);
        return NextResponse.json(r);
      }
      case "add-groups": {
        const list = (body.usernames ?? [])
          .map((s) => String(s ?? "").trim())
          .filter(Boolean);
        if (list.length === 0)
          return NextResponse.json({ ok: false, message: "Ro'yxat bo'sh" }, { status: 400 });
        const r = await hub.addManyGroups(list);
        return NextResponse.json({ ok: r.added + r.updated > 0, ...r });
      }
      case "delete-groups": {
        const n = await hub.deleteGroups((body.ids ?? []).filter(Boolean));
        return NextResponse.json({ ok: true, message: `${n} ta guruh o'chirildi` });
      }
      case "import-presets": {
        const r = await hub.importPresets();
        return NextResponse.json({
          ok: true,
          message: `Preset import: ${r.added} yangi, ${r.updated} yangilandi, ${r.religious} ta diniy filtrga tushdi`,
        });
      }
      case "resolve-peers": {
        const r = await hub.resolveMissingPeers(20);
        return NextResponse.json({ ok: r.resolved > 0 || (!hub.authDead && !r.flood && r.remaining === 0), ...r });
      }
      default:
        return NextResponse.json({ ok: false, message: "Noma'lum harakat" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: `Server xatosi: ${((e as Error)?.message ?? "noma'lum").slice(0, 140)}` },
      { status: 500 }
    );
  }
}
