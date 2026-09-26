import { useEffect, useRef, useState } from 'react';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import type { Link } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import type { Note } from '@/store/db';
import { extractLinks } from '@/store/notes';
import s from './note.module.css';

interface Node {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  tags: number;
  kind: 'note' | 'instrument' | 'strategie' | 'evenement';
  /** Identifiant de note à ouvrir. Null pour un instrument ou un événement. */
  openId: string | null;
}

interface Edge {
  i: number;
  j: number;
  style: 'wiki' | 'affirme' | 'hypothese' | 'structurel';
}

const MAX_FRAMES = 600;
/** Énergie cinétique totale (Σ v²) sous laquelle la mise en page est considérée stable. */
const REST_ENERGY = 0.05;
/** Au-delà, la répulsion passe par une grille spatiale (voisins proches seulement). */
const GRID_THRESHOLD = 300;
const GRID_CELL = 120;
const REPULSION = 6000;

function repel(a: Node, b: Node): void {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  let d2 = dx * dx + dy * dy;
  if (d2 < 1) {
    dx = Math.random() - 0.5;
    dy = Math.random() - 0.5;
    d2 = 1;
  }
  const f = REPULSION / d2;
  const d = Math.sqrt(d2);
  a.vx += (dx / d) * f;
  a.vy += (dy / d) * f;
  b.vx -= (dx / d) * f;
  b.vy -= (dy / d) * f;
}

/** Répulsion exacte O(n²) : suffisante en dessous de GRID_THRESHOLD nœuds. */
function repelAll(nodes: Node[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (b) repel(a, b);
    }
  }
}

/**
 * Répulsion approchée par grille : chaque nœud n'interagit qu'avec les 9 cellules voisines.
 * À 120 px la force résiduelle (6000/d²) est < 0,5 : l'écart visuel est imperceptible.
 */
function repelGrid(nodes: Node[]): void {
  const cells = new Map<string, Node[]>();
  const keyOf = (cx: number, cy: number) => `${cx},${cy}`;
  const coords = nodes.map((n) => [Math.floor(n.x / GRID_CELL), Math.floor(n.y / GRID_CELL)] as const);
  nodes.forEach((n, i) => {
    const c = coords[i];
    if (!c) return;
    const k = keyOf(c[0], c[1]);
    const bucket = cells.get(k);
    if (bucket) bucket.push(n);
    else cells.set(k, [n]);
  });
  const done = new Set<string>();
  nodes.forEach((a, i) => {
    const c = coords[i];
    if (!c) return;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = cells.get(keyOf(c[0] + ox, c[1] + oy));
        if (!bucket) continue;
        for (const b of bucket) {
          if (a === b) continue;
          // Chaque paire une seule fois : clé ordonnée par identifiant.
          const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (done.has(pair)) continue;
          done.add(pair);
          repel(a, b);
        }
      }
    }
  });
}

function token(canvas: HTMLCanvasElement, name: string, fallback: string): string {
  const value = getComputedStyle(canvas).getPropertyValue(name).trim();
  return value || fallback;
}

