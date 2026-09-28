"use client";

import { useEffect, useRef, useState } from "react";
import {
  Radar,
  ScanSearch,
  Globe,
  Users,
  Youtube,
  MessagesSquare,
  FileText,
  Newspaper,
  Server,
  Link2,
  Square,
  ShieldAlert,
  Loader2,
  Bookmark,
  Clock,
  Target,
  History,
  GraduationCap,
  Zap,
  Network,
  Activity,
  Layers,
  Crosshair,
  UserRound,
  MailCheck,
  Building2,
  Github,
  UserCheck,
  Phone,
  BookOpen,
  Gauge,
  Snail,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { TerminalLog } from "@/components/osint/terminal-log";
import { ResultCard } from "@/components/osint/result-card";
import { AiPanel } from "@/components/osint/ai-panel";
import { DeepPanel, type PendingPivot, type SourceStat } from "@/components/osint/deep-panel";
import { IntelPanel } from "@/components/osint/intel-panel";
import {
  extractIntelBatch,
  mergeIntel,
  type IntelEntry,
  type IntelSourceItem,
} from "@/lib/intel";
import { ReviewPanel, type ReviewEntry } from "@/components/osint/review-panel";
import { DiagnosticsDialog } from "@/components/osint/diagnostics-dialog";
import {
  BookmarksSheet,
  type BookmarkItem,
} from "@/components/osint/bookmarks-sheet";
import {
  OSINT_MODULES,
  TARGET_TYPES,
  detectTargetType,
  extractPivots,
  normalizeUrl,
  anyModuleTitle,
  type DeepStep,
  type LogLine,
  type ModuleResult,
  type PivotCandidate,
  type ScanEvent,
  type SearchResultItem,
  type TargetType,
} from "@/lib/osint";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  search: Globe,
  social: Users,
  video: Youtube,
  forums: MessagesSquare,
  docs: FileText,
  news: Newspaper,
  tech: Server,
  profiles: Link2,
  // To'g'ridan-to'g'ri manbalar (OSINT Framework uslubi)
  dns: Network,
  whois: Activity,
  subdomains: Layers,
  "site-probe": Radar,
  recon: Crosshair,
  "ip-intel": Zap,
  "whois-ip": Activity,
  "ptr-recon": Server,
  // Email — to'g'ridan-to'g'ri manbalar
  breaches: ShieldAlert,
  gravatar: UserRound,
  mailbox: MailCheck,
  "corp-domain": Building2,
  "github-email": Github,
  // Username / Telefon / Ism — to'g'ridan-to'g'ri manbalar
  whatsmyname: ScanSearch,
  "username-probe": UserCheck,
  "phone-meta": Phone,
  "wiki-people": BookOpen,
};

const EXAMPLES: { type: TargetType; query: string }[] = [
  { type: "username", query: "dilshod_dev" },
  { type: "email", query: "info@example.uz" },
  { type: "phone", query: "+998901234567" },
  { type: "name", query: "Muhammad Karimov" },
  { type: "domain", query: "nuu.uz" },
  { type: "ip", query: "8.8.8.8" },
];

// Skaner chegaralari — rate-limit va beqarorlikka qarshi himoya.
// Qo'shimcha qidiruvlar FAQAT foydalanuvchi tanlagan izlar bo'yicha ishlaydi —
// tizim topgan ma'lumot bo'yicha o'zi qidiruv ishga tushirmaydi.
const MAX_SCANS = 12; // bitta sessiyada eng ko'pi bilan 12 skaner (ko'p maqsadli batch bilan)

// Parallel ishchilar — navbatdagi so'rovlarni bir vaqtda bajaradigan skanerlar.
// Queue + worker pool arxitekturasi: so'rovlar navbatga tushadi, N ta ishchi
// bir vaqtda oladi va bajaradi (controlled concurrency).
const PARALLEL_LEVELS = [1, 2, 3, 4] as const;
type ParallelLevel = (typeof PARALLEL_LEVELS)[number];
const PARALLEL_STAGGER_MS = 1200; // har ishchi orasidagi start farqi — dvigatelga bir vaqtda bosilmasin

// Tezlik darajalari — UI'dagi "Tezlik" boshqaruvi (localStorage: osint-speed).
// Scan API'ga speed parametri sifatida uzatiladi — server pauzalarni shunga
// qarab kengaytiradi/qisqartiradi, dvigatel ichidagi paceEngine ham shunga mos.
type SpeedLevel = "sekin" | "oddiy" | "tez" | "tezkor";
const SPEED_LEVELS: {
  val: SpeedLevel;
  label: string;
  hint: string;
  Icon: typeof Gauge;
}[] = [
  {
    val: "sekin",
    label: "Sekin",
    hint: "Bloklanishdan maksimal himoya — barcha pauzalar 2x",
    Icon: Snail,
  },
  {
    val: "oddiy",
    label: "Oddiy",
    hint: "Muvozanatli tezlik (standart)",
    Icon: Gauge,
  },
  {
    val: "tez",
    label: "Tez",
    hint: "2 barobar tezroq — yaxshi holatda ishlating",
    Icon: Zap,
  },
  {
    val: "tezkor",
    label: "Tezkor",
    hint: "Maksimal tezlik — bloklanish xavfi yuqori",
    Icon: Rocket,
  },
];


type VerdictInfo = { verdict: "related" | "unsure" | "unrelated"; reason: string };

interface NewResult {
  key: string;
  item: SearchResultItem;
  moduleTitle: string;
  moduleId?: string;
}

interface PivotJob {
  kind: TargetType;
  value: string;
  depth: number;
}

/** Batch (ko'p maqsadli) navbat holati — «Navbat: X/Y · N parallel» ko'rsatkichi */
interface BatchInfo {
  done: number;
  total: number;
  active: number;
}

const STEP_BADGES: Record<DeepStep, string> = {
  idle: "",
  global: "1-bosqich · global taramok",
  focused: "2-bosqich · manba fokusi",
  review: "AI solishtirish",
  pivots: "qo'shimcha qidiruv (qo'lda)",
  done: "yakunlandi",
  stopped: "to'xtatildi",
};

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function moduleTitleOf(id: string): string {
  return anyModuleTitle(id);
}

