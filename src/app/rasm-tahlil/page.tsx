"use client";

// OSINT Radar — Rasm/Video tahlil sahifasi (profil: Rasm yoki video)
// - Fayl yuklash: EXIF brauzerda O'QILADI, fayl hech qayerga yuklanmaydi (maxfiylik)
// - Rasm URL: server yuklab, EXIF + C2PA/AI bayt skani
// - GPS geolokatsiya (xarita havolalari) yoki qo'lda geolokatsiya ro'yxati
// - Sana+GPS bo'lsa: o'sha sana-joydagi ob-havo (Open-Meteo) — «yomg'irda olingan» kabi izohlarni solishtirish
// - Teskari qidiruv: Google Lens / Yandex / Bing / TinEye
// - AI/tahrir belgilari: C2PA, Software/UserComment, o'lcham gipotezalari
// - Video: davomiylik va o'lcham, metadata cheklovlari izohi

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  Globe,
  Image as ImageIcon,
  Info,
  Link2,
  MapPin,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  Video,
} from "lucide-react";
import {
  parseImageMeta,
  scanBytesForAiMarkers,
  type IntelSignal,
  type LinkItem,
  type WeatherInfo,
} from "@/lib/image-intel";

interface IntelReport {
  ok: boolean;
  source: "url" | "file";
  error?: string;
  exifPresent?: boolean;
  display?: {
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
  };
  gps?: { lat: number; lon: number } | null;
  dateISO?: string | null;
  weather?: WeatherInfo | null;
  weatherNote?: string | null;
  signals?: IntelSignal[];
  mapLinks?: LinkItem[];
  reverseLinks?: LinkItem[] | null;
  hints?: IntelSignal[];
}

const SIGNAL_STYLES: Record<IntelSignal["level"], { badge: string; icon: React.ReactNode }> = {
  ok: { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
  info: { badge: "bg-sky-500/15 text-sky-400 border-sky-500/30", icon: <Info className="w-4 h-4 text-sky-400" /> },
  warn: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: <TriangleAlert className="w-4 h-4 text-amber-400" /> },
  alert: { badge: "bg-red-500/15 text-red-400 border-red-500/30", icon: <TriangleAlert className="w-4 h-4 text-red-400" /> },
};

function MetaRow({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === "" || value === null) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right break-all">{String(value)}</span>
    </div>
  );
}

