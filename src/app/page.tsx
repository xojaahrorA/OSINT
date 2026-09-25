"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  BookmarksSheet,
  type BookmarkItem,
} from "@/components/osint/bookmarks-sheet";
import {
  OSINT_MODULES,
  TARGET_TYPES,
  type LogLine,
  type ModuleResult,
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
};

const EXAMPLES: { type: TargetType; query: string }[] = [
  { type: "username", query: "dilshod_dev" },
  { type: "email", query: "info@example.uz" },
  { type: "phone", query: "+998901234567" },
  { type: "name", query: "Muhammad Karimov" },
  { type: "domain", query: "nuu.uz" },
  { type: "ip", query: "8.8.8.8" },
];

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Home() {
  const { toast } = useToast();

  const [type, setType] = useState<TargetType>("username");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [modules, setModules] = useState<ModuleResult[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [target, setTarget] = useState<{ type: TargetType; query: string } | null>(null);

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
    if (phase !== "scanning") return;
    const t = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

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

  const pushLog = (l: LogLine) => setLogs((prev) => [...prev, l]);

  const handleEvent = useCallback((ev: ScanEvent) => {
    switch (ev.type) {
      case "log":
        if (ev.log) pushLog(ev.log);
        break;
      case "module_start":
        setModules((prev) => {
          if (prev.some((m) => m.moduleId === ev.moduleId)) return prev;
          return [
            ...prev,
            {
              moduleId: ev.moduleId!,
              moduleTitle: ev.moduleTitle ?? ev.moduleId!,
              status: "running",
              count: 0,
              results: [],
            },
          ];
        });
        break;
      case "module_done":
        setModules((prev) => {
          const others = prev.filter((m) => m.moduleId !== ev.moduleId);
          return [
            ...others,
            {
              moduleId: ev.moduleId!,
              moduleTitle: ev.moduleTitle ?? ev.moduleId!,
              status: "done",
              count: ev.count ?? 0,
              results: ev.results ?? [],
            },
          ];
        });
        if (!touchedTabRef.current && (ev.count ?? 0) > 0) {
          setActiveTab(ev.moduleId!);
        }
        break;
      case "progress":
        setProgress({ done: ev.count ?? 0, total: ev.total ?? 0 });
        break;
      case "done":
        setPhase("done");
        break;
      case "error":
        setPhase("done");
        toast({
          title: "Skaner xatosi",
          description: ev.message,
          variant: "destructive",
        });
        break;
    }
  }, [toast]);

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
    const ctrl = new AbortController();
    scanAbortRef.current = ctrl;

    touchedTabRef.current = false;
    startedAtRef.current = Date.now();
    setPhase("scanning");
    setLogs([]);
    setModules([]);
    setAiText("");
    setAiStatus("idle");
    setElapsed(0);
    setProgress(null);
    setTarget({ type, query });
    saveRecent(type, query);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, query }),
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
      setPhase((p) => (p === "scanning" ? "done" : p));
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setPhase("done");
        pushLog({
          id: Date.now(),
          time: "",
          level: "warn",
          message: "Skaner foydalanuvchi tomonidan to'xtatildi.",
        });
      } else {
        setPhase("done");
        toast({
          title: "Skanerni ishga tushirib bo'lmadi",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    }
  };

  const stopScan = () => {
    scanAbortRef.current?.abort();
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
        <section className={phase === "idle" ? "text-center pt-6 pb-2" : ""}>
          {phase === "idle" && (
            <div className="max-w-2xl mx-auto mb-6">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Maqsadni kiriting — <span className="text-primary">qolganini tizim o&apos;zi bajaradi</span>
              </h1>
              <p className="mt-3 text-muted-foreground text-sm sm:text-base leading-relaxed">
                To&apos;liq avtomatlashtirilgan ochiq manbalar razvedkasi:{" "}
                {OSINT_MODULES.length + 1} ta modul bir vaqtda ishga tushadi —
                ijtimoiy tarmoqlar, forumlar, hujjatlar, video, yangiliklar va
                texnik manbalar skanerlanadi, so&apos;ng AI xulosa chiqaradi.
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
                onKeyDown={(e) => e.key === "Enter" && phase !== "scanning" && startScan()}
                placeholder={`${currentTypeLabel} kiriting — masalan: ${
                  TARGET_TYPES.find((t) => t.value === type)?.example
                }`}
                className="h-11 text-base"
                aria-label="Maqsad kiritish"
              />
              {phase === "scanning" ? (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={stopScan}
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
            {recent.length > 0 && phase === "idle" && (
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
        {phase !== "idle" && (
          <section className="grid lg:grid-cols-5 gap-4 items-start">
            {/* Chap ustun */}
            <div className="lg:col-span-2 space-y-4">
              {target && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Target className="w-4 h-4 text-primary" />
                    Maqsad: <span className="text-primary break-all">{target.query}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GraduationCap className="w-3.5 h-3.5" />
                      {TARGET_TYPES.find((t) => t.value === target.type)?.label}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {phase === "scanning" ? fmtElapsed(elapsed) : "yakunlangan"}
                    </span>
                    <span>
                      {totalResults} ta topilma · {modules.length} ta modul
                    </span>
                  </div>
                  {phase === "scanning" && progress && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span>Skaner davom etmoqda...</span>
                        <span className="tabular-nums">
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

              <TerminalLog logs={logs} scanning={phase === "scanning"} />

              <AiPanel
                aiText={aiText}
                aiStatus={aiStatus}
                onRunAnalysis={() => runAi()}
                onAskQuestion={(q) => runAi(q)}
                canAnalyze={phase === "done" && totalResults > 0}
              />
            </div>

            {/* O'ng ustun — natijalar */}
            <div className="lg:col-span-3">
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
                          {m.results.map((r) => (
                            <ResultCard
                              key={r.url}
                              item={r}
                              saved={savedKeys.has(`${r.url}||${target?.query ?? ""}`)}
                              onSave={saveResult}
                              saving={false}
                            />
                          ))}
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
