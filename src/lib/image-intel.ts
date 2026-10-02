// OSINT Radar — Rasm/Video tahlil kutubxonasi (profil: Rasm yoki video)
// EXIF metadata, GPS geolokatsiya, ob-havo solishtirish (Open-Meteo — kalitsiz),
// teskari qidiruv havolalari (Google Lens/Yandex/Bing/TinEye) va AI yaratilganlik
// belgilari (C2PA/Software/UserComment, o'lcham gipotezalari).
// Bu modul klient (brauzer) va serverda bir xil ishlaydi — SDK import QILINMAYDI.

import exifr from "exifr";

// ===== Tiplar =====

export type SignalLevel = "ok" | "info" | "warn" | "alert";

export interface IntelSignal {
  level: SignalLevel;
  title: string;
  note: string;
}

export interface LinkItem {
  name: string;
  url: string;
  note?: string;
}

export interface WeatherInfo {
  date: string;
  tempMax?: number;
  tempMin?: number;
  code?: number;
  codeText?: string;
  source: "open-meteo-forecast" | "open-meteo-archive";
  note?: string;
}

export interface DisplayMeta {
  camera?: string;
  lens?: string;
  takenAt?: string;
  dimensions?: string;
  fileSize?: string;
  software?: string;
  orientation?: string;
  exposure?: string;
  iso?: number | string;
  fNumber?: string;
  focalLength?: string;
  comment?: string;
  fileType?: string;
}

// ===== EXIF o'qish =====

/** exifr.parse natijasidan bizga kerakli maydonlarni tozalab oladi */
function normalizeMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const dateToISO = (v: unknown): string | undefined => {
    if (!v) return undefined;
    try {
      if (v instanceof Date) return v.toISOString();
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    } catch {
      return undefined;
    }
  };
  const out: Record<string, unknown> = {
    Make: pick("Make"),
    Model: pick("Model"),
    LensModel: pick("LensModel", "LensMake"),
    DateTimeOriginal: dateToISO(pick("DateTimeOriginal", "CreateDate", "CreationDate")),
    ModifyDate: dateToISO(pick("ModifyDate")),
    Software: pick("Software"),
    UserComment: pick("UserComment"),
    Orientation: pick("Orientation"),
    ExifImageWidth: pick("ExifImageWidth", "ImageWidth"),
    ExifImageHeight: pick("ExifImageHeight", "ImageHeight"),
    latitude: raw.latitude,
    longitude: raw.longitude,
    ISO: pick("ISO"),
    FNumber: pick("FNumber"),
    ExposureTime: pick("ExposureTime"),
    FocalLength: pick("FocalLength"),
  };
  return out;
}

/** Fayl/buferdan EXIF metadata o'qiydi. EXIF bo'lmasa null qaytaradi. */
export async function parseImageMeta(
  input: ArrayBuffer | File | Blob
): Promise<Record<string, unknown> | null> {
  try {
    const data = await exifr.parse(input as File, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: {},
      translateValues: false,
      reviveValues: true,
    });
    if (!data || typeof data !== "object") return null;
    const norm = normalizeMeta(data as Record<string, unknown>);
    // Hech qanday foydali maydon yo'q bo'lsa — EXIF yo'q deb hisoblaymiz
    const hasAny = Object.values(norm).some((v) => v !== undefined && v !== null);
    return hasAny ? norm : null;
  } catch {
    return null;
  }
}

// ===== C2PA / AI izlari — xom baytlar skani =====

/**
 * Fayl baytlarida C2PA (Kontent kredensiallari) va AI generator izlarini qidiradi.
 * C2PA manifestlar JUMBF quti strukturasi bilan yoziladi — "c2pa"/"jumb" ASCII
 * izlari odatda fayl boshida yoki oxirida bo'ladi. Adobe Firefly kabi
 * generativ vositalar "trainedAlgorithmicMedia" yozuvini qoldiradi.
 */
