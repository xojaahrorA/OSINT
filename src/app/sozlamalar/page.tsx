"use client";

// Sozlamalar sahifasi — API kalitlarini kiritish joyi.
// KALITLAR SQLite BAZADA SAQLANADI: platforma qayta ishga tushsa ham
// (.env fayl tozalansa ham) kalitlar YO'QOLMAYDI.
// Skaner har ishga tushganda kalitlar avtomatik faollashadi — qayta kiritish
// shart emas. Kalitlar maskalangan ko'rinishda ko'rsatiladi (faqat oxirgi 4 belgi).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

interface KeyPart {
  envKey: string;
  set: boolean;
  masked: string;
  from: string;
}
interface SourceMeta {
  id: string;
  title: string;
  what: string;
  getKeyUrl: string;
  free: string;
  appliesTo: string[];
  keys: KeyPart[];
  active: boolean;
}

export default function SozlamalarPage() {
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      const j = (await res.json()) as { sources: SourceMeta[] };
      setSources(j.sources ?? []);
    } catch {
      toast({ title: "Xato", description: "Sozlamalarni yuklash amalga oshmadi", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (envKey: string) => {
    const value = (drafts[envKey] ?? "").trim();
    if (!value) return;
    setSaving(envKey);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envKey, value }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Saqlash amalga oshmadi");
      toast({ title: "Kalit saqlandi", description: `${envKey} faollashdi — keyingi skanda ishlaydi.` });
      setDrafts((d) => ({ ...d, [envKey]: "" }));
      await load();
    } catch (e) {
      toast({ title: "Xato", description: String(e).slice(0, 120), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const remove = async (envKey: string) => {
    setSaving(envKey);
    try {
      const res = await fetch(`/api/keys?envKey=${encodeURIComponent(envKey)}`, { method: "DELETE" });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "O'chirish amalga oshmadi");
      toast({ title: "Kalit o'chirildi", description: envKey });
      await load();
    } catch (e) {
      toast({ title: "Xato", description: String(e).slice(0, 120), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const activeCount = sources.filter((s) => s.active).length;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link href="/">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Skanerga qaytish</span>
            </Link>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant="secondary" className="gap-1.5">
                <Activity className="w-3 h-3" />
                {activeCount}/{sources.length} faol
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start gap-3 mb-2">
          <div className="flex w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">API kalitlari</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Kalitlarni bir marta kiriting — <b>bazada doimiy saqlanadi</b>, platforma qayta ishga
              tushsa ham yo&apos;qolmaydi. Skaner keyingi ishga tushishida avtomatik ulaydi.
              Diagnostika sahifasida faollashganini tekshirishingiz mumkin.
            </p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground border rounded-lg p-3 mb-6 bg-muted/40">
          Xavfsizlik: kalitlar faqat server tomonda o&apos;qiladi, sahifada faqat maskalangan
          ko&apos;rinish (oxirgi 4 belgi) ko&apos;rsatiladi. Hamma kalit <b>bepul</b> ro&apos;yxatdan
          o&apos;tish bilan olinadi — har bir manba ostida havola bor.
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Yuklanmoqda...
          </div>
        ) : (
          <div className="grid gap-4">
            {sources.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{s.title}</span>
                      {s.active ? (
                        <Badge className="gap-1 text-emerald-600" variant="outline">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Faol
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <XCircle className="w-3.5 h-3.5" /> Kutilmoqda
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{s.what}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.free} · qamrov: {s.appliesTo.join(", ")}
                    </p>
                  </div>
                  <a
                    href={s.getKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 whitespace-nowrap"
                  >
                    Kalit olish <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="grid gap-2">
                  {s.keys.map((k) => (
                    <div key={k.envKey} className="flex items-center gap-2">
                      <code className="text-xs w-44 sm:w-56 shrink-0 text-muted-foreground truncate">
                        {k.envKey}
                      </code>
                      <Input
                        value={drafts[k.envKey] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [k.envKey]: e.target.value }))
                        }
                        placeholder={
                          k.set
                            ? `Saqlangan: ${k.masked} (${k.from}) — yangisini kiritsangiz almashtiriladi`
                            : "Kalitni shu yerga kiritib «Saqlash»ni bosing"
                        }
                        className="h-9 text-sm"
                        type="password"
                        autoComplete="off"
                      />
                      <Button
                        size="sm"
                        className="h-9 shrink-0"
                        disabled={!drafts[k.envKey]?.trim() || saving === k.envKey}
                        onClick={() => void save(k.envKey)}
                      >
                        {saving === k.envKey ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                      </Button>
                      {k.set && k.from === "db" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 shrink-0 text-destructive hover:text-destructive"
                          disabled={saving === k.envKey}
                          onClick={() => void remove(k.envKey)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
