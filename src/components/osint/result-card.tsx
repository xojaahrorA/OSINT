"use client";

import {
  ExternalLink,
  BookmarkPlus,
  BookmarkCheck,
  ShieldAlert,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SearchResultItem } from "@/lib/osint";

function prettyHost(host: string): string {
  return host.replace(/^www\./, "");
}

export function ResultCard({
  item,
  saved,
  onSave,
  saving,
}: {
  item: SearchResultItem;
  saved: boolean;
  onSave: (item: SearchResultItem) => void;
  saving: boolean;
}) {
  const isProfileLink = item.snippet.startsWith("To'g'ridan-to'g'ri profil havolasi");

  return (
    <div className="group rounded-lg border bg-card p-4 hover:border-emerald-500/40 transition-colors">
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
          </div>
          {item.snippet && (
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {isProfileLink && (
                <ShieldAlert className="inline w-3 h-3 mr-1 -mt-0.5 text-amber-400" />
              )}
              {item.snippet}
            </p>
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