export function scanBytesForAiMarkers(buf: Uint8Array): { c2pa: boolean; aiMarker: string | null } {
  const probes: Uint8Array[] = [];
  const head = buf.slice(0, Math.min(buf.length, 2 * 1024 * 1024));
  probes.push(head);
  if (buf.length > 2 * 1024 * 1024) {
    const tail = buf.slice(Math.max(0, buf.length - 512 * 1024));
    probes.push(tail);
  }
  const markers = [
    ["c2pa", "c2pa"],
    ["jumb", "c2pa"],
    ["trainedAlgorithmicMedia", "trainedAlgorithmicMedia"],
    ["Midjourney", "Midjourney"],
    ["DALL", "DALL-E"],
    ["Stable Diffusion", "Stable Diffusion"],
    ["Firefly", "Adobe Firefly"],
    ["generative", "generative-izoh"],
  ] as const;
  let c2pa = false;
  let aiMarker: string | null = null;
  for (const chunk of probes) {
    const text = new TextDecoder("latin1").decode(chunk);
    for (const [needle, label] of markers) {
      if (text.includes(needle)) {
        if (label === "c2pa") c2pa = true;
        else if (!aiMarker) aiMarker = label;
      }
    }
  }
  return { c2pa, aiMarker };
}

// ===== AI belgilari xulosasi =====

const AI_TOOL_RE =
  /(midjourney|dall[-· ]?e|stable\s?diffusion|firefly|sora|veo|kling|runway|imagen|flux|grok|nano\s?banana|ideogram|leonardo|copilot|generative)/i;

/** AI generatorlarning odatiy chiqish o'lchamlari — kamera EXIF'siz uchraganda gipoteza */
const AI_COMMON_DIMS = new Set([
  "1024x1024", "512x512", "768x768", "1152x896", "896x1152",
  "1024x1536", "1536x1024", "1280x720", "1536x640", "640x1536",
]);

export function buildAiSignals(
  meta: Record<string, unknown> | null,
  byteScan: { c2pa: boolean; aiMarker: string | null } | null
): IntelSignal[] {
  const out: IntelSignal[] = [];

  if (byteScan?.c2pa) {
    out.push({
      level: "info",
      title: "C2PA kontent kredensiallari topildi",
      note: "Faylda C2PA/JUMBF manifest bor — kelib chiqishi rasman tasdiqlangan bo'lishi mumkin. Tekshirish: contentcredentials.org/verify. AI vositalar (masalan Firefly) ham o'z manifestini qo'yadi — manifest ICHIDA kim yaratganini ko'ring.",
    });
  }
  if (byteScan?.aiMarker) {
    out.push({
      level: "alert",
      title: `AI generator izi: ${byteScan.aiMarker}`,
      note: "Fayl baytlarida generativ model izohi topildi — rasm AI tomonidan yaratilgan yoki AI vositada tahrirlangan bo'lish ehtimoli yuqori.",
    });
  }

  const software = String(meta?.Software ?? "");
  const comment = String(meta?.UserComment ?? "");
  if (AI_TOOL_RE.test(software) || AI_TOOL_RE.test(comment)) {
    out.push({
      level: "alert",
      title: "Metadata'da AI vosita nomi yozilgan",
      note: `Software/UserComment maydonida AI generator izohi bor: ${software || comment}`.slice(0, 180),
    });
  }

  const camera = [meta?.Make, meta?.Model].filter(Boolean).join(" ");
  if (meta && camera) {
    out.push({
      level: "ok",
      title: `Kamera ma'lumotlari bor: ${camera}`,
      note: "EXIF'da kamera/linza ma'lumotlari to'liq — rasm haqiqiy kamera yoki telefonda olingan ehtimoli kuchli (metadata soxta ko'chirilgan bo'lishi ham mumkin — teskari qidiruv bilan solishtiring).",
    });
  }

  if (!meta) {
    out.push({
      level: "warn",
      title: "EXIF metadata deyarli yo'q",
      note: "Bu o'zi AI dalili EMAS: ijtimoiy tarmoqlar (Instagram, Telegram) yuklanganda EXIF'ni o'chirib yuboradi — indekslangan (skrinshot/boshqa saytdan) rasm ham EXIF'siz bo'ladi. Lekin yangi generatsiya qilingan rasmlarda ham EXIF bo'lmaydi. Xulosa uchun teskari qidiruv va vizual belgilarni birga ko'ring.",
    });
  } else {
    const w = Number(meta.ExifImageWidth);
    const h = Number(meta.ExifImageHeight);
    if (w && h && !camera) {
      const key = `${w}x${h}`;
      if (AI_COMMON_DIMS.has(key)) {
        out.push({
          level: "warn",
          title: `O'lcham AI generatorlarga xos: ${key}`,
          note: "Bu o'lcham AI rasmlarida standart. Kamera ma'lumotlari yo'q va o'lcham generator o'lchamiga to'g'ri keladi — shubhali kombinatsiya.",
        });
      } else {
        out.push({
          level: "info",
          title: `Rasm o'lchami: ${key}`,
          note: "O'lcham generatorlar standartiga to'g'ri kelmaydi — oddiy kamera/sahna rasmi ehtimoli ko'proq.",
        });
      }
    }
  }

  return out;
}

