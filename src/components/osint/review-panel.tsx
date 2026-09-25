"use client";

import {
  Check,
  Loader2,
  Scale,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface ReviewEntry {
  key: string;
  title: string;
  url: string;
  host: string;
  moduleTitle: string;
  verdict: "unsure" | "unrelated";
  reason: string;
}

export function ReviewPanel({
  entries,
  loading,
  onCheck,
  onSkip,
}: {
  entries: ReviewEntry[];
  loading: boolean;
  onCheck: (key: string) => void;
  onSkip: (key: string) => void;
}) {
  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-3 border-amber-500/30 bg-amber-500/5">
        <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
        <p className="text-sm text-amber-200">
          AI topilmalarni maqsad va bir-biri bilan solishtiryapti — bu bir necha soniya olishi mumkin...
        </p>
      </Card>
    );
  }

  if (entries.length === 0) return null;

  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200 leading-tight">
            Tekshirish talab qiladigan topilmalar
          </p>
          <p className="text-[11px] text-amber-200/70 leading-relaxed mt-1">
            AI ushbu natijalarni maqsad bilan solishtirdi va mos kelmaydi deb hisoblaydi. Har
            birini tekshiring yoki keyingi bosqichlardan chiqarib yuboring.
          </p>
        </div>
        <Badge className="ml-auto h-5 px-1.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
          {entries.length}
        </Badge>
      </div>

      <div className="mt-3 space-y-2 max-h-80 overflow-y-auto pr-1">
        {entries.map((e) => (
          <div
            key={e.key}
            className={`rounded-md border p-2.5 ${
              e.verdict === "unrelated"
                ? "border-red-500/25 bg-red-500/5"
                : "border-amber-500/25 bg-amber-500/5"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={`h-4.5 px-1.5 text-[9px] ${
                  e.verdict === "unrelated"
                    ? "bg-red-500/15 text-red-300 border border-red-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}
              >
                {e.verdict === "unrelated" ? "MOS EMAS" : "ANIQ EMAS"}
              </Badge>
              <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                {e.host} · {e.moduleTitle}
              </span>
            </div>
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 text-xs font-medium text-foreground hover:text-emerald-400 transition-colors line-clamp-2"
            >
              {e.title}
            </a>
            {e.reason && (
              <p className="mt-1 text-[11px] text-muted-foreground flex items-start gap-1 leading-relaxed">
                <Scale className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground/60" />
                {e.reason}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                onClick={() => onCheck(e.key)}
              >
                <Check className="w-3 h-3" />
                Tekshirdim — mos
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={() => onSkip(e.key)}
              >
                <X className="w-3 h-3" />
                O&apos;tkazib yuborish
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
