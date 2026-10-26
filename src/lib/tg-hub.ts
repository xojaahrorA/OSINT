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
// eslint-disable-next-line
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

export interface TgHit {
  group: string; // @username
  title: string;
  kind: string; // channel | group
  members: number;
  type: "mention" | "ism" | "from_id";
  count: number;
  samples: TgSample[];
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

class TgHub {
  private client: AnyClient = null;
  private connecting: Promise<void> | null = null;
  private peerCache = loadPeerCache();
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
        // eslint-disable-next-line
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
    let info: PeerInfo | null = null;
    try {
      info = await this.resolvePeer(u);
    } catch (e) {
      const msg = ((e as Error)?.message ?? "").includes("FLOOD")
        ? "Telegram FLOOD cheklovi — 1-2 daqiqa kutib turing"
        : "Telegram bilan aloqa xatosi";
      return { ok: false, message: msg };
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

  private async searchOne(
    peer: unknown,
    q: string,
    fromId: unknown | null,
    limit = 100
  ): Promise<any> {
    const client = await this.ensureClient();
    return client.invoke(
      new Api.messages.Search({
        peer,
        q,
        fromId: fromId ?? undefined,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetId: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: BigInt(0),
      })
    );
  }

  private samplesFrom(res: { messages?: unknown[]; users?: unknown[] }): TgSample[] {
    const out: TgSample[] = [];
    const msgs = (res.messages ?? []).slice(0, 3);
    for (const m of msgs as any[]) {
      out.push({
        date: m?.date ? new Date(Number(m.date) * 1000).toISOString().slice(0, 10) : undefined,
        text: (m?.message ?? "").slice(0, 140) || undefined,
        sender: m?.fromId?.userId ? String(m.fromId.userId) : undefined,
      });
    }
    return out;
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

    // 1) Profil tekshiruv — username bo'lsa: aniq ID + accessHash olamiz (from_id uchun)
    if (t.username) {
      this.log(`Profil tekshirilmoqda: @${t.username}`);
      try {
        const client = await this.ensureClient();
        const res = await client.invoke(new Api.contacts.Search({ q: t.username, limit: 20 }));
        const u = (res.users ?? []).find((x: any) => (x.username ?? "").toLowerCase() === t.username);
        if (u) {
          this.scan.targetProfile = {
            id: String(u.id),
            username: u.username ?? null,
            name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
            bio: null,
            accessHash: u.accessHash?.toString() ?? "0",
          };
          try {
            const full = await client.invoke(
              new Api.users.GetFullUser({
                id: new Api.InputUser({
                  userId: BigInt(String(u.id)),
                  accessHash: BigInt(u.accessHash?.toString() ?? "0"),
                }),
              })
            );
            this.scan.targetProfile.bio = full?.fullUser?.about ?? null;
          } catch {
            /* bio bo'lmasa ham davom */
          }
          this.log(
            `Profil topildi: id=${this.scan.targetProfile.id}, ism="${this.scan.targetProfile.name}", bio="${(this.scan.targetProfile.bio ?? "yo'q").slice(0, 60)}"`
          );
        } else {
          this.log("Profil contacts.Search'da topilmadi — faqat matn qidiruvi ishlaydi");
        }
      } catch (e) {
        this.log(`Profil qidiruvi o'tkazib yuborildi: ${((e as Error)?.message ?? "").slice(0, 60)}`);
      }
      await sleep(1500);
    }

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
      const tgId = g.tgId ?? info?.id;
      const hash = g.accessHash ?? info?.accessHash;
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
      const doSearch = async (q: string, fromId: any): Promise<any> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await this.searchOne(peer, q, fromId);
          } catch (e) {
            const msg = String((e as Error)?.message ?? (e as { errorMessage?: string })?.errorMessage ?? "");
            const m = /FLOOD_WAIT_(\d+)/.exec(msg);
            if (m) {
              const wait = Math.min(Number(m[1]) + 5, 120);
              this.log(`@${g.username} — FLOOD ${m[1]}s → ${wait}s kutish`);
              await sleep(wait * 1000);
            } else {
              throw e;
            }
          }
        }
        throw new Error("FLOOD_RETRY_FAILED");
      };

      const pushHit = (type: TgHit["type"], count: number, samples: TgSample[]) => {
        if (count <= 0) return;
        this.scan.hits.push({
          group: `@${g.username}`,
          title: g.title,
          kind: g.kind,
          members: g.members,
          type,
          count,
          samples,
        });
        this.log(`  HIT [${type}] @${g.username} — ${count} ta xabar`);
        this.saveSnapshot();
      };

      try {
        // a) mention — @username tilga olinganmi
        if (t.username) {
          const res = await doSearch(`@${t.username}`, null);
          pushHit("mention", res.count ?? res.messages?.length ?? 0, this.samplesFrom(res));
          await sleep(700);
        }
        // b) ism bo'yicha — matnda ism uchraydi (tekshiruv sender bilan)
        if (t.nameQuery) {
          const res = await doSearch(t.nameQuery, null);
          const cnt = res.count ?? res.messages?.length ?? 0;
          const samples = this.samplesFrom(res);
          // Senderlar target bilan mosmi?
          if (cnt > 0 && t.userId) {
            const senderMatch = (res.users ?? []).some((u: any) => String(u?.id) === t.userId);
            if (senderMatch) this.log(`  ISM HIT + SENDER MOS @${g.username} — TEKSHIRUV`);
          }
          pushHit("ism", cnt, samples);
          await sleep(700);
        }
        // c) from_id — faqat real accessHash bo'lganda (hash=0 filtrni o'chirib qo'yadi!)
        if (t.userId && this.scan.targetProfile?.accessHash && this.scan.targetProfile.accessHash !== "0") {
          const fromId = new Api.InputPeerUser({
            userId: BigInt(this.scan.targetProfile.id),
            accessHash: BigInt(this.scan.targetProfile.accessHash),
          });
          const res = await doSearch("", fromId);
          pushHit("from_id", res.count ?? res.messages?.length ?? 0, this.samplesFrom(res));
          await sleep(700);
        }
        await db.telegramGroup.update({
          where: { id: g.id },
          data: { lastStatus: "ok", lastScanAt: new Date() },
        });
        this.scan.scanned++;
      } catch (e) {
        const msg = ((e as Error)?.message ?? "").slice(0, 60);
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

  // ---------- Status (poll uchun — ulanishni TRIGGER QILMAYDI) ----------
  public status() {
    const { scan } = this;
    return {
      session: this.hasSession(),
      connected: this.isConnected(),
      connecting: this.isConnecting(),
      connectError: this.connectError,
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
const TG_HUB_VERSION = 5;
// eslint-disable-next-line
const g = globalThis as any;
if (!g.__tgHub || g.__tgHubVersion !== TG_HUB_VERSION) {
  g.__tgHub = new TgHub();
  g.__tgHubVersion = TG_HUB_VERSION;
}
const hub = g.__tgHub as TgHub;
export default hub;
export const TG_POLL_SLEEP_MS = POLL_SLEEP_MS;