function LinkList({ items, external }: { items: LinkItem[]; external: boolean }) {
  return (
    <div className="grid gap-2">
      {items.map((l) => (
        <a
          key={l.name}
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="group flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
          {external ? <Search className="w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0" /> : <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0" />}
          <span className="min-w-0">
            <span className="block text-sm font-medium">{l.name}</span>
            {l.note && <span className="block text-xs text-muted-foreground leading-snug">{l.note}</span>}
          </span>
          <Link2 className="w-3.5 h-3.5 ml-auto mt-1 text-muted-foreground/50 shrink-0" />
        </a>
      ))}
    </div>
  );
}

export default function RasmTahlilPage() {
  const [mode, setMode] = useState<"fayl" | "url">("fayl");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<IntelReport | null>(null);
  const [preview, setPreview] = useState<{ kind: "image" | "video"; src: string } | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ duration: string; size: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleReport = (r: IntelReport) => {
    if (!r.ok) {
      setError(r.error ?? "Tahlilda xatolik");
      setReport(null);
      return;
    }
    setError(null);
    setReport(r);
  };

  const analyseFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setReport(null);
    setVideoInfo(null);
    try {
      if (file.type.startsWith("video/")) {
        // Video: metadata brauzer imkonlari cheklangan — davomiylik va o'lcham
        const objUrl = URL.createObjectURL(file);
        setPreview({ kind: "video", src: objUrl });
        const v = document.createElement("video");
        v.preload = "metadata";
        await new Promise<void>((resolve) => {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => resolve();
          setTimeout(resolve, 5000);
        });
        const dur = Number.isFinite(v.duration)
          ? `${Math.floor(v.duration / 60)}:${String(Math.floor(v.duration % 60)).padStart(2, "0")} daqiqa`
          : "aniqlanmadi";
        setVideoInfo({
          duration: dur,
          size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        });
        setReport({
          ok: true,
          source: "file",
          exifPresent: false,
          display: { fileType: file.type, fileSize: `${(file.size / 1024 / 1024).toFixed(1)} MB` },
          gps: null,
          dateISO: null,
          weather: null,
          weatherNote: null,
          signals: [
            {
              level: "info",
              title: "Video fayl qabul qilindi",
              note: "Video konteynerlarda (MP4/MOV) EXIF o'rniga boshqa metadata formatlari bo'ladi va brauzer ularni to'liq o'qiy olmaydi. Kamera/joy ma'lumotini dasturiy ko'rish uchun MediaInfo (mediainfo.js) yoki ExifTool ishlating. AI-video (Sora/Veo/Kling) belgilarini aniqlash uchun kadrlarni skrinshot qilib Google Lens orqali tekshiring.",
            },
          ],
          mapLinks: undefined,
          reverseLinks: null,
          hints: undefined,
        });
        return;
      }

      // Rasm: EXIF'ni faqat brauzerda o'qiymiz — fayl serverga YUKLANMAYDI
      const objUrl = URL.createObjectURL(file);
      setPreview({ kind: "image", src: objUrl });
      const buf = await file.arrayBuffer();
      const meta = await parseImageMeta(buf);
      const byteScan = scanBytesForAiMarkers(new Uint8Array(buf));
      const res = await fetch("/api/image-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMeta: {
            meta,
            c2pa: byteScan.c2pa,
            aiMarker: byteScan.aiMarker,
            fileSize: file.size,
            fileType: file.type,
          },
        }),
      });
      handleReport((await res.json()) as IntelReport);
    } catch {
      setError("Faylni o'qishda xatolik — boshqa fayl bilan urinib ko'ring");
    } finally {
      setLoading(false);
    }
  }, []);

  const analyseUrl = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setPreview(null);
    setVideoInfo(null);
    try {
      const res = await fetch("/api/image-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      handleReport((await res.json()) as IntelReport);
    } catch {
      setError("Serverga ulanishda xatolik");
    } finally {
      setLoading(false);
    }
  }, [url]);

  const fmtDate = (iso?: string | null) => {
    if (!iso) return undefined;
    try {
      return new Date(iso).toLocaleString("uz-UZ", { dateStyle: "long", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2">
            <Link href="/">
              <ArrowLeft className="w-4 h-4" />
              Skaner
            </Link>
          </Button>
          <span className="font-semibold tracking-tight">Rasm / Video tahlili</span>
          <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
            EXIF · GPS · ob-havo · teskari qidiruv · AI belgilari
          </Badge>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Rejim tanlash */}
        <div className="flex gap-2">
          <Button
            variant={mode === "fayl" ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setMode("fayl")}
          >
            <Upload className="w-4 h-4" />
            Fayl yuklash
          </Button>
          <Button
            variant={mode === "url" ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setMode("url")}
          >
            <Globe className="w-4 h-4" />
            Rasm URL
          </Button>
        </div>

        {/* Kirish paneli */}
        {mode === "fayl" ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void analyseFile(f);
            }}
            className={`rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Rasm yoki video faylni bu yerga tashlang yoki bosing</p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              JPG, PNG, WebP, HEIC · MP4/MOV. Fayl <b>hech qayerga yuklanmaydi</b> — metadata faqat
              brauzeringizda o&apos;qiladi, tahlil uchun faqat ajratilgan ko&apos;rsatkichlar serverga boradi.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyseFile(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        ) : (
          <Card className="p-4">
            <div className="flex gap-2">
              <Input
                placeholder="https://example.uz/rasm.jpg"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void analyseUrl()}
              />
              <Button onClick={() => void analyseUrl()} disabled={loading || !url.trim()} className="gap-2 shrink-0">
                <Search className="w-4 h-4" />
                Tahlil
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              URL rejimida server rasmini yuklab o&apos;tadi (maks. 30 MB) — faqat ochiq manzillar.
              Fayl maxfiyligi muhim bo&apos;lsa, yuqoridagi «Fayl yuklash» rejimidan foydalaning.
            </p>
          </Card>
        )}

        {loading && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Tahlil qilinmoqda — metadata, ob-havo va belgilar o&apos;rganilmoqda...
          </Card>
        )}
        {error && (
          <Card className="p-4 border-red-500/30 bg-red-500/5 text-sm text-red-300">{error}</Card>
        )}

        {/* Natijalar */}
        {report && (
          <div className="grid gap-5 md:grid-cols-2">
            {/* Ko'rish */}
            {preview && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {preview.kind === "video" ? <Video className="w-4 h-4 text-primary" /> : <ImageIcon className="w-4 h-4 text-primary" />}
                    Ko&apos;rinish
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {preview.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview.src} alt="Tahlil qilinayotgan rasm" className="rounded-lg max-h-72 w-auto mx-auto" />
                  ) : (
                    <video src={preview.src} controls className="rounded-lg max-h-72 w-full" />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Metadata */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Camera className="w-4 h-4 text-primary" />
                  Metadata (EXIF)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-0">
                <MetaRow label="Kamera" value={report.display?.camera} />
                <MetaRow label="Linza" value={report.display?.lens} />
                <MetaRow label="Olingan vaqt" value={fmtDate(report.display?.takenAt ?? null)} />
                <MetaRow label="O'lcham" value={report.display?.dimensions} />
                <MetaRow label="Fayl hajmi" value={report.display?.fileSize} />
                <MetaRow label="Fayl turi" value={report.display?.fileType} />
                <MetaRow label="Software" value={report.display?.software} />
                <MetaRow label="Orientatsiya" value={report.display?.orientation} />
                <MetaRow label="ISO" value={report.display?.iso} />
                <MetaRow label="Diafragma" value={report.display?.fNumber} />
                <MetaRow label="Ekspozitsiya" value={report.display?.exposure} />
                <MetaRow label="Fokus masofa" value={report.display?.focalLength} />
                <MetaRow label="Izoh (UserComment)" value={report.display?.comment} />
                {!report.exifPresent && report.source === "url" && (
                  <p className="text-xs text-muted-foreground pt-2 leading-relaxed">
                    EXIF topilmadi: manba sahifasi (ijtimoiy tarmoq, CMS) yuklashda EXIF&apos;ni o&apos;chirgan
                    yoki rasm qayta saqlangan. Bu AI dalili emas — «AI belgilari» kartasini ko&apos;ring.
                  </p>
                )}
                {videoInfo && (
                  <>
                    <MetaRow label="Davomiylik" value={videoInfo.duration} />
                    <MetaRow label="Hajm" value={videoInfo.size} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Geolokatsiya */}
            {(report.mapLinks || report.hints) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    Geolokatsiya
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {report.gps && (
                    <p className="text-xs font-medium">
                      Koordinata: {report.gps.lat.toFixed(6)}, {report.gps.lon.toFixed(6)}
                    </p>
                  )}
                  {report.mapLinks && <LinkList items={report.mapLinks} external={false} />}
                  {report.hints && (
                    <div className="space-y-2.5">
                      {report.hints.map((h) => (
                        <div key={h.title} className="flex items-start gap-2">
                          <Info className="w-4 h-4 mt-0.5 text-sky-400 shrink-0" />
                          <div>
                            <p className="text-xs font-medium">{h.title}</p>
                            <p className="text-xs text-muted-foreground leading-snug">{h.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Vaqt va ob-havo */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  Vaqt va ob-havo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>
                    {report.dateISO ? (
                      <>Sana (EXIF): <b>{fmtDate(report.dateISO)}</b></>
                    ) : (
                      "EXIF'da sana yo'q — vaqtni soyalardan taxmin qilish mumkin (geolokatsiya ro'yxatidagi 4-band)"
                    )}
                  </span>
                </div>
                {report.weather && (
                  <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 space-y-1">
                    <p className="font-medium">
                      {report.weather.date} — {report.weather.codeText || "holat noma'lum"}
                    </p>
                    {report.weather.tempMax !== undefined && (
                      <p className="text-muted-foreground">
                        Harorat: {report.weather.tempMin}°C ... {report.weather.tempMax}°C (Open-Meteo arxivi)
                      </p>
                    )}
                  </div>
                )}
                {report.weatherNote && (
                  <p className="text-muted-foreground leading-snug">{report.weatherNote}</p>
                )}
                {!report.dateISO && !report.gps && (
                  <p className="text-muted-foreground leading-snug">
                    Sana va joy bo&apos;lmasa ob-havo solishtirib bo&apos;lmaydi — bu tekshiruv
                    rasmning «aytilgan vaqtga mosligini» sinash uchun ishlaydi.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Teskari qidiruv */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="w-4 h-4 text-primary" />
                  Teskari qidiruv — rasm qayerda va qachon chiqqan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.reverseLinks ? (
                  <LinkList items={report.reverseLinks} external />
                ) : (
                  <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <p>
                      Fayl rejimida rasmni qidiruv tizimlariga <b>qo&apos;lda yuklang</b> (brauzerlar faylni
                      havola orqali uzatolmaydi): quyidagi saytlarni ochib, kamera belgisini bosing.
                    </p>
                    <LinkList
                      external
                      items={[
                        { name: "Google Lens — lens.google.com", url: "https://lens.google.com", note: "Eng kuchli obyekt/joy aniqlash" },
                        { name: "Yandex Images — yandex.com/images", url: "https://yandex.com/images/search", note: "Shaxslar uchun eng aniq — kamera belgisi" },
                        { name: "TinEye — tineye.com", url: "https://tineye.com", note: "Birinchi chiqqan sana va manba" },
                      ]}
                    />
                    <p>
                      Maslahat: fayl URL&apos;i bor bo&apos;lsa (masalan site rasmi), «Rasm URL» rejimiga
                      o&apos;ting — barcha platformalar to&apos;g&apos;ridan-to&apos;g&apos;ri havolalar bilan ochiladi.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI / tahrir belgilari */}
            {report.signals && report.signals.length > 0 && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Tahrirlangan / AI yaratilganlik belgilari
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {report.signals.map((s, i) => (
                    <div
                      key={`${s.title}-${i}`}
                      className={`rounded-lg border px-3 py-2.5 ${SIGNAL_STYLES[s.level].badge}`}
                    >
                      <div className="flex items-start gap-2">
                        {SIGNAL_STYLES[s.level].icon}
                        <div>
                          <p className="text-sm font-medium">{s.title}</p>
                          <p className="text-xs mt-0.5 opacity-90 leading-relaxed">{s.note}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                    Diqqat: bitta belgi ham yakuniy xulosa emas — har doim teskari qidiruv,
                    kontekst va manba bilan birga baholang.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!report && !loading && !error && (
          <Card className="p-5 text-xs text-muted-foreground leading-relaxed space-y-2">
            <p className="font-medium text-foreground text-sm">Bu sahifa nimani beradi?</p>
            <p>
              <b>Geolokatsiya</b> — EXIF GPS bo&apos;lsa koordinata va xarita havolalari; bo&apos;lmasa
              belgilar (yozuvlar, tillar, relyef, soya) bo&apos;yicha qo&apos;lda aniqlash ro&apos;yxati.
            </p>
            <p>
              <b>Taxminiy vaqt va ob-havo</b> — EXIF sana+GPS bo&apos;lsa o&apos;sha kungi ob-havo
              (Open-Meteo) — «yomg&apos;irda olingan» kabi da&apos;volarni solishtirish uchun.
            </p>
            <p>
              <b>Teskari qidiruv</b> — rasm internetda QAYERDA va QACHON birinchi paydo bo&apos;lgani
              (Google Lens, Yandex, Bing, TinEye).
            </p>
            <p>
              <b>AI/tahrir belgilari</b> — C2PA kredensiallari, AI generator izohlari (Software/UserComment),
              o&apos;lcham gipotezalari va kamera ma&apos;lumotlarining haqiqiyligi.
            </p>
          </Card>
        )}
      </main>

      <footer className="border-t py-4 text-center text-[11px] text-muted-foreground">
        PASSIVE OSINT — faqat ochiq manbalar. Fayl rejimida rasm hech qayerga yuklanmaydi.
      </footer>
    </div>
  );
}
