"use client";

import {
  CheckCircle2,
  Circle,
  Globe2,
  Layers,
  Loader2,
  Network,
  Play,
  Square,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DeepStep, TargetType } from "@/lib/osint";

export interface SourceStat {
  id: string;
  title: string;
  count: number;
}

export interface PendingPivot {
  kind: TargetType;
  value: string;
}

const STEP_ORDER: DeepStep[] = ["global", "focused", "review", "pivots"];

const STEP_LABELS: Record<string, string> = {
  global: "1-bosqich — Global taramok: barcha ochiq tarmoqlar",
  focused: "2-bosqich — Eng unumli manbalarga chuqur fokus",
  review: "3-qadam — AI natijalarni maqsad bilan solishtiradi",
  pivots: "4-bosqich — Rekursiv pivot qidiruvi (topilgan ma'lumot bo'yicha)",
};

const KIND_LABELS: Record<TargetType, string> = {
  username: "USERNAME",
  email: "EMAIL",
  phone: "TEL",
  name: "ISM",
  domain: "DOMEN",
  ip: "IP",
};

export function DeepPanel({
  mode,
  step,
  stats,
  focusIds,
  pending,
  activeLabel,
  scansDone,
  busy,
  onContinue,
  onStop,
  onRunPivot,
}: {
  mode: "normal" | "deep";
  step: DeepStep;
  stats: SourceStat[];
  focusIds: string[];
  pending: PendingPivot[];
  activeLabel: string | null;
  scansDone: number;
  busy: boolean;
  onContinue: () => void;
  onStop: () => void;
  onRunPivot: (p: PendingPivot) => void;
}) {
  const maxCount = Math.max(1, ...stats.map((s) => s.count));
  const currentIdx = STEP_ORDER.indexOf(step);
  const sessionOver = step === "done" || step === "stopped";

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 items-center justify-center">
          <Network className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">Adaptiv chuqur taramok</p>
          <p className="text-[11px] text-muted-foreground leading-tight">
            {scansDone > 0 ? `${scansDone} ta skaner bajarildi` : "bosqichlar avtomatik ketma-ket ishlaydi"}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={`ml-auto text-[10px] ${mode === "deep" ? "bg-primary/15 text-primary border border-primary/30" : ""}`}
        >
          {mode === "deep" ? "CHUQUR + REKURSIV" : "TEZ"}
        </Badge>
      </div>

      {/* Bosqichlar timeline (faqat chuqur rejimda) */}
      {mode === "deep" && (
        <ol className="space-y-1.5">
          {STEP_ORDER.map((s, i) => {
            const passed = sessionOver || i < currentIdx;
            const current = !sessionOver && i === currentIdx;
            return (
              <li key={s} className="flex items-start gap-2 text-xs">
                {passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                ) : current ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin mt-0.5 shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
                )}
                <span
                  className={`leading-snug ${
                    current ? "text-foreground font-medium" : passed ? "text-muted-foreground" : "text-muted-foreground/60"
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Hozirgi skaner */}
      {busy && activeLabel && (
        <div className="flex items-center gap-2 text-xs text-primary bg-primary/5 border border-primary/20 rounded-md px-2.5 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">
            Skanerlanmoqda: <span className="font-medium break-all">{activeLabel}</span>
          </span>
        </div>
      )}

      {/* Manbalar statistikasi — qayerdan ko'proq chiqqani */}
      {stats.some((s) => s.count > 0) && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <TrendingUp className="w-3.5 h-3.5" />
            Qaysi manbalar ko&apos;proq berdi
          </p>
          <div className="space-y-1.5">
            {stats
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((s) => {
                const isFocus = focusIds.includes(s.id);
                return (
                  <div key={s.id}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`truncate ${isFocus ? "text-emerald-300 font-medium" : "text-muted-foreground"}`}>
                        {s.title}
                      </span>
                      {isFocus && (
                        <Badge className="h-4 px-1 text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          FOKUS
                        </Badge>
                      )}
                      <span className="ml-auto tabular-nums text-muted-foreground shrink-0">{s.count}</span>
                    </div>
                    <div className="h-1.5 mt-0.5 rounded-full bg-secondary/60 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isFocus ? "bg-emerald-400" : "bg-primary/50"}`}
                        style={{ width: `${Math.max(4, (s.count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Topilgan pivotlar navbati */}
      {pending.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <Layers className="w-3.5 h-3.5" />
            Topilgan yangi izlar ({pending.length}) — navbat
          </p>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
            {pending.map((p) => (
              <div
                key={`${p.kind}:${p.value}`}
                className="flex items-center gap-2 text-xs bg-secondary/40 rounded-md px-2 py-1.5"
              >
                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono shrink-0">
                  {KIND_LABELS[p.kind]}
                </Badge>
                <span className="truncate text-foreground/90 break-all">{p.value}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 ml-auto shrink-0 text-primary hover:text-primary"
                  onClick={() => onRunPivot(p)}
                  aria-label={`${p.value} bo'yicha qidirish`}
                  disabled={busy}
                >
                  <Play className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boshqaruv tugmalari */}
      <div className="flex flex-wrap gap-2">
        {step === "review" && (
          <Button size="sm" onClick={onContinue} className="gap-1.5 flex-1">
            <Globe2 className="w-3.5 h-3.5" />
            Davom etish — chuqur qidiruv
          </Button>
        )}
        {(busy || step === "review") && (
          <Button
            size="sm"
            variant="outline"
            onClick={onStop}
            className="gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Square className="w-3.5 h-3.5" />
            {step === "review" ? "Yakunlash" : "To'xtatish"}
          </Button>
        )}
      </div>

      {sessionOver && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {step === "stopped"
            ? "Sessiya to'xtatildi. Natijalar kartalaridagi «+» tugmasi orqali istalgan izni davom ettirishingiz mumkin."
            : "Sessiya yakunlandi. «+» tugmasi orqali istalgan topilma bo'yicha qidiruvni davom ettirishingiz mumkin."}
        </p>
      )}
    </Card>
  );
}
