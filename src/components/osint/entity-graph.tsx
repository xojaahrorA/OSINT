"use client";

// ===== Maltego uslubidagi bog'lanish grafigi — interaktiv vizualizatsiya =====
// Skaner topganlari bir-biriga ulanib, jonli force-directed tarmoqda
// ko'rsatiladi: maqsad markazda, atrofida topilgan sahifalar va ular
// ichidan ajratilgan entitetlar (email, telefon, username, domen, IP, ism).
// Imkoniyatlar: sudrash, zoom, pan, tugunni tortish, tanlab
// ta'kidlash, tur bo'yicha filtrlash va entitet bo'yicha to'g'ridan-to'g'ri
// qidiruv ishga tushirish («+» pivot kabi).
//
// ANIQLIK (v8) — isma to'qnashuvini boshqarish tizimi:
//   * Har tugun ismasi o'z ustuvorligi bilan tekshiriladi (tanlangan >
//     sichqoncha ostidagi > maqsad > entitet (vazn bo'yicha) > sahifa).
//   * Boshqa isma yoki tugun doirasi bilan kesishsa — isma YASHIRILADI,
//     grafdagi nomlar hech qachon ustma-ust tushmaydi.
//   * Ishmalar zoom darajasidan QAT'IY NAZAR ekran o'lchamida turadi
//     (counter-scale) va halo (kontur) bilan chiziqlar ustida ham o'qiladi.
//   * Itarish kuchi va masofalar kengaytirilgan — tugunlar jipslashmaydi.
//
// SILLIQLIK (v8):
//   * fitView / zoom tugmalari endi lerp animatsiya bilan silliq yuradi.
//   * Hover qilinganda qo'shni tugunlar va bog'lanishlar darhol yonadi.
//   * Yangi tugunlar yumshoq kirish animatsiyasi bilan paydo bo'ladi.
//   * Bog'lanishlar yengil egri chiziqlar — kesishishlar o'qiladigan.
//   * Tugunlar radial gradient + maqsad atrofida glow, fon nuqtali to'r.
//
// Ma'lumot modeli: src/lib/entity-graph.ts

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AtSign,
  Building2,
  Globe,
  Mail,
  Maximize2,
  Minus,
  Network as NetworkIcon,
  Orbit,
  Phone,
  PinOff,
  Plus,
  Radar,
  RefreshCcw,
  Search,
  User,
  Waypoints,
  X,
  ExternalLink,
  type LucideProps,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  buildEntityGraph,
  type GraphNode,
  type GraphNodeKind,
} from "@/lib/entity-graph";
import type { ModuleResult, TargetType } from "@/lib/osint";

const KIND_COLOR: Record<GraphNodeKind, string> = {
  target: "#34d399",
  username: "#38bdf8",
  email: "#fbbf24",
  phone: "#a78bfa",
  name: "#fb7185",
  domain: "#2dd4bf",
  ip: "#fb923c",
  company: "#e879f9",
  result: "#64748b",
};

const KIND_LABEL: Record<GraphNodeKind, string> = {
  target: "Maqsad",
  result: "Sahifa",
  username: "Username",
  email: "Email",
  phone: "Telefon",
  name: "Ism",
  domain: "Domen",
  ip: "IP",
  company: "Kompaniya",
};

const KIND_ICON: Record<Exclude<GraphNodeKind, "result">, React.ComponentType<LucideProps>> = {
  target: Radar,
  username: AtSign,
  email: Mail,
  phone: Phone,
  name: User,
  domain: Globe,
  ip: NetworkIcon,
  company: Building2,
};

/** Filtr chip'larida ko'rinadigan turlar (maqsad doim ko'rinadi) */
const FILTER_KINDS: GraphNodeKind[] = ["result", "username", "email", "phone", "name", "domain", "ip", "company"];

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

