"use client";

// ===== Maltego uslubidagi bog'lanish grafigi — interaktiv vizualizatsiya =====
// Skaner topganlari bir-biriga ulanib, jonli force-directed tarmoqda
// ko'rsatiladi: maqsad markazda, atrofida topilgan sahifalar va ular
// ichidan ajratilgan entitetlar (email, telefon, username, domen, IP, ism).
// Imkoniyatlar: sudrash, zoom, pan, tugunni tortish, tanlab
// ta'kidlash, tur bo'yicha filtrlash va entitet bo'yicha to'g'ridan-to'g'ri
// qidiruv ishga tushirish («+» pivot kabi).
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
  Globe,
  Mail,
  Maximize2,
  Minus,
  Network as NetworkIcon,
  Phone,
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
};

const KIND_ICON: Record<Exclude<GraphNodeKind, "result">, React.ComponentType<LucideProps>> = {
  target: Radar,
  username: AtSign,
  email: Mail,
  phone: Phone,
  name: User,
  domain: Globe,
  ip: NetworkIcon,
};

/** Filtr chip'larida ko'rinadigan turlar (maqsad doim ko'rinadi) */
const FILTER_KINDS: GraphNodeKind[] = ["result", "username", "email", "phone", "name", "domain", "ip"];

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

const REPULSION = 2600;
const REST = { found: 170, mentions: 115, linked: 150 } as const;
const STRENGTH = { found: 0.045, mentions: 0.06, linked: 0.03 } as const;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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
      if (d2 > 90000) continue; // 300px dan uzoq — kuch sezilarli emas
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
  const linkElsRef = useRef(new Map<string, SVGLineElement>());
  const viewportRef = useRef<SVGGElement | null>(null);

  // Ko'rinish (pan/zoom) — faqat ref; DOM'ga setAttribute orqali qo'llanadi
  // (re-render'siz — zoom va pan silliq 60fps)
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
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
    const shouldLabels = v.k > 1.35;
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
      el.setAttribute("x1", s.x.toFixed(2));
      el.setAttribute("y1", s.y.toFixed(2));
      el.setAttribute("x2", t.x.toFixed(2));
      el.setAttribute("y2", t.y.toFixed(2));
    }
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const userMovedRef = useRef(false);

  const nodeR = useCallback((n: GraphNode) => {
    if (n.kind === "target") return 22;
    if (n.kind === "result") return 7 + Math.min(n.weight, 5);
    return 12 + Math.min(n.weight, 8) * 0.9;
  }, []);

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
        return;
      }
      stepSim(dataRef.current.nodes, dataRef.current.links, posRef.current, Math.min(a, 1));
      // 0.975 decay — ~2.5s da to'liq tinchalik (uzoq tebranish yo'q)
      alphaRef.current = a * 0.975;
      // Imperativ DOM yangilash — React re-render YO'Q (silliq 60fps)
      syncAll();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [syncAll]);

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

  const fitView = useCallback(() => {
    const { nodes } = dataRef.current;
    const pos = posRef.current;
    if (nodes.length < 2) {
      viewRef.current = { x: 0, y: 0, k: 1 };
      applyView();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const bw = Math.max(80, maxX - minX) + 140;
    const bh = Math.max(80, maxY - minY) + 140;
    const { w, h } = sizeRef.current;
    const k = clamp(Math.min(w / bw, h / bh), 0.35, 1.6);
    viewRef.current = { x: (-((minX + maxX) / 2)) * k, y: (-((minY + maxY) / 2)) * k, k };
    applyView();
  }, [applyView]);

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
    applyView();
    startRaf();
    // Foydalanuvchi pan/zoom qilmagan bo'lsa — avtomatik joylashtirish
    if (!userMovedRef.current && visible.nodes.length >= 4) {
      const t = setTimeout(fitView, 350);
      return () => clearTimeout(t);
    }
  }, [visible, startRaf, fitView, syncAll, applyView]);

  const scatter = useCallback(() => {
    const pos = posRef.current;
    visible.nodes.forEach((n, i) => {
      const a = i * 2.399963;
      const r = 46 + Math.sqrt(i) * 36;
      pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 });
    });
    userMovedRef.current = false;
    alphaRef.current = 1;
    syncAll();
    startRaf();
    setTimeout(fitView, 500);
  }, [visible, startRaf, fitView, syncAll]);

  // Zoom g'ildirakda — kursor ostidagi nuqta joyida qoladi.
  // Konteynerga biriktiriladi (svg bo'sh holatda ham ishlashi uchun)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
  }, [applyView]);

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
    e.currentTarget.setPointerCapture(e.pointerId);
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
      if (p) posRef.current.set(drag.id, { x: p.x, y: p.y, vx: 0, vy: 0 });
      if (!drag.moved) setSelected((cur) => (cur === drag.id ? null : drag.id));
      dragRef.current = null;
      return;
    }
    const pan = panRef.current;
    if (pan && !pan.moved) setSelected(null);
    panRef.current = null;
  };

  // Qo'shni tugunlar — tanlanganda ta'kidlash
  const neighbors = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    for (const l of visible.links) {
      if (l.source === selected) set.add(l.target);
      if (l.target === selected) set.add(l.source);
    }
    return set;
  }, [selected, visible]);

  const nodeById = useMemo(() => new Map(visible.nodes.map((n) => [n.id, n])), [visible]);
  const kindCounts = useMemo(() => {
    const m = new Map<GraphNodeKind, number>();
    for (const n of visible.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
    return m;
  }, [visible]);
  const selectedNode = selected ? nodeById.get(selected) ?? null : null;

  const toggleKind = (k: GraphNodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    const k2 = clamp(v.k * factor, 0.35, 3.2);
    userMovedRef.current = true;
    viewRef.current = { x: v.x * (k2 / v.k), y: v.y * (k2 / v.k), k: k2 };
    applyView();
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
      <div ref={containerRef} className="relative h-[440px] md:h-[560px]">
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
              onPointerLeave={() => {
                dragRef.current = null;
                panRef.current = null;
                setHover(null);
              }}
            >
              <g ref={viewportRef}>
                {/* Fon — pan uchun tutash maydon */}
                <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent" />
                {/* Bog'lanishlar — pozitsiyalar imperativ (syncAll), React faqat strukturani boshqaradi */}
                {visible.links.map((l) => {
                  const lKey = `${l.source}|${l.target}|${l.kind}`;
                  const hi = neighbors ? neighbors.has(l.source) && neighbors.has(l.target) : false;
                  const dim = neighbors ? 0.08 : 1;
                  const stroke =
                    l.kind === "mentions"
                      ? KIND_COLOR[nodeById.get(l.target)?.kind ?? "result"]
                      : l.kind === "linked"
                        ? "#94a3b8"
                        : "#3f4f63";
                  return (
                    <line
                      key={lKey}
                      ref={(el) => {
                        if (el) linkElsRef.current.set(lKey, el);
                        else linkElsRef.current.delete(lKey);
                      }}
                      stroke={stroke}
                      strokeWidth={hi ? 1.6 : 1}
                      strokeOpacity={hi ? 0.9 : l.kind === "found" ? 0.3 * dim : 0.38 * dim}
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
                  return (
                    <g
                      key={n.id}
                      ref={(el) => {
                        if (el) nodeElsRef.current.set(n.id, el);
                        else nodeElsRef.current.delete(n.id);
                      }}
                      data-node-id={n.id}
                      opacity={dim}
                      className="cursor-pointer"
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                    >
                      <title>{n.label}</title>
                      {selected === n.id && (
                        <circle r={r + 4.5} fill="none" stroke={color} strokeWidth={1.6} opacity={0.8} />
                      )}
                      <circle
                        r={r}
                        fill={color}
                        stroke="rgba(255,255,255,0.18)"
                        strokeWidth={1}
                      />
                      {Icon && (
                        <Icon
                          x={-r * 0.52}
                          y={-r * 0.52}
                          width={r * 1.04}
                          height={r * 1.04}
                          color="#0a1510"
                          strokeWidth={2.2}
                        />
                      )}
                      {showLabel && (
                        <text
                          y={r + 12}
                          textAnchor="middle"
                          fontSize={n.kind === "target" ? 12 : 10}
                          fontWeight={n.kind === "target" ? 600 : 400}
                          fill={n.kind === "result" ? "#94a3b8" : "#e2e8f0"}
                          className="pointer-events-none"
                        >
                          {n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Boshqaruv tugmalari */}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <Button variant="secondary" size="icon" className="h-7 w-7" title="Kattalashtirish" onClick={() => zoomBy(1.25)}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="h-7 w-7" title="Kichiklashtirish" onClick={() => zoomBy(0.8)}>
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7"
                title="Joylashtirish"
                onClick={() => {
                  userMovedRef.current = false;
                  fitView();
                }}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="h-7 w-7" title="Qayta joylash" onClick={scatter}>
                <RefreshCcw className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Tanlangan tugun — tafsilotlar */}
            {selectedNode && (
              <div className="absolute left-2 right-2 bottom-2 md:left-auto md:w-96 rounded-lg border bg-card/95 backdrop-blur p-3 shadow-lg">
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
                  <button
                    type="button"
                    className="ml-auto text-muted-foreground hover:text-foreground"
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
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
