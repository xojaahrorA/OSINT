// ===== Maltego uslubidagi bog'lanish grafigi — ma'lumot modeli =====
// Skaner natijalaridan entitet grafigi yasaydi:
//   maqsad → natija sahifalar → ular ichidan ajratilgan entitetlar
//   (email, telefon, username, domen, IP, ism) va entitetlar orasidagi
//   bog'lanishlar (email ↔ korporativ domen, sahifa ↔ platforma profili).
// Toza funksiya — klient tomonda ishlaydi (server importi yo'q).
// Vizualizatsiya: src/components/osint/entity-graph.tsx

import {
  FREEMAIL_DOMAINS,
  PLATFORM_DOMAINS,
  PROFILE_URL_SEGMENTS,
  normalizeUrl,
  type ModuleResult,
  type SearchResultItem,
  type TargetType,
} from "@/lib/osint";
import {
  PROFILE_ENUM_MODULES,
  extractNames,
  isValidPhoneDigits,
} from "@/lib/intel";

export type GraphNodeKind = "target" | "result" | TargetType;

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Qisqa ko'rsatiladigan nom */
  label: string;
  /** Qo'shimcha qator (host, manba) */
  sub?: string;
  /** Natija sahifalari uchun havola */
  url?: string;
  /** Nechta bog'lanish / eslatib o'tish — tugun kattaligi shunga qarab */
  weight: number;
  /** Qaysi modullar orqali topilgan (≤3) */
  modules: string[];
}

export interface GraphLink {
  source: string;
  target: string;
  /** found: maqsad→sahifa · mentions: sahifa→entitet · linked: entitet→entitet */
  kind: "found" | "mentions" | "linked";
  /** Qaysi modul bog'landi (found/mentions uchun) */
  module?: string;
}

export interface EntityGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Chegaralar tufayli grafga kiritilmaganlar (foydalanuvchiga ko'rsatiladi) */
  droppedResults: number;
  droppedEntities: number;
}

/** Natija sahifalari chegarasi — graf ishlashi va o'qilishi uchun */
const RESULT_CAP = 72;
/** Har bir entitet turidan grafga tushadigan maksimal son */
const ENTITY_CAPS: Record<TargetType, number> = {
  username: 14,
  domain: 12,
  email: 8,
  phone: 6,
  name: 6,
  ip: 4,
  company: 6,
};
const ENTITY_ORDER: TargetType[] = ["email", "username", "phone", "name", "domain", "ip"];

const trunc = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

interface EntHit {
  kind: TargetType;
  value: string;
}