// ===== Geolokatsiya =====

export function mapLinks(lat: number, lon: number): LinkItem[] {
  return [
    {
      name: "Google Maps",
      url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
      note: "Atrof-muhit, binolar, Street View bilan solishtirish",
    },
    {
      name: "Yandex Maps",
      url: `https://yandex.com/maps/?ll=${lon}%2C${lat}&z=17`,
      note: "Panoramalar — MDH hududlari uchun kuchli",
    },
    {
      name: "OpenStreetMap",
      url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
      note: "Relef va kichik obyektlar",
    },
  ];
}

/** GPS bo'lmasa — qo'lda geolokatsiya tekshiruvi ro'yxati */
export function geolocationHints(): IntelSignal[] {
  return [
    {
      level: "info",
      title: "GPS EXIF'da yo'q — qo'lda belgilardan aniqlang",
      note: "Rasmning ichida ko'rinadigan quyidagi belgilar geolokatsiyani aniqlashga yordam beradi:",
    },
    {
      level: "info",
      title: "1. Matn va tillar",
      note: "Do'kon yozuvlari, ko'cha taxtalari, avtomobil raqamlari, bino raqamlari. O'zbek lotin/kirill, rus, arab yoki boshqa yozuv — mintaqani toraytiradi. Ma'lumotnoma: raqam belgilarini rasmdan o'qib, davlat raqam formati bilan solishtiring.",
    },
    {
      level: "info",
      title: "2. Infratuzilma",
      note: "Yo'l chiziqlari va belgilar, svetofor turlari, elektr uzatish minoralari, uyalmi bazalar, avtobus bekatlari, frankizatsiya — har bir davlatda o'z standarti bor.",
    },
    {
      level: "info",
      title: "3. Relyef va o'simliklar",
      note: "Tog' siluetlari, daryolar, tuproq rangi, daraxt turlari — mahalliy iqlimga mosligini xarita va sun'iy yo'ldosh tasvirlari (Google Earth, Yandex Xaritalar) bilan solishtiring.",
    },
    {
      level: "info",
      title: "4. Soya va quyosh",
      note: "Soya yo'nalishi va uzunligidan taxminiy vaqt va yarim sharni (shimol/janub) baholash mumkin: quyosh sharqda chiqib, g'arbda botadi — Shimoliy yarimsharda soya shimolga qarab harakatlanadi. Sunlight calculator (masalan suncalc.org) bilan solishtiring.",
    },
  ];
}

// ===== Vaqt va ob-havo =====

export function weatherText(code: number | undefined): string {
  if (code === undefined) return "";
  if (code === 0) return "Osmon toza";
  if (code <= 2) return "Kam bulutli";
  if (code === 3) return "Bulutli";
  if (code === 45 || code === 48) return "Tuman";
  if (code >= 51 && code <= 57) return "Chimchim yomg'ir";
  if (code >= 61 && code <= 67) return "Yomg'ir";
  if (code >= 71 && code <= 77) return "Qor";
  if (code >= 80 && code <= 82) return "Kuchli yomg'ir";
  if (code === 85 || code === 86) return "Qor bo'roni";
  if (code >= 95) return "G'ujra, momaqaldiroq";
  return "Noma'lum holat";
}

export function isWeathercodeKey(k: string): boolean {
  return k === "weather_code" || k === "weathercode";
}

