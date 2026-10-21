"use client";

import {
  Clock,
  FolderOpen,
  History,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TARGET_TYPES, type TargetType } from "@/lib/osint";

export interface HistoryItem {
  id: string;
  rootQuery: string;
  rootType: string;
  status: string;
  totalResults: number;
  scansDone: number;
  createdAt: string;
  updatedAt: string;
}

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TARGET_TYPES.map((t) => [t.value, t.label])
);

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export function HistorySheet({
  sessions,
  loading,
  open,
  onOpenChange,
  onOpenSession,
  onRemove,
  onRemoveAll,
  children,
}: {
  sessions: HistoryItem[];
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tarixdan sessiyani ochish — to'liq holat tiklanadi */
  onOpenSession: (item: HistoryItem) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-sky-400" />
            Skaner tarixi — ma&apos;lumotlar bazasi
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({sessions.length})
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Har bir qidirilgan shaxs bazada saqlanadi. Sahifa yangilansa ham
            natijalar yo&apos;qolmaydi — istaganni ochib davom ettirasiz yoki
            o&apos;chirib tashlaysiz.
          </SheetDescription>
        </SheetHeader>
        <Separator />
        {sessions.length > 0 && (
          <div className="px-4 py-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
              onClick={onRemoveAll}
            >
              <TriangleAlert className="w-3.5 h-3.5" />
              Barcha tarixni o&apos;chirish
            </Button>
          </div>
        )}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Yuklanmoqda...
              </p>
            ) : sessions.length === 0 ? (
              <div className="text-center py-10">
                <Clock className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Hozircha tarix bo&apos;sh. Skaner yakunlangach, natijalar
                  avtomatik bazaga saqlanadi.
                </p>
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border bg-card p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium font-mono leading-snug break-all">
                        {s.rootQuery}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/25"
                        >
                          {TYPE_LABELS[s.rootType] ?? s.rootType}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="text-[10px] tabular-nums bg-secondary/50"
                        >
                          {s.totalResults} topilma
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="text-[10px] tabular-nums bg-secondary/50"
                        >
                          {s.scansDone} skaner
                        </Badge>
                        {s.status === "stopped" && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/25"
                          >
                            to&apos;xtatilgan
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {fmtDate(s.updatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] gap-1 border-sky-500/40 text-sky-400 hover:bg-sky-500/10"
                        onClick={() => onOpenSession(s)}
                        aria-label="Tarixdan ochish"
                      >
                        <FolderOpen className="w-3 h-3" />
                        Ochish
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400 self-end"
                        onClick={() => onRemove(s.id)}
                        aria-label="O'chirish"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
