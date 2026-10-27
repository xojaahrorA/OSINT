// TG login xizmati — telefon + Telegram kodi + (kerak bo'lsa) 2FA parol
// bilan yangi sessiya yaratadi va scripts/.tg-session.json ga saqlaydi.
//
// XAVFSIZLIK:
//   - Parol/sessiya hech qachon klientga qaytarilmaydi (faqat maskalangan holat).
//   - Parol faqat Telegram SRP orqali ishlatiladi, hech qayerga yozilmaydi.
//   - Login jarayonida hech qanday o'qish/yozish amali bajarilmaydi (faqat auth).

import fs from "fs";
import path from "path";
import { createRequire } from "node:module";

// gramjs — serverExternalPackages tufayli runtime'da to'g'ridan-to'g'ri require
const nodeRequire = createRequire(import.meta.url);
const { TelegramClient: TgClientCtor } = nodeRequire("telegram") as {
  TelegramClient: new (...args: unknown[]) => unknown;
};
const { StringSession } = nodeRequire("telegram/sessions/index.js") as {
  StringSession: new (s: string) => unknown;
};
 
const { Api } = nodeRequire("telegram") as any;
 
const { computeCheck } = nodeRequire("telegram/Password") as {
  computeCheck: (pwdInfo: unknown, plain: string) => Promise<unknown>;
};

const ROOT = process.cwd();
const SESSION_FILE = path.join(ROOT, "scripts", ".tg-session.json");

export type LoginStage = "idle" | "code_sent" | "password_needed" | "success" | "error";

export interface LoginState {
  stage: LoginStage;
  phoneMasked: string | null;
  apiIdMasked: string | null;
  error: string | null;
  floodWaitSec: number;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

interface StoredCreds {
  apiId: number;
  apiHash: string;
}

function readStoredCreds(): StoredCreds | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (raw?.apiId && raw?.apiHash) return { apiId: Number(raw.apiId), apiHash: String(raw.apiHash) };
  } catch {
    /* fayl yo'q */
  }
  return null;
}

export function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length < 6) return "+****";
  return `+${d.slice(0, 4)}****${d.slice(-3)}`;
}

export function maskApiId(id: number | string): string {
  const s = String(id);
  if (s.length <= 3) return "***";
  return `${s.slice(0, 2)}***`;
}

/** Telefon raqamini xalqaro formatga keltirish: faqat raqamlar, + prefiks */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

function errMessage(e: unknown): string {
  const er = e as { errorMessage?: string; message?: string };
  return String(er?.errorMessage ?? er?.message ?? e);
}

function floodFrom(msg: string): number | null {
  const m = /FLOOD_WAIT_(\d+)/.exec(msg);
  return m ? Math.min(Number(m[1]), 86400) : null;
}

function uzError(msg: string): string {
  if (/FLOOD_WAIT_(\d+)/.test(msg)) {
    const s = floodFrom(msg) ?? 0;
    if (s >= 3600) return `Telegram cheklovi: ${(s / 3600).toFixed(1)} soatdan keyin qayta urinib ko'ring`;
    return `Telegram cheklovi: ${s} soniyadan keyin qayta urinib ko'ring`;
  }
  if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD|api.id/i.test(msg))
    return "apiId/apiHash noto'g'ri (my.telegram.org'dan olingan qiymatlarni tekshiring)";
  if (/PHONE_NUMBER_INVALID/i.test(msg)) return "Telefon raqami noto'g'ri — xalqaro formatda kiriting (+998...)";
  if (/PHONE_CODE_INVALID/i.test(msg)) return "Kod xato — Telegram'dagi kodni qayta tekshiring";
  if (/PHONE_CODE_EXPIRED/i.test(msg)) return "Kod muddati tugadi — loginni qaytadan boshlang";
  if (/SESSION_PASSWORD_NEEDED/i.test(msg)) return "2FA parol talab qilinadi";
  if (/PASSWORD_HASH_INVALID/i.test(msg)) return "2FA parol xato — qayta kiriting";
  if (/PHONE_NUMBER_UNOCCUPIED/i.test(msg)) return "Bu raqam Telegram'da ro'yxatdan o'tmagan";
  if (/PHONE_NUMBER_BANNED/i.test(msg)) return "Bu raqam Telegram tomonidan bloklangan";
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|AUTH_KEY_INVALID/i.test(msg))
    return "Sessiya bekor qilingan — loginni qaytadan boshlang";
  return msg.slice(0, 160);
}

class TgLogin {
   
  private client: any = null;
  private phone: string | null = null;
  private phoneCodeHash: string | null = null;
  private apiId: number | null = null;
  private apiHash: string | null = null;

