import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * Skaner sessiyalari tarixi — ma'lumotlar bazasida saqlash va tiklash.
 * Har bir qidirilgan shaxs/maqsad uchun to'liq holat nusxasi (snapshot)
 * saqlanadi: modullar, topilmalar, intel paneli, AI xulosalar —
 * sahifa yangilanganda ham yo'qolmaydi.
 */

interface SnapshotPayload {
  modules?: unknown;
  results?: unknown;
  intel?: unknown;
  verdicts?: unknown;
  skipped?: unknown;
}

const VALID_TYPES = ["username", "email", "phone", "name", "domain", "ip"];

/** Ro'yxat — oxirgi 50 sessiya (snapshot'siz, yengil) */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  try {
    if (id) {
      // Bitta sessiyani to'liq olish — tiklash uchun
      const session = await db.scanSession.findUnique({ where: { id } });
      if (!session) {
        return Response.json({ error: "Sessiya topilmadi" }, { status: 404 });
      }
      let snapshot: SnapshotPayload = {};
      try {
        snapshot = session.snapshotJson ? JSON.parse(session.snapshotJson) : {};
      } catch {
        snapshot = {};
      }
      let queries: string[] = [];
      try {
        queries = session.queriesJson ? JSON.parse(session.queriesJson) : [];
      } catch {
        queries = [];
      }
      return Response.json({
        session: {
          id: session.id,
          rootQuery: session.rootQuery,
          rootType: session.rootType,
          queries,
          status: session.status,
          totalResults: session.totalResults,
          scansDone: session.scansDone,
          aiText: session.aiText,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          snapshot,
        },
      });
    }
    const sessions = await db.scanSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        rootQuery: true,
        rootType: true,
        status: true,
        totalResults: true,
        scansDone: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return Response.json({ sessions });
  } catch {
    return Response.json({ error: "Tarixni o'qish xatosi" }, { status: 500 });
  }
}

/** Saqlash (upsert) — shu maqsad qayta skanerlansa eski yozuv yangilanadi */
export async function POST(req: NextRequest) {
  let body: {
    rootQuery?: string;
    rootType?: string;
    queries?: string[];
    status?: string;
    totalResults?: number;
    scansDone?: number;
    snapshot?: SnapshotPayload;
    aiText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const rootQuery = (body.rootQuery ?? "").trim();
  const rootType = (body.rootType ?? "").trim();
  if (!rootQuery || !VALID_TYPES.includes(rootType)) {
    return Response.json(
      { error: "rootQuery va to'g'ri rootType kerak" },
      { status: 400 }
    );
  }

  const status = body.status === "stopped" ? "stopped" : "done";
  const totalResults = Math.max(0, Math.floor(Number(body.totalResults) || 0));
  const scansDone = Math.max(0, Math.floor(Number(body.scansDone) || 0));
  const queries = Array.isArray(body.queries)
    ? body.queries.filter((q) => typeof q === "string").slice(0, 20)
    : [];
  const snapshotJson = body.snapshot ? JSON.stringify(body.snapshot) : null;
  const aiText = (body.aiText ?? "").slice(0, 60_000) || null;

  try {
    const existing = await db.scanSession.findUnique({
      where: { rootQuery_rootType: { rootQuery, rootType } },
    });
    const session = existing
      ? await db.scanSession.update({
          where: { id: existing.id },
          data: {
            queriesJson: JSON.stringify(queries),
            status,
            totalResults,
            scansDone,
            snapshotJson,
            aiText,
          },
        })
      : await db.scanSession.create({
          data: {
            rootQuery: rootQuery.slice(0, 200),
            rootType,
            queriesJson: JSON.stringify(queries),
            status,
            totalResults,
            scansDone,
            snapshotJson,
            aiText,
          },
        });
    return Response.json({
      session: { id: session.id, updatedAt: session.updatedAt },
    });
  } catch {
    return Response.json({ error: "Saqlashda xatolik" }, { status: 500 });
  }
}

/** O'chirish — bitta (?id=) yoki barchasi (?all=1) */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const all = req.nextUrl.searchParams.get("all");
  try {
    if (all === "1") {
      const res = await db.scanSession.deleteMany({});
      return Response.json({ ok: true, deleted: res.count });
    }
    if (!id) {
      return Response.json({ error: "id kerak" }, { status: 400 });
    }
    await db.scanSession.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "O'chirishda xatolik" }, { status: 500 });
  }
}
