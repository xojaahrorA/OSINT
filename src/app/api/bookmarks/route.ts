import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const bookmarks = await db.bookmark.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return Response.json({ bookmarks });
  } catch {
    return Response.json({ error: "Saqlanganlarni o'qish xatosi" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    title?: string;
    url?: string;
    snippet?: string;
    module?: string;
    moduleName?: string;
    query?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const url = (body.url ?? "").trim();
  const query = (body.query ?? "").trim();

  if (!title || !url) {
    return Response.json({ error: "Sarlavha va havola majburiy" }, { status: 400 });
  }

  try {
    const existing = await db.bookmark.findUnique({
      where: { url_query: { url, query } },
    });
    if (existing) {
      return Response.json({ bookmark: existing, alreadySaved: true });
    }
    const bookmark = await db.bookmark.create({
      data: {
        title: title.slice(0, 300),
        url: url.slice(0, 1000),
        snippet: (body.snippet ?? "").slice(0, 600) || null,
        module: body.module?.slice(0, 60) || null,
        moduleName: body.moduleName?.slice(0, 80) || null,
        query: query.slice(0, 200) || null,
      },
    });
    return Response.json({ bookmark });
  } catch {
    return Response.json({ error: "Saqlashda xatolik yuz berdi" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id kerak" }, { status: 400 });
  }
  try {
    await db.bookmark.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "O'chirishda xatolik" }, { status: 500 });
  }
}
