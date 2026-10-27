"use client";

// TG login dialogi — 3 bosqich: kredensiallar+telefon → kod → (2FA) parol.
// Parol hech qachon saqlanmaydi, faqat Telegram SRP orqali yuboriladi.

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, KeyRound, ShieldCheck, AlertTriangle, Info } from "lucide-react";

interface LoginState {
  stage: "idle" | "code_sent" | "password_needed" | "success" | "error";
  phoneMasked: string | null;
  apiIdMasked: string | null;
  error: string | null;
  floodWaitSec: number;
  message: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}

type Step = "creds" | "code" | "password";

export function TgLoginDialog({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("creds");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("+998");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [floodSec, setFloodSec] = useState(0);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);

  // Dialog ochilganda: saqlangan kredensiallar + joriy login holati
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tg-hub?creds=1", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const j = (await res.json()) as {
          login?: LoginState;
          storedCreds?: { apiId: number; apiHash: string } | null;
        };
        if (j.storedCreds) {
          setApiId(String(j.storedCreds.apiId));
          setApiHash(j.storedCreds.apiHash);
        }
        const st = j.login?.stage;
        if (st === "code_sent") {
          setStep("code");
          setPhoneMasked(j.login?.phoneMasked ?? null);
          setInfo(j.login?.message ?? null);
        } else if (st === "password_needed") {
          setStep("password");
          setInfo(j.login?.message ?? null);
        } else if (st === "error") {
          setError(j.login?.error ?? null);
          setFloodSec(j.login?.floodWaitSec ?? 0);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const act = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; needPassword?: boolean } | null> => {
      setBusy(action);
      setError(null);
      try {
        const res = await fetch("/api/tg-hub", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const j = (await res.json()) as { ok: boolean; message?: string; needPassword?: boolean };
        if (!j.ok) {
          setError(j.message ?? "Noma'lum xato");
          return j;
        }
        return j;
      } catch {
        setError("Server bilan aloqa yo'q — sahifani yangilab ko'ring");
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const sendCode = async () => {
    const r = await act("login-send-code", { apiId: apiId.trim(), apiHash: apiHash.trim(), phone: phone.trim() });
    if (r?.ok) {
      setStep("code");
      setInfo("Kod Telegram'ga yuborildi — rasmiy Telegram ilovasiga kirib ko'ring yoki SMS'ni kutib turing.");
      setPhoneMasked(null);
    }
  };

  const verify = async () => {
    const r = await act("login-verify", { code: code.trim() });
    if (r?.ok && r.needPassword) {
      setStep("password");
      setInfo("Bu hisobda 2FA yoqilgan — Telegram parolingizni kiriting.");
      return;
    }
    if (r?.ok) {
      onSuccess();
      onOpenChange(false);
    }
  };

  const checkPassword = async () => {
    const r = await act("login-password", { password });
    if (r?.ok) {
      onSuccess();
      onOpenChange(false);
    }
  };

  const cancel = async () => {
    await act("login-cancel", {});
    setStep("creds");
    setCode("");
    setPassword("");
    setInfo(null);
  };

  const closeDialog = (v: boolean) => {
    if (!v && step !== "creds" && busy === null) {
      // Jarayon o'rtasida yopilsa — serverdagi pending loginni bekor qilamiz
      void fetch("/api/tg-hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-cancel" }),
      }).catch(() => {});
    }
    onOpenChange(v);
  };

  const canSendCode = phone.replace(/\D/g, "").length >= 9 && apiId.trim() !== "" && apiHash.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="w-4 h-4 text-primary" />
            Telegram sessiyasiga kirish
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Skaner ishlashi uchun bir martalik login kerak. Kod <b>faqat sizning Telegram&apos;ingizga</b> keladi —
            hech kimga bermang. Parol saqlanmaydi.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription className="text-xs">
              {error}
              {floodSec > 0 && (
                <span className="block mt-1 font-mono">Kutish: {Math.ceil(floodSec / 60)} daqiqa</span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {info && !error && (
          <Alert className="py-2 border-primary/30">
            <Info className="w-4 h-4 text-primary" />
            <AlertDescription className="text-xs">{info}</AlertDescription>
          </Alert>
        )}

        {step === "creds" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="login-apiid" className="text-xs">api_id</Label>
              <Input
                id="login-apiid"
                value={apiId}
                onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))}
                placeholder="1234567"
                className="h-9 text-sm font-mono"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-apihash" className="text-xs">api_hash</Label>
              <Input
                id="login-apihash"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value.trim())}
                placeholder="0123456789abcdef0123456789abcdef"
                className="h-9 text-sm font-mono"
                autoComplete="off"
              />
            </div>
            <details className="rounded-md border bg-secondary/30 p-2.5 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none font-medium text-foreground/80">
                api_id / api_hash qayerdan olinadi?
              </summary>
              <ol className="mt-1.5 space-y-0.5 list-decimal list-inside leading-relaxed">
                <li><b>my.telegram.org</b> sahifasiga kiring (telefon + Telegram&apos;ga keladigan kod)</li>
                <li><b>API development tools</b> bo&apos;limini oching</li>
                <li>App title: istalgan nom (masalan <i>osint</i>), platform: <i>Desktop</i> → Create</li>
                <li>Ko&apos;rinadigan <b>app_api_id</b> va <b>app_api_hash</b> qiymatlarini yuqoriga nusxalang</li>
              </ol>
            </details>
            <div className="space-y-1.5">
              <Label htmlFor="login-phone" className="text-xs">Telefon raqami</Label>
              <Input
                id="login-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
                className="h-10 text-sm"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <Button className="w-full" disabled={!canSendCode || busy !== null} onClick={() => void sendCode()}>
              {busy === "login-send-code" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Kod yuborish
            </Button>
          </div>
        )}

        {step === "code" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Kod yuborildi {phoneMasked ? <b>({phoneMasked})</b> : null} — Telegram rasmiy ilovasida yangi
              xabar sifatida yoki SMS orqali keladi.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="login-code" className="text-xs">5 xonali kod</Label>
              <Input
                id="login-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="— — — — —"
                className="h-11 text-lg text-center tracking-[0.5em] font-mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length >= 4 && busy === null) void verify();
                }}
              />
            </div>
            <Button className="w-full" disabled={code.length < 4 || busy !== null} onClick={() => void verify()}>
              {busy === "login-verify" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
              Kirish
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={busy !== null} onClick={() => void cancel()}>
              Bekor qilish va qaytadan boshlash
            </Button>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              2FA paroli talab qilinadi. Parol faqat Telegram&apos;ga yuboriladi — ilova saqlamaydi.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="login-pwd" className="text-xs">2FA paroli</Label>
              <Input
                id="login-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10 text-sm"
                autoComplete="current-password"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && password && busy === null) void checkPassword();
                }}
              />
            </div>
            <Button className="w-full" disabled={!password || busy !== null} onClick={() => void checkPassword()}>
              {busy === "login-password" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
              Tasdiqlash
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={busy !== null} onClick={() => void cancel()}>
              Bekor qilish
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
