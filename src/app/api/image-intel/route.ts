// OSINT Radar — Rasm/Video tahlil API (profil: Rasm yoki video)
// POST /api/image-intel
//   { url: "https://..." }                        — server rasmini yuklab, EXIF + C2PA/AI skan qiladi
//   { clientMeta: { meta, c2pa, aiMarker, ... } } — fayl BRAUZERDA lokal tahlil qilingan (fayl yuklanmaydi — maxfiylik)
// Javob: metadata, GPS geolokatsiya, o'sha sana-joydagi ob-havo (Open-Meteo),
// AI belgilari, teskari qidiruv havolalari, GPS bo'lmasa qo'lda geolokatsiya ro'yxati.

import { NextRequest } from "next/server";
import {
  buildAiSignals,
  buildDisplayMeta,
  buildReverseLinks,
  fetchWeather,
  geolocationHints,
  mapLinks,
  parseImageMeta,
  scanBytesForAiMarkers,
  toDayISO,
  type IntelSignal,
  type LinkItem,
  type WeatherInfo,
} from "@/lib/image-intel";

export const maxDuration = 60;

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB

/** SSRF himoyasi: faqat ommaviy http(s) manzillar */
function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^0\./.test(h) ||
      h === "[::1]" ||
      h === "::1"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

interface IntelResponse {
  ok: boolean;
  source?: "url" | "file";
  error?: string;
  exifPresent?: boolean;
  meta?: Record<string, unknown> | null;
  display?: ReturnType<typeof buildDisplayMeta>;
  gps?: { lat: number; lon: number } | null;
  dateISO?: string | null;
  weather?: WeatherInfo | null;
  weatherNote?: string | null;
  signals?: IntelSignal[];
  mapLinks?: LinkItem[];
  reverseLinks?: LinkItem[] | null;
  hints?: IntelSignal[];
  fetchedBytes?: number;
}

async function analyse(
  meta: Record<string, unknown> | null,
  byteScan: { c2pa: boolean; aiMarker: string | null } | null,
  imageUrl: string | null,
  extra: { fileSize?: number; fileType?: string }
): Promise<IntelResponse> {
  const exifPresent = !!meta;
  const lat = typeof meta?.latitude === "number" ? meta.latitude : NaN;
  const lon = typeof meta?.longitude === "number" ? meta.longitude : NaN;
  const hasGps = Number.isFinite(lat) && Number.isFinite(lon);

  const rawDate = (meta?.DateTimeOriginal ?? meta?.ModifyDate) as string | undefined;
  let dateISO: string | null = null;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!Number.isNaN(d.getTime())) dateISO = toDayISO(d);
  }

  let weather: WeatherInfo | null = null;
  let weatherNote: string | null = null;
  if (hasGps && dateISO) {
    weather = await fetchWeather(lat, lon, dateISO);
    if (weather) {
      weatherNote =
        "Ob-havo foydalanuvchining aytgan vaqt/joy izohi bilan solishtirilishi mumkin: rasm «yomg'irda olingan» deyilsa, lekin bu sana-joyda yomg'ir bo'lmagan bo'lsa — ziddiyat belgisi.";
    } else {
      weatherNote =
        "Bu sana uchun ob-havo arxivi hali mavjud emas yoki olinmadi — keyinroq qayta tekshirilishi mumkin.";
    }
  } else if (hasGps && !dateISO) {
    weatherNote = "GPS bor, lekin EXIF'da sana yo'q — ob-havo solishtirish uchun sanani bilish kerak.";
  }

  const signals = buildAiSignals(meta, byteScan);
  if (hasGps) {
    signals.unshift({
      level: "ok",
      title: "GPS joylashuv EXIF'da bor",
      note: `Koordinata: ${lat}, ${lon}. Bu joyda rasm olingan ehtimoli yuqori (metadata ko'chirilgan bo'lishi ham mumkin — xaritada atrofini rasm bilan solishtiring).`,
    });
  }

  return {
    ok: true,
    source: imageUrl ? "url" : "file",
    exifPresent,
    meta,
    display: buildDisplayMeta(meta, extra),
    gps: hasGps ? { lat, lon } : null,
    dateISO,
    weather,
    weatherNote,
    signals,
    mapLinks: hasGps ? mapLinks(lat, lon) : undefined,
    reverseLinks: imageUrl ? buildReverseLinks(imageUrl) : null,
    hints: !hasGps ? geolocationHints() : undefined,
  };
}

export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    clientMeta?: {
      meta?: Record<string, unknown> | null;
      c2pa?: boolean;
      aiMarker?: string | null;
      fileSize?: number;
      fileType?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Noto'g'ri so'rov (JSON emas)" } satisfies IntelResponse, { status: 400 });
  }

  // ---- 1) URL rejimi: server yuklab o'qiydi ----
  if (body.url) {
    const url = body.url.trim();
    if (!isPublicHttpUrl(url)) {
      return Response.json(
        { ok: false, error: "Rasm URL ochiq http(s) manzil bo'lishi kerak (maxfiy tarmoqqa murojaat taqiqlangan)" } satisfies IntelResponse,
        { status: 400 }
      );
    }
    try {
      // Redirect zanjirini ham tekshirib boramiz (SSRF'ga qarshi)
      let current = url;
      let res: Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        if (!isPublicHttpUrl(current)) {
          return Response.json(
            { ok: false, error: "Yo'naltirilgan manzil xavfsiz emas" } satisfies IntelResponse,
            { status: 400 }
          );
        }
        res = await fetch(current, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OSINT-Radar ImageIntel" },
          signal: AbortSignal.timeout(20000),
          redirect: "manual",
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          current = new URL(loc, current).toString();
          continue;
        }
        break;
      }
      if (!res || !res.ok) {
        return Response.json(
          { ok: false, error: "Rasm yuklab olinmadi — manzilni tekshirib, boshqa manbadan urinib ko'ring" } satisfies IntelResponse,
          { status: 422 }
        );
      }
      const type = res.headers.get("content-type") ?? "";
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return Response.json(
          { ok: false, error: "Fayl hajmi 30 MB dan katta" } satisfies IntelResponse,
          { status: 413 }
        );
      }
      const meta = await parseImageMeta(buf);
      const byteScan = scanBytesForAiMarkers(new Uint8Array(buf));
      const out = await analyse(meta, byteScan, url, { fileType: type.split(";")[0], fileSize: buf.byteLength });
      return Response.json(out);
    } catch {
      return Response.json(
        { ok: false, error: "Rasmni o'qishda xatolik (muddat tugadi yoki manba javob bermadi)" } satisfies IntelResponse,
        { status: 502 }
      );
    }
  }

  // ---- 2) Fayl rejimi: EXIF brauzerda o'qilgan (fayl yuklanmagan) ----
  const cm = body.clientMeta;
  if (cm && typeof cm === "object") {
    const meta = (cm.meta ?? null) as Record<string, unknown> | null;
    const byteScan = {
      c2pa: !!cm.c2pa,
      aiMarker: cm.aiMarker ?? null,
    };
    const out = await analyse(meta, byteScan, null, { fileSize: cm.fileSize, fileType: cm.fileType });
    return Response.json(out);
  }

  return Response.json(
    { ok: false, error: "url yoki clientMeta maydonlaridan biri kerak" } satisfies IntelResponse,
    { status: 400 }
  );
}