/** Graphe de force : nœuds = notes, arêtes = liens [[wiki]] et liens typés. */
export function Graph({ notes, activeId, onOpen, links = [], events = [] }: { notes: Note[]; activeId: string | null; onOpen: (id: string) => void; links?: Link[]; events?: CalendarEventRow[] }) {
  useI18n((st) => st.locale);
  const ref = useRef<HTMLCanvasElement>(null);
  const [entities, setEntities] = useState(false);
  const state = useRef<{ nodes: Node[]; edges: Edge[]; hover: number | null; drag: number | null; offset: { x: number; y: number }; scale: number; frame: number; wake: (() => void) | null }>({ nodes: [], edges: [], hover: null, drag: null, offset: { x: 0, y: 0 }, scale: 1, frame: 0, wake: null });

  useEffect(() => {
    const byTitle = new Map(notes.map((n, i) => [n.title.toLowerCase(), i]));
    const prev = new Map(state.current.nodes.map((n) => [n.id, n]));
    const place = (id: string, index: number, total: number): Pick<Node, 'x' | 'y' | 'vx' | 'vy'> => {
      const p = prev.get(id);
      const angle = (index / Math.max(1, total)) * Math.PI * 2;
      return { x: p?.x ?? Math.cos(angle) * 160, y: p?.y ?? Math.sin(angle) * 160, vx: 0, vy: 0 };
    };
    const nodes: Node[] = notes.map((n, i) => ({
      id: n.id,
      title: n.title,
      ...place(n.id, i, notes.length),
      degree: 0,
      tags: n.tags.length,
      kind: 'note',
      openId: n.id,
    }));
    const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
    const edges: Edge[] = [];
    const bump = (edge: Edge) => {
      edges.push(edge);
      const a = nodes[edge.i];
      const b = nodes[edge.j];
      if (a) a.degree++;
      if (b) b.degree++;
    };
    notes.forEach((n, i) => {
      for (const l of extractLinks(n.body)) {
        const j = byTitle.get(l);
        if (j !== undefined && j !== i) bump({ i, j, style: 'wiki' });
      }
    });
    const resolve = (type: Link['from']['type'], id: string): number | undefined => {
      if (type === 'note') return indexOf.get(id);
      if (type === 'strategie') {
        if (!entities) return indexOf.get(id);
        return indexOf.get(`strategie:${id}`);
      }
      if (!entities) return undefined;
      if (type === 'instrument' || type === 'evenement') return indexOf.get(`${type}:${id}`);
      return undefined;
    };
    if (entities) {
      const extra = new Map<string, Node>();
      const titles = new Map(notes.map((n) => [n.id, n.title]));
      const eventTitle = new Map(events.map((e) => [e.id, e.title]));
      for (const link of links) {
        for (const ref of [link.from, link.to]) {
          if (ref.type !== 'instrument' && ref.type !== 'evenement' && ref.type !== 'strategie') continue;
          const id = `${ref.type}:${ref.id}`;
          if (extra.has(id) || (ref.type === 'strategie' && !titles.has(ref.id))) continue;
          const title = ref.type === 'instrument' ? ref.id : ref.type === 'strategie' ? (titles.get(ref.id) ?? ref.id) : (eventTitle.get(ref.id) ?? ref.id);
          extra.set(id, {
            id,
            title,
            ...place(id, extra.size + notes.length, notes.length + 8),
            degree: 0,
            tags: 0,
            kind: ref.type,
            openId: ref.type === 'strategie' ? ref.id : null,
          });
        }
      }
      for (const node of extra.values()) {
        indexOf.set(node.id, nodes.length);
        nodes.push(node);
      }
    }
    for (const link of links) {
      if (link.kind === 'rejete') continue;
      const i = resolve(link.from.type, link.from.id);
      const j = resolve(link.to.type, link.to.id);
      if (i === undefined || j === undefined || i === j) continue;
      const style = link.kind === 'hypothese' ? 'hypothese' : link.kind === 'structurel' ? 'structurel' : 'affirme';
      bump({ i, j, style });
    }
    state.current.nodes = nodes;
    state.current.edges = edges;
    state.current.frame = 0;
    state.current.wake?.();
  }, [notes, links, events, entities]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let dirty = true;
    const wake = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    state.current.wake = wake;

    const tick = () => {
      raf = 0;
      const st = state.current;
      const { nodes, edges } = st;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      const cx = rect.width / 2 + st.offset.x;
      const cy = rect.height / 2 + st.offset.y;

      if (st.frame < MAX_FRAMES) {
        if (nodes.length > GRID_THRESHOLD) repelGrid(nodes);
        else repelAll(nodes);
        for (const a of nodes) {
          a.vx -= a.x * 0.004;
          a.vy -= a.y * 0.004;
        }
        for (const edge of edges) {
          const a = nodes[edge.i];
          const b = nodes[edge.j];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const rest = 110 + 3.5 * Math.max(a.title.length, b.title.length);
          const f = (d - rest) * 0.02;
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f;
          b.vy -= (dy / d) * f;
        }
        let energy = 0;
        nodes.forEach((n, i) => {
          if (st.drag === i) return;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
          energy += n.vx * n.vx + n.vy * n.vy;
        });
        st.frame++;
        // Arrêt anticipé dès que la mise en page ne bouge plus (le plafond de 600 reste la borne).
        // Quelques images de sécurité pour laisser les positions initiales (angle) se dérouler.
        if (st.frame > 10 && energy < REST_ENERGY && st.drag === null) st.frame = MAX_FRAMES;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(st.scale, st.scale);
      const gold = token(canvas, '--gold', '#c41e3a');
      const ice = token(canvas, '--ice', '#8fc7e8');
      const text2 = token(canvas, '--text-2', '#8a8a8a');
      const text3 = token(canvas, '--text-3', '#6c6c6c');
      const text4 = token(canvas, '--text-4', '#4a4a4a');
      for (const edge of edges) {
        const a = nodes[edge.i];
        const b = nodes[edge.j];
        if (!a || !b) continue;
        const hot = st.hover === edge.i || st.hover === edge.j;
        ctx.setLineDash(edge.style === 'hypothese' ? [4 / st.scale, 4 / st.scale] : []);
        ctx.lineWidth = (edge.style === 'structurel' ? 0.6 : 1) / st.scale;
        ctx.strokeStyle = hot ? gold : edge.style === 'structurel' ? text4 : edge.style === 'hypothese' ? text3 : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / st.scale;
      nodes.forEach((n, i) => {
        const r = n.kind === 'note' ? 3 + Math.min(9, n.degree * 1.4) : 2.5;
        const active = n.kind === 'note' && n.id === activeId;
        const hot = st.hover === i;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        const entityFill = n.kind === 'evenement' ? ice : n.kind === 'strategie' ? gold : text3;
        ctx.fillStyle = active ? gold : hot ? '#ffffff' : n.kind === 'note' ? (n.title.startsWith('Journal ') ? ice : text2) : entityFill;
        ctx.fill();
        if (active || hot) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = active ? 'rgba(196,30,58,0.5)' : 'rgba(255,255,255,0.3)';
          ctx.stroke();
        }
        if (hot || active || n.degree >= 2 || nodes.length <= 30) {
          ctx.font = `${11 / st.scale}px "JetBrains Mono Variable", monospace`;
          ctx.fillStyle = hot || active ? '#ffffff' : 'rgba(138,138,138,0.9)';
          ctx.textAlign = 'center';
          ctx.fillText(n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title, n.x, n.y + r + 13 / st.scale);
        }
      });
      ctx.restore();
      dirty = false;
      // La simulation continue tant qu'elle n'a pas convergé ; ensuite le canvas ne se
      // redessine que sur interaction (survol, glisser, zoom) : zéro CPU au repos.
      if (st.frame < MAX_FRAMES || dirty) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => wake());
    ro.observe(canvas);

    const toWorld = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const st = state.current;
      return { x: (e.clientX - rect.left - rect.width / 2 - st.offset.x) / st.scale, y: (e.clientY - rect.top - rect.height / 2 - st.offset.y) / st.scale };
    };
    const pick = (p: { x: number; y: number }) => {
      const st = state.current;
      let best: number | null = null;
      let bestD = 14 / st.scale;
      st.nodes.forEach((n, i) => {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    let panning: { x: number; y: number } | null = null;
    const onMove = (e: MouseEvent) => {
      const st = state.current;
      const p = toWorld(e);
      if (st.drag !== null) {
        const dragged = st.nodes[st.drag];
        if (dragged) {
          dragged.x = p.x;
          dragged.y = p.y;
        }
        st.frame = Math.min(st.frame, 300);
        wake();
        return;
      }
      if (panning) {
        st.offset.x += e.clientX - panning.x;
        st.offset.y += e.clientY - panning.y;
        panning = { x: e.clientX, y: e.clientY };
        wake();
        return;
      }
      const hover = pick(p);
      if (hover !== st.hover) {
        st.hover = hover;
        wake();
      }
      canvas.style.cursor = st.hover !== null ? 'pointer' : 'grab';
    };
    const onDown = (e: MouseEvent) => {
      const st = state.current;
      const i = pick(toWorld(e));
      if (i !== null) st.drag = i;
      else panning = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: MouseEvent) => {
      const st = state.current;
      if (st.drag !== null) {
        const i = st.drag;
        st.drag = null;
        const p = toWorld(e);
        const node = st.nodes[i];
        if (node?.openId && Math.hypot(node.x - p.x, node.y - p.y) < 2) onOpen(node.openId);
      }
      panning = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = state.current;
      st.scale = Math.max(0.4, Math.min(2.5, st.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
      wake();
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      state.current.wake = null;
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [activeId, onOpen]);

  return (
    <div className={s.graphWrap}>
      <canvas ref={ref} className={s.graphCanvas} />
      <button type="button" className={`${s.graphEntities} ${entities ? s.on : ''}`} aria-pressed={entities} onClick={() => setEntities((v) => !v)}>
        {tr('Entités', 'Entities', 'Entidades')}
      </button>
      <div className={s.graphHint}>{tr('glisser · molette pour zoomer · clic pour ouvrir', 'drag · wheel to zoom · click to open', 'arrastrar · rueda para zoom · clic para abrir')}</div>
    </div>
  );
}