export default function Home() {
  const { toast } = useToast();

  const [type, setType] = useState<TargetType>("username");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"normal" | "deep">("deep");
  // Tezlik boshqaruvi — tanlov localStorage'da saqlanadi va skanerga uzatiladi
  const [speed, setSpeed] = useState<SpeedLevel>("oddiy");
  const speedRef = useRef<SpeedLevel>("oddiy");
  useEffect(() => {
    try {
      const s = localStorage.getItem("osint-speed");
      if (s === "sekin" || s === "oddiy" || s === "tez" || s === "tezkor") {
        setSpeed(s);
        speedRef.current = s;
      }
    } catch {
      /* noop */
    }
  }, []);
  const changeSpeed = (s: SpeedLevel) => {
    setSpeed(s);
    speedRef.current = s;
    try {
      localStorage.setItem("osint-speed", s);
    } catch {
      /* noop */
    }
  };

  // Parallel ishchilar darajasi — navbatdagi so'rovlarni nechta bir vaqtda bajaradi
  // (localStorage: osint-parallel). 1 = ketma-ket, 4 = maksimal tezlik.
  const [parallel, setParallel] = useState<ParallelLevel>(3);
  const parallelRef = useRef<ParallelLevel>(3);
  useEffect(() => {
    try {
      const p = localStorage.getItem("osint-parallel");
      const n = Number(p);
      if (PARALLEL_LEVELS.includes(n as ParallelLevel)) {
        setParallel(n as ParallelLevel);
        parallelRef.current = n as ParallelLevel;
      }
    } catch {
      /* noop */
    }
  }, []);
  const changeParallel = (n: ParallelLevel) => {
    setParallel(n);
    parallelRef.current = n;
    try {
      localStorage.setItem("osint-parallel", String(n));
    } catch {
      /* noop */
    }
  };

  // Ko'p maqsadli rejim — textarea'da har qator bitta maqsad, turlari avtomatik
  const [multiMode, setMultiMode] = useState(false);

  // Batch navbat holati — «Navbat: X/Y · N parallel» indikatori
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  // Ko'p maqsadli sessiya so'rovlari — Maqsad kartasida ro'yxat ko'rsatish uchun
  const [batchQueries, setBatchQueries] = useState<string[]>([]);

  const [step, setStep] = useState<DeepStep>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [modules, setModules] = useState<ModuleResult[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [target, setTarget] = useState<{ type: TargetType; query: string } | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const [pendingCandidates, setPendingCandidates] = useState<PendingPivot[]>([]);
  const [scansDone, setScansDone] = useState(0);
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictInfo>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  const [aiText, setAiText] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);

 const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const [recent, setRecent] = useState<{ type: TargetType; query: string }[]>([]);

  // «Topilgan qo'shimcha ma'lumotlar» — skaner davomida yig'ilgan telefon,
  // email, ism-familiya va h.k. Alohida joyda saqlanadi, faqat foydalanuvchi
  // tanlagani bo'yicha qidiriladi.
  const [intel, setIntel] = useState<IntelEntry[]>([]);
  const intelRef = useRef<IntelEntry[]>([]);
  const [searchedKeys, setSearchedKeys] = useState<Set<string>>(new Set());

  const scanAbortsRef = useRef<Set<AbortController>>(new Set());
  // Parallel ishlayotgan skanerlar yorliqlari — «Skanerlanmoqda: A · B · C»
  const runningLabelsRef = useRef<Set<string>>(new Set());
  const aiAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const touchedTabRef = useRef(false);
  const logIdRef = useRef(0);
  const processingRef = useRef(false);

  // Dvigatel holati — render'ga ta'sir qilmaydigan ichki holat
  const engineRef = useRef({
    stopped: false,
    queue: [] as PivotJob[],
    runSet: new Set<string>(),
    pending: [] as PendingPivot[],
    knownUrls: new Set<string>(),
    scansDone: 0,
    rootQuery: "",
    rootType: "username" as TargetType,
    // Intel ajratishda hisobga olinmaydigan so'rovlar — batch sessiyada barcha
    // foydalanuvchi kiritgan maqsadlar (o'zi topilgan ism qayta chiqmasligi uchun)
    batchQueries: [] as string[],
  });
  const resultsRef = useRef<Map<string, { item: SearchResultItem; moduleTitle: string }>>(new Map());
  const verdictsRef = useRef<Record<string, VerdictInfo>>({});
  const skippedRef = useRef<Set<string>>(new Set());
  const statsRef = useRef<Record<string, number>>({});

  const busy = step === "global" || step === "focused" || step === "pivots";

  useEffect(() => {
    try {
      const raw = localStorage.getItem("osint-recent");
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      /* noop */
    }
    loadBookmarks();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 500);
    return () => clearInterval(t);
  }, [busy]);

  const loadBookmarks = async () => {
    setBookmarksLoading(true);
    try {
      const res = await fetch("/api/bookmarks");
      const data = await res.json();
      if (Array.isArray(data.bookmarks)) {
        setBookmarks(data.bookmarks);
        setSavedKeys(
          new Set(data.bookmarks.map((b: BookmarkItem) => `${b.url}||${b.query ?? ""}`))
        );
      }
    } catch {
      /* noop */
    }
    setBookmarksLoading(false);
  };

  const pushLog = (level: LogLine["level"], message: string) => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const id = ++logIdRef.current;
    setLogs((prev) => [
      ...prev,
      { id, time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, level, message },
    ]);
  };

  const saveRecent = (t: TargetType, q: string) => {
    setRecent((prev) => {
      const next = [{ type: t, query: q }, ...prev.filter((r) => !(r.query === q && r.type === t))].slice(0, 6);
      try {
        localStorage.setItem("osint-recent", JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  // ===== Bitta skaner (NDJSON oqim) — natijalarni modullar bilan birlashtiradi =====
  // Parallel ishchilar ham shu funksiyani chaqiradi: har skaner oqimi mustaqil,
  // abortlar to'plamda saqlanadi, yorliqlar "A · B · C" ko'rinishida birlashadi.
  const runScanTarget = async (
    job: PivotJob,
    querySet: "core" | "deep-only" | "extended",
    moduleFilter?: string[]
  ): Promise<NewResult[]> => {
    const eng = engineRef.current;
    const ctrl = new AbortController();
    scanAbortsRef.current.add(ctrl);
    runningLabelsRef.current.add(job.value);
    if (runningLabelsRef.current.size === 1) startedAtRef.current = Date.now();
    setActiveLabel([...runningLabelsRef.current].join(" · "));
    setProgress(null);

    const scanNo = eng.scansDone + 1;
    const modeLabel =
      querySet === "core" ? "GLOBAL" : querySet === "deep-only" ? "FOKUS-CHUQUR" : "KENGAYTIRILGAN";
    pushLog(
      "sys",
      `=== SKANER #${scanNo} · "${job.value}" (${job.kind.toUpperCase()}, ${modeLabel}, chuqurlik ${job.depth}) ===`
    );

    const newResults: NewResult[] = [];
    const intelBatch: IntelSourceItem[] = [];

    const handleEvent = (ev: ScanEvent) => {
      switch (ev.type) {
        case "log":
          if (ev.log) {
            // Server log id'larini klient hisoblagichi orqali qayta belgilaymiz —
            // har skaner so'rovida server 1,2,3... dan boshlaydi, key"lar to'qnashmasligi uchun
            const entry: LogLine = { ...ev.log, id: ++logIdRef.current };
            setLogs((prev) => [...prev, entry]);
          }
          break;
        case "module_start":
          setModules((prev) =>
            prev.some((m) => m.moduleId === ev.moduleId)
              ? prev
              : [
                  ...prev,
                  {
                    moduleId: ev.moduleId!,
                    moduleTitle: ev.moduleTitle ?? ev.moduleId!,
                    status: "running",
                    count: 0,
                    results: [],
                  },
                ]
          );
          break;
        case "module_done": {
          const incoming = ev.results ?? [];
          setModules((prev) => {
            const existing = prev.find((m) => m.moduleId === ev.moduleId);
            if (!existing) {
              return [
                ...prev,
                {
                  moduleId: ev.moduleId!,
                  moduleTitle: ev.moduleTitle ?? ev.moduleId!,
                  status: "done",
                  count: incoming.length,
                  results: incoming,
                },
              ];
            }
            const seen = new Set(existing.results.map((r) => normalizeUrl(r.url)));
            const fresh = incoming.filter((r) => {
              const k = normalizeUrl(r.url);
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
            return prev.map((m) =>
              m.moduleId === ev.moduleId
                ? { ...m, status: "done" as const, count: existing.count + fresh.length, results: [...existing.results, ...fresh] }
                : m
            );
          });
          const mTitle = ev.moduleTitle ?? ev.moduleId!;
          let added = 0;
          for (const r of incoming) {
            intelBatch.push({ item: r, moduleTitle: mTitle, moduleId: ev.moduleId });
            const k = normalizeUrl(r.url);
            if (!eng.knownUrls.has(k)) {
              eng.knownUrls.add(k);
              newResults.push({ key: k, item: r, moduleTitle: mTitle, moduleId: ev.moduleId });
              resultsRef.current.set(k, { item: r, moduleTitle: mTitle });
              added++;
            }
          }
          statsRef.current[ev.moduleId!] = (statsRef.current[ev.moduleId!] ?? 0) + added;
          if (!touchedTabRef.current && added > 0) setActiveTab(ev.moduleId!);
          break;
        }
        case "progress":
          setProgress({ done: ev.count ?? 0, total: ev.total ?? 0 });
          break;
        case "error":
          pushLog("error", ev.message ?? "Skaner xatosi");
          break;
      }
    };

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: job.kind,
          query: job.value,
          querySet,
          modules: moduleFilter,
          speed: speedRef.current,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Server xatosi" }));
        throw new Error(err.error || "Server xatosi");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line) as ScanEvent);
          } catch {
            /* skip malformed line */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        pushLog("error", `Skaner xatosi: ${(e as Error).message}`);
        toast({
          title: "Skaner xatosi",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      scanAbortsRef.current.delete(ctrl);
      runningLabelsRef.current.delete(job.value);
      if (runningLabelsRef.current.size === 0) setActiveLabel(null);
      else setActiveLabel([...runningLabelsRef.current].join(" · "));
    }

    // Topilgan qo'shimcha ma'lumotlarni alohida panelga yig'amiz —
    // tizim o'zi qidirmaydi, faqat foydalanuvchi tanlagani qidiriladi
    if (intelBatch.length > 0) {
      const exclude = eng.batchQueries.length > 0 ? eng.batchQueries : [eng.rootQuery];
      const add = extractIntelBatch(intelBatch, exclude);
      const merged = mergeIntel(intelRef.current, add);
      intelRef.current = merged;
      setIntel(merged);
    }

    eng.scansDone++;
    setScansDone(eng.scansDone);
    return newResults;
  };

  // ===== Pivotlar yigimi — yangi natijalardan avtomatik izlarni ajratadi =====
  // Profil sanovchi modullar — ularning URL hostlari profil saytlari, "domen iz" emas
  const PROFILE_ENUM_MODS = new Set(["whatsmyname", "profiles", "username-probe"]);
  const harvestPivots = (newResults: NewResult[]) => {
    const eng = engineRef.current;
    let addedCount = 0;
    for (const { key, item, moduleId } of newResults) {
      if (skippedRef.current.has(key)) continue;
      for (const p of extractPivots(item)) {
        // WhatsMyName/profil modullari natijasidagi sayt domeni — alohida iz emas
        if (p.kind === "domain" && moduleId && PROFILE_ENUM_MODS.has(moduleId)) continue;
        const pk = `${p.kind}:${p.value}`;
        if (eng.runSet.has(pk)) continue;
        if (eng.pending.some((x) => x.kind === p.kind && x.value === p.value)) continue;
        eng.pending.push({ kind: p.kind, value: p.value });
        addedCount++;
      }
    }
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    if (addedCount > 0) {
      pushLog("ok", `${addedCount} ta yangi ma'lumot ajratildi — «Topilgan qo'shimcha ma'lumotlar» panelida`);
    }
  };

  // ===== AI solishtirish — natijalarni maqsad bilan taqqoslaydi =====
  const applyVerdicts = async (items: NewResult[], label: string): Promise<boolean> => {
    const eng = engineRef.current;
    try {
      const res = await fetch("/api/relevance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: eng.rootQuery,
          type: eng.rootType,
          results: items.map((r) => ({
            id: r.key,
            title: r.item.name,
            snippet: r.item.snippet,
            url: r.item.url,
            moduleTitle: r.moduleTitle,
          })),
        }),
      });
      if (!res.ok) throw new Error("Server xatosi");
      const data = await res.json();
      const list = Array.isArray(data.verdicts) ? data.verdicts : [];
      let related = 0;
      let unsure = 0;
      let unrelated = 0;
      for (const v of list) {
        if (!v?.id || !v?.verdict) continue;
        verdictsRef.current[v.id as string] = {
          verdict: v.verdict as VerdictInfo["verdict"],
          reason: String(v.reason ?? ""),
        };
        if (v.verdict === "related") related++;
        else if (v.verdict === "unsure") unsure++;
        else unrelated++;
      }
      setVerdicts({ ...verdictsRef.current });
      pushLog(
        "ok",
        `AI solishtirish${label ? ` (${label})` : ""}: ${related} mos · ${unsure} aniq emas · ${unrelated} mos emas`
      );
      return list.length > 0;
    } catch {
      pushLog("warn", "AI solishtirish bajarilmadi — barcha natijalar saqlanib qoldi");
      return false;
    }
  };

  const buildReviewEntries = (): ReviewEntry[] => {
    const out: ReviewEntry[] = [];
    for (const [key, v] of resultsRef.current) {
      const vd = verdictsRef.current[key];
      if (!vd || vd.verdict === "related" || skippedRef.current.has(key)) continue;
      out.push({
        key,
        title: v.item.name,
        url: v.item.url,
        host: v.item.host_name,
        moduleTitle: v.moduleTitle,
        verdict: vd.verdict as "unsure" | "unrelated",
        reason: vd.reason,
      });
    }
    return out;
  };

  const runReviewGate = async (): Promise<boolean> => {
    const eng = engineRef.current;
    const items = [...resultsRef.current.entries()]
      .filter(([key]) => !skippedRef.current.has(key))
      .map(([key, v]) => ({ key, item: v.item, moduleTitle: v.moduleTitle }))
      .slice(0, 40);
    if (items.length === 0) return false;
    setReviewLoading(true);
    pushLog("info", "AI topilmalarni maqsad va bir-biri bilan solishtiryapti...");
    const ok = await applyVerdicts(items, "asosiy taramok");
    setReviewLoading(false);
    const flagged = buildReviewEntries();
    setReviewEntries(flagged);
    return ok && flagged.length > 0;
  };

  const finalVerdictPass = async () => {
    const items = [...resultsRef.current.entries()]
      .filter(([key]) => !verdictsRef.current[key] && !skippedRef.current.has(key))
      .map(([key, v]) => ({ key, item: v.item, moduleTitle: v.moduleTitle }))
      .slice(0, 40);
    if (items.length === 0) return;
    pushLog("info", "AI pivot skanerlari natijalarini ham solishtiryapti...");
    await applyVerdicts(items, "pivotlar");
    setReviewEntries(buildReviewEntries());
  };

  // ===== Navbat protsessori — worker-pool arxitekturasi =====
  // Navbatdagi so'rovlarni N ta parallel ishchi bo'lib bajaradi (controlled
  // concurrency): har ishchi navbatdan keyingi vazifani oladi, tugatgach
  // yana oladi — navbat bo'saguncha. Ishchilar STAGGER oraliqda start oladi —
  // qidiruv dvigatellariga bir vaqtda "gulda" bosilmasin (429 himoyasi).
  // Retry/backoff server tomonda bor (429/403 retry, adaptiv sovitish).
  const processQueue = async (querySet: "core" | "extended" = "extended", withVerdict = true) => {
    if (processingRef.current) return;
    processingRef.current = true;
    const eng = engineRef.current;
    let done = 0;
    const totalInitial = eng.queue.length;
    if (totalInitial > 1) setBatchInfo({ done: 0, total: totalInitial, active: 0 });

    const worker = async (wIdx: number) => {
      if (wIdx > 0) {
        await new Promise((r) => setTimeout(r, wIdx * PARALLEL_STAGGER_MS));
      }
      while (!eng.stopped && eng.queue.length > 0 && eng.scansDone < MAX_SCANS) {
        const job = eng.queue.shift();
        if (!job) break;
        setBatchInfo((b) =>
          b ? { ...b, active: runningLabelsRef.current.size } : b
        );
        try {
          const newResults = await runScanTarget(job, querySet);
          if (eng.stopped) break;
          harvestPivots(newResults);
        } finally {
          done++;
          setBatchInfo((b) =>
            b
              ? {
                  done,
                  total: Math.max(b.total, done + eng.queue.length),
                  active: runningLabelsRef.current.size,
                }
              : b
          );
        }
      }
    };

    const n = Math.max(
      1,
      Math.min(parallelRef.current, eng.queue.length || 1, MAX_SCANS - eng.scansDone)
    );
    if (n > 1 && eng.queue.length > 0) {
      pushLog(
        "sys",
        `${n} ta skaner parallel ishga tushdi — navbatda ${eng.queue.length} ta so'rov (har ishchi ${(PARALLEL_STAGGER_MS / 1000).toFixed(1)}s oraliqda start oladi)`
      );
    }
    try {
      await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));
    } finally {
      processingRef.current = false;
      setBatchInfo(null);
    }
    if (engineRef.current.stopped) {
      setStep("stopped");
      return;
    }
    if (withVerdict) {
      await finalVerdictPass();
    }
    setStep("done");
    pushLog(
      "sys",
      withVerdict
        ? "Qo'shimcha qidiruvlar yakunlandi — AI xulosa chiqarishingiz mumkin."
        : `Navbat yakunlandi (${done}/${totalInitial}) — «Topilgan qo'shimcha ma'lumotlar» paneldan davom etishingiz mumkin.`
    );
  };

  const continueAfterReview = () => {
    const eng = engineRef.current;
    if (eng.stopped) {
      setStep("stopped");
      return;
    }
    // Avtomatik qidiruv YO'Q: topilgan izlar panelda qoladi —
    // qaysi biri bo'yicha qidirishni foydalanuvchi o'zi tanlaydi
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    setStep("done");
    pushLog(
      "sys",
      "Skaner yakunlandi — topilgan telefon, email va boshqa ma'lumotlar «Topilgan qo'shimcha ma'lumotlar» panelida yig'ilgan."
    );
    pushLog(
      "info",
      "Qo'shimcha qidiruv faqat siz tanlagan ma'lumot bo'yicha boradi: panelda «Qidir» tugmasini bosing yoki yuqorida yangi maqsad kiriting."
    );
  };

  // ===== Qo'lda pivot: "+" tugmasi yoki paneldagi Play =====
  const addPivotManual = (p: { kind: TargetType; value: string }) => {
    const eng = engineRef.current;
    if (step === "idle") return;
    const pk = `${p.kind}:${p.value}`;
    if (eng.runSet.has(pk)) {
      toast({
        title: "Bu iz allaqachon navbatda yoki tekshirilgan",
        description: `${p.kind.toUpperCase()}: ${p.value}`,
      });
      return;
    }
    if (eng.scansDone >= MAX_SCANS) {
      toast({
        title: "Skaner limitiga yetildi",
        description: `Bitta sessiyada eng ko'pi bilan ${MAX_SCANS} ta skaner bajariladi.`,
        variant: "destructive",
      });
      return;
    }
    eng.runSet.add(pk);
    setSearchedKeys((prev) => new Set(prev).add(pk));
    eng.queue.push({ kind: p.kind, value: p.value, depth: 1 });
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    pushLog("info", `Qo'lda navbat: "${p.value}" (${p.kind.toUpperCase()}) bo'yicha chuqur skaner`);
    if (!processingRef.current) {
      setStep("pivots");
      void processQueue();
    }
  };

  // ===== «Topilgan ma'lumotlar» panelidan qidiruv — FAQAT qo'lda =====
  const runIntelSearch = (kind: TargetType, value: string) => {
    if (step === "idle" || !target) {
      // Faol sessiya yo'q — shu qiymat bilan yangi sessiya boshlaymiz
      setType(kind);
      setInput(value);
      void startScan(kind, value);
      return;
    }
    addPivotManual({ kind, value });
  };

  // ===== «Barchasini qidirish» — barcha tekshirilmagan izlar BIRGA navbatga =====
  // Foydalanuvchi ism-familiya bo'yicha qidirib, telefon/email chiqib qolsa —
  // hammasini bir vaqtda parallel ishchilar bilan tekshiradi.
  const runIntelSearchAll = () => {
    const eng = engineRef.current;
    if (step === "idle" || !target) {
      toast({
        title: "Avval sessiya boshlang",
        description: "Barchasini birga qidirish faol skaner sessiyasida ishlaydi.",
      });
      return;
    }
    const pendingList = intelRef.current.filter((e) => !eng.runSet.has(`${e.kind}:${e.value}`));
    if (pendingList.length === 0) {
      toast({ title: "Hammasi tekshirilgan", description: "Panelda yangi iz qolmadi." });
      return;
    }
    const cap = MAX_SCANS - eng.scansDone;
    if (cap <= 0) {
      toast({
        title: "Skaner limitiga yetildi",
        description: `Bitta sessiyada eng ko'pi bilan ${MAX_SCANS} ta skaner bajariladi.`,
        variant: "destructive",
      });
      return;
    }
    const take = pendingList.slice(0, cap);
    for (const e of take) {
      eng.runSet.add(`${e.kind}:${e.value}`);
      eng.queue.push({ kind: e.kind, value: e.value, depth: 1 });
    }
    setSearchedKeys((prev) => new Set([...prev, ...take.map((e) => `${e.kind}:${e.value}`)]));
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    pushLog(
      "info",
      `«Barchasini qidirish»: ${take.length} ta iz navbatga qo'yildi${pendingList.length > take.length ? ` (limit tufayli ${pendingList.length - take.length} tasi keyingi navbatga qoldi)` : ""} — ${parallelRef.current} ta parallel ishchi bajaradi`
    );
    setStep("pivots");
    if (!processingRef.current) {
      void processQueue();
    }
  };

  const abortAllScans = () => {
    for (const ctrl of scanAbortsRef.current) {
      try {
        ctrl.abort();
      } catch {
        /* noop */
      }
    }
    scanAbortsRef.current.clear();
    runningLabelsRef.current.clear();
  };

  const stopAll = () => {
    const eng = engineRef.current;
    eng.stopped = true;
    eng.queue = [];
    // Barcha parallel skaner oqimlarini to'xtatamiz
    abortAllScans();
    setActiveLabel(null);
    setBatchInfo(null);
    setStep("stopped");
    pushLog("warn", "Foydalanuvchi sessiyani to'xtatdi.");
  };

  // ===== Ko'p maqsadli (batch) sessiya — har so'rov navbatga, worker-pool bajaradi =====
  // Bitta turgan joyda bir nechta buyruq: ism-familiya, telefon, email — aralash
  // kiritiladi, turlari avtomatik aniqlanadi, barchasi parallel skanerlanadi.
  const startBatchScan = async (queries: string[]) => {
    aiAbortRef.current?.abort();
    abortAllScans();
    processingRef.current = false;

    const rootQuery = queries[0];
    const rootType = detectTargetType(rootQuery);

    engineRef.current = {
      stopped: false,
      queue: [],
      runSet: new Set<string>(),
      pending: [],
      knownUrls: new Set<string>(),
      scansDone: 0,
      rootQuery,
      rootType,
      batchQueries: queries,
    };
    const eng = engineRef.current;
    for (const q of queries) {
      const kind = detectTargetType(q);
      eng.runSet.add(`${kind}:${q.toLowerCase()}`);
      eng.queue.push({ kind, value: q, depth: 0 });
    }

    resultsRef.current = new Map();
    verdictsRef.current = {};
    skippedRef.current = new Set();
    statsRef.current = {};
    touchedTabRef.current = false;
    logIdRef.current = 0;

    setVerdicts({});
    setSkipped(new Set());
    setReviewEntries([]);
    setPendingCandidates([]);
    setScansDone(0);
    setFocusIds([]);
    intelRef.current = [];
    setIntel([]);
    setSearchedKeys(new Set(eng.runSet));
    setLogs([]);
    setModules([]);
    setAiText("");
    setAiStatus("idle");
    setElapsed(0);
    setProgress(null);
    setTarget({ type: rootType, query: rootQuery });
    setBatchQueries(queries);
    saveRecent(rootType, rootQuery);
    setStep("global");

    pushLog(
      "sys",
      `KO'P MAQSADLI SESSIYA — ${queries.length} ta so'rov navbatga qo'yildi · ${parallelRef.current} ta parallel ishchi · tezlik: ${SPEED_LEVELS.find((s) => s.val === speedRef.current)?.label ?? "Oddiy"}`
    );
    for (const job of eng.queue) {
      pushLog("info", `Navbatga qo'shildi: [${job.kind.toUpperCase()}] ${job.value}`);
    }

    // Barcha so'rovlar "core" to'plam bilan parallel bajariladi — tezlik ustuvor
    await processQueue("core", false);
  };

  // ===== Asosiy oqim =====
  const startScan = async (ovType?: TargetType, ovQuery?: string) => {
    const raw = (ovQuery ?? input).trim();

    // KO'P MAQSADLI REJIM — textarea'da har qator bitta maqsad
    // (vergul / nuqtali vergul bilan ajratilganlar ham bo'linadi)
    if (multiMode && !ovQuery) {
      const seenQ = new Set<string>();
      const parts = raw
        .split(/\r?\n|[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
        .filter((s) => {
          const k = s.toLowerCase();
          if (seenQ.has(k)) return false;
          seenQ.add(k);
          return true;
        });
      if (parts.length > 1) {
        if (parts.length > MAX_SCANS) {
          toast({
            title: "Navbat limiti",
            description: `Bir sessiyada eng ko'pi bilan ${MAX_SCANS} ta so'rov — birinchisi qabul qilindi.`,
          });
        }
        await startBatchScan(parts.slice(0, MAX_SCANS));
        return;
      }
    }

    const query = raw;
    const scanType =
      ovType ?? (multiMode ? detectTargetType(query) : type);
    if (query.length < 2) {
      toast({
        title: "Maqsad juda qisqa",
        description: "Iltimos, kamida 2 belgidan iborat maqsad kiriting.",
        variant: "destructive",
      });
      return;
    }

    aiAbortRef.current?.abort();
    abortAllScans();
    processingRef.current = false;

    engineRef.current = {
      stopped: false,
      queue: [],
      runSet: new Set([`${scanType}:${query.toLowerCase()}`]),
      pending: [],
      knownUrls: new Set<string>(),
      scansDone: 0,
      rootQuery: query,
      rootType: scanType,
      batchQueries: [query],
    };
    resultsRef.current = new Map();
    verdictsRef.current = {};
    skippedRef.current = new Set();
    statsRef.current = {};
    touchedTabRef.current = false;
    logIdRef.current = 0;

    setVerdicts({});
    setSkipped(new Set());
    setReviewEntries([]);
    setPendingCandidates([]);
    setScansDone(0);
    setFocusIds([]);
    intelRef.current = [];
    setIntel([]);
    setSearchedKeys(new Set([`${scanType}:${query.toLowerCase()}`]));
    setLogs([]);
    setModules([]);
    setAiText("");
    setAiStatus("idle");
    setElapsed(0);
    setProgress(null);
    setTarget({ type: scanType, query });
    setBatchQueries([]);
    saveRecent(scanType, query);
    setStep("global");

    pushLog(
      "sys",
      `SESSIYA BOSHLANDI — rejim: ${mode === "deep" ? "CHUQUR (adaptiv)" : "TEZ"} · tezlik: ${SPEED_LEVELS.find((s) => s.val === speedRef.current)?.label ?? "Oddiy"}`
    );

    // 1-BOSQICH: dunyo bo'ylab — barcha ochiq tarmoqlar
    const r1 = await runScanTarget({ kind: scanType, value: query, depth: 0 }, "core");
    let eng = engineRef.current;
    if (eng.stopped) {
      setStep("stopped");
      return;
    }
    harvestPivots(r1);

    if (mode === "deep") {
      // 2-BOSQICH: eng unumli manbalarga chuqur fokus
      const top = Object.entries(statsRef.current)
        .filter(([id, c]) => id !== "profiles" && c > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id);
      if (top.length > 0) {
        setFocusIds(top);
        pushLog(
          "sys",
          `2-BOSQICH — ko'p natija bergan manbalar: ${top.map(moduleTitleOf).join(", ")}`
        );
        setStep("focused");
        const r2 = await runScanTarget({ kind: scanType, value: query, depth: 0 }, "deep-only", top);
        if (engineRef.current.stopped) {
          setStep("stopped");
          return;
        }
        harvestPivots(r2);
      }

      // 3-QADAM: AI solishtirish (review)
      setStep("review");
      eng = engineRef.current;
      if (eng.stopped) {
        setStep("stopped");
        return;
      }
      const hasFlagged = await runReviewGate();
      if (engineRef.current.stopped) {
        setStep("stopped");
        return;
      }
      if (!hasFlagged) {
        pushLog("info", "Shubhali topilma yo'q — avtomatik davom etilmoqda...");
        continueAfterReview();
        return;
      }
      pushLog("info", "Shubhali topilmalar panelda — tekshiring yoki davom eting.");
    } else {
      setStep("done");
      pushLog("sys", "Tez skaner yakunlandi — «+» orqali istalgan iz bo'yicha chuqur qidirishingiz mumkin.");
    }
  };

  const handleCheck = (key: string) => {
    skippedRef.current.delete(key);
    verdictsRef.current[key] = { verdict: "related", reason: "Foydalanuvchi tekshirib tasdiqladi" };
    setVerdicts({ ...verdictsRef.current });
    setSkipped(new Set(skippedRef.current));
    setReviewEntries(buildReviewEntries());
    toast({ title: "Tasdiqlandi", description: "Natija keyingi bosqichlarda hisobga olinadi." });
  };

  const handleSkip = (key: string) => {
    skippedRef.current.add(key);
    verdictsRef.current[key] = { verdict: "unrelated", reason: "Foydalanuvchi o'tkazib yubordi" };
    setVerdicts({ ...verdictsRef.current });
    setSkipped(new Set(skippedRef.current));
    setReviewEntries(buildReviewEntries());
    toast({ title: "O'tkazib yuborildi", description: "Natija keyingi bosqichlardan chiqarildi." });
  };

  const runAi = async (question?: string) => {
    if (!target || modules.length === 0) return;
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;

    if (!question) setAiText("");
    setAiStatus("streaming");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: target.query,
          type: target.type,
          question,
          modules: modules.map((m) => ({ moduleTitle: m.moduleTitle, results: m.results })),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI xizmati xatosi");
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiText(acc);
      }
      setAiStatus("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setAiStatus("error");
      toast({
        title: "AI tahlil xatosi",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const saveResult = async (item: SearchResultItem) => {
    if (!target) return;
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.name,
          url: item.url,
          snippet: item.snippet,
          module: activeTab,
          moduleName: modules.find((m) => m.moduleId === activeTab)?.moduleTitle,
          query: target.query,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedKeys((prev) => new Set(prev).add(`${item.url}||${target.query}`));
        if (!data.alreadySaved) setBookmarks((prev) => [data.bookmark, ...prev]);
        toast({
          title: data.alreadySaved ? "Allaqachon saqlangan" : "Saqlandi",
          description: item.name.slice(0, 60),
        });
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      toast({
        title: "Saqlash xatosi",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const removeBookmark = async (id: string) => {
    try {
      const res = await fetch(`/api/bookmarks?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBookmarks((prev) => prev.filter((b) => b.id !== id));
        loadBookmarks();
        toast({ title: "O'chirildi" });
      }
    } catch {
      toast({ title: "O'chirish xatosi", variant: "destructive" });
    }
  };

  const totalResults = modules.reduce((acc, m) => acc + m.count, 0);
  const currentTypeLabel = TARGET_TYPES.find((t) => t.value === type)?.label ?? type;
  const stats: SourceStat[] = modules.map((m) => ({
    id: m.moduleId,
    title: m.moduleTitle,
    count: m.count,
  }));

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 items-center justify-center">
              <Radar className="w-4.5 h-4.5 text-primary" />
            </div>
            <span className="font-semibold tracking-tight">OSINT Radar</span>
            <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] text-emerald-500">
              O&apos;QUV LOYIHASI
            </Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DiagnosticsDialog>
              <Button variant="outline" size="sm" className="gap-2">
                <Activity className="w-4 h-4" />
                <span className="hidden sm:inline">Diagnostika</span>
              </Button>
            </DiagnosticsDialog>
            <BookmarksSheet
              open={bookmarksOpen}
              onOpenChange={setBookmarksOpen}
              bookmarks={bookmarks}
              loading={bookmarksLoading}
              onRemove={removeBookmark}
            >
              <Button variant="outline" size="sm" className="gap-2 relative">
                <Bookmark className="w-4 h-4" />
                <span className="hidden sm:inline">Saqlanganlar</span>
                {bookmarks.length > 0 && (
                  <Badge className="h-5 px-1.5 text-[10px] bg-primary text-primary-foreground">
                    {bookmarks.length}
                  </Badge>
                )}
              </Button>
            </BookmarksSheet>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Eslatma */}
        <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <AlertTitle className="text-amber-300 text-sm">
            Faqat o&apos;quv va tadqiqot maqsadida
          </AlertTitle>
          <AlertDescription className="text-amber-200/70 text-xs leading-relaxed">
            Tizim PASSIVE OSINT rejimida ishlaydi: faqat ochiq internet
            manbalaridan qidiradi. Hech qanday tizimga ruxsatsiz kirish,
            parol buzish yoki yashirin ma&apos;lumot olish amalga oshirilmaydi.
            Topilgan ma&apos;lumotlardan qonunga xilof maqsadda foydalanmang.
          </AlertDescription>
        </Alert>

        {/* Qidiruv formasi */}
        <section className={step === "idle" ? "text-center pt-6 pb-2" : ""}>
          {step === "idle" && (
            <div className="max-w-2xl mx-auto mb-6">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Maqsadni kiriting — <span className="text-primary">qaysi izni tekshirishni siz tanlaysiz</span>
              </h1>
              <p className="mt-3 text-muted-foreground text-sm sm:text-base leading-relaxed">
                Ochiq manbalar razvedkasi: dunyo bo&apos;ylab tarmoqlar
                skanerlanadi va AI natijalarni solishtiradi. Topilgan telefon,
                email, ism-familiya va boshqa ma&apos;lumotlar alohida
                panelda to&apos;planadi — qaysi biri bo&apos;yicha chuqur
                qidirishni siz tanlaysiz, tizim o&apos;zi qidirmaydi.
              </p>
            </div>
          )}

          <Card className="p-4 sm:p-5 max-w-3xl mx-auto">
            {!multiMode && (
              <div className="flex flex-wrap gap-1.5 justify-center">
                {TARGET_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      type === t.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                    }`}
                    aria-pressed={type === t.value}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              {multiMode ? (
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
                      e.preventDefault();
                      void startScan();
                    }
                  }}
                  rows={4}
                  placeholder={"Har qatorda bitta maqsad — tur avtomatik aniqlanadi:\nMuhammad Karimov\n+998901234567\ninfo@example.com"}
                  className="min-h-[104px] text-base font-mono text-sm"
                  aria-label="Ko'p maqsadli kiritish"
                />
              ) : (
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && startScan()}
                  placeholder={`${currentTypeLabel} kiriting — masalan: ${
                    TARGET_TYPES.find((t) => t.value === type)?.example
                  }`}
                  className="h-11 text-base"
                  aria-label="Maqsad kiritish"
                />
              )}
              {busy ? (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={stopAll}
                  className="gap-2 shrink-0"
                >
                  <Square className="w-4 h-4" />
                  To&apos;xtatish
                </Button>
              ) : (
                <Button size="lg" onClick={() => startScan()} className="gap-2 shrink-0">
                  <ScanSearch className="w-4 h-4" />
                  Skanerlash
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="text-[11px] text-muted-foreground mr-1 flex items-center gap-1">
                <Network className="w-3 h-3" /> Rejim:
              </span>
              <button
                onClick={() => setMode("deep")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  mode === "deep"
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                }`}
                aria-pressed={mode === "deep"}
              >
                Chuqur taramok (AI solishtirish bilan)
              </button>
              <button
                onClick={() => setMode("normal")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  mode === "normal"
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                }`}
                aria-pressed={mode === "normal"}
              >
                <Zap className="inline w-3 h-3 mr-1 -mt-0.5" />
                Tez skaner
              </button>
              <span className="mx-1 hidden sm:inline text-border">|</span>
              <button
                onClick={() => {
                  setMultiMode((m) => !m);
                  setInput("");
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  multiMode
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                }`}
                aria-pressed={multiMode}
                title="Bir vaqtda bir nechta so'rov — har qator bitta maqsad, hammasi parallel skanerlanadi"
              >
                <Layers className="inline w-3 h-3 mr-1 -mt-0.5" />
                Ko&apos;p maqsadli
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              <span className="text-[11px] text-muted-foreground mr-1 flex items-center gap-1">
                <Gauge className="w-3 h-3" /> Tezlik:
              </span>
              {SPEED_LEVELS.map(({ val, label, hint, Icon }) => (
                <button
                  key={val}
                  onClick={() => changeSpeed(val)}
                  title={hint}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    speed === val
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                  }`}
                  aria-pressed={speed === val}
                >
                  <Icon className="inline w-3 h-3 mr-1 -mt-0.5" />
                  {label}
                </button>
              ))}
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                {SPEED_LEVELS.find((s) => s.val === speed)?.hint}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              <span className="text-[11px] text-muted-foreground mr-1 flex items-center gap-1">
                <Rocket className="w-3 h-3" /> Parallel:
              </span>
              {PARALLEL_LEVELS.map((n) => (
                <button
                  key={n}
                  onClick={() => changeParallel(n)}
                  title={`${n} ta skaner bir vaqtda ishlaydi`}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors tabular-nums ${
                    parallel === n
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-secondary/50 text-muted-foreground border-transparent hover:border-primary/30"
                  }`}
                  aria-pressed={parallel === n}
                >
                  ×{n}
                </button>
              ))}
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                navbatdagi so&apos;rovlar shuncha skaner bilan bir vaqtda bajariladi
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-3 justify-center">
              <span className="text-[11px] text-muted-foreground mr-1">
                Tezkor misollar:
              </span>
              {EXAMPLES.map((ex) => (
                <button
                  key={`${ex.type}-${ex.query}`}
                  onClick={() => {
                    setType(ex.type);
                    setInput(ex.query);
                  }}
                  className="px-2 py-0.5 rounded-md text-[11px] bg-secondary/60 text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                >
                  {ex.query}
                </button>
              ))}
            </div>
            {recent.length > 0 && step === "idle" && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2 justify-center">
                <span className="text-[11px] text-muted-foreground mr-1 flex items-center gap-1">
                  <History className="w-3 h-3" /> Oldingi:
                </span>
                {recent.map((r) => (
                  <button
                    key={`${r.type}-${r.query}`}
                    onClick={() => {
                      setType(r.type);
                      setInput(r.query);
                    }}
                    className="px-2 py-0.5 rounded-md text-[11px] bg-transparent border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {r.query}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* Skaner maydoni */}
        {step !== "idle" && (
          <section className="grid lg:grid-cols-5 gap-4 items-start">
            {/* Chap ustun */}
            <div className="lg:col-span-2 space-y-4">
              {target && (
                <Card className="p-4">
                  {batchQueries.length > 1 ? (
                    <>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Target className="w-4 h-4 text-primary" />
                        Maqsadlar:
                        <Badge
                          variant="secondary"
                          className="bg-primary/15 text-primary border border-primary/30 text-[10px] tabular-nums"
                        >
                          {batchQueries.length} ta so&apos;rov
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {batchQueries.map((q) => (
                          <Badge
                            key={q}
                            variant="secondary"
                            className="max-w-full text-[10px] font-mono bg-secondary/50 border border-transparent truncate"
                          >
                            {q}
                          </Badge>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Target className="w-4 h-4 text-primary" />
                      Maqsad: <span className="text-primary break-all">{target.query}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground items-center">
                    <span className="flex items-center gap-1">
                      <GraduationCap className="w-3.5 h-3.5" />
                      {TARGET_TYPES.find((t) => t.value === target.type)?.label}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {busy ? fmtElapsed(elapsed) : "yakunlangan"}
                    </span>
                    <span>
                      {totalResults} ta topilma · {scansDone} ta skaner
                    </span>
                    {STEP_BADGES[step] && (
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${busy ? "bg-primary/15 text-primary border border-primary/30" : ""}`}
                      >
                        {STEP_BADGES[step]}
                      </Badge>
                    )}
                  </div>
                  {/* Batch navbat progressi — «Navbat: X/Y · N parallel» */}
                  {busy && batchInfo && batchInfo.total > 1 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span className="truncate max-w-[220px]">
                          Skanerlanmoqda: {activeLabel ?? "navbatdagi so&apos;rovlar"}
                        </span>
                        <span className="tabular-nums shrink-0 ml-2">
                          navbat: {batchInfo.done}/{batchInfo.total} · {batchInfo.active} parallel
                        </span>
                      </div>
                      <Progress
                        value={batchInfo.total ? (batchInfo.done / batchInfo.total) * 100 : 0}
                        className="h-1.5"
                      />
                    </div>
                  )}
                  {/* Bitta skaner progressi — faqat navbat rejimida emas */}
                  {busy && (!batchInfo || batchInfo.total <= 1) && progress && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span className="truncate max-w-[200px]">
                          Skanerlanmoqda: {activeLabel ?? target.query}
                        </span>
                        <span className="tabular-nums shrink-0 ml-2">
                          {progress.done}/{progress.total} so&apos;rov
                        </span>
                      </div>
                      <Progress
                        value={progress.total ? (progress.done / progress.total) * 100 : 0}
                        className="h-1.5"
                      />
                    </div>
                  )}
                </Card>
              )}

              <IntelPanel
                entries={intel}
                busy={busy}
                searchedKeys={searchedKeys}
                onSearch={runIntelSearch}
                onSearchAll={runIntelSearchAll}
                searchAllCap={MAX_SCANS - scansDone}
              />

              <DeepPanel
                mode={mode}
                step={step}
                stats={stats}
                focusIds={focusIds}
                pending={pendingCandidates}
                activeLabel={activeLabel}
                scansDone={scansDone}
                busy={busy}
                onContinue={continueAfterReview}
                onStop={stopAll}
                onRunPivot={addPivotManual}
              />

              <TerminalLog logs={logs} scanning={busy} />

              <AiPanel
                aiText={aiText}
                aiStatus={aiStatus}
                onRunAnalysis={() => runAi()}
                onAskQuestion={(q) => runAi(q)}
                canAnalyze={!busy && totalResults > 0}
              />
            </div>

            {/* O'ng ustun — natijalar */}
            <div className="lg:col-span-3 space-y-4">
              <ReviewPanel
                entries={reviewEntries}
                loading={reviewLoading}
                onCheck={handleCheck}
                onSkip={handleSkip}
              />

              {modules.length === 0 ? (
                <Card className="p-10 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Modullar ishga tushirilmoqda — jonli jurnaldan kuzatib turing.
                  </p>
                </Card>
              ) : (
                <Tabs
                  value={activeTab || modules[0]?.moduleId}
                  onValueChange={(v) => {
                    touchedTabRef.current = true;
                    setActiveTab(v);
                  }}
                >
                  <TabsList className="w-full h-auto flex-wrap justify-start gap-1 bg-secondary/40">
                    {modules.map((m) => {
                      const Icon = MODULE_ICONS[m.moduleId] ?? Globe;
                      return (
                        <TabsTrigger
                          key={m.moduleId}
                          value={m.moduleId}
                          className="gap-1.5 text-xs data-[state=active]:text-primary"
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="hidden md:inline">{m.moduleTitle}</span>
                          <span className="md:hidden">{m.moduleTitle.split(" ")[0]}</span>
                          {m.status === "done" ? (
                            <Badge
                              variant="secondary"
                              className="h-4.5 px-1 text-[10px] tabular-nums"
                            >
                              {m.count}
                            </Badge>
                          ) : (
                            <Loader2 className="w-3 h-3 animate-spin text-primary" />
                          )}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  {modules.map((m) => (
                    <TabsContent key={m.moduleId} value={m.moduleId} className="mt-3">
                      {m.status === "running" ? (
                        <div className="text-center py-10 text-sm text-muted-foreground flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          Skanerlanmoqda...
                        </div>
                      ) : m.count === 0 ? (
                        <div className="text-center py-10 text-sm text-muted-foreground">
                          Bu modul bo&apos;yicha ochiq manbalarda natija topilmadi.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {m.results.map((r) => {
                            const key = normalizeUrl(r.url);
                            return (
                              <ResultCard
                                key={key}
                                item={r}
                                saved={savedKeys.has(`${r.url}||${target?.query ?? ""}`)}
                                onSave={saveResult}
                                saving={false}
                                skipped={skipped.has(key)}
                                verdict={verdicts[key] ?? null}
                                onPivot={addPivotManual}
                              />
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="mt-auto border-t">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Radar className="w-3.5 h-3.5 text-primary" />
            OSINT Radar — talabalar uchun o&apos;quv loyihasi
          </span>
          <span className="sm:ml-auto">
            Passive OSINT · faqat ochiq manbalar · javobgarlik foydalanuvchida
          </span>
        </div>
      </footer>
    </div>
  );
}
