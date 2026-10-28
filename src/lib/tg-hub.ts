// TG Guruh/Kanal skaneri — gramjs asosidagi READ-ONLY servis.
//
// QOIDALAR (majburiy):
//   1. FAQAT O'QISH: hech kimga xabar yozilmaydi, hech qayerga qo'shilmaydi,
//      hech qanday yozuv qoldirmaydigan amal yo'q.
//   2. DINIY FILTR: religious=true guruhlar skan QILINMAYDI (O'zbekiston
//      qonunchiligiga rioya).
//   3. FLOOD xavfsizligi: guruhlar orasi 2s, FLOOD_WAIT'da kutish + 1 retry,
//      keyin guruh o'tkazib yuboriladi (skan hech qachon o'lib qolmaydi).
//
// Foydalanuvchi sessiyasi: scripts/.tg-session.json {session, apiId, apiHash}
// Peer kesh: scripts/.peers.json (username -> {id, accessHash,...})
// Preset ro'yxat: scripts/.uz-groups.json

import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { db } from "@/lib/db";

// gramjs — serverExternalPackages tufayli bundler'ga kirmaydi. Turbopack'ning
// CJS/ESM interop'idan chetlanish uchun createRequire bilan to'g'ridan-to'g'ri
// olamiz (skriptlar bilan aynan bir xil yuklanish yo'li):
const nodeRequire = createRequire(import.meta.url);
const { TelegramClient: TgClientCtor } = nodeRequire("telegram") as {
  TelegramClient: new (...args: unknown[]) => unknown;
};
const { StringSession } = nodeRequire("telegram/sessions/index.js") as {
  StringSession: new (s: string) => unknown;
};
 
const { Api } = nodeRequire("telegram") as any;

type AnyClient = any;

export interface TgTarget {
  username?: string;
  userId?: string;
  nameQuery?: string;
}

export interface TgSample {
  date?: string;
  text?: string;
  sender?: string;
}

// Topilgan xabarning to'liq ko'rinishi — "nima deb yozgan"ini ko'rsatish uchun
export interface TgMsg {
  id: number;
  date: string; // "YYYY-MM-DD HH:mm"
  text: string;
  link?: string | null; // t.me havolasi
  fromUserId?: string; // kim yozgan (maqsad ID bilan solishtiriladi)
}

export interface TgHit {
  group: string; // @username
  title: string;
  kind: string; // channel | group
  members: number;
  type: "mention" | "ism" | "from_id";
  count: number;
  samples: TgSample[];
  msgs?: TgMsg[]; // xabarlar ro'yxati (havola bilan)
}

// Global qidiruv (ochiq/public chatlar) natijasi — bitta xabar
export interface TgGlobalMsg {
  chatTitle: string;
  chatUsername: string | null;
  chatId: string | null;
  msgId: number;
  date: string;
  text: string;
  senderUserId: string | null;
  senderName: string | null;
  authoredByTarget: boolean; // maqsadning o'zi yozgan
  link: string | null;
}

// Ismiga o'xshash ochiq chat (contacts.Search orqali)
export interface TgNamedChat {
  title: string;
  username: string | null;
  kind: string;
  members: number;
  link: string | null;
}

export interface TgGlobalResult {
  ok: boolean;
  message?: string;
  queries: { q: string; count: number; error?: string }[];
  found: TgGlobalMsg[];
  chatsNamedLike: TgNamedChat[];
  religiousSkipped: number;
  targetId: string | null;
  targetUsername: string | null;
}

export interface TgScanState {
  running: boolean;
  stopping: boolean;
  target: TgTarget | null;
  targetProfile: {
    id: string;
    username: string | null;
    name: string;
    bio: string | null;
    accessHash: string;
  } | null;
  done: number;
  total: number;
  current: string | null;
  hits: TgHit[];
  scanned: number;
  floodSkips: number;
  errors: number;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
}

export interface TgGroupRow {
  id: string;
  username: string;
  title: string;
  kind: string;
  members: number;
  source: string;
  religious: boolean;
  lastStatus: string | null;
  lastScanAt: string | null;
}

// Diniy kontent filtri — bu guruhlar TEGILMAYDI
const RELIGIOUS = /(islom|quron|qur'on|namoz|musulmon|diniy|masjid|hadis|sunna|ramazon|haj|umra|imom|ummah|alohid|yaqin kuni|zikr|duo)/i;

// Maqsad konstantalari — oldingi read-only profil tekshiruvidan olingan.
// accessHash shu hisob sessiyasiga bog'liq: boshqa hisobda kirilsa tekshiruv
// xato qaytaradi va qidiruv matn bo'yicha davom etadi (hech qachon yiqilmaydi).
const TARGET_FALLBACK = {
  userId: "8731535304",
  accessHash: "-6224497623040441778",
};

// Bitta guruhda nechta xabargacha to'liq yig'amiz (paginatsiya chegarasi)
const FROM_ID_MAX = 600;
const QUERY_MAX = 200;
const GLOBAL_MAX = 200;

const ROOT = process.cwd();
const SESSION_FILE = path.join(ROOT, "scripts", ".tg-session.json");
const PEERS_FILE = path.join(ROOT, "scripts", ".peers.json");
const PRESETS_FILE = path.join(ROOT, "scripts", ".uz-groups.json");
const SNAPSHOT_FILE = path.join(ROOT, "db", "tg-hub-state.json");

const GROUP_PAUSE_MS = 2000;
const POLL_SLEEP_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normUsername(raw: string): string | null {
  const u = raw
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(u)) return null;
  return u;
}

interface PeerInfo {
  id: string;
  accessHash: string;
  title?: string;
  members?: number;
  isChannel?: boolean;
}