const REPULSION = 3200; // v8: 2600 → 3200 — tugunlar jipslashmaydi
const REPEL_CUT2 = 115600; // 340px² gacha itarish sezilarli (avval 300px)
const REST = { found: 185, mentions: 128, linked: 150 } as const;
const STRENGTH = { found: 0.045, mentions: 0.06, linked: 0.03 } as const;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Rangni ochish/qoraylash (amt: -1..1) — gradient uchun */
function shade(hex: string, amt: number) {
  const num = parseInt(hex.replace("#", ""), 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Ikkala nuqta orasida yengil egri chiziq (quadratic) */
function curvePath(sx: number, sy: number, tx: number, ty: number) {
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.hypot(dx, dy) || 1;
  const off = Math.min(d * 0.1, 26);
  const cx = (sx + tx) / 2 - (dy / d) * off;
  const cy = (sy + ty) / 2 + (dx / d) * off;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)}`;
}

/** Komponent darajasida isma uzunligi — grafdagi nomlar ixcham turadi */
const truncLabel = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxesOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Isma MARKAZI doira ichiga kirdimi — burchak tegishi ruxsat etiladi
 *  (halo bilan o'qiladigan; qattiq tekshiruv ismalarni ortiqcha yashirardi) */
function boxHitsCircle(b: Box, cx: number, cy: number, r: number) {
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Bitta fizika qadami — itarish, prujina, gravitatsiya va integratsiya */
function stepSim(
  nodes: GraphNode[],
  links: { source: string; target: string; kind: "found" | "mentions" | "linked" }[],
  pos: Map<string, P>,
  alpha: number
) {
  // 1) Itarish (har juftlik — tugunlar ≤ ~130, tez)
  for (let i = 0; i < nodes.length; i++) {
    const a = pos.get(nodes[i].id);
    if (!a) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = pos.get(nodes[j].id);
      if (!b) continue;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = dx * dx + dy * dy + 0.01;
      }
      if (d2 > REPEL_CUT2) continue; // uzoq — kuch sezilarli emas
      const f = (REPULSION * alpha) / d2;
      const fx = dx * f;
      const fy = dy * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  // 2) Prujinalar — bog'lanishlarni ideal uzunlikka tortish
  for (const l of links) {
    const s = pos.get(l.source);
    const t = pos.get(l.target);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - REST[l.kind]) / d) * STRENGTH[l.kind] * alpha;
    const fx = dx * f;
    const fy = dy * f;
    s.vx += fx;
    s.vy += fy;
    t.vx -= fx;
    t.vy -= fy;
  }
  // 3) Gravitatsiya va integratsiya
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const g = n.kind === "target" ? 0.16 : 0.04;
    p.vx += -p.x * g * alpha;
    p.vy += -p.y * g * alpha;
    if (p.fx !== undefined && p.fy !== undefined) {
      p.x = p.fx;
      p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
    } else {
      p.vx *= 0.85;
      p.vy *= 0.85;
      const v = Math.hypot(p.vx, p.vy);
      // Tezlik clamp pastroq — tugunlar muvozanat atrofida tebranib qaltiramaydi
      if (v > 5.5) {
        p.vx = (p.vx / v) * 5.5;
        p.vy = (p.vy / v) * 5.5;
      }
      // Deyarli turg'un tugunni to'xtatamiz — mikro-qaltirash yo'qoladi
      if (v < 0.06 && alpha < 0.08) {
        p.vx = 0;
        p.vy = 0;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
  }
}

const GRAPH_CSS = `
.eg-edge { transition: stroke-opacity .25s ease, stroke-width .25s ease; }
.eg-node-g { transition: opacity .25s ease; }
.eg-node-in {
  animation: eg-node-in .38s cubic-bezier(.22,1,.36,1) both;
  transform-box: fill-box; transform-origin: center;
}
@keyframes eg-node-in { from { opacity: 0; transform: scale(.35); } to { opacity: 1; transform: scale(1); } }
.eg-hoverable { transition: transform .18s ease; transform-box: fill-box; transform-origin: center; }
.eg-node-g:hover .eg-hoverable { transform: scale(1.12); }
.eg-sel-ring { animation: eg-ring 1.7s ease-in-out infinite; }
@keyframes eg-ring { 0%, 100% { opacity: .85; } 50% { opacity: .3; } }
.eg-panel-in { animation: eg-panel .28s cubic-bezier(.22,1,.36,1) both; }
@keyframes eg-panel { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.eg-label { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
`;

export function EntityGraph({
  target,
  modules,
  busy,
  searchedKeys,
  onSearchEntity,
}: {
  target: { type: TargetType; query: string };
  modules: ModuleResult[];
  busy: boolean;
  searchedKeys: Set<string>;
  onSearchEntity: (kind: TargetType, value: string) => void;
}) {
  const targetType = target.type;
  const targetQuery = target.query;
  const graph = useMemo(
    () => buildEntityGraph({ type: targetType, query: targetQuery }, modules),
    [targetType, targetQuery, modules]
  );

  const [hiddenKinds, setHiddenKinds] = useState<Set<GraphNodeKind>>(new Set());
  const visible = useMemo(() => {
    if (hiddenKinds.size === 0) return graph;
    const nodes = graph.nodes.filter(
      (n) => n.kind === "target" || !hiddenKinds.has(n.kind)
    );
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target));
    return { ...graph, nodes, links };
  }, [graph, hiddenKinds]);

  // Fizika holati — pozitsiyalar FAQAT ref'da yuritadi. DOM imperativ yangilanadi:
  // har kadrda React re-render bo'lsa, 75+ tugun reconciliation qaltirash hosil
  // qilardi (avvalgi posSnap state yondashuvi qaltirashning asosiy sababi edi).
  const posRef = useRef<Map<string, P>>(new Map());
  const alphaRef = useRef(0);
  const rafRef = useRef(0);
  const dataRef = useRef(visible);

  useEffect(() => {
    dataRef.current = visible;
  }, [visible]);

  // SVG element ref'lari — rAF loop ularni imperativ yangilaydi
  const nodeElsRef = useRef(new Map<string, SVGGElement>());
  const linkElsRef = useRef(new Map<string, SVGPathElement>());
  const labelElsRef = useRef(new Map<string, SVGTextElement>());
  const viewportRef = useRef<SVGGElement | null>(null);

  // Ko'rinish (pan/zoom) — faqat ref; DOM'ga setAttribute orqali qo'llanadi
  // (re-render'siz — zoom va pan silliq 60fps)
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const animRef = useRef(0); // view lerp animatsiyasi
  const sizeRef = useRef({ w: 800, h: 480 });
  // Zoom 1.35'dan oshsa sahifa yorliqlari ko'rinadi — chegara kesilgandagina re-render
  const labelZoomRef = useRef(false);
  const [labelZoom, setLabelZoom] = useState(false);

  const applyView = useCallback(() => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    viewportRef.current?.setAttribute(
      "transform",
      `translate(${w / 2 + v.x} ${h / 2 + v.y}) scale(${v.k})`
    );
    // v8: esik 1.35 → 1.0 — ismalar zoom'dan qat'iy nazar ekran o'lchamida
    // o'qiladigan bo'lgani uchun sahifa nomlari ham iliqroq yoqiladi
    const shouldLabels = v.k > 1.0;
    if (shouldLabels !== labelZoomRef.current) {
      labelZoomRef.current = shouldLabels;
      setLabelZoom(shouldLabels);
    }
  }, []);

  // Barcha tugun/bog'lanish pozitsiyalarini DOM'ga yozish (paint oldidan ham)
  const syncAll = useCallback(() => {
    const pos = posRef.current;
    for (const [id, el] of nodeElsRef.current) {
      const p = pos.get(id);
      if (p) el.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
    }
    for (const l of dataRef.current.links) {
      const el = linkElsRef.current.get(`${l.source}|${l.target}|${l.kind}`);
      if (!el) continue;
      const s = pos.get(l.source);
      const t = pos.get(l.target);
      if (!s || !t) continue;
      el.setAttribute("d", curvePath(s.x, s.y, t.x, t.y));
    }
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Maltego "Pin Entities": tortib qo'yilgan tugunlar o'sha joyda qoladi.
  // Set faqat pin holati o'zgarganda yangilanadi — har kadrda emas.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const userMovedRef = useRef(false);

  // Tanlash/hover ref'lari — isma to'qnashuvi rAF ichida state'siz o'qiydi
  const selectedRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  const nodeR = useCallback((n: GraphNode) => {
    if (n.kind === "target") return 22;
    if (n.kind === "result") return 7 + Math.min(n.weight, 5);
    return 12 + Math.min(n.weight, 8) * 0.9;
  }, []);

  /**
   * ISMA TO'QNASUVINI BOSHQARISH (v8 asosiy yutuq).
   * Har isma uchun ekran o'lchamidagi quti hisoblanadi (zoom counter-scale
   * bilan) va ustuvorlik bo'yicha joylashtiriladi: tanlangan > hover >
   * maqsad > entitet (vazn) > sahifa. Boshqa isma yoki tugun doirasi bilan
   * kesishsa — isma yashiriladi. Nomlar hech qachon ustma-ust tushmaydi.
   */
  const resolveLabels = useCallback(
    (force = false) => {
      const pos = posRef.current;
      const nodes = dataRef.current.nodes;
      const k = viewRef.current.k || 1;
      const sel = selectedRef.current;
      const hov = hoverRef.current;
      const focus = sel ?? hov;

      // Focus faol bo'lsa — qo'shni bo'lmaganlar ismalari yashirinadi
      let focusSet: Set<string> | null = null;
      if (focus) {
        focusSet = new Set([focus]);
        for (const l of dataRef.current.links) {
          if (l.source === focus) focusSet.add(l.target);
          if (l.target === focus) focusSet.add(l.source);
        }
      }

      // Tugun doiralari — isma ularning ustiga tushmasligi kerak
      const circles: { id: string; x: number; y: number; r: number }[] = [];
      for (const n of nodes) {
        const p = pos.get(n.id);
        if (!p) continue;
        circles.push({ id: n.id, x: p.x, y: p.y, r: nodeR(n) + 2 });
      }

      interface Cand {
        id: string;
        el: SVGTextElement;
        prio: number;
        weight: number;
        // Ikkala pozitsiya: past (standart) va yuqori (pastga sig'masa)
        below: { off: number; box: Box };
        above: { off: number; box: Box };
      }
      const cands: Cand[] = [];
      nodes.forEach((n) => {
        const p = pos.get(n.id);
        const el = labelElsRef.current.get(n.id);
        if (!p || !el) return;
        const r = nodeR(n);
        const fs = n.kind === "target" ? 12 : 10;
        // Zoom'dan qat'iy nazar ekran o'lchamida: counter-scale + doira oldida 7px
        const inv = 1 / k;
        const off = r + 7 / k;
        const wFactor = n.kind === "target" ? 0.7 : 0.64;
        const w = n.label.length * fs * wFactor * inv;
        const h = (fs + 5) * inv;
        const below = { off, box: { x: p.x - w / 2, y: p.y + off - h * 0.72, w, h } };
        const above = { off: -off, box: { x: p.x - w / 2, y: p.y - off - h * 0.72, w, h } };
        const prio =
          n.id === sel ? 0 : n.id === hov ? 1 : n.kind === "target" ? 2 : n.kind === "result" ? 4 : 3;
        cands.push({ id: n.id, el, prio, weight: n.weight, below, above });
      });

      // Harakat davomida (alpha baland) to'qnashuvni kutamiz — isma
      // sakrab-yonib turishi (flicker) yo'q; halo vaqtincha o'qiladigan
      const settling = force || alphaRef.current < 0.25;

      cands.sort((a, b) => a.prio - b.prio || b.weight - a.weight);
      const taken: Box[] = [];
      // Isma joyini hal qilish: avval past, sig'masa yuqoriga qarataladi —
      // shunda zich klasterlarda ham ko'p ismalar ko'rinadi, hech biri ustma-ust tushmaydi
      const place = (c: Cand, side: { off: number; box: Box }): boolean => {
        for (const t of taken) {
          if (boxesOverlap(side.box, t)) return false;
        }
        for (const cir of circles) {
          if (cir.id === c.id) continue;
          if (boxHitsCircle(side.box, cir.x, cir.y, cir.r)) return false;
        }
        c.el.setAttribute(
          "transform",
          `translate(0 ${side.off.toFixed(2)}) scale(${(1 / k).toFixed(3)})`
        );
        taken.push(side.box);
        c.el.removeAttribute("display");
        return true;
      };
      for (const c of cands) {
        // Focus rejimi: aloqasiz tugun ismasi — yashirin
        if (focusSet && !focusSet.has(c.id) && c.id !== sel && c.id !== hov) {
          c.el.setAttribute("display", "none");
          continue;
        }
        if (!settling) {
          c.el.setAttribute(
            "transform",
            `translate(0 ${c.below.off.toFixed(2)}) scale(${(1 / k).toFixed(3)})`
          );
          c.el.removeAttribute("display");
          continue;
        }
        if (!place(c, c.below) && !place(c, c.above)) c.el.setAttribute("display", "none");
      }
    },
    [nodeR]
  );

  const startRaf = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      const dragging = dragRef.current?.id;
      if (dragging) alphaRef.current = Math.max(alphaRef.current, 0.3);
      const a = alphaRef.current;
      if (a < 0.015 && !dragging) {
        alphaRef.current = 0;
        rafRef.current = 0;
        // To'xtaganda qoldiq tezliklarni nolga tushiramiz — tugunlar jim qotadi
        for (const p of posRef.current.values()) {
          p.vx = 0;
          p.vy = 0;
        }
        // To'xtagan holda yakuniy isma to'qnashuvini hal qilamiz
        resolveLabels(true);
        return;
      }
      stepSim(dataRef.current.nodes, dataRef.current.links, posRef.current, Math.min(a, 1));
      // 0.975 decay — ~2.5s da to'liq tinchalik (uzoq tebranish yo'q)
      alphaRef.current = a * 0.975;
      // Imperativ DOM yangilash — React re-render YO'Q (silliq 60fps)
      syncAll();
      resolveLabels();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [syncAll, resolveLabels]);

  useEffect(() => {
    startRaf();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [startRaf]);

  // Konteyner o'lchami — ref'da yuritiladi, o'zgarganda viewport qayta qo'llanadi
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) {
        sizeRef.current = { w: Math.max(320, r.width), h: Math.max(300, r.height) };
        applyView();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyView]);

  // Ko'rinishni silliq o'tkazish — fitView/zoom sakramasdan lerp bilan yuradi.
  // animTargetRef: joriy animatsiya MANZILI — tez ketma-ket zoom bosishlarida
  // har safar noldan emas, oldingi manzildan davom etiladi (kuchayib boradi).
  const animTargetRef = useRef<{ x: number; y: number; k: number } | null>(null);
  const animateView = useCallback(
    (target: { x: number; y: number; k: number }, ms = 340) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animTargetRef.current = target;
      const from = { ...viewRef.current };
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = clamp((now - t0) / ms, 0, 1);
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
        viewRef.current = {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          k: from.k + (target.k - from.k) * e,
        };
        applyView();
        if (p < 1) {
          animRef.current = requestAnimationFrame(tick);
        } else {
          animRef.current = 0;
          animTargetRef.current = null;
        }
      };
      animRef.current = requestAnimationFrame(tick);
    },
    [applyView]
  );

  // Komponent yo'q qilinganda view animatsiyasini ham to'xtatamiz
  useEffect(
    () => () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    },
    []
  );

  const fitView = useCallback(() => {
    const { nodes } = dataRef.current;
    const pos = posRef.current;
    if (nodes.length < 2) {
      animateView({ x: 0, y: 0, k: 1 }, 240);
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const bw = Math.max(80, maxX - minX) + 150;
    const bh = Math.max(80, maxY - minY) + 170;
    const { w, h } = sizeRef.current;
    const k = clamp(Math.min(w / bw, h / bh), 0.35, 1.6);
    animateView({ x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k, k }, 380);
  }, [animateView]);

  const cancelViewAnim = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }
    animTargetRef.current = null;
  }, []);

  // Yangi tugunlarni spiral bo'ylab joylashtirish, eskilarni olib tashlash.
  // useLayoutEffect — pozitsiyalar paint'dan OLDIN DOM'ga yoziladi (bir kadrlik
  // (0,0)da turish flash'i bo'lmaydi). Faqat YANGI tugun qo'shilsa qayta isitiladi —
  // har modul yangilanishida butun graf qayta uchib chiqmasligi uchun.
  useLayoutEffect(() => {
    const pos = posRef.current;
    const ids = new Set<string>();
    let added = 0;
    visible.nodes.forEach((n, i) => {
      ids.add(n.id);
      if (!pos.has(n.id)) {
        const a = i * 2.399963;
        const r = 46 + Math.sqrt(i) * 36;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 });
        added++;
      }
    });
    for (const id of [...pos.keys()]) if (!ids.has(id)) pos.delete(id);
    if (added > 0) alphaRef.current = Math.max(alphaRef.current, 0.5);
    // Commit bo'lgan elementlarga pozitsiyalarni paint oldidan qo'llash
    syncAll();
    resolveLabels(true);
    applyView();
    startRaf();
    // Foydalanuvchi pan/zoom qilmagan bo'lsa — avtomatik joylashtirish.
    // Taymer OTILGAN paytda ham qayta tekshiramiz: aks holda skan tugashi
    // bilan rejalashtirilgan fitView foydalanuvchi zoomidan keyin ham
    // otib, view'ni orqaga tortardi ("graf qaytib qoladi" xatosi).
    if (!userMovedRef.current && visible.nodes.length >= 4) {
      const t = setTimeout(() => {
        if (!userMovedRef.current) fitView();
      }, 350);
      return () => clearTimeout(t);
    }
  }, [visible, startRaf, fitView, syncAll, resolveLabels, applyView]);

  const scatter = useCallback(() => {
    const pos = posRef.current;
    visible.nodes.forEach((n, i) => {
      const a = i * 2.399963;
      const r = 46 + Math.sqrt(i) * 36;
      pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 });
    });
    userMovedRef.current = false;
    setPinnedIds(new Set());
    alphaRef.current = 1;
    syncAll();
    resolveLabels(true);
    startRaf();
    setTimeout(fitView, 500);
  }, [visible, startRaf, fitView, syncAll, resolveLabels]);

  // Maltego "Circular Layout": maqsad markazda, entitetlar ichki doirada,
  // sahifalar tashqi doirada. Maltego'da avtomatik joylashuvlar BIR MARTALIK —
  // natija joyida qoladi (fizika ishga tushmaydi), shuning uchun hammasi
  // qotqichlanadi. "Barchasini bo'shatish" organik harakatni qaytaradi.
  const circleLayout = useCallback(() => {
    const nodes = dataRef.current.nodes;
    const pos = posRef.current;
    const place = (arr: GraphNode[], radius: number) => {
      arr.forEach((n, i) => {
        const a = (i / Math.max(arr.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        pos.set(n.id, { x, y, vx: 0, vy: 0, fx: x, fy: y });
      });
    };
    const target = nodes.find((n) => n.kind === "target");
    if (target) pos.set(target.id, { x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 });
    const entities = nodes.filter((n) => n.kind !== "target" && n.kind !== "result");
    const results = nodes.filter((n) => n.kind === "result");
    // v8: radiuslar kengaytirilgan — ismalar doira bo'ylab sig'inadi
    place(entities, 170 + Math.min(entities.length, 14) * 9);
    place(results, 340 + Math.min(results.length, 18) * 10);
    setPinnedIds(new Set(nodes.map((n) => n.id)));
    userMovedRef.current = false;
    // Fizikani to'xtatamiz — deterministik layout joyida qoladi
    alphaRef.current = 0;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    syncAll();
    // Doira layoutida ham ismalar ustma-ust tushmasin
    resolveLabels(true);
    fitView();
  }, [fitView, syncAll, resolveLabels]);

  // Bir tugunning qotqichini bo'shatish — yana fizika bo'yicha harakatlanadi
  const unpinNode = useCallback(
    (id: string) => {
      const p = posRef.current.get(id);
      if (p && (p.fx !== undefined || p.fy !== undefined)) {
        posRef.current.set(id, { x: p.x, y: p.y, vx: 0, vy: 0 });
        alphaRef.current = Math.max(alphaRef.current, 0.5);
        startRaf();
      }
      setPinnedIds((cur) => {
        if (!cur.has(id)) return cur;
        const n = new Set(cur);
        n.delete(id);
        return n;
      });
    },
    [startRaf]
  );

  // Maltego "Unpin All" — barcha qotqichlar bo'shaydi, organik harakat qaytadi
  const unpinAll = useCallback(() => {
    let any = false;
    for (const [id, p] of posRef.current) {
      if (p.fx !== undefined || p.fy !== undefined) {
        posRef.current.set(id, { x: p.x, y: p.y, vx: 0, vy: 0 });
        any = true;
      }
    }
    if (any) {
      alphaRef.current = Math.max(alphaRef.current, 0.5);
      startRaf();
    }
    setPinnedIds(new Set());
  }, [startRaf]);

  // Zoom g'ildirakda — kursor ostidagi nuqta joyida qoladi.
  // Konteynerga biriktiriladi (svg bo'sh holatda ham ishlashi uchun)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelViewAnim();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const v = viewRef.current;
      const k2 = clamp(v.k * Math.exp(-e.deltaY * 0.0012), 0.35, 3.2);
      const s = k2 / v.k;
      userMovedRef.current = true;
      viewRef.current = { x: mx - (mx - v.x) * s, y: my - (my - v.y) * s, k: k2 };
      applyView();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyView, cancelViewAnim]);

  const toGraph = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - v.x) / v.k,
      y: (clientY - rect.top - rect.height / 2 - v.y) / v.k,
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Pointer down va capture orasida pointer bo'shatilsa (noyob poyga)
    // InvalidPointerId tashlanadi — butun handler o'lmasligi uchun himoyalangan
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture muhim emas — drag/pan window darajasida ham ishlaydi */
    }
    const nodeEl = (e.target as Element).closest?.("[data-node-id]");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id") ?? "";
      dragRef.current = { id, moved: false };
      const p = posRef.current.get(id);
      const g = toGraph(e.clientX, e.clientY);
      if (p) posRef.current.set(id, { ...p, fx: g.x, fy: g.y, vx: 0, vy: 0 });
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      startRaf();
    } else {
      cancelViewAnim();
      const v = viewRef.current;
      panRef.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const g = toGraph(e.clientX, e.clientY);
      const p = posRef.current.get(drag.id);
      if (p) {
        if (Math.abs(p.fx! - g.x) > 1 || Math.abs(p.fy! - g.y) > 1) drag.moved = true;
        posRef.current.set(drag.id, { ...p, fx: g.x, fy: g.y });
      }
      return;
    }
    const pan = panRef.current;
    if (pan) {
      const dx = e.clientX - pan.sx;
      const dy = e.clientY - pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        pan.moved = true;
        userMovedRef.current = true;
      }
      viewRef.current = { x: pan.vx + dx, y: pan.vy + dy, k: viewRef.current.k };
      applyView();
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag) {
      const p = posRef.current.get(drag.id);
      if (p) {
        if (drag.moved) {
          // MALTEGO XULQI: tortib qo'yilgan tugun o'sha joyda QOTQICHLANADI —
          // prujina uni orqaga qaytarmaydi. Ikki marta bosish yoki
          // «Barchasini bo'shatish» bilan yana bo'shatiladi.
          posRef.current.set(drag.id, { x: p.x, y: p.y, vx: 0, vy: 0, fx: p.x, fy: p.y });
          setPinnedIds((cur) => {
            if (cur.has(drag.id)) return cur;
            const n = new Set(cur);
            n.add(drag.id);
            return n;
          });
        } else {
          // Sudrashsiz bosish — tanlash; mavjud qotqich saqlanadi
          posRef.current.set(drag.id, { x: p.x, y: p.y, vx: 0, vy: 0, fx: p.fx, fy: p.fy });
          setSelected((cur) => (cur === drag.id ? null : drag.id));
        }
      }
      dragRef.current = null;
      return;
    }
    const pan = panRef.current;
    if (pan && !pan.moved) setSelected(null);
    panRef.current = null;
  };

  // Qo'shni tugunlar — tanlanganda ham, hover qilinganda ham yonadi (v8)
  const focusId = selected ?? hover;
  const neighbors = useMemo(() => {
    if (!focusId) return null;
    const set = new Set([focusId]);
    for (const l of visible.links) {
      if (l.source === focusId) set.add(l.target);
      if (l.target === focusId) set.add(l.source);
    }
    return set;
  }, [focusId, visible]);

  const nodeById = useMemo(() => new Map(visible.nodes.map((n) => [n.id, n])), [visible]);
  const kindCounts = useMemo(() => {
    const m = new Map<GraphNodeKind, number>();
    for (const n of visible.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
    return m;
  }, [visible]);
  const selectedNode = selected ? nodeById.get(selected) ?? null : null;

  // Hover/selection o'zgarganda fizika turg'un bo'lsa ham ismalarni
  // darhol qayta hal qilamiz (loop ishlamayotgan bo'lishi mumkin)
  useEffect(() => {
    syncAll();
    resolveLabels(true);
  }, [hover, selected, labelZoom, syncAll, resolveLabels]);

  const toggleKind = (k: GraphNodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const zoomBy = (factor: number) => {
    // Joriy animatsiya manzilidan davom etamiz — tez bosishlar to'planadi
    const base = animTargetRef.current ?? viewRef.current;
    const k2 = clamp(base.k * factor, 0.35, 3.2);
    const s = k2 / base.k;
    userMovedRef.current = true;
    animateView({ x: base.x * s, y: base.y * s, k: k2 }, 200);
  };

  const searchKey =
    selectedNode && selectedNode.kind !== "target" && selectedNode.kind !== "result"
      ? `${selectedNode.kind}:${selectedNode.label}`
      : null;

  return (
    <Card className="overflow-hidden p-0">
      {/* Sarlavha */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Waypoints className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium">Bog&apos;lanish grafigi</span>
        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border border-primary/25">
          Maltego uslubi
        </Badge>
        {busy && (
          <span className="text-[10px] text-primary flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            jonli yangilanmoqda
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {visible.nodes.length} tugun · {visible.links.length} bog&apos;lanish
          {pinnedIds.size > 0 && <> · {pinnedIds.size} qadalgan</>}
        </span>
      </div>

      {/* Filtr chiplari — legenda vazifasini ham bajaradi */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {FILTER_KINDS.filter((k) => (kindCounts.get(k) ?? 0) > 0).map((k) => {
          const hidden = hiddenKinds.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                hidden
                  ? "opacity-40 border-transparent bg-secondary/30 text-muted-foreground"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
              <span className="tabular-nums text-muted-foreground">{kindCounts.get(k)}</span>
            </button>
          );
        })}
        {(graph.droppedResults > 0 || graph.droppedEntities > 0) && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            +{graph.droppedResults} sahifa, +{graph.droppedEntities} iz grafdan tashqarida
          </span>
        )}
      </div>

      {/* Graf maydoni */}
      <div
        ref={containerRef}
        className="relative h-[440px] md:h-[560px]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(56,189,248,0.055), transparent 68%)",
        }}
      >
        {visible.nodes.length <= 1 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <NetworkIcon className="w-7 h-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Graf uchun natija hali yo&apos;q — skaner boshlang, topilmalar
              bir-biriga ulanib shu yerda paydo bo&apos;ladi.
            </p>
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              // MUHIM: brauzer tugun ustida sudrash boshlanganda NATIVE
              // drag-and-drop'ni o'zlashtirib oladi — pointercancel kelib,
              // pointer oqimi o'ladi (pointermove/pointerup hech qachon
              // kelmaydi, dragRef qotib qoladi). dragstart'ni bekor qilish
              // bilan native drag hech qachon boshlanmaydi.
              onDragStart={(e) => e.preventDefault()}
              // Tashqi sabablarga ko'ra (masalan OS darajadagi jamlash)
              // pointercancel kelsa — drag/pan holatini tozalaymiz
              onPointerCancel={() => {
                dragRef.current = null;
                panRef.current = null;
              }}
              onPointerLeave={() => {
                dragRef.current = null;
                panRef.current = null;
                setHover(null);
              }}
            >
              <style>{GRAPH_CSS}</style>
              <defs>
                {/* Har tur uchun radial gradient — tugunlar hajmli ko'rinadi */}
                {(Object.keys(KIND_COLOR) as GraphNodeKind[]).map((k) => (
                  <radialGradient key={k} id={`eg-${k}`} cx="35%" cy="30%" r="78%">
                    <stop offset="0%" stopColor={shade(KIND_COLOR[k], 0.38)} />
                    <stop offset="55%" stopColor={KIND_COLOR[k]} />
                    <stop offset="100%" stopColor={shade(KIND_COLOR[k], -0.32)} />
                  </radialGradient>
                ))}
                {/* Maqsad atrofidagi yumshoq glow */}
                <filter id="eg-glow" x="-90%" y="-90%" width="280%" height="280%">
                  <feGaussianBlur stdDeviation="3.4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Nuqtali to'r — pan/zoom bilan yashaydi, kanvas his qilinadi */}
                <pattern id="eg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
                  <circle cx="1.3" cy="1.3" r="1.3" fill="rgba(148,163,184,0.10)" />
                </pattern>
              </defs>
              <g ref={viewportRef}>
                {/* Fon — pan uchun tutash maydon + nuqtali to'r */}
                <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#eg-dots)" />
                {/* Bog'lanishlar — egri chiziqlar, pozitsiyalar imperativ (syncAll) */}
                {visible.links.map((l) => {
                  const lKey = `${l.source}|${l.target}|${l.kind}`;
                  const hi = neighbors ? neighbors.has(l.source) && neighbors.has(l.target) : false;
                  const dim = neighbors ? (hi ? 1 : 0.07) : 1;
                  const stroke =
                    l.kind === "mentions"
                      ? KIND_COLOR[nodeById.get(l.target)?.kind ?? "result"]
                      : l.kind === "linked"
                        ? "#94a3b8"
                        : "#3f4f63";
                  return (
                    <path
                      key={lKey}
                      ref={(el) => {
                        if (el) linkElsRef.current.set(lKey, el);
                        else linkElsRef.current.delete(lKey);
                      }}
                      className="eg-edge"
                      fill="none"
                      stroke={stroke}
                      strokeWidth={hi ? 1.9 : l.kind === "linked" ? 1.2 : 1.05}
                      strokeOpacity={hi ? 0.95 : (l.kind === "found" ? 0.3 : 0.38) * dim}
                      strokeDasharray={l.kind === "linked" ? "5 4" : undefined}
                    />
                  );
                })}
                {/* Tugunlar — transform imperativ (syncAll) yangilanadi */}
                {visible.nodes.map((n) => {
                  const r = nodeR(n);
                  const color = KIND_COLOR[n.kind];
                  const isHi = neighbors ? neighbors.has(n.id) : true;
                  const dim = neighbors ? (isHi ? 1 : 0.16) : 1;
                  const Icon = n.kind !== "result" ? KIND_ICON[n.kind] : null;
                  const showLabel = n.kind !== "result" || hover === n.id || selected === n.id || labelZoom;
                  const labelMax = n.kind === "target" ? 34 : n.kind === "result" ? 34 : 26;
                  const labelText = truncLabel(n.label, labelMax);
                  return (
                    <g
                      key={n.id}
                      ref={(el) => {
                        if (el) nodeElsRef.current.set(n.id, el);
                        else nodeElsRef.current.delete(n.id);
                      }}
                      data-node-id={n.id}
                      opacity={dim}
                      className="eg-node-g cursor-pointer"
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                      onDoubleClick={() => unpinNode(n.id)}
                    >
                      <title>
                        {n.label}
                        {pinnedIds.has(n.id) ? " (qadalgan — bo'shatish uchun ikki marta bosing)" : ""}
                      </title>
                      {selected === n.id && (
                        <circle
                          r={r + 5}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.6}
                          className="eg-sel-ring pointer-events-none"
                        />
                      )}
                      <g className="eg-node-in">
                        <g className="eg-hoverable">
                          {/* Maqsad — glow halosi bilan ajralib turadi */}
                          {n.kind === "target" && (
                            <circle
                              r={r + 6}
                              fill="none"
                              stroke={color}
                              strokeOpacity={0.4}
                              strokeWidth={1.4}
                              filter="url(#eg-glow)"
                              className="pointer-events-none"
                            />
                          )}
                          <circle
                            r={r}
                            fill={`url(#eg-${n.kind})`}
                            stroke={color}
                            strokeOpacity={0.45}
                            strokeWidth={1.1}
                          />
                          {pinnedIds.has(n.id) && (
                            <circle
                              cx={r * 0.72}
                              cy={-r * 0.72}
                              r={3.2}
                              fill="#f59e0b"
                              stroke="rgba(0,0,0,0.5)"
                              strokeWidth={1}
                              className="pointer-events-none"
                            />
                          )}
                          {Icon && (
                            <Icon
                              x={-r * 0.52}
                              y={-r * 0.52}
                              width={r * 1.04}
                              height={r * 1.04}
                              color="#0a1220"
                              strokeWidth={2.2}
                            />
                          )}
                        </g>
                      </g>
                      {showLabel && (
                        <text
                          ref={(el) => {
                            if (el) labelElsRef.current.set(n.id, el);
                            else labelElsRef.current.delete(n.id);
                          }}
                          className="eg-label pointer-events-none"
                          textAnchor="middle"
                          fontSize={n.kind === "target" ? 12 : 10}
                          fontWeight={n.kind === "target" ? 600 : 500}
                          fill={n.kind === "result" ? "#a8b6c8" : "#e6edf5"}
                          // Halo: isma chiziqlar/tugunlar ustidan o'tsa ham o'qiladi
                          stroke="#080d16"
                          strokeWidth={3}
                          strokeOpacity={0.85}
                          paintOrder="stroke"
                          strokeLinejoin="round"
                        >
                          {labelText}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Boshqaruv tugmalari */}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <Button variant="secondary" size="icon" className="h-7 w-7 transition-transform hover:scale-105" title="Kattalashtirish" onClick={() => zoomBy(1.25)}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="h-7 w-7 transition-transform hover:scale-105" title="Kichiklashtirish" onClick={() => zoomBy(0.8)}>
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 transition-transform hover:scale-105"
                title="Joylashtirish"
                onClick={() => {
                  userMovedRef.current = false;
                  fitView();
                }}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="h-7 w-7 transition-transform hover:scale-105" title="Qayta joylash (organik)" onClick={scatter}>
                <RefreshCcw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 transition-transform hover:scale-105"
                title="Doira bo'ylab joylash (Maltego circular layout)"
                onClick={circleLayout}
              >
                <Orbit className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 transition-transform hover:scale-105"
                title="Barcha qadalganlarni bo'shatish — organik harakat qaytadi"
                disabled={pinnedIds.size === 0}
                onClick={unpinAll}
              >
                <PinOff className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Ishoralar — pastki chapda, graf bilan ishlashni o'rgatadi */}
            <div className="pointer-events-none absolute bottom-2 left-2 hidden md:block text-[10px] leading-relaxed text-muted-foreground/60">
              Tortish — qadash · Ikki marta bosish — bo&apos;shatish · G&apos;ildirak — zoom ·
              Bosish — tafsilotlar
            </div>

            {/* Tanlangan tugun — tafsilotlar */}
            {selectedNode && (
              <div
                key={selectedNode.id}
                className="eg-panel-in absolute left-2 right-2 bottom-2 md:left-auto md:w-96 rounded-lg border bg-card/95 backdrop-blur p-3 shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[selectedNode.kind] }} />
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[selectedNode.kind]}
                  </span>
                  {selectedNode.kind === "target" && (
                    <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary border border-primary/25">
                      ildiz
                    </Badge>
                  )}
                  {neighbors && (
                    <Badge variant="secondary" className="text-[9px] font-normal bg-secondary/50 border border-transparent tabular-nums">
                      {Math.max(0, neighbors.size - 1)} bog&apos;lanish
                    </Badge>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSelected(null)}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-sm font-medium break-all">
                  {selectedNode.url ? (
                    <a
                      href={selectedNode.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary underline decoration-dotted underline-offset-2"
                    >
                      {selectedNode.label}
                    </a>
                  ) : (
                    selectedNode.label
                  )}
                </p>
                {selectedNode.sub && selectedNode.kind !== "result" && (
                  <p className="text-[11px] text-muted-foreground">{KIND_LABEL[selectedNode.sub as GraphNodeKind] ?? selectedNode.sub}</p>
                )}
                {selectedNode.kind === "result" && selectedNode.sub && (
                  <p className="text-[11px] text-muted-foreground">{selectedNode.sub}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {selectedNode.modules.map((m) => (
                    <Badge key={m} variant="secondary" className="text-[9px] font-normal bg-secondary/50 border border-transparent">
                      {m}
                    </Badge>
                  ))}
                  <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                    {selectedNode.kind === "result"
                      ? `${Math.max(0, selectedNode.weight - 1)} ta iz ajratilgan`
                      : `${selectedNode.weight} marta uchragan`}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  {selectedNode.kind === "result" && selectedNode.url && (
                    <a href={selectedNode.url} target="_blank" rel="noreferrer" className="flex-1">
                      <Button variant="secondary" size="sm" className="w-full h-7 text-xs gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Havolani ochish
                      </Button>
                    </a>
                  )}
                  {selectedNode.kind !== "target" && selectedNode.kind !== "result" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1 h-7 text-xs gap-1.5"
                        disabled={busy}
                        onClick={() => onSearchEntity(selectedNode.kind as TargetType, selectedNode.label)}
                      >
                        <Search className="w-3.5 h-3.5" />
                        Shu bo&apos;yicha qidirish
                      </Button>
                      {searchKey && searchedKeys.has(searchKey) && (
                        <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary border border-primary/25">
                          navbatda
                        </Badge>
                      )}
                    </>
                  )}
                  {pinnedIds.has(selectedNode.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5 text-amber-400 hover:text-amber-300"
                      onClick={() => unpinNode(selectedNode.id)}
                    >
                      <PinOff className="w-3.5 h-3.5" />
                      Bo&apos;shatish
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
