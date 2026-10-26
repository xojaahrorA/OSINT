// TG Guruh/Kanal skaneri API — GET (holat) + POST (harakatlar).
// Barcha harakatlar READ-ONLY: hech kimga yozilmaydi, hech qayerga qo'shilmaydi.

import { NextRequest, NextResponse } from "next/server";
import hub, { type TgTarget } from "@/lib/tg-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full") === "1";
  const status = hub.status();
  const groups = full ? await hub.listGroups() : null;
  const presets = await hub.presetsStatus();
  return NextResponse.json({ ...status, groups, presets });
}

interface ActionBody {
  action?: string;
  username?: string;
  ids?: string[];
  target?: TgTarget;
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
      case "add-group": {
        if (!body.username) return NextResponse.json({ ok: false, message: "Username bo'sh" }, { status: 400 });
        const r = await hub.addGroup(body.username);
        return NextResponse.json(r);
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