/** Sana → YYYY-MM-DD (lokal emas, UTC) */
export function toDayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Open-Meteo (kalitsiz, bepul) — o'sha sana, o'sha joydagi ob-havo.
 * 7 kundan yangi sanalar → prognoz API (o'tgan kunlar bilan), eski sanalar → arxiv API.
 */
export async function fetchWeather(lat: number, lon: number, dateISO: string): Promise<WeatherInfo | null> {
  const today = toDayISO(new Date());
  if (dateISO > today) return null; // kelajak sanasi — ob-havo so'ramaymiz
  const within7d = (new Date(today).getTime() - new Date(dateISO).getTime()) <= 7 * 86400000;
  const base = within7d
    ? "https://api.open-meteo.com/v1/forecast"
    : "https://archive-api.open-meteo.com/v1/archive";
  const url =
    `${base}?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&start_date=${dateISO}&end_date=${dateISO}&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
        weathercode?: number[];
      };
    };
    const d = j.daily;
    if (!d?.time?.length) return null;
    const code = (d.weather_code ?? d.weathercode)?.[0];
    return {
      date: dateISO,
      tempMax: d.temperature_2m_max?.[0],
      tempMin: d.temperature_2m_min?.[0],
      code,
      codeText: weatherText(code),
      source: within7d ? "open-meteo-forecast" : "open-meteo-archive",
    };
  } catch {
    return null;
  }
}

// ===== Teskari qidiruv =====

/** Rasm URL bo'yicha teskari qidiruv platformalari (barchasi bepul) */
export function buildReverseLinks(imageUrl: string): LinkItem[] {
  const enc = encodeURIComponent(imageUrl);
  return [
    {
      name: "Google Lens",
      url: `https://lens.google.com/uploadbyurl?url=${enc}`,
      note: "Eng kuchli: obyektlar, joylar, mahsulotlarni aniqlaydi",
    },
    {
      name: "Yandex Images",
      url: `https://yandex.com/images/search?rpt=imageview&url=${enc}`,
      note: "Shaxslar va MDH kontenti uchun eng aniq",
    },
    {
      name: "Bing Visual",
      url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}`,
      note: "Microsoft indeksi — qolganlarida topilmasa",
    },
    {
      name: "TinEye",
      url: `https://tineye.com/search?url=${enc}`,
      note: "Rasm QAYERGA VA QACHON birinchi chiqqani — tarixiy tartiblash",
    },
  ];
}

// ===== Ko'rsatish uchun tozalangan metadata =====

const ORIENT_TEXT: Record<number, string> = {
  1: "Oddiy",
  2: "Ogayda aks etgan",
  3: "180° aylangan",
  6: "90° CW aylangan",
  8: "90° CCW aylangan",
};

export function buildDisplayMeta(
  meta: Record<string, unknown> | null,
  extra?: { fileSize?: number; fileType?: string }
): DisplayMeta {
  const out: DisplayMeta = {
    fileType: extra?.fileType,
    fileSize: extra?.fileSize ? `${(extra.fileSize / 1024).toFixed(0)} KB` : undefined,
  };
  if (!meta) return out;
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  out.camera = [str(meta.Make), str(meta.Model)].filter(Boolean).join(" ") || undefined;
  out.lens = str(meta.LensModel);
  out.takenAt = str(meta.DateTimeOriginal) ?? str(meta.ModifyDate);
  const w = Number(meta.ExifImageWidth);
  const h = Number(meta.ExifImageHeight);
  out.dimensions = w && h ? `${w} × ${h}` : undefined;
  out.software = str(meta.Software);
  const orientNum = Number(meta.Orientation);
  out.orientation = orientNum ? (ORIENT_TEXT[orientNum] ?? `Kod ${orientNum}`) : undefined;
  out.exposure = meta.ExposureTime ? `${Number(meta.ExposureTime)} s` : undefined;
  out.iso = meta.ISO !== undefined ? Number(meta.ISO) : undefined;
  out.fNumber = meta.FNumber !== undefined ? `f/${Number(meta.FNumber)}` : undefined;
  out.focalLength = meta.FocalLength !== undefined ? `${Number(meta.FocalLength)} mm` : undefined;
  const comment = str(meta.UserComment);
  out.comment = comment && comment !== "undefined" ? comment.slice(0, 120) : undefined;
  return out;
}
