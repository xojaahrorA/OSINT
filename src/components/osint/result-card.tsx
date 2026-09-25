"use client";

import { useMemo, useState } from "react";
import {
  BookmarkCheck,
  BookmarkPlus,
  ExternalLink,
  Link2,
  Play,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { extractPivots, type PivotCandidate, type SearchResultItem } from "@/lib/osint";

function prettyHost(host: string): string {
  return host.replace(/^www\./, "");
}

const KIND_LABELS: Record<PivotCandidate["kind"], string> = {
  username: "USERNAME",
  email: "EMAIL",
  phone: "TEL",
  name: "ISM",
  domain: "DOMEN",
  ip: "IP",
};

export function ResultCard({
  item,
  saved,
  onSave,
  saving,
  skipped = false,
  verdict,
  onPivot,
}: {
  item: SearchResultItem;
  saved: boolean;
  onSave: (item: SearchResultItem) => void;
  saving: boolean;
  skipped?: boolean;
  verdict?: { verdict: "related" | "unsure" | "unrelated"; reason: string } | null;
  onPivot?: (p: PivotCandidate) => void;
}) {
  const isProfileLink = item.snippet.startsWith("To'g'ridan-to'g'ri profil havolasi");
  const pivots = useMemo(() => (onPivot ? extractPivots(item) : []), [item, onPivot]);
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`group rounded-lg border bg-card p-4 hover:border-emerald-500/40 transition-colors ${
        skipped ? "opacity-55 border-dashed" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex w-7 h-7 rounded-md bg-secondary items-center justify-center shrink-0 overflow-hidden">
          {item.favicon ? (
            <img
              src={item.favicon}
              alt=""
              className="w-4 h-4"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium leading-snug text-foreground hover:text-emerald-400 transition-colors line-clamp-2"
          >
            {item.name}
          </a>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
            <span className="text-[11px] text-emerald-500/90 truncate max-w-[240px]">
              {prettyHost(item.host_name)}
            </span>
            {item.date && (
              <span className="text-[11px] text-muted-foreground">
                · {item.date.slice(0, 10)}
              </span>
            )}
            {skipped && (
              <span className="text-[10px] text-red-400/80 border border-red-500/30 rounded px-1">
                o&apos;tkazib yuborilgan
              </span>
            )}
            {!skipped && verdict && (
              <Badge
                className={`h-4 px-1.5 text-[9px] ${
                  verdict.verdict === "related"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                    : verdict.verdict === "unsure"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                      : "bg-red-500/10 text-red-400 border border-red-500/25"
                }`}
                title={verdict.reason}
              >
                AI: {verdict.verdict === "related" ? "mos" : verdict.verdict === "unsure" ? "aniq emas" : "mos emas"}
              </Badge>
            )}
          </div>
          {item.snippet && (
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {isProfileLink && (
                <ShieldAlert className="inline w-3 h-3 mr-1 -mt-0.5 text-amber-400" />
              )}
              {item.snippet}
            </p>
          )}

          {/* Pivot qidiruv — topilma ichidan yangi izlar bo'yicha */}
          {pivots.length > 0 && onPivot && (
            <div className="mt-2">
              <button
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-emerald-300 transition-colors"
                aria-expanded={open}
              >
                <span
                  className={`flex w-4 h-4 rounded bg-primary/15 border border-primary/40 items-center justify-center transition-transform ${
                    open ? "rotate-45" : ""
                  }`}
                >
                  <Plus className="w-3 h-3" />
                </span>
                Bu topilmada {pivots.length} ta yangi iz topildi — chuqur qidirish
              </button>
              {open && (
                <div className="mt-1.5 space-y-1 border-l-2 border-primary/30 pl-2.5">
                  {pivots.map((p) => (
                    <div key={`${p.kind}:${p.value}`} className="flex items-center gap-2">
                      <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono shrink-0">
                        {KIND_LABELS[p.kind]}
                      </Badge>
                      <span className="text-[11px] text-foreground/85 truncate max-w-[260px] break-all">
                        {p.value}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] gap-1 text-primary hover:text-emerald-300 shrink-0"
                        onClick={() => {
                          setOpen(false);
                          onPivot(p);
                        }}
                      >
                        <Play className="w-3 h-3" />
                        Qidir
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            asChild
            aria-label="Havolani ochish"
          >
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={`h-8 w-8 ${saved ? "text-emerald-400" : "text-muted-foreground"}`}
            onClick={() => onSave(item)}
            disabled={saved || saving}
            aria-label={saved ? "Saqlangan" : "Saqlash"}
          >
            {saved ? (
              <BookmarkCheck className="w-4 h-4" />
            ) : (
              <BookmarkPlus className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
