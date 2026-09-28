"use client";

// ===== «Topilgan qo'shimcha ma'lumotlar» paneli =====
// Skaner davomida topilgan telefon, email, ism-familiya, username, domen
// va IP'larning yig'ma ro'yxati — ALOHIDA joyda. Tizim o'zi hech biriga
// qidiruv ishga tushirmaydi: foydalanuvchi birini tanlasa, keyin shu
// bo'yicha chuqur qidiriladi.

import { useState } from "react";
import {
  AtSign,
  Check,
  Copy,
  Database,
  Globe,
  Mail,
  Network,
  Phone,
  ScanSearch,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TargetType } from "@/lib/osint";
import type { IntelEntry } from "@/lib/intel";

const GROUPS: {
  kind: TargetType;
  label: string;
  Icon: typeof Phone;
  hint: string;
}[] = [
  { kind: "phone", label: "Telefon raqamlar", Icon: Phone, hint: "xalqaro format" },
  { kind: "email", label: "Email manzillar", Icon: Mail, hint: "pochta" },
  { kind: "username", label: "Usernamelar", Icon: AtSign, hint: "profildagi ismlar" },
  { kind: "name", label: "Ism-familiyalar", Icon: User, hint: "shaxs nomlari" },
  { kind: "domain", label: "Domenlar", Icon: Globe, hint: "alohida saytlar" },
  { kind: "ip", label: "IP manzillar", Icon: Network, hint: "serverlar" },
];

export function IntelPanel({
  entries,
  busy,
  searchedKeys,
  onSearch,
}: {
  entries: IntelEntry[];
  busy: boolean;
  searchedKeys: Set<string>;
  onSearch: (kind: TargetType, value: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1500);
    } catch {
      /* clipboard ruxsatsiz — jim o'tamiz */
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <div className="flex w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 items-center justify-center shrink-0">
          <Database className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">
            Topilgan qo&apos;shimcha ma&apos;lumotlar
          </p>
          <p className="text-[11px] text-muted-foreground leading-tight">
            Tizim o&apos;zi qidirmaydi — siz tanlanganni tekshiramiz
          </p>
        </div>
        {entries.length > 0 && (
          <Badge
            variant="secondary"
            className="ml-auto shrink-0 bg-primary/15 text-primary border border-primary/30 text-[10px] tabular-nums"
          >
            {entries.length}
          </Badge>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          Hozircha hech narsa yig&apos;ilmadi. Skaner natijalarida telefon,
          email, ism-familiya yoki boshqa iz topilsa — hammasi shu yerda
          to&apos;planadi va qaysi biri bo&apos;yicha qidirishni siz tanlaysiz.
        </p>
      ) : (
        <div className="mt-3 max-h-[420px] overflow-y-auto space-y-3 pr-1 osint-scroll">
          {GROUPS.map(({ kind, label, Icon, hint }) => {
            const list = entries.filter((e) => e.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind}>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  <span className="text-[10px] normal-case text-muted-foreground/60 font-normal">
                    ({hint}) — {list.length}
                  </span>
                </p>
                <div className="space-y-1.5">
                  {list.map((e) => {
                    const key = `${e.kind}:${e.value}`;
                    const searched = searchedKeys.has(key);
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 bg-secondary/40 border ${
                          searched ? "border-emerald-500/30" : "border-transparent"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono text-foreground/90 break-all leading-snug">
                            {e.value}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {e.hosts.slice(0, 2).join(", ")}
                            {e.sources.length > 0 ? ` · ${e.sources[0]}` : ""}
                            {e.count > 1 ? ` · ${e.count}x` : ""}
                          </p>
                        </div>
                        {searched && (
                          <Badge
                            variant="secondary"
                            className="h-4.5 px-1 text-[9px] shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                          >
                            <Check className="w-2.5 h-2.5 mr-0.5" />
                            tekshirildi
                          </Badge>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => copyValue(e.value)}
                          aria-label={`${e.value} — nusxalash`}
                        >
                          {copied === e.value ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] gap-1 text-primary hover:text-emerald-300 shrink-0"
                          disabled={busy}
                          onClick={() => onSearch(e.kind, e.value)}
                          aria-label={`${e.value} bo'yicha qidirish`}
                        >
                          <ScanSearch className="w-3 h-3" />
                          Qidir
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
