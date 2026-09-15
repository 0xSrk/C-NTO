import { useEffect, useRef } from 'react';
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
}

/** Graphe de force minimaliste (canvas) : nœuds = notes, arêtes = liens [[wiki]]. */
export function Graph({ notes, activeId, onOpen }: { notes: Note[]; activeId: string | null; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ nodes: Node[]; edges: [number, number][]; hover: number | null; drag: number | null; offset: { x: number; y: number }; scale: number }>({ nodes: [], edges: [], hover: null, drag: null, offset: { x: 0, y: 0 }, scale: 1 });

  useEffect(() => {
    const byTitle = new Map(notes.map((n, i) => [n.title.toLowerCase(), i]));
    const prev = new Map(state.current.nodes.map((n) => [n.id, n]));
    const nodes: Node[] = notes.map((n, i) => {
      const p = prev.get(n.id);
      const angle = (i / Math.max(1, notes.length)) * Math.PI * 2;
      return { id: n.id, title: n.title, x: p?.x ?? Math.cos(angle) * 160, y: p?.y ?? Math.sin(angle) * 160, vx: 0, vy: 0, degree: 0, tags: n.tags.length };
    });
    const edges: [number, number][] = [];
    notes.forEach((n, i) => {
      for (const l of extractLinks(n.body)) {
        const j = byTitle.get(l);
        if (j !== undefined && j !== i) {
          edges.push([i, j]);
          nodes[i].degree++;
          nodes[j].degree++;
        }
      }
    });
    state.current.nodes = nodes;
    state.current.edges = edges;
  }, [notes]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let frame = 0;

    const tick = () => {
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

      if (frame < 600) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = 1;
            }
            const f = 6000 / d2;
            const d = Math.sqrt(d2);
            a.vx += (dx / d) * f;
            a.vy += (dy / d) * f;
            b.vx -= (dx / d) * f;
            b.vy -= (dy / d) * f;
          }
          a.vx -= a.x * 0.004;
          a.vy -= a.y * 0.004;
        }
        for (const [i, j] of edges) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 130) * 0.02;
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f;
          b.vy -= (dy / d) * f;
        }
        nodes.forEach((n, i) => {
          if (st.drag === i) return;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
        });
        frame++;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(st.scale, st.scale);
      ctx.lineWidth = 1 / st.scale;
      for (const [i, j] of edges) {
        const a = nodes[i];
        const b = nodes[j];
        const hot = st.hover === i || st.hover === j;
        ctx.strokeStyle = hot ? 'rgba(201,162,77,0.7)' : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      nodes.forEach((n, i) => {
        const r = 3 + Math.min(9, n.degree * 1.4);
        const active = n.id === activeId;
        const hot = st.hover === i;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#c9a24d' : hot ? '#f3f4f8' : n.title.startsWith('Journal ') ? '#7fd1ff' : '#8b91a3';
        ctx.fill();
        if (active || hot) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = active ? 'rgba(201,162,77,0.5)' : 'rgba(255,255,255,0.3)';
          ctx.stroke();
        }
        if (hot || active || n.degree >= 2 || nodes.length <= 30) {
          ctx.font = `${11 / st.scale}px "JetBrains Mono Variable", monospace`;
          ctx.fillStyle = hot || active ? '#f3f4f8' : 'rgba(139,145,163,0.9)';
          ctx.textAlign = 'center';
          ctx.fillText(n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title, n.x, n.y + r + 13 / st.scale);
        }
      });
      ctx.restore();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

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
        st.nodes[st.drag].x = p.x;
        st.nodes[st.drag].y = p.y;
        frame = Math.min(frame, 300);
        return;
      }
      if (panning) {
        st.offset.x += e.clientX - panning.x;
        st.offset.y += e.clientY - panning.y;
        panning = { x: e.clientX, y: e.clientY };
        return;
      }
      st.hover = pick(p);
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
        if (Math.hypot(st.nodes[i].x - p.x, st.nodes[i].y - p.y) < 2) onOpen(st.nodes[i].id);
      }
      panning = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = state.current;
      st.scale = Math.max(0.4, Math.min(2.5, st.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [activeId, onOpen]);

  return (
    <div className={s.graphWrap}>
      <canvas ref={ref} className={s.graphCanvas} />
      <div className={s.graphHint}>glisser · molette pour zoomer · clic pour ouvrir</div>
    </div>
  );
}