function loadPeerCache(): Map<string, PeerInfo> {
  try {
    const raw = JSON.parse(fs.readFileSync(PEERS_FILE, "utf8")) as Record<string, PeerInfo>;
    return new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  } catch {
    return new Map();
  }
}

// Sessiya o'lgan holatlar (login talab qiladi): Telegram o'zi 401 qaytaradi
const AUTH_DEAD_RE =
  /(AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|AUTH_KEY_DUPLICATED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED)/i;

class TgHub {
  private client: AnyClient = null;
  private connecting: Promise<void> | null = null;
  private peerCache = loadPeerCache();
  // Sessiya Telegram tomonidan bekor qilinganmi? (qayta login kerak)
  public authDead = false;
  private lastSnapshot: { target: TgTarget | null; startedAt: string | null; finishedAt: string | null; hits: TgHit[]; scanned: number } | null = null;

  public connectError: string | null = null;
  public scan: TgScanState = {
    running: false,
    stopping: false,
    target: null,
    targetProfile: null,
    done: 0,
    total: 0,
    current: null,
    hits: [],
    scanned: 0,
    floodSkips: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null,
    log: [],
  };

  constructor() {
    this.loadSnapshot();
  }

  // ---------- Snapshot (qayta ishga tushganda natijalar yo'qolmasin) ----------
  private loadSnapshot() {
    try {
      const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
      if (raw && typeof raw === "object") this.lastSnapshot = raw.lastScan ?? null;
    } catch {
      /* birinchi ishga tushish — fayl yo'q */
    }
  }