/** Bitta natijadan entitet nomzodlarini ajratadi (intel.ts bilan bir xil qoidalar) */
function extractEntitiesFromItem(item: SearchResultItem, moduleId?: string): EntHit[] {
  const out: EntHit[] = [];
  const seen = new Set<string>();
  const push = (kind: TargetType, raw: string) => {
    let value = raw.trim().toLowerCase();
    if (kind === "phone") value = "+" + value.replace(/\D/g, "");
    if (kind === "username") value = value.replace(/^@+/, "").replace(/[._-]+$/, "");
    if (kind === "domain") value = value.replace(/^www\./, "");
    if (!value || value.length < 3 || value.length > 254) return;
    if (kind === "username" && (/^\d+$/.test(value) || value.length > 30)) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value });
  };

  const text = `${item.name ?? ""} ${item.snippet ?? ""}`;
  const isProfileEnum = moduleId ? PROFILE_ENUM_MODULES.has(moduleId) : false;

  // 1) Email + korporativ domen
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const email = m[0].toLowerCase();
    push("email", email);
    const dom = email.split("@")[1] ?? "";
    if (dom && !FREEMAIL_DOMAINS.has(dom) && !PLATFORM_DOMAINS.has(dom)) push("domain", dom);
  }

  // 2) Telefon — faqat "+" bilan (xalqaro format)
  for (const m of text.matchAll(/\+\d[\d\s().-]{6,16}\d/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (isValidPhoneDigits(digits)) push("phone", digits);
  }

  // 3) IP manzil
  for (const m of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const parts = m[0].split(".").map(Number);
    if (parts.every((n) => n <= 255) && parts[0] >= 1 && parts[3] >= 1) push("ip", m[0]);
  }

  // 4) @username izohlari va t.me havolalari
  for (const m of text.matchAll(/(^|[\s(@:])@([a-z0-9._-]{3,30})/gi)) push("username", m[2]);
  for (const m of text.matchAll(/https?:\/\/(?:t|telegram)\.me\/([a-z0-9._-]{3,32})/gi)) {
    push("username", m[1]);
  }

  // 5) URL tahlili — platforma profil username'lari va alohida domenlar
  try {
    const u = new URL(item.url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    const isPlatform =
      PLATFORM_DOMAINS.has(h) || [...PLATFORM_DOMAINS].some((d) => h.endsWith(`.${d}`));
    if (!isProfileEnum && !isPlatform && !FREEMAIL_DOMAINS.has(h) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h)) {
      push("domain", h);
    }
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (
      isPlatform &&
      seg &&
      !PROFILE_URL_SEGMENTS.has(seg.toLowerCase()) &&
      /^[a-z0-9._-]{3,30}$/i.test(seg) &&
      !/^\d+$/.test(seg)
    ) {
      push("username", seg);
    }
  } catch {
    /* URL noto'g'ri — tashlab ketamiz */
  }

  // 6) Ism-familiya — sarlavha va snippet alohida
  for (const src of [item.name ?? "", item.snippet ?? ""]) {
    for (const n of extractNames(src)) push("name", n);
  }

  return out;
}

/**
 * Skaner natijalaridan entitet grafigini yasaydi.
 * Tuzilma: maqsad (markaz) → natija sahifalar → entitetlar.
 * Sahifalar chegarasi RESULT_CAP, entitetlar tur bo'yicha ENTITY_CAPS bilan
 * cheklanadi; entitetga ega sahifalar birinchi navbatda grafga tushadi.
 */
export function buildEntityGraph(
  target: { type: TargetType; query: string },
  modules: ModuleResult[]
): EntityGraph {
  const targetNode: GraphNode = {
    id: "target",
    kind: "target",
    label: trunc(target.query, 32),
    sub: target.type,
    weight: 0,
    modules: [],
  };

  // 1) Sahifa nomzodlari va entitetlar to'planadi
  interface ResCand {
    node: GraphNode;
    urlKey: string;
    ents: EntHit[];
    order: number;
  }
  const resCands: ResCand[] = [];
  const urlSeen = new Set<string>();
  let order = 0;

  const entAgg = new Map<string, { kind: TargetType; value: string; count: number; modules: Set<string> }>();

  for (const mod of modules) {
    if (mod.status !== "done") continue;
    for (const r of mod.results) {
      const urlKey = normalizeUrl(r.url);
      if (!urlKey || urlSeen.has(urlKey)) continue;
      urlSeen.add(urlKey);
      const ents = extractEntitiesFromItem(r, mod.moduleId);
      let host = "";
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        host = r.host_name ?? "";
      }
      resCands.push({
        node: {
          id: `res:${urlKey}`,
          kind: "result",
          label: trunc(r.name || host || urlKey, 42),
          sub: host,
          url: r.url,
          weight: 0,
          modules: [mod.moduleTitle],
        },
        urlKey,
        ents,
        order: order++,
      });
      for (const e of ents) {
        const key = `${e.kind}:${e.value}`;
        const ex = entAgg.get(key);
        if (ex) {
          ex.count++;
          ex.modules.add(mod.moduleTitle);
        } else {
          entAgg.set(key, { kind: e.kind, value: e.value, count: 1, modules: new Set([mod.moduleTitle]) });
        }
      }
    }
  }

  // 2) Entitetlar reytingi: ko'p uchraganlari birinchi, tur bo'yicha chegara
  const ranked = [...entAgg.values()].sort(
    (a, b) => b.count - a.count || ENTITY_ORDER.indexOf(a.kind) - ENTITY_ORDER.indexOf(b.kind) || a.value.localeCompare(b.value)
  );
  const perKind = new Map<TargetType, number>();
  const keptEnts: typeof ranked = [];
  let droppedEntities = 0;
  for (const e of ranked) {
    const used = perKind.get(e.kind) ?? 0;
    if (used >= ENTITY_CAPS[e.kind]) {
      droppedEntities++;
      continue;
    }
    perKind.set(e.kind, used + 1);
    keptEnts.push(e);
  }

  // 3) Sahifalar: entitetga ega'lari birinchi, keyin skaner tartibida
  const sorted = [...resCands].sort((a, b) => (b.ents.length > 0 ? 1 : 0) - (a.ents.length > 0 ? 1 : 0) || a.order - b.order);
  const keptResults = sorted.slice(0, RESULT_CAP);
  const droppedResults = Math.max(0, sorted.length - RESULT_CAP);

  const nodes: GraphNode[] = [targetNode];
  const links: GraphLink[] = [];
  const linkSeen = new Set<string>();
  const addLink = (source: string, target: string, kind: GraphLink["kind"], module?: string) => {
    const key = `${source}|${target}|${kind}`;
    if (source === target || linkSeen.has(key)) return;
    linkSeen.add(key);
    links.push({ source, target, kind, module });
  };

  // 4) Maqsad → sahifa bog'lanishlari
  for (const rc of keptResults) {
    rc.node.weight = 1;
    nodes.push(rc.node);
    addLink("target", rc.node.id, "found", rc.node.modules[0]);
  }

  // 5) Entitet tugunlari va sahifa → entitet bog'lanishlari
  const entNodeById = new Map<string, GraphNode>();
  for (const e of keptEnts) {
    const id = `ent:${e.kind}:${e.value}`;
    const node: GraphNode = {
      id,
      kind: e.kind,
      label: trunc(e.value, 30),
      sub: e.kind,
      weight: e.count,
      modules: [...e.modules].slice(0, 3),
    };
    entNodeById.set(id, node);
    nodes.push(node);
  }
  for (const rc of keptResults) {
    for (const e of rc.ents) {
      const id = `ent:${e.kind}:${e.value}`;
      const entNode = entNodeById.get(id);
      if (!entNode) continue;
      rc.node.weight++;
      addLink(rc.node.id, id, "mentions", rc.node.modules[0]);
    }
  }

  // 6) Entitet ↔ entitet: email ↔ korporativ domeni
  for (const e of keptEnts) {
    if (e.kind !== "email") continue;
    const dom = e.value.split("@")[1] ?? "";
    const domId = `ent:domain:${dom}`;
    if (entNodeById.has(domId)) addLink(`ent:email:${e.value}`, domId, "linked");
  }

  // 7) Izolyatsiya qilgan entitetlarni (bog'lanishsiz) olib tashlaymiz
  const linkedIds = new Set<string>();
  for (const l of links) {
    linkedIds.add(l.source);
    linkedIds.add(l.target);
  }
  const filtered = nodes.filter((n) => n.kind === "target" || n.kind === "result" || linkedIds.has(n.id));

  return { nodes: filtered, links, droppedResults, droppedEntities };
}