  public state: LoginState = {
    stage: "idle",
    phoneMasked: null,
    apiIdMasked: null,
    error: null,
    floodWaitSec: 0,
    startedAt: null,
    finishedAt: null,
    message: null,
  };

  constructor() {
    // HMR'da jarayon ichidagi eski holat qolmasin — lekin klient globalThis'da
    // (pastda) saqlanadi, shuning uchun davom etayotgan login buzilmaydi.
  }

  public getState(): LoginState {
    return { ...this.state };
  }

  public getStage(): LoginStage {
    return this.state.stage;
  }

  public hasStoredCreds(): boolean {
    return readStoredCreds() !== null;
  }

  /** Klientga qaytarish uchun: mavjud kredensiallar (sessiya faylidan) */
  public storedCredsForClient(): { apiId: number; apiHash: string } | null {
    return readStoredCreds();
  }

  private reset(partial?: Partial<LoginState>) {
    this.state = {
      stage: "idle",
      phoneMasked: null,
      apiIdMasked: null,
      error: null,
      floodWaitSec: 0,
      startedAt: null,
      finishedAt: null,
      message: null,
      ...partial,
    };
  }

  private fail(message: string) {
    this.state.error = message;
    this.state.message = message;
  }

  private async killClient() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }

  /** 1-qadam: kod yuborish (apiId/apiHash + telefon) */
  public async sendCode(input: {
    apiId?: number | string;
    apiHash?: string;
    phone: string;
  }): Promise<{ ok: boolean; message: string }> {
    // Jarayonda davom etayotgan login bo'lsa — bekor qilamiz
    await this.killClient();

    const phone = normalizePhone(input.phone ?? "");
    if (!phone) {
      this.reset({ stage: "error" });
      this.fail("Telefon raqami noto'g'ri — xalqaro formatda kiriting (masalan +998901234567)");
      return { ok: false, message: this.state.error! };
    }

    // apiId/apiHash: so'rovdan, bo'lmasa saqlangan fayldan
    let apiId = input.apiId ? Number(String(input.apiId).replace(/\D/g, "")) : null;
    let apiHash = input.apiHash?.trim() || null;
    if (!apiId || !apiHash) {
      const stored = readStoredCreds();
      if (stored) {
        apiId = stored.apiId;
        apiHash = stored.apiHash;
      }
    }
    if (!apiId || !apiHash) {
      this.reset({ stage: "error" });
      this.fail(
        "apiId va apiHash kerak — my.telegram.org → API development tools sahifasidan oling va kiriting"
      );
      return { ok: false, message: this.state.error! };
    }

    this.reset({
      stage: "idle",
      phoneMasked: maskPhone(phone),
      apiIdMasked: maskApiId(apiId),
      startedAt: new Date().toISOString(),
    });
    this.phone = phone;
    this.apiId = apiId;
    this.apiHash = apiHash;

    try {
      // Klient instansiyasi HMR reload'da ham saqlansin
       
      const g = globalThis as any;
      const client = new TgClientCtor(new StringSession(""), apiId, apiHash, {
        connectionRetries: 3,
        requestRetries: 1,
        timeout: 30,
        deviceModel: "Desktop",
        systemVersion: "Linux",
      }) as any;
      client.setLogLevel?.("error");
      g.__tgLoginClient = client;
      this.client = client;
      await client.connect();

      const r = await client.sendCode({ apiId, apiHash }, phone);
      this.phoneCodeHash = r?.phoneCodeHash ?? null;
      if (!this.phoneCodeHash) throw new Error("phoneCodeHash olinmadi — qayta urinib ko'ring");

      this.state.stage = "code_sent";
      this.state.message =
        "Kod Telegram'ga yuborildi (rasmiy Telegram ilovasiga yoki SMS orqali). Kodni kiriting.";
      return { ok: true, message: this.state.message };
    } catch (e) {
      const msg = errMessage(e);
      const flood = floodFrom(msg);
      this.state.stage = "error";
      this.state.floodWaitSec = flood ?? 0;
      this.fail(uzError(msg));
      void this.killClient();
      return { ok: false, message: this.state.error! };
    }
  }

  /** 2-qadam: kodni tasdiqlash */
  public async verify(code: string): Promise<{ ok: boolean; message: string; needPassword?: boolean }> {
    if (this.state.stage !== "code_sent" || !this.client || !this.phoneCodeHash) {
      return { ok: false, message: "Login jarayoni topilmadi — qaytadan boshlang (kod yuborishdan)" };
    }
    const clean = (code ?? "").replace(/\D/g, "");
    if (clean.length < 4) {
      this.fail("Kodni to'liq kiriting (5 raqam)");
      return { ok: false, message: this.state.error! };
    }

    try {
      const res = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: clean,
        })
      );
      // Ba'zan ro'yxatdan o'tmagan raqam uchun SignUpRequired qaytadi
      if (String(res?.className ?? "") === "auth.authSignUpRequired") {
        this.reset({ stage: "error" });
        this.fail("Bu raqam Telegram'da ro'yxatdan o'tmagan — boshqa raqam kiriting");
        void this.killClient();
        return { ok: false, message: this.state.error! };
      }
      return await this.finishLogin();
    } catch (e) {
      const msg = errMessage(e);
      if (/SESSION_PASSWORD_NEEDED/i.test(msg)) {
        this.state.stage = "password_needed";
        this.state.error = null;
        this.state.message = "Bu hisobda 2FA (ikkita bosqichli tasdiqlash) yoqilgan — parolni kiriting";
        return { ok: true, message: this.state.message, needPassword: true };
      }
      if (/PHONE_CODE_INVALID/i.test(msg)) {
        // Kod xato — jarayon saqlanadi, foydalanuvchi qayta kirita oladi
        this.fail(uzError(msg));
        return { ok: false, message: this.state.error! };
      }
      if (/PHONE_CODE_EXPIRED/i.test(msg)) {
        await this.cancel();
        this.state.stage = "error";
        this.fail(uzError(msg));
        return { ok: false, message: this.state.error! };
      }
      const flood = floodFrom(msg);
      this.state.floodWaitSec = flood ?? 0;
      this.state.stage = "error";
      this.fail(uzError(msg));
      void this.killClient();
      return { ok: false, message: this.state.error! };
    }
  }

  /** 3-qadam (2FA yoqilgan bo'lsa): parol bilan tasdiqlash */
  public async checkPassword(password: string): Promise<{ ok: boolean; message: string }> {
    if (this.state.stage !== "password_needed" || !this.client) {
      return { ok: false, message: "Parol bosqichi topilmadi — avval kodni kiriting" };
    }
    if (!password) return { ok: false, message: "Parol bo'sh" };
    try {
      const pwdInfo = await this.client.invoke(new Api.account.GetPassword());
      const srp = await computeCheck(pwdInfo, password);
      await this.client.invoke(new Api.auth.CheckPassword({ password: srp }));
      return await this.finishLogin();
    } catch (e) {
      const msg = errMessage(e);
      if (/PASSWORD_HASH_INVALID/i.test(msg)) {
        this.fail(uzError(msg));
        return { ok: false, message: this.state.error! };
      }
      const flood = floodFrom(msg);
      this.state.floodWaitSec = flood ?? 0;
      this.state.stage = "error";
      this.fail(uzError(msg));
      void this.killClient();
      return { ok: false, message: this.state.error! };
    }
  }

  private async finishLogin(): Promise<{ ok: boolean; message: string }> {
    try {
      const sessionString = this.client.session.save() as string;
      if (!sessionString || sessionString.length < 20) throw new Error("Sessiya stringi olinmadi");
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(
        SESSION_FILE,
        JSON.stringify({ session: sessionString, apiId: this.apiId, apiHash: this.apiHash })
      );
      this.state.stage = "success";
      this.state.error = null;
      this.state.floodWaitSec = 0;
      this.state.finishedAt = new Date().toISOString();
      this.state.message = "Kirish muvaffaqiyatli — sessiya saqlandi. Skaner ishga tayyor!";
      // Login klienti endi kerak emas
      await this.killClient();
      return { ok: true, message: this.state.message };
    } catch (e) {
      this.state.stage = "error";
      this.fail(`Sessiyani saqlashda xato: ${uzError(errMessage(e))}`);
      return { ok: false, message: this.state.error! };
    }
  }

  /** Loginni bekor qilish */
  public async cancel(): Promise<{ ok: boolean; message: string }> {
    await this.killClient();
    this.reset({ stage: "idle", message: "Login bekor qilindi" });
    this.phone = null;
    this.phoneCodeHash = null;
    return { ok: true, message: "Login bekor qilindi" };
  }
}

// Global singleton (HMR'da ham saqlanadi)
 
const g = globalThis as any;
const TG_LOGIN_VERSION = 1;
if (!g.__tgLogin || g.__tgLoginVersion !== TG_LOGIN_VERSION) {
  g.__tgLogin = new TgLogin();
  g.__tgLoginVersion = TG_LOGIN_VERSION;
}
const tgLogin = g.__tgLogin as TgLogin;
export default tgLogin;
