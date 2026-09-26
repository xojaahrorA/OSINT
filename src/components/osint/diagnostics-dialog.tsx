"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, XCircle, AlertTriangle, CircleDashed, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
  ms?: number;
}

interface DoctorReport {
  generatedAt: string;
  nodeVersion: string;
  searchEngineEnv: string | null;
  codeVersion: string | null;
  checks: DoctorCheck[];
  workingEngines: string[];
  recommendation: string;
  error?: string;
}

const STATUS_META: Record<
  DoctorCheck["status"],
  { icon: React.ReactNode; cls: string; text: string }
> = {
  ok: { icon: <CheckCircle2 className="w-4 h-4" />, cls: "text-emerald-500", text: "text-emerald-400" },
  warn: { icon: <AlertTriangle className="w-4 h-4" />, cls: "text-amber-500", text: "text-amber-400" },
  fail: { icon: <XCircle className="w-4 h-4" />, cls: "text-red-500", text: "text-red-400" },
  skip: { icon: <CircleDashed className="w-4 h-4" />, cls: "text-muted-foreground", text: "text-muted-foreground" },
};

export function DiagnosticsDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DoctorReport | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setReport(null);
    try {
      // Dev-rejimda birinchi chaqiruv chunk kompilyatsiyasi paytida uzilishi
      // mumkin — 1 marta qayta urinish
      let res: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch("/api/diagnostics", { cache: "no-store" });
          break;
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
        }
      }
      if (!res) throw new Error("Server bilan aloqa uzildi");
      const data = (await res.json()) as DoctorReport;
      setReport(data);
    } catch (e) {
      setReport({ error: String(e) } as DoctorReport);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Xato bo'lgan holatda qayta ochilsa — yana uriniladi
    if (open && !loading && (!report || report.error)) run();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-primary" />
            Tizim diagnostikasi
          </DialogTitle>
          <DialogDescription className="text-xs">
            Tarmoq, DNS va qidiruv dvigatellari real so&apos;rov bilan
            tekshiriladi — qidiruv ishlamasa sababi shu yerda ko&apos;rinadi.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-10 text-center space-y-2">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Dvigatellar tekshirilmoqda (~10-15 soniya)...
            </p>
          </div>
        )}

        {!loading && report?.error && (
          <Alert className="border-red-500/40 text-red-300">
            <AlertTitle className="text-sm">Diagnostika xatosi</AlertTitle>
            <AlertDescription className="text-xs">{report.error}</AlertDescription>
          </Alert>
        )}

        {!loading && report && !report.error && (
          <div className="space-y-3">
            <ScrollArea className="h-[340px] pr-3">
              <div className="space-y-1.5">
                {report.checks.map((c) => {
                  const meta = STATUS_META[c.status];
                  return (
                    <div
                      key={c.id}
                      className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2"
                    >
                      <span className={`mt-0.5 shrink-0 ${meta.cls}`}>{meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm font-medium ${meta.text}`}>{c.label}</span>
                          {c.ms !== undefined && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {c.ms}ms
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug break-words">
                          {c.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <Alert
              className={
                report.workingEngines.length > 0
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-amber-500/30 bg-amber-500/5"
              }
            >
              <AlertTitle className="text-sm">
                {report.workingEngines.length > 0
                  ? `${report.workingEngines.length} ta dvigatel ishlayapti`
                  : "Dvigatellar javob bermadi"}
              </AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                {report.recommendation}
              </AlertDescription>
            </Alert>

            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">
                {new Date(report.generatedAt).toLocaleTimeString()}
              </span>
              <Button size="sm" variant="outline" onClick={run} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Qayta tekshirish
              </Button>
            </div>
          </div>
        )}

        <Separator className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