  private saveSnapshot() {
    try {
      const s = this.scan;
      const data = {
        lastScan: {
          target: s.target,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          hits: s.hits,
          scanned: s.scanned,
        },
      };
      this.lastSnapshot = data.lastScan;
      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data));
    } catch {
      /* disk xatosi — critik emas */
    }
  }

  // ---------- Holat ----------
  public hasSession(): boolean {
    return fs.existsSync(SESSION_FILE);
  }

  public isConnected(): boolean {
    return !!this.client?.connected;
  }

  public isConnecting(): boolean {
    return this.connecting !== null;
  }

  private log(line: string) {
    const ts = new Date().toISOString().slice(11, 19);
    this.scan.log.push(`[${ts}] ${line}`);
    if (this.scan.log.length > 300) this.scan.log.splice(0, this.scan.log.length - 300);
  }

  private async ensureClient(): Promise<AnyClient> {
    if (this.client?.connected) return this.client;
    if (this.connecting) return this.connecting.then(() => this.client);
    this.connecting = (async () => {
      try {
        if (!this.hasSession()) throw new Error("TG sessiya fayli topilmadi (scripts/.tg-session.json)");
        const sess = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        // Klient instansiyasi HMR reload'da ham saqlansin
         
        const g = globalThis as any;
        if (!g.__tgClient || !g.__tgClient.connected) {
          const client = new TgClientCtor(
            new StringSession(sess.session) as never,
            Number(sess.apiId),
            sess.apiHash,
            {
              connectionRetries: 3,
              requestRetries: 2,
              timeout: 25,
              deviceModel: "Desktop",
              systemVersion: "Linux",
            }
          ) as unknown as AnyClient;
          client.setLogLevel?.("error");
          await client.connect();
          g.__tgClient = client;
        }
        this.client = g.__tgClient;
        this.connectError = null;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        this.connectError = msg.slice(0, 200);
        if (AUTH_DEAD_RE.test(msg)) this.authDead = true;
        throw e;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting.then(() => this.client);
  }

  // ---------- Peer yechish (read-only: contacts.Search) ----------
  private async resolvePeer(username: string): Promise<PeerInfo | null> {
    const key = username.toLowerCase();
    const cached = this.peerCache.get(key);
    if (cached?.accessHash) return cached;
    const client = await this.ensureClient();
    const res = await client.invoke(new Api.contacts.Search({ q: key, limit: 20 }));
    for (const ch of res.chats ?? []) {
      if ((ch.username ?? "").toLowerCase() === key) {
        const info: PeerInfo = {
          id: String(ch.id),
          accessHash: ch.accessHash?.toString() ?? "0",
          title: ch.title ?? key,
          members: ch.participantsCount ?? 0,
          isChannel: ch.broadcast === true,
        };
        this.peerCache.set(key, info);
        return info;
      }
    }
    return null;
  }

  // ---------- Guruhlar CRUD ----------
  public async listGroups(): Promise<TgGroupRow[]> {
    const rows = await db.telegramGroup.findMany({ orderBy: [{ source: "desc" }, { members: "desc" }] });
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      title: r.title,
      kind: r.kind,
      members: r.members,
      source: r.source,
      religious: r.religious,
      lastStatus: r.lastStatus,
      lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
    }));
  }

  public async addGroup(rawUsername: string): Promise<{ ok: boolean; message: string }> {
    const u = normUsername(rawUsername);
    if (!u) return { ok: false, message: "Username noto'g'ri — @belgi bilan yoki t.me havolasi kiriting" };
    // Peer yechish xatolari: sessiya yo'q / FLOOD / sessiya o'lgan — aniq o'zbekcha xabar
    let info: PeerInfo | null = null;
    try {
      info = await this.resolvePeer(u);
    } catch (e) {
      const msg = ((e as Error)?.message ?? "").slice(0, 80);
      if (/sessiya fayli topilmadi/i.test(msg)) {
        return { ok: false, message: "Sessiya yo'q — yuqorida Login tugmasi orqali kiring" };
      }
      if (/FLOOD/i.test(msg)) {
        return { ok: false, message: "Telegram FLOOD cheklovi — 1-2 daqiqa kutib turing" };
      }
      if (this.authDead || /AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i.test(msg)) {
        return { ok: false, message: "Sessiya yaroqsiz — qayta login qiling" };
      }
      return { ok: false, message: "Telegram bilan aloqa xatosi" };
    }
    if (!info) return { ok: false, message: `@${u} topilmadi — username mavjud emas yoki yashirilgan` };
    const religious = RELIGIOUS.test(info.title ?? u);
    await db.telegramGroup.upsert({
      where: { username: u },
      create: {
        username: u,
        title: info.title ?? u,
        kind: info.isChannel ? "channel" : "group",
        members: info.members ?? 0,
        tgId: info.id,
        accessHash: info.accessHash,
        source: "user",
        religious,
      },
      update: {
        title: info.title ?? u,
        members: info.members ?? 0,
        tgId: info.id,
        accessHash: info.accessHash,
      },
    });
    return {
      ok: true,
      message: religious
        ? `@${u} qo'shildi — lekin DINIY filtrga tushdi va skanlanmaydi`
        : `@${u} qo'shildi (${info.members ?? 0} a'zo)`,
    };
  }

  public async deleteGroups(ids: string[]): Promise<number> {
    const res = await db.telegramGroup.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  }

  /** Ko'p guruhni bir vaqtda qo'shish (har biri contacts.Search bilan tekshiriladi) */
  public async addManyGroups(
    rawList: string[],
    max = 25
  ): Promise<{ added: number; updated: number; failed: number; religious: number; details: string[]; message: string }> {
    const list = rawList.map((s) => s.trim()).filter(Boolean).slice(0, max);
    if (list.length === 0) {
      return { added: 0, updated: 0, failed: 0, religious: 0, details: [], message: "Ro'yxat bo'sh" };
    }
    let added = 0;
    let updated = 0;
    let failed = 0;
    let religious = 0;
    const details: string[] = [];
    for (const raw of list) {
      const r = await this.addGroup(raw);
      if (r.ok) {
        if (/DINIY/.test(r.message)) religious++;
        else if (/qo'shildi/.test(r.message)) added++;
        details.push(`✔ ${raw}: ${r.message}`);
      } else {
        failed++;
        details.push(`✘ ${raw}: ${r.message}`);
      }
      await sleep(800);
    }
    return {
      added,
      updated,
      failed,
      religious,
      details: details.slice(0, 40),
      message: `${added} qo'shildi, ${religious} diniy (skanlanmaydi), ${failed} xato` +
        (failed >= list.length && list.length > 0 ? " — ulanish/sessiyani tekshiring" : ""),
    };
  }

  public async importPresets(): Promise<{ added: number; updated: number; religious: number }> {
    const raw = JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8")) as {
      title: string;
      username: string;
      type: string;
      members: number;
    }[];
    let added = 0;
    let updated = 0;
    let religious = 0;
    for (const g of raw) {
      const u = (g.username ?? "").toLowerCase();
      if (!u) continue;
      const isRel = RELIGIOUS.test(g.title ?? "") || RELIGIOUS.test(u);
      if (isRel) religious++;
      const peer = this.peerCache.get(u);
      const exists = await db.telegramGroup.findUnique({ where: { username: u } });
      if (exists) {
        await db.telegramGroup.update({
          where: { username: u },
          data: {
            title: g.title ?? u,
            kind: g.type === "channel" ? "channel" : "group",
            members: g.members ?? exists.members,
            tgId: peer?.id ?? exists.tgId,
            accessHash: peer?.accessHash ?? exists.accessHash,
            religious: isRel || exists.religious,
          },
        });
        updated++;
      } else {
        await db.telegramGroup.create({
          data: {
            username: u,
            title: g.title ?? u,
            kind: g.type === "channel" ? "channel" : "group",
            members: g.members ?? 0,
            tgId: peer?.id ?? null,
            accessHash: peer?.accessHash ?? null,
            source: "preset",
            religious: isRel,
          },
        });
        added++;
      }
    }
    return { added, updated, religious };
  }

  public async presetsStatus(): Promise<{ imported: boolean; presetFile: boolean; total: number }> {
    const total = await db.telegramGroup.count();
    const presetFile = fs.existsSync(PRESETS_FILE);
    const imported = presetFile && total > 0;
    return { imported: !!imported, presetFile, total };
  }

  // ---------- Skan ----------
  public async startScan(target: TgTarget): Promise<{ ok: boolean; message: string }> {
    if (this.scan.running) return { ok: false, message: "Skan allaqachon ishlab turibdi — avval to'xtating" };
    const t: TgTarget = {
      username: target.username ? normUsername(target.username) ?? undefined : undefined,
      userId: target.userId?.replace(/\D/g, "") || undefined,
      nameQuery: target.nameQuery?.trim() || undefined,
    };
    if (!t.username && !t.userId && !t.nameQuery)
      return { ok: false, message: "Kamida bitta maqsad kiriting: username, userId yoki ism" };

    // Holatni tozalash
    this.scan = {
      running: true,
      stopping: false,
      target: t,
      targetProfile: null,
      done: 0,
      total: 0,
      current: null,
      hits: [],
      scanned: 0,
      floodSkips: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      log: [],
    };
    this.saveSnapshot();

    // Fondda ishga tushiramiz — API javob kutmaydi
    void this.runScan(t).catch((e) => {
      this.log(`XATO: ${(e as Error)?.message ?? e}`);
      this.scan.running = false;
      this.scan.finishedAt = new Date().toISOString();
      this.saveSnapshot();
    });
    return { ok: true, message: "Skan boshlandi" };
  }

  public stopScan(): void {
    if (this.scan.running) {
      this.scan.stopping = true;
      this.log("To'xtatish so'raldi — joriy guruhdan keyin to'htaydi");
    }
  }

  private errText(e: unknown): string {
    return String((e as Error)?.message ?? (e as { errorMessage?: string })?.errorMessage ?? e ?? "");
  }

  private samplesFrom(raw: any[]): TgSample[] {
    const out: TgSample[] = [];
    for (const m of (raw ?? []).slice(0, 3)) {
      out.push({
        date: m?.date ? new Date(Number(m.date) * 1000).toISOString().slice(0, 10) : undefined,
        text: (m?.message ?? "").slice(0, 140) || undefined,
        sender: m?.fromId?.className === "PeerUser" ? String(m.fromId.userId) : undefined,
      });
    }
    return out;
  }

  private msgLink(username: string, internalId: string | null, msgId: number): string | null {
    const u = (username ?? "").trim();
    if (u) return `https://t.me/${u}/${msgId}`;
    const id = String(internalId ?? "").replace(/^-100/, "").replace(/^-/, "");
    return id ? `https://t.me/c/${id}/${msgId}` : null;
  }

  private buildMsgs(raw: any[], username: string, internalId: string | null, cap: number): TgMsg[] {
    const out: TgMsg[] = [];
    for (const m of raw ?? []) {
      if (!m || typeof m.id !== "number") continue;
      const text = (typeof m.message === "string" ? m.message : "").trim();
      out.push({
        id: m.id,
        date: m.date
          ? new Date(Number(m.date) * 1000).toISOString().slice(0, 16).replace("T", " ")
          : "",
        text: (text || "(media — matn yo'q)").slice(0, 300),
        link: this.msgLink(username, internalId, m.id),
        fromUserId: m.fromId?.className === "PeerUser" ? String(m.fromId.userId) : undefined,
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  /** Bitta chatda qidiruvni paginatsiya bilan to'liq olib boradi (FLOOD himoyasi ichida) */
  private async searchAll(
    peer: unknown,
    q: string,
    fromId: unknown | null,
    max: number,
    logCtx: (s: string) => void
  ): Promise<{ count: number; messages: any[] }> {
    const client = await this.ensureClient();
    const pages = Math.max(1, Math.ceil(max / 100));
    const all: any[] = [];
    let total = 0;
    let offsetId = 0;
    for (let p = 0; p < pages; p++) {
      let res: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await client.invoke(
            new Api.messages.Search({
              peer: peer as never,
              q,
              fromId: fromId ?? undefined,
              filter: new Api.InputMessagesFilterEmpty(),
              minDate: 0,
              maxDate: 0,
              offsetRate: 0,
              offsetId,
              addOffset: 0,
              limit: 100,
              maxId: 0,
              minId: 0,
              hash: BigInt(0),
            })
          );
          break;
        } catch (e) {
          const msg = this.errText(e);
          const m = /FLOOD_WAIT_(\d+)/.exec(msg);
          if (m) {
            const wait = Math.min(Number(m[1]) + 5, 120);
            logCtx(`FLOOD ${m[1]}s → ${wait}s kutish`);
            await sleep(wait * 1000);
          } else if (/PEER_ID_INVALID|CHANNEL_INVALID/i.test(msg) && offsetId === 0) {
            // Peer turi mos kelmadi — oddiy (basic) guruh bo'lishi mumkin: chat peer bilan urinamiz
            const chPeer = this.basicChatPeer(peer);
            if (chPeer) {
              try {
                res = await client.invoke(
                  new Api.messages.Search({
                    peer: chPeer as never,
                    q,
                    fromId: fromId ?? undefined,
                    filter: new Api.InputMessagesFilterEmpty(),
                    minDate: 0,
                    maxDate: 0,
                    offsetRate: 0,
                    offsetId,
                    addOffset: 0,
                    limit: 100,
                    maxId: 0,
                    minId: 0,
                    hash: BigInt(0),
                  })
                );
                break;
              } catch (e2) {
                if (/FLOOD_WAIT_(\d+)/.test(this.errText(e2))) throw e2;
                throw e;
              }
            } else throw e;
          } else {
            throw e;
          }
        }
      }
      if (!res) throw new Error("FLOOD_RETRY_FAILED");
      const msgs: any[] = res.messages ?? [];
      total = Number(res.count ?? total);
      if (msgs.length === 0) break;
      all.push(...msgs);
      if (all.length >= max || (total > 0 && all.length >= total)) break;
      const minId = Math.min(...msgs.map((x) => Number(x.id)));
      if (!minId || minId <= 0 || minId === offsetId) break;
      offsetId = minId;
      await sleep(600);
    }
    return { count: total || all.length, messages: all };
  }

  private basicChatPeer(original: unknown): unknown | null {
    // InputPeerChannel'dan InputPeerChat'ga o'tish — faqat ID orqali (basic guruh hash so'ramaydi)
    const chId = (original as { channelId?: unknown })?.channelId;
    if (chId === undefined) return null;
    const id = String(chId).replace(/^-100/, "").replace(/^-/, "");
    if (!id || id === "0") return null;
    return new Api.InputPeerChat({ chatId: BigInt(id) });
  }

  /**
   * Maqsad profilini aniqlash — from_id qidiruv uchun ID + accessHash shart.
   * 1) contacts.Search (username), 2) ma'lum ID+hash (users.getUsers bilan tekshiriladi),
   * 3) shu hisob dialoglari. Hech biri topmasa — qidiruv matn bo'yicha davom etadi.
   */
  private async resolveTargetIdentity(t: TgTarget): Promise<boolean> {
    let client: AnyClient;
    try {
      client = await this.ensureClient();
    } catch (e) {
      this.log(`ULANISH XATOSI: ${this.errText(e).slice(0, 120)}`);
      return false;
    }
    const setProfile = async (u: any, source: string): Promise<boolean> => {
      const id = String(u.id);
      const accessHash = u.accessHash?.toString() ?? null;
      if (!accessHash || accessHash === "0") {
        this.log(`Profil topildi (id=${id}) lekin accessHash yo'q — from_id o'tkaziladi`);
        return false;
      }
      this.scan.targetProfile = {
        id,
        username: u.username ?? null,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        bio: null,
        accessHash,
      };
      try {
        const full = await client.invoke(
          new Api.users.GetFullUser({
            id: new Api.InputUser({ userId: BigInt(id), accessHash: BigInt(accessHash) }),
          })
        );
        this.scan.targetProfile.bio = full?.fullUser?.about ?? null;
      } catch {
        /* bio bo'lmasa ham davom */
      }
      this.log(
        `Profil topildi (${source}): id=${id}, ism="${this.scan.targetProfile.name}", bio="${(this.scan.targetProfile.bio ?? "yo'q").slice(0, 60)}"`
      );
      return true;
    };

    // 1) Username orqali
    if (t.username) {
      this.log(`Profil tekshirilmoqda: @${t.username}`);
      try {
        const res = await client.invoke(new Api.contacts.Search({ q: t.username, limit: 20 }));
        const u = (res.users ?? []).find((x: any) => (x.username ?? "").toLowerCase() === t.username);
        if (u && (await setProfile(u, "contacts.Search"))) return true;
      } catch (e) {
        this.log(`contacts.Search o'tkazildi: ${this.errText(e).slice(0, 60)}`);
      }
      await sleep(1200);
    }

    // 2) Ma'lum ID + hash (shu hisobda ishlashi tekshiriladi — read-only)
    if (t.userId) {
      const known = t.userId === TARGET_FALLBACK.userId ? TARGET_FALLBACK : null;
      if (known) {
        try {
          const users = (await client.invoke(
            new Api.users.GetUsers({
              id: [new Api.InputUser({ userId: BigInt(known.userId), accessHash: BigInt(known.accessHash) })],
            })
          )) as any[];
          const u = (users ?? [])[0];
          if (u && String(u.id) === t.userId && !u.min) {
            if (await setProfile(u, "ID+hash tekshiruvi")) return true;
          }
        } catch (e) {
          this.log(`ID+hash tekshiruvi o'tmadi (${this.errText(e).slice(0, 50)}) — boshqa yo'l bilan izlanadi`);
        }
        await sleep(800);
      }
    }

    // 3) Shu hisob dialoglaridan izlash (agar maqsad bilan muloqot bo'lsa)
    if (t.userId) {
      try {
        const dialogs = (await client.invoke(
          new Api.messages.GetDialogs({
            offsetDate: 0,
            offsetId: 0,
            offsetPeer: new Api.InputPeerEmpty(),
            limit: 200,
            hash: BigInt(0),
          })
        )) as any;
        const u = (dialogs?.users ?? []).find((x: any) => String(x?.id) === t.userId);
        if (u && (await setProfile(u, "dialoglar"))) return true;
      } catch (e) {
        this.log(`Dialog tekshiruvi o'tkazildi: ${this.errText(e).slice(0, 60)}`);
      }
    }

    this.log("Profil aniqlanmadi — qidiruv @username/ism matni bo'yicha davom etadi");
    return false;
  }

  /**
   * GLOBAL qidiruv — saqlangan ro'yxatdan TASHQARI, butun Telegram ochiq (public)
   * chatlarida: @username tilga olingan xabarlar, ism uchrashi va maqsadning
   * o'zi yozgan xabarlar. messages.searchGlobal — faqat public kontent.
   */
  public async globalSearch(target: TgTarget): Promise<TgGlobalResult> {
    const empty: TgGlobalResult = {
      ok: false,
      queries: [],
      found: [],
      chatsNamedLike: [],
      religiousSkipped: 0,
      targetId: null,
      targetUsername: null,
    };
    if (this.scan.running) return { ...empty, message: "Skan ishlab turibdi — tugagach urinib ko'ring" };
    if (!this.hasSession()) return { ...empty, message: "Sessiya yo'q — avval Login qiling" };

    const t: TgTarget = {
      username: target.username ? normUsername(target.username) ?? undefined : undefined,
      userId: target.userId?.replace(/\D/g, "") || undefined,
      nameQuery: target.nameQuery?.trim() || undefined,
    };
    if (!t.username && !t.userId && !t.nameQuery)
      return { ...empty, message: "Kamida bitta maqsad kiriting: username, userId yoki ism" };

    let client: AnyClient;
    try {
      client = await this.ensureClient();
    } catch (e) {
      const msg = this.errText(e);
      if (AUTH_DEAD_RE.test(msg)) this.authDead = true;
      return { ...empty, message: /sessiya fayli topilmadi/i.test(msg) ? "Sessiya yo'q — avval Login qiling" : `Ulanish xatosi: ${msg.slice(0, 90)}` };
    }

    // Maqsad ID aniqlash — "uning o'zi yozgan"ini ajratish uchun
    let targetId: string | null = t.userId ?? null;
    let targetUsername: string | null = t.username ?? null;
    if (!targetId && t.username) {
      try {
        const res = await client.invoke(new Api.contacts.Search({ q: t.username, limit: 20 }));
        const u = (res.users ?? []).find((x: any) => (x.username ?? "").toLowerCase() === t.username);
        if (u) {
          targetId = String(u.id);
          if (!targetUsername) targetUsername = u.username ?? null;
        }
      } catch {
        /* ID aniqlanmasa ham matn qidiruvi davom */
      }
      await sleep(800);
    }

    // So'rov variantlari
    const qs = new Set<string>();
    if (t.username) {
      qs.add(`@${t.username}`);
      qs.add(t.username);
    }
    if (t.nameQuery) qs.add(t.nameQuery);
    const queries = [...qs].slice(0, 4);

    const found: TgGlobalMsg[] = [];
    const seen = new Set<string>();
    let religiousSkipped = 0;
    const queriesInfo: { q: string; count: number; error?: string }[] = [];

    for (const q of queries) {
      try {
        const res: any = await client.invoke(
          new Api.messages.SearchGlobal({
            q,
            filter: new Api.InputMessagesFilterEmpty(),
            minDate: 0,
            maxDate: 0,
            offsetRate: 0,
            offsetPeer: new Api.InputPeerEmpty(),
            offsetId: 0,
            limit: 100,
          })
        );
        const msgs: any[] = res.messages ?? [];
        const users: any[] = res.users ?? [];
        const chats: any[] = res.chats ?? [];
        queriesInfo.push({ q, count: msgs.length });
        for (const m of msgs) {
          let chatTitle = "";
          let chatUsername: string | null = null;
          let internalId: string | null = null;
          const peerId = m.peerId;
          if (peerId?.className === "PeerChannel") {
            const ch = chats.find((c: any) => String(c.id) === String(peerId.channelId));
            chatTitle = ch?.title ?? "kanal/guruh";
            chatUsername = ch?.username ?? null;
            internalId = String(peerId.channelId);
          } else if (peerId?.className === "PeerChat") {
            const ch = chats.find((c: any) => String(c.id) === String(peerId.chatId));
            chatTitle = ch?.title ?? "guruh";
            internalId = String(peerId.chatId);
          } else continue;
          // Diniy filtr — bu chatlardan natija KO'RSATILMAYDI
          if (RELIGIOUS.test(chatTitle) || RELIGIOUS.test(chatUsername ?? "")) {
            religiousSkipped++;
            continue;
          }
          const key = `${chatUsername ?? internalId}-${m.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sender = m.fromId?.className === "PeerUser" ? String(m.fromId.userId) : null;
          const senderUser = users.find((u: any) => String(u.id) === sender);
          const text = (typeof m.message === "string" ? m.message : "").trim();
          found.push({
            chatTitle,
            chatUsername,
            chatId: internalId,
            msgId: m.id,
            date: m.date ? new Date(Number(m.date) * 1000).toISOString().slice(0, 16).replace("T", " ") : "",
            text: (text || "(media — matn yo'q)").slice(0, 300),
            senderUserId: sender,
            senderName: senderUser
              ? `${senderUser.firstName ?? ""}${senderUser.lastName ? " " + senderUser.lastName : ""}`.trim() || null
              : null,
            authoredByTarget: !!targetId && sender === targetId,
            link: chatUsername ? `https://t.me/${chatUsername}/${m.id}` : this.msgLink("", internalId, m.id),
          });
        }
      } catch (e) {
        const msg = this.errText(e);
        if (AUTH_DEAD_RE.test(msg)) {
          this.authDead = true;
          return { ...empty, message: "Sessiya bekor qilingan — qayta login qiling" };
        }
        const m = /FLOOD_WAIT_(\d+)/.exec(msg);
        if (m) {
          const wait = Math.min(Number(m[1]) + 5, 60);
          queriesInfo.push({ q, count: 0, error: `FLOOD ${m[1]}s` });
          await sleep(wait * 1000);
        } else {
          queriesInfo.push({ q, count: 0, error: msg.slice(0, 60) });
        }
      }
      await sleep(900);
    }

    // Ismiga o'xshash ochiq chatlar (contacts.Search — read-only)
    const chatsNamedLike: TgNamedChat[] = [];
    const seenChats = new Set<string>();
    for (const q of [t.username, t.nameQuery].filter(Boolean).slice(0, 2)) {
      try {
        const res = await client.invoke(new Api.contacts.Search({ q: q as string, limit: 20 }));
        for (const ch of res.chats ?? []) {
          const u = ch.username ?? "";
          const key = u || `id:${ch.id}`;
          if (seenChats.has(key)) continue;
          seenChats.add(key);
          if (RELIGIOUS.test(ch.title ?? "") || RELIGIOUS.test(u)) {
            religiousSkipped++;
            continue;
          }
          chatsNamedLike.push({
            title: ch.title ?? "",
            username: u || null,
            kind: ch.broadcast === true ? "channel" : "group",
            members: ch.participantsCount ?? 0,
            link: u ? `https://t.me/${u}` : null,
          });
        }
      } catch {
        /* chat nomi qidiruvi muhim emas — davom */
      }
      await sleep(700);
    }

    found.sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      ok: true,
      queries: queriesInfo,
      found: found.slice(0, GLOBAL_MAX),
      chatsNamedLike: chatsNamedLike.slice(0, 30),
      religiousSkipped,
      targetId,
      targetUsername,
    };
  }

  private async runScan(t: TgTarget) {
    try {
      await this.ensureClient();
      this.log("Telegram bilan aloqa o'rnatildi");
    } catch (e) {
      this.log(`ULANISH XATOSI: ${((e as Error)?.message ?? String(e)).slice(0, 120)}`);
      this.scan.running = false;
      this.scan.finishedAt = new Date().toISOString();
      return;
    }

    // 1) Maqsad profilini aniqlash — from_id (o'zining yozgan xabarlari) uchun ID+hash kerak
    await this.resolveTargetIdentity(t);
    if (t.username || t.userId) await sleep(1000);

    // 2) Skan ro'yxati — diniy guruhlar O'TKAZILADI
    const groups = await db.telegramGroup.findMany({
      where: { religious: false },
      orderBy: { members: "desc" },
    });
    this.scan.total = groups.length;
    this.log(`Skan boshlandi: ${groups.length} ta ochiq guruh/kanal (diniylar chiqarildi)`);

    for (const g of groups) {
      if (this.scan.stopping) {
        this.log("Skan to'xtatildi (foydalanuvchi)");
        break;
      }
      this.scan.current = `@${g.username}`;
      const info = this.peerCache.get(g.username);
      let tgId = g.tgId ?? info?.id;
      let hash = g.accessHash ?? info?.accessHash;
      if ((!tgId || !hash) && !this.authDead) {
        // Peer yo'q — contacts.Search bilan yechib ko'ramiz (o'z-o'zidan davolash)
        try {
          const r = await this.resolvePeer(g.username);
          if (r) {
            tgId = r.id;
            hash = r.accessHash;
            await db.telegramGroup.update({
              where: { id: g.id },
              data: { tgId: r.id, accessHash: r.accessHash, members: r.members ?? g.members },
            });
            this.log(`@${g.username} — peer yechildi (${r.members ?? "?"} a'zo)`);
          }
        } catch (e) {
          const msg = String((e as Error)?.message ?? (e as { errorMessage?: string })?.errorMessage ?? "");
          if (/FLOOD_WAIT_(\d+)/.test(msg)) {
            this.log(`@${g.username} — peer yechishda FLOOD, o'tkazildi`);
          }
        }
      }
      if (!tgId || !hash) {
        await db.telegramGroup.update({
          where: { id: g.id },
          data: { lastStatus: "skipped", lastScanAt: new Date() },
        });
        this.scan.done++;
        this.scan.errors++;
        this.log(`@${g.username} — peer yo'q (resolve bo'lmagan) — o'tkazildi`);
        continue;
      }
      const peer = new Api.InputPeerChannel({ channelId: BigInt(tgId), accessHash: BigInt(hash) });

      let groupOk = true;

      const pushHit = (type: TgHit["type"], count: number, samples: TgSample[], msgs?: TgMsg[]) => {
        if (count <= 0 && (!msgs || msgs.length === 0)) return;
        this.scan.hits.push({
          group: `@${g.username}`,
          title: g.title,
          kind: g.kind,
          members: g.members,
          type,
          count,
          samples,
          ...(msgs && msgs.length > 0 ? { msgs } : {}),
        });
        this.log(`  HIT [${type}] @${g.username} — ${count} ta xabar`);
        this.saveSnapshot();
      };

      try {
        const internalId = String(g.tgId ?? tgId);
        // a) mention — @username tilga olinganmi (paginatsiya bilan)
        if (t.username) {
          const { count, messages: raw } = await this.searchAll(peer, `@${t.username}`, null, QUERY_MAX, (s) =>
            this.log(`@${g.username} — ${s}`)
          );
          pushHit("mention", count, this.samplesFrom(raw), this.buildMsgs(raw, g.username, internalId, 20));
          await sleep(700);
        }
        // b) ism bo'yicha — matnda ism uchraydi (kim yozganini tekshiramiz)
        if (t.nameQuery) {
          const { count, messages: raw } = await this.searchAll(peer, t.nameQuery, null, QUERY_MAX, (s) =>
            this.log(`@${g.username} — ${s}`)
          );
          if (raw.length > 0 && t.userId) {
            const selfWritten = raw.some(
              (m) => m.fromId?.className === "PeerUser" && String(m.fromId.userId) === t.userId
            );
            if (selfWritten) this.log(`  @${g.username} — ism HIT va MAQSADNING O'ZI yozgan!`);
          }
          pushHit("ism", count, this.samplesFrom(raw), this.buildMsgs(raw, g.username, internalId, 20));
          await sleep(700);
        }
        // c) MAQSADNING O'ZI YOZGAN XABARLAR — from_id bilan TO'LIQ paginatsiya (600 tagacha)
        if (t.userId && this.scan.targetProfile?.accessHash && this.scan.targetProfile.accessHash !== "0") {
          const fromId = new Api.InputPeerUser({
            userId: BigInt(this.scan.targetProfile.id),
            accessHash: BigInt(this.scan.targetProfile.accessHash),
          });
          const { count, messages: raw } = await this.searchAll(peer, "", fromId, FROM_ID_MAX, (s) =>
            this.log(`@${g.username} — ${s}`)
          );
          if (raw.length > 0) {
            const clipped = count > raw.length ? ` (${raw.length} tasi o'zbekcha ko'rsatildi)` : "";
            this.log(`  @${g.username} — maqsad yozgan ${count} ta xabar topildi${clipped}`);
          }
          pushHit("from_id", count || raw.length, this.samplesFrom(raw), this.buildMsgs(raw, g.username, internalId, 40));
          await sleep(700);
        }
        await db.telegramGroup.update({
          where: { id: g.id },
          data: { lastStatus: "ok", lastScanAt: new Date() },
        });
        this.scan.scanned++;
      } catch (e) {
        const rawMsg = String((e as Error)?.message ?? (e as { errorMessage?: string })?.errorMessage ?? "");
        const msg = rawMsg.slice(0, 60);
        if (AUTH_DEAD_RE.test(rawMsg)) {
          // Sessiya o'lgan — davom etishning ma'nosi yo'q
          this.authDead = true;
          this.scan.errors++;
          await db.telegramGroup.update({
            where: { id: g.id },
            data: { lastStatus: "error", lastScanAt: new Date() },
          });
          this.log("SESSIYA BEKOR QILINGAN — skan to'xtatildi, ilovada qayta login qiling");
          this.scan.done++;
          break;
        }
        if (/FLOOD/.test(msg)) {
          this.scan.floodSkips++;
          await db.telegramGroup.update({
            where: { id: g.id },
            data: { lastStatus: "flood", lastScanAt: new Date() },
          });
          this.log(`@${g.username} — FLOOD, o'tkazildi (keyinroq qayta ishga tushiring)`);
        } else {
          this.scan.errors++;
          await db.telegramGroup.update({
            where: { id: g.id },
            data: { lastStatus: "error", lastScanAt: new Date() },
          });
          this.log(`@${g.username} — xato: ${msg}`);
        }
        groupOk = false;
      }

      this.scan.done++;
      if (this.scan.done % 10 === 0 || this.scan.hits.length > 0) this.saveSnapshot();
      if (groupOk) await sleep(GROUP_PAUSE_MS);
    }

    this.scan.running = false;
    this.scan.stopping = false;
    this.scan.current = null;
    this.scan.finishedAt = new Date().toISOString();
    const totalHits = this.scan.hits.reduce((a, h) => a + h.count, 0);
    this.log(
      `TUGADI: ${this.scan.scanned}/${this.scan.total} guruh, ${this.scan.hits.length} ta hit (${totalHits} xabar), flood=${this.scan.floodSkips}, xato=${this.scan.errors}`
    );
    this.saveSnapshot();
  }

  // ---------- Sessiya/klient boshqaruvi ----------
  /** Login muvaffaqiyatli bo'lgach: eski klientni yopib, yangi sessiya bilan qayta ulanish */
  public resetClient(): void {
     
    const g = globalThis as any;
    try {
      void g.__tgClient?.disconnect?.();
    } catch {
      /* ignore */
    }
    g.__tgClient = null;
    this.client = null;
    this.authDead = false;
    this.connectError = null;
  }

  /** Ro'yxatdagi peer'i yo'q guruhlarni contacts.Search orqali yechish (read-only). FLOOD bo'lsa to'xtaydi. */
  public async resolveMissingPeers(
    max = 20
  ): Promise<{ resolved: number; notFound: number; remaining: number; flood: boolean; message: string }> {
    if (this.scan.running) {
      return { resolved: 0, notFound: 0, remaining: 0, flood: false, message: "Skan ishlab turibdi — tugagach urinib ko'ring" };
    }
    let client: AnyClient;
    try {
      client = await this.ensureClient();
    } catch (e) {
      return {
        resolved: 0,
        notFound: 0,
        remaining: 0,
        flood: false,
        message: `Ulanish xatosi: ${((e as Error)?.message ?? "").slice(0, 100)}`,
      };
    }
    const pending = await db.telegramGroup.findMany({
      where: { religious: false, OR: [{ tgId: null }, { accessHash: null }] },
      orderBy: { members: "desc" },
      take: max,
    });
    let resolved = 0;
    let notFound = 0;
    let flood = false;
    for (const g of pending) {
      try {
        const info = await this.resolvePeer(g.username);
        if (info) {
          await db.telegramGroup.update({
            where: { id: g.id },
            data: { tgId: info.id, accessHash: info.accessHash, members: info.members ?? g.members },
          });
          resolved++;
        } else {
          notFound++;
          await db.telegramGroup.update({
            where: { id: g.id },
            data: { lastStatus: "skipped", lastScanAt: new Date() },
          });
        }
      } catch (e) {
        const msg = String((e as Error)?.message ?? (e as { errorMessage?: string })?.errorMessage ?? "");
        if (AUTH_DEAD_RE.test(msg)) {
          this.authDead = true;
          flood = false;
          break;
        }
        if (/FLOOD_WAIT_(\d+)/.test(msg)) {
          flood = true;
          break;
        }
        notFound++;
      }
      await sleep(1500);
    }
    const remaining = await db.telegramGroup.count({
      where: { religious: false, OR: [{ tgId: null }, { accessHash: null }] },
    });
    let message = `${resolved} ta peer yechildi, ${notFound} ta topilmadi`;
    if (this.authDead) message = "Sessiya bekor qilingan — qayta login qiling";
    else if (flood) message += " — FLOOD cheklovi, keyinroq davom ettiring";
    void client;
    return { resolved, notFound, remaining, flood, message };
  }

  // ---------- Status (poll uchun — ulanishni TRIGGER QILMAYDI) ----------
  public status() {
    const { scan } = this;
    return {
      session: this.hasSession(),
      connected: this.isConnected(),
      connecting: this.isConnecting(),
      connectError: this.connectError,
      authDead: this.authDead,
      scan: {
        running: scan.running,
        stopping: scan.stopping,
        target: scan.target,
        targetProfile: scan.targetProfile,
        done: scan.done,
        total: scan.total,
        current: scan.current,
        hits: scan.hits,
        scanned: scan.scanned,
        floodSkips: scan.floodSkips,
        errors: scan.errors,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        log: scan.log.slice(-40),
      },
      lastScan: this.lastSnapshot,
    };
  }

  public clearLastScan() {
    this.lastSnapshot = null;
    try {
      fs.rmSync(SNAPSHOT_FILE, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// Global singleton (HMR'da ham saqlanadi). Kod o'zgarsa versiya ko'tariladi —
// eski instansiya (eski kod bilan) almashtiriladi, lekin ulangan klient
// globalThis.__tgClient'da qoladi va qayta ishlatiladi.
const TG_HUB_VERSION = 7;
 
const g = globalThis as any;
if (!g.__tgHub || g.__tgHubVersion !== TG_HUB_VERSION) {
  g.__tgHub = new TgHub();
  g.__tgHubVersion = TG_HUB_VERSION;
}
const hub = g.__tgHub as TgHub;
export default hub;
export const TG_POLL_SLEEP_MS = POLL_SLEEP_MS;
