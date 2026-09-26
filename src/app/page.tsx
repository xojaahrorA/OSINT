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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ReviewPanel, type ReviewEntry } from "@/components/osint/review-panel";
import { DiagnosticsDialog } from "@/components/osint/diagnostics-dialog";
import {
  BookmarksSheet,
  type BookmarkItem,
} from "@/components/osint/bookmarks-sheet";
import {
  OSINT_MODULES,
  PIVOT_PRIORITY,
  TARGET_TYPES,
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

// Rekursiv dvigatel chegaralari — rate-limit va beqarorlikka qarshi himoya
const MAX_SCANS = 8; // bitta sessiyada eng ko'pi bilan 8 skaner
const MAX_DEPTH_DEEP = 3; // chuqur rejimda rekursiya chuqurligi
const AUTO_PER_SCAN = 2; // har skanerdan avtomatik navbatga chiqadigan pivotlar

type VerdictInfo = { verdict: "related" | "unsure" | "unrelated"; reason: string };

interface NewResult {
  key: string;
  item: SearchResultItem;
  moduleTitle: string;
}

interface PivotJob {
  kind: TargetType;
  value: string;
  depth: number;
}

const STEP_BADGES: Record<DeepStep, string> = {
  idle: "",
  global: "1-bosqich · global taramok",
  focused: "2-bosqich · manba fokusi",
  review: "AI solishtirish",
  pivots: "chuqur pivot qidiruvi",
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

  const scanAbortRef = useRef<AbortController | null>(null);
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
    maxDepth: MAX_DEPTH_DEEP,
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
  const runScanTarget = async (
    job: PivotJob,
    querySet: "core" | "deep-only" | "extended",
    moduleFilter?: string[]
  ): Promise<NewResult[]> => {
    const eng = engineRef.current;
    const ctrl = new AbortController();
    scanAbortRef.current = ctrl;
    startedAtRef.current = Date.now();
    setActiveLabel(job.value);
    setProgress(null);

    const scanNo = eng.scansDone + 1;
    const modeLabel =
      querySet === "core" ? "GLOBAL" : querySet === "deep-only" ? "FOKUS-CHUQUR" : "KENGAYTIRILGAN";
    pushLog(
      "sys",
      `=== SKANER #${scanNo} · "${job.value}" (${job.kind.toUpperCase()}, ${modeLabel}, chuqurlik ${job.depth}) ===`
    );

    const newResults: NewResult[] = [];

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
            const k = normalizeUrl(r.url);
            if (!eng.knownUrls.has(k)) {
              eng.knownUrls.add(k);
              newResults.push({ key: k, item: r, moduleTitle: mTitle });
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
        body: JSON.stringify({ type: job.kind, query: job.value, querySet, modules: moduleFilter }),
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
    }

    eng.scansDone++;
    setScansDone(eng.scansDone);
    return newResults;
  };

  // ===== Pivotlar yigimi — yangi natijalardan avtomatik izlarni ajratadi =====
  const harvestPivots = (newResults: NewResult[]) => {
    const eng = engineRef.current;
    let addedCount = 0;
    for (const { key, item } of newResults) {
      if (skippedRef.current.has(key)) continue;
      for (const p of extractPivots(item)) {
        const pk = `${p.kind}:${p.value}`;
        if (eng.runSet.has(pk)) continue;
        if (eng.pending.some((x) => x.kind === p.kind && x.value === p.value)) continue;
        eng.pending.push({ kind: p.kind, value: p.value });
        addedCount++;
      }
    }
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    if (addedCount > 0) {
      pushLog("ok", `${addedCount} ta yangi iz (pivot) ajratib olindi — navbatda`);
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

  // ===== Rekursiv navbat protsessori — pivot skanerlarni ketma-ket ishga tushiradi =====
  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    const eng = engineRef.current;
    try {
      while (!eng.stopped && eng.queue.length > 0 && eng.scansDone < MAX_SCANS) {
        const job = eng.queue.shift()!;
        const newResults = await runScanTarget(job, "extended");
        if (eng.stopped) break;
        harvestPivots(newResults);
        // Rekursiya: yangi topilgan izlardan eng ustuvorlari navbatga
        if (job.depth + 1 <= eng.maxDepth && eng.scansDone < MAX_SCANS) {
          const picks = eng.pending
            .filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`))
            .sort((a, b) => PIVOT_PRIORITY[a.kind] - PIVOT_PRIORITY[b.kind])
            .slice(0, AUTO_PER_SCAN);
          for (const c of picks) {
            eng.runSet.add(`${c.kind}:${c.value}`);
            eng.queue.push({ kind: c.kind, value: c.value, depth: job.depth + 1 });
            pushLog(
              "sys",
              `Rekursiya: "${c.value}" (${c.kind.toUpperCase()}) bo'yicha chuqurlik ${job.depth + 1} skaner navbatga qo'shildi`
            );
          }
          setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
        }
      }
    } finally {
      processingRef.current = false;
    }
    if (engineRef.current.stopped) {
      setStep("stopped");
      return;
    }
    await finalVerdictPass();
    setStep("done");
    pushLog("sys", "Rekursiv chuqur qidiruv yakunlandi — AI xulosa chiqarishingiz mumkin.");
  };

  const continueAfterReview = () => {
    const eng = engineRef.current;
    if (eng.stopped) {
      setStep("stopped");
      return;
    }
    const picks = eng.pending
      .filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`))
      .sort((a, b) => PIVOT_PRIORITY[a.kind] - PIVOT_PRIORITY[b.kind])
      .slice(0, AUTO_PER_SCAN);
    for (const c of picks) {
      eng.runSet.add(`${c.kind}:${c.value}`);
      eng.queue.push({ kind: c.kind, value: c.value, depth: 1 });
      pushLog("sys", `Navbat: "${c.value}" (${c.kind.toUpperCase()}) bo'yicha chuqur skaner`);
    }
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    if (eng.queue.length === 0) {
      pushLog("info", "Yangi iz topilmadi — sessiya yakunlandi.");
      setStep("done");
      return;
    }
    setStep("pivots");
    void processQueue();
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
    eng.queue.push({ kind: p.kind, value: p.value, depth: 1 });
    setPendingCandidates(eng.pending.filter((c) => !eng.runSet.has(`${c.kind}:${c.value}`)));
    pushLog("info", `Qo'lda navbat: "${p.value}" (${p.kind.toUpperCase()}) bo'yicha chuqur skaner`);
    if (!processingRef.current) {
      setStep("pivots");
      void processQueue();
    }
  };

  const stopAll = () => {
    const eng = engineRef.current;
    eng.stopped = true;
    eng.queue = [];
    scanAbortRef.current?.abort();
    setStep("stopped");
    pushLog("warn", "Foydalanuvchi sessiyani to'xtatdi.");
  };

  // ===== Asosiy oqim =====
  const startScan = async () => {
    const query = input.trim();
    if (query.length < 2) {
      toast({
        title: "Maqsad juda qisqa",
        description: "Iltimos, kamida 2 belgidan iborat maqsad kiriting.",
        variant: "destructive",
      });
      return;
    }

    aiAbortRef.current?.abort();
    scanAbortRef.current?.abort();
    processingRef.current = false;

    engineRef.current = {
      stopped: false,
      queue: [],
      runSet: new Set([`${type}:${query.toLowerCase()}`]),
      pending: [],
      knownUrls: new Set<string>(),
      scansDone: 0,
      rootQuery: query,
      rootType: type,
      maxDepth: mode === "deep" ? MAX_DEPTH_DEEP : 1,
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
    setLogs([]);
    setModules([]);
    setAiText("");
    setAiStatus("idle");
    setElapsed(0);
    setProgress(null);
    setTarget({ type, query });
    saveRecent(type, query);
    setStep("global");

    pushLog(
      "sys",
      `SESSIYA BOSHLANDI — rejim: ${mode === "deep" ? "CHUQUR (adaptiv + rekursiv)" : "TEZ"}`
    );

    // 1-BOSQICH: dunyo bo'ylab — barcha ochiq tarmoqlar
    const r1 = await runScanTarget({ kind: type, value: query, depth: 0 }, "core");
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
        const r2 = await runScanTarget({ kind: type, value: query, depth: 0 }, "deep-only", top);
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
                Maqsadni kiriting — <span className="text-primary">qolganini tizim o&apos;zi bajaradi</span>
              </h1>
              <p className="mt-3 text-muted-foreground text-sm sm:text-base leading-relaxed">
                To&apos;liq avtomatlashtirilgan ochiq manbalar razvedkasi: dunyo
                bo&apos;ylab barcha ochiq tarmoqlar skanerlanadi, eng unumli
                manbalar chuqur tahlil qilinadi, AI natijalarni solishtiradi va
                topilgan izlar bo&apos;yicha qidiruv o&apos;zi davom etadi.
              </p>
            </div>
          )}

          <Card className="p-4 sm:p-5 max-w-3xl mx-auto">
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
            <div className="flex gap-2 mt-3">
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
                <Button size="lg" onClick={startScan} className="gap-2 shrink-0">
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
                Chuqur + rekursiv (4 bosqich)
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
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Target className="w-4 h-4 text-primary" />
                    Maqsad: <span className="text-primary break-all">{target.query}</span>
                  </div>
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
                  {busy && progress && (
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
