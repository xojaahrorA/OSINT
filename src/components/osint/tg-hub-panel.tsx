"use client";

// TG Guruh/Kanal skaneri — foydalanuvchi interfeysi.
// Skan: username / userId / ism bo'yicha barcha ro'yxatdagi guruhlarda
// READ-ONLY qidiruv (mention + ism + from_id). Guruhlar: qo'shish/o'chirish.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Play,
  Square,
  Send,
  Plus,
  X,
  RefreshCw,
  DatabaseZap,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

// ---- Server javob shakllari (lib/tg-hub bilan mos — type-only) ----
interface TgSample {
  date?: string;
  text?: string;
  sender?: string;
}
interface TgHit {
  group: string;
  title: string;
  kind: string;
  members: number;
  type: "mention" | "ism" | "from_id";
  count: number;
  samples: TgSample[];
}
interface TgGroupRow {
  id: string;
  username: string;
  title: string;
  kind: string;
  members: number;
  source: string;
  religious: boolean;
  lastStatus: string | null;
  lastScanAt: string | null;
}
interface TgStatus {
  session: boolean;
  connected: boolean;
  connecting: boolean;
  connectError: string | null;
  scan: {
    running: boolean;
    stopping: boolean;
    target: { username?: string; userId?: string; nameQuery?: string } | null;
    targetProfile: { id: string; username: string | null; name: string; bio: string | null } | null;
    done: number;
    total: number;
    current: string | null;
    hits: TgHit[];
    scanned: number;
    floodSkips: number;
    errors: number;
    startedAt: string | null;
    finishedAt: string | null;
    log: string[];
  };
  lastScan: { target: unknown; startedAt: string | null; finishedAt: string | null; hits: TgHit[]; scanned: number } | null;
  groups: TgGroupRow[] | null;
  presets: { imported: boolean; presetFile: boolean; total: number };
}

const HIT_TYPE_UZ: Record<string, string> = {
  mention: "@tilga olingan",
  ism: "ism matnda",
  from_id: "uning xabari (ID)",
};

const STATUS_UZ: Record<string, string> = {
  ok: "ok",
  flood: "FLOOD",
  error: "xato",
  skipped: "peer yo'q",
};

