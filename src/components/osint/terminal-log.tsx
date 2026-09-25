"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { LogLine } from "@/lib/osint";

const LEVEL_STYLE: Record<LogLine["level"], string> = {
  sys: "text-emerald-400",
  info: "text-slate-300",
  ok: "text-emerald-300 font-medium",
  warn: "text-amber-400",
  error: "text-red-400",
};

const LEVEL_PREFIX: Record<LogLine["level"], string> = {
  sys: "[*]",
  info: "[>]",
  ok: "[+]",
  warn: "[!]",
  error: "[x]",
};

export function TerminalLog({
  logs,
  scanning,
}: {
  logs: LogLine[];
  scanning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-950/80 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 bg-slate-900/70">
        <span className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        </span>
        <Terminal className="w-3.5 h-3.5 text-emerald-400 ml-1" />
        <span className="text-xs font-mono text-slate-400">
          jonli skaner jurnali
        </span>
        {scanning && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-mono text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            ISHLAYAPTI
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed scroll-smooth"
        role="log"
        aria-live="polite"
        aria-label="Skaner jurnali"
      >
        {logs.length === 0 ? (
          <p className="text-slate-600">
            Jurnal bo&apos;sh. Maqsad kiriting va skanerlashni boshlang — bu yerda
            har bir modul ishi jonli ko&apos;rinadi.
          </p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-slate-600 shrink-0">{l.time}</span>
              <span className={`${LEVEL_STYLE[l.level]} shrink-0`}>
                {LEVEL_PREFIX[l.level]}
              </span>
              <span className="text-slate-300 break-all">{l.message}</span>
            </div>
          ))
        )}
        {scanning && (
          <div className="flex gap-2 mt-0.5">
            <span className="text-emerald-400 animate-pulse">▌</span>
          </div>
        )}
      </div>
    </div>
  );
}