export function TgHubPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<TgStatus | null>(null);
  const [tab, setTab] = useState("skan");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [addInput, setAddInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(
    async (full: boolean) => {
      try {
        const res = await fetch(`/api/tg-hub${full ? "?full=1" : ""}`, { cache: "no-store" });
        if (res.ok) setData((await res.json()) as TgStatus);
      } catch {
        /* poll xatosi — keyingi siklda qayta */
      }
    },
    []
  );

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      void fetchStatus(tab === "guruhlar");
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [fetchStatus, tab]);

  // Log avtomatik pastga siljisin
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.scan.log.length]);

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const res = await fetch("/api/tg-hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const j = (await res.json()) as { ok: boolean; message: string };
      toast({
        title: j.ok ? "Bajarildi" : "Xato",
        description: j.message,
        variant: j.ok ? "default" : "destructive",
      });
      void fetchStatus(true);
      return j.ok;
    } catch {
      toast({ title: "Xato", description: "Server bilan aloqa yo'q", variant: "destructive" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const scan = data?.scan;
  const running = !!scan?.running;
  const pct = scan && scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : 0;
  const showScan = scan && (scan.startedAt !== null || running);
  const displayHits = running || showScan ? (scan?.hits ?? []) : (data?.lastScan?.hits ?? []);

  const startDisabled =
    running || busy === "start-scan" || (!username.trim() && !userId.trim() && !nameQuery.trim());

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Send className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm sm:text-base">Telegram guruh/kanal skaneri</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {data?.session ? (
            data.connected ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40" variant="outline">
                <ShieldCheck className="w-3 h-3 mr-1" /> Ulangan
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {data.connecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Ulanmagan
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="text-amber-400 border-amber-500/40">
              <AlertTriangle className="w-3 h-3 mr-1" /> Sessiya yo&apos;q
            </Badge>
          )}
          {data?.presets.imported && (
            <Badge variant="secondary" className="text-[10px]">
              {data.presets.total} guruh ro&apos;yxatda
            </Badge>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
        Faqat o&apos;qish rejimi: hech kimga yozilmaydi, hech qayerga qo&apos;shilmaydi. Diniy
        guruhlar avtomatik chiqarib tashlanadi. Qidiruv: @username tilga olinganmi, ism matnda
        uchraydimi, maqsad ID&apos;si bilan xabar yozganmi.
      </p>

      <Tabs value={tab} onValueChange={setTab} className="mt-3">
        <TabsList className="bg-secondary/40">
          <TabsTrigger value="skan" className="text-xs gap-1.5">
            <Send className="w-3.5 h-3.5" /> Skan
          </TabsTrigger>
          <TabsTrigger value="guruhlar" className="text-xs gap-1.5">
            <DatabaseZap className="w-3.5 h-3.5" />
            Guruhlar
            {data?.groups && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{data.groups.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ===== SKAN ===== */}
        <TabsContent value="skan" className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground" htmlFor="tg-username">Username</label>
              <Input
                id="tg-username"
                placeholder="@username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-9 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground" htmlFor="tg-userid">User ID (raqam)</label>
              <Input
                id="tg-userid"
                placeholder="8731535304"
                value={userId}
                onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))}
                className="h-9 text-sm"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground" htmlFor="tg-name">Ism bo&apos;yicha so&apos;rov</label>
              <Input
                id="tg-name"
                placeholder="Gulhayo"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                className="h-9 text-sm"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={startDisabled}
              onClick={() => {
                if (data && !data.connected && data.connectError) {
                  toast({ title: "Ulanish xatosi", description: data.connectError, variant: "destructive" });
                  return;
                }
                void act("start-scan", {
                  target: {
                    username: username.trim() || undefined,
                    userId: userId.trim() || undefined,
                    nameQuery: nameQuery.trim() || undefined,
                  },
                });
              }}
            >
              {busy === "start-scan" || (data?.connecting && !data?.connected) ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              Skanni boshlash
            </Button>
            {running && (
              <Button size="sm" variant="destructive" disabled={scan?.stopping} onClick={() => void act("stop-scan")}>
                <Square className="w-4 h-4 mr-1" />
                To&apos;xtatish
              </Button>
            )}
            {!running && showScan && (
              <Button size="sm" variant="ghost" onClick={() => void act("clear-last-scan")}>
                <RefreshCw className="w-4 h-4 mr-1" /> Natijalarni tozalash
              </Button>
            )}
          </div>

          {scan?.targetProfile && (
            <div className="rounded-md border bg-secondary/20 p-3 text-xs space-y-0.5">
              <span className="font-medium">Profil tasdiqlandi:</span>{" "}
              {scan.targetProfile.name} · @{scan.targetProfile.username} · ID {scan.targetProfile.id}
              {scan.targetProfile.bio ? ` · bio: "${scan.targetProfile.bio}"` : ""}
            </div>
          )}

          {showScan && (
            <div className="space-y-2">
              <Progress value={pct} className="h-2" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {scan!.done}/{scan!.total} guruh ({pct}%)
                </span>
                {scan!.current && <span className="font-mono text-foreground/80">hozir: {scan!.current}</span>}
                <span>hit: <b className="text-foreground">{scan!.hits.length}</b></span>
                {scan!.floodSkips > 0 && <span>FLOOD: {scan!.floodSkips}</span>}
                {scan!.errors > 0 && <span>xato: {scan!.errors}</span>}
                {scan!.finishedAt && !running && <span className="text-emerald-400">tugadi</span>}
              </div>
              {scan!.log.length > 0 && (
                <div
                  ref={logBoxRef}
                  className="max-h-36 overflow-y-auto rounded-md border bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-emerald-300/90"
                >
                  {scan!.log.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Natijalar */}
          <div className="space-y-2">
            {displayHits.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border rounded-md border-dashed">
                {running
                  ? "Hozirgacha topilma yo'q — skan davom etmoqda..."
                  : (scan?.errors ?? 0) > 0 && (scan?.scanned ?? 0) === 0
                    ? "Skan xatolar bilan to'xtadi — pastdagi logni tekshiring (ko'pincha: sessiya yaroqsiz yoki Telegram cheklovi)."
                    : showScan
                      ? "Natija yo'q: bu maqsad ro'yxatdagi guruhlarda ochiq iz qoldirmagan."
                      : "Maqsad kirib, «Skanni boshlash»ni bosing."}
              </div>
            ) : (
              displayHits.map((h, i) => (
                <div key={`${h.group}-${h.type}-${i}`} className="rounded-md border p-3 text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        h.type === "from_id"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                          : h.type === "mention"
                            ? "bg-primary/10 text-primary border-primary/40"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/40"
                      }
                    >
                      {HIT_TYPE_UZ[h.type] ?? h.type}
                    </Badge>
                    <span className="font-medium">{h.title}</span>
                    <span className="font-mono text-muted-foreground">{h.group}</span>
                    <span className="text-muted-foreground">· {h.members.toLocaleString("en-US")} a&apos;zo</span>
                    <Badge variant="secondary" className="ml-auto tabular-nums">{h.count} ta xabar</Badge>
                  </div>
                  {h.samples.length > 0 && (
                    <ul className="space-y-0.5 text-muted-foreground">
                      {h.samples.map((s, k) => (
                        <li key={k} className="truncate">
                          {s.date ? <span className="font-mono mr-1.5">{s.date}</span> : null}
                          {s.text ?? "(media — matn yo'q)"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* ===== GURUHLAR ===== */}
        <TabsContent value="guruhlar" className="mt-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="@username yoki t.me havolasi"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              className="h-9 text-sm flex-1"
              autoComplete="off"
            />
            <Button
              size="sm"
              className="h-9"
              disabled={!addInput.trim() || busy === "add-group"}
              onClick={async () => {
                const ok = await act("add-group", { username: addInput.trim() });
                if (ok) setAddInput("");
              }}
            >
              {busy === "add-group" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Qo&apos;shish
            </Button>
            {data?.presets.presetFile && (
              <Button
                size="sm"
                variant="secondary"
                className="h-9"
                disabled={busy === "import-presets"}
                onClick={() => void act("import-presets")}
              >
                {busy === "import-presets" ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <DatabaseZap className="w-4 h-4 mr-1" />
                )}
                Preset 380 guruhni import
              </Button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto rounded-md border divide-y">
            {(data?.groups ?? []).length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Ro&apos;yxat bo&apos;sh — @username qo&apos;shing yoki preset import qiling.
              </div>
            ) : (
              (data?.groups ?? []).map((g) => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate max-w-[220px]">{g.title}</span>
                      <span className="font-mono text-muted-foreground">@{g.username}</span>
                      {g.source === "preset" && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">preset</Badge>
                      )}
                      {g.religious && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] text-amber-400 border-amber-500/40">
                          diniy — skanlanmaydi
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {g.kind === "channel" ? "kanal" : "guruh"} · {g.members.toLocaleString("en-US")} a&apos;zo
                      {g.lastStatus && g.lastStatus !== "ok" ? ` · ${STATUS_UZ[g.lastStatus] ?? g.lastStatus}` : ""}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`${g.title} o'chirish`}
                    disabled={busy === "delete-groups"}
                    onClick={() => void act("delete-groups", { ids: [g.id] })}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Qo&apos;shish read-only tekshiruv orqali bor: Telegram&apos;dan guruh haqiqatdan
            mavjudligi aniqlanadi (a&apos;zolar soni, kanal/guruh turi). Foydalanuvchi
            hisobiga HECH QANDAY iz qolmaydi.
          </p>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
