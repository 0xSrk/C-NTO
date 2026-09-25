/**
 * Circuit du chargement — canvas, net au pixel physique.
 *
 * Suite de la transition du lanceur : la LED laissée au centre du logotype se déplie
 * en un trait d'axe, puis l'énergie repart vers les bords de la fenêtre le long de
 * traces à 45° (façon PCB). Chaque trace est tracée par un photon (tête + traîne),
 * les nano-pixels 1×1 s'allument à son passage, les cadres à chanfreins et leurs
 * règles se dessinent depuis l'axe. Tout est calculé à partir du temps écoulé :
 * un redimensionnement reconstruit le plan sans perdre la chorégraphie.
 */

type Pt = readonly [number, number];

interface Seg {
  a: Pt;
  b: Pt;
  len: number;
}

interface Trace {
  pts: Pt[];
  segs: Seg[];
  len: number;
  delay: number;
  speed: number;
  led: boolean;
  alpha: number;
  end: number;
}

interface Pixel {
  x: number;
  y: number;
  at: number;
  base: number;
  led: boolean;
}

interface Layout {
  W: number;
  H: number;
  cx: number;
  cy: number;
  halfW: number;
  ring: { x0: number; x1: number; y0: number; y1: number };
  ringHalf: Pt[];
  ringLen: number;
  traces: Trace[];
  /** Instant où la dernière trace atteint son bord. */
  settled: number;
  pixels: Pixel[];
  frames: { half: Pt[]; len: number; delay: number; alpha: number }[];
  ticks: { x: number; y: number; w: number; h: number; at: number; major: boolean }[];
}

export interface BootCircuitOptions {
  reduced: boolean;
  /** Boîte du logotype (coordonnées fenêtre) — centre du circuit. */
  anchor: () => DOMRect | null;
  /** Bloc que l'anneau doit contenir en entier (logotype + sigle). */
  enclose?: () => DOMRect | null;
  /** Ordonnée où s'arrêtent les voies basses (haut de la console). */
  floor: () => number;
  onTick?: (t: number) => void;
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Segments consécutifs d'une polyligne, avec leur longueur. */
function segments(pts: readonly Pt[]): Seg[] {
  const out: Seg[] = [];
  let prev: Pt | undefined;
  for (const p of pts) {
    if (prev) out.push({ a: prev, b: p, len: Math.hypot(p[0] - prev[0], p[1] - prev[1]) });
    prev = p;
  }
  return out;
}

function polyLength(pts: readonly Pt[]): number {
  return segments(pts).reduce((sum, sg) => sum + sg.len, 0);
}

const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** Point à la distance `d` le long d'une trace. */
function pointAt(segs: readonly Seg[], d: number): Pt {
  let last: Pt = segs[0]?.a ?? [0, 0];
  for (const sg of segs) {
    if (d <= sg.len) return lerp(sg.a, sg.b, sg.len ? d / sg.len : 0);
    d -= sg.len;
    last = sg.b;
  }
  return last;
}

/** Aléa déterministe : le même plan à chaque rendu d'une même taille. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T_UNFOLD = 360;
const T_TRACE = 220;

function buildLayout(W: number, H: number, box: DOMRect, floor: number, enclose: DOMRect | null): Layout {
  const cx = Math.round(box.left + box.width / 2);
  const cy = Math.round(box.top + box.height / 2);
  const ring = {
    x0: Math.round(Math.min(box.left, enclose?.left ?? box.left)) - 24,
    x1: Math.round(Math.max(box.right, enclose?.right ?? box.right)) + 24,
    y0: Math.round(box.top) - 28,
    y1: Math.round(Math.max(box.bottom + 28, (enclose?.bottom ?? 0) + 16)),
  };
  const traces: Trace[] = [];
  const add = (pts: Pt[], o: Omit<Trace, 'pts' | 'segs' | 'len' | 'end'>) => {
    const segs = segments(pts);
    const len = segs.reduce((sum, sg) => sum + sg.len, 0);
    traces.push({ pts, segs, len, ...o, end: o.delay + len / o.speed });
  };

  // Bus vertical : 15 voies à 16 px sur l'anneau, qui s'évasent vers le haut et vers la console.
  const LANES = 7;
  for (const dir of [-1, 1] as const) {
    const from = dir < 0 ? ring.y0 : ring.y1;
    const to = dir < 0 ? 72 : Math.max(from + 48, floor);
    const room = Math.abs(to - from) - 32;
    if (room < 16) continue;
    const spread = Math.max(0, Math.min(24, (room - 8) / LANES));
    for (let j = -LANES; j <= LANES; j++) {
      const xs = cx + j * 16;
      const xe = cx + j * (16 + spread);
      const dx = Math.abs(xe - xs);
      const b0 = from + dir * 16;
      const b1 = b0 + dir * dx;
      add(
        [
          [xs, from],
          [xs, b0],
          [xe, b1],
          [xe, to],
        ],
        { delay: T_TRACE + Math.abs(j) * 26 + (dir > 0 ? 50 : 0), speed: 0.7, led: false, alpha: j === 0 ? 0.24 : 0.12 },
      );
    }
  }
  // Bus latéraux : 7 voies à 12 px, évasées à 32 px, l'axe central en LED.
  for (const side of [-1, 1] as const) {
    const from = side < 0 ? ring.x0 : ring.x1;
    const edge = side < 0 ? 48 : W - 48;
    for (let k = -3; k <= 3; k++) {
      const ys = cy + k * 12;
      const ye = cy + k * 32;
      const dy = Math.abs(ye - ys);
      const b0 = from + side * 24;
      const b1 = b0 + side * dy;
      if ((side < 0 && b1 < edge + 16) || (side > 0 && b1 > edge - 16)) continue;
      const pts: Pt[] =
        k === 0
          ? [
              [from, ys],
              [edge, ys],
            ]
          : [
              [from, ys],
              [b0, ys],
              [b1, ye],
              [edge, ye],
            ];
      add(pts, { delay: T_TRACE - 60 + Math.abs(k) * 40, speed: k === 0 ? 1.15 : 0.95, led: k === 0, alpha: k === 0 ? 0.55 : 0.12 });
    }
  }

  const rnd = mulberry(W * 7919 + H);
  const pixels: Pixel[] = [];
  for (const t of traces) {
    for (let d = 6; d < t.len; d += 8) {
      const [x, y] = pointAt(t.segs, d);
      pixels.push({ x, y, at: t.delay + d / t.speed, base: t.led ? 0.55 : 0.24, led: t.led });
    }
  }
  const diag = Math.hypot(W, H);
  for (let y = 48; y < H - 48; y += 8) {
    for (let x = 48; x < W - 48; x += 8) {
      if (rnd() > 0.045) continue;
      if (x > ring.x0 - 8 && x < ring.x1 + 8 && y > ring.y0 - 8 && y < ring.y1 + 8) continue;
      const dist = Math.hypot(x - cx, y - cy);
      pixels.push({ x, y, at: T_TRACE + (dist / diag) * 1100 + rnd() * 260, base: 0.08, led: rnd() < 0.05 });
    }
  }

  const frames = [24, 32].map((m, i) => {
    const c = 12;
    const half: Pt[] = [
      [W / 2, m],
      [W - m - c, m],
      [W - m, m + c],
      [W - m, H - m - c],
      [W - m - c, H - m],
      [W / 2, H - m],
    ];
    return { half, len: polyLength(half), delay: 80 + i * 140, alpha: i ? 0.06 : 0.1 };
  });

  // Règles : graduation 8 px sur les montants, majeure tous les 40 px, en vague depuis l'axe.
  const ticks: Layout['ticks'] = [];
  for (let y = 64; y <= H - 64; y += 8) {
    const major = Math.round((y - cy) / 8) % 5 === 0;
    const len = major ? 7 : 3;
    const at = 260 + Math.abs(y - cy) * 0.9;
    ticks.push({ x: 33, y, w: len, h: 1, at, major }, { x: W - 33 - len, y, w: len, h: 1, at, major });
  }
  for (let x = 80; x <= W - 80; x += 8) {
    const major = Math.round((x - cx) / 8) % 5 === 0;
    if (!major) continue;
    const at = 320 + Math.abs(x - cx) * 0.6;
    ticks.push({ x, y: 33, w: 1, h: 5, at, major }, { x, y: H - 33 - 5, w: 1, h: 5, at, major });
  }

  const C = 8;
  const ringHalf: Pt[] = [
    [cx, ring.y0],
    [ring.x1 - C, ring.y0],
    [ring.x1, ring.y0 + C],
    [ring.x1, ring.y1 - C],
    [ring.x1 - C, ring.y1],
    [cx, ring.y1],
  ];
  const settled = traces.reduce((m, tr) => Math.max(m, tr.end), 0);
  return { W, H, cx, cy, halfW: box.width / 2, ring, ringHalf, ringLen: polyLength(ringHalf), traces, settled, pixels, frames, ticks };
}

export function runBootCircuit(canvas: HTMLCanvasElement, opts: BootCircuitOptions): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  let dpr = 1;
  let layout: Layout | null = null;
  let probe = '';
  /** Empreinte de la géométrie : un zoom CSS ne déclenche pas « resize », on la compare. */
  const geometry = () => {
    const f = canvas.getBoundingClientRect();
    const b = opts.anchor();
    return `${f.width}|${f.height}|${b ? `${Math.round(b.left)}|${Math.round(b.top)}|${Math.round(b.width)}` : '-'}`;
  };

  // Tout est mesuré dans l'espace visuel du canvas lui-même : juste sous un zoom CSS
  // (navigateur) comme sous le zoom de la fenêtre (desk).
  const resize = () => {
    probe = geometry();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const frame = canvas.getBoundingClientRect();
    const W = frame.width;
    const H = frame.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const box = opts.anchor();
    const local = (r: DOMRect) => new DOMRect(r.left - frame.left, r.top - frame.top, r.width, r.height);
    const outer = opts.enclose?.() ?? null;
    layout = box && box.width > 0 && W > 0 ? buildLayout(W, H, local(box), opts.floor() - frame.top, outer ? local(outer) : null) : null;
    if (opts.reduced) raf = requestAnimationFrame(draw);
  };

  // Le lanceur a laissé la LED allumée au centre du logotype : on reprend exactement là.
  const t0 = performance.now();
  const rnd = mulberry(1337);
  const pulses: { trace: Trace; start: number; speed: number }[] = [];
  let nextPulse = 0;
  let raf = 0;
  let frameNo = 0;

  const draw = (now: number) => {
    if (++frameNo % 12 === 0 && geometry() !== probe) resize();
    const L = layout;
    const t = opts.reduced ? 4000 : now - t0;
    opts.onTick?.(Math.max(0, t));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!L) {
      resize();
      if (!opts.reduced) raf = requestAnimationFrame(draw);
      return;
    }
    const hair = 1 / dpr;
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
    const px = (v: number) => Math.round(v * dpr) / dpr;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    const strokePoly = (pts: readonly Pt[], upTo: number, mirrorX = 0) => {
      const first = pts[0];
      if (!first) return;
      let left = upTo;
      const map = (p: Pt): Pt => [snap(mirrorX ? 2 * mirrorX - p[0] : p[0]), snap(p[1])];
      ctx.beginPath();
      ctx.moveTo(...map(first));
      for (const sg of segments(pts)) {
        if (left <= 0) break;
        ctx.lineTo(...map(lerp(sg.a, sg.b, sg.len ? Math.min(1, left / sg.len) : 1)));
        left -= sg.len;
      }
      ctx.stroke();
    };

    const photon = (x: number, y: number, led: boolean, strength: number) => {
      const rad = 12;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, led ? `rgba(255,70,96,${0.5 * strength})` : `rgba(255,255,255,${0.4 * strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      ctx.fillStyle = led ? `rgba(255,140,156,${strength})` : `rgba(255,255,255,${strength})`;
      ctx.fillRect(px(x) - hair, px(y) - hair, 3 * hair, 3 * hair);
    };

    const tail = (tr: Trace, head: number, length: number, strength: number) => {
      for (let k = 0; k < length; k += 4) {
        const s0 = head - k;
        if (s0 <= 0) break;
        const [x1, y1] = pointAt(tr.segs, s0);
        const [x2, y2] = pointAt(tr.segs, Math.max(0, s0 - 4));
        const fade = (1 - k / length) * strength;
        ctx.strokeStyle = tr.led ? `rgba(255,80,104,${0.8 * fade})` : `rgba(255,255,255,${0.65 * fade})`;
        ctx.beginPath();
        ctx.moveTo(snap(x2), snap(y2));
        ctx.lineTo(snap(x1), snap(y1));
        ctx.stroke();
      }
    };

    // Lumière de salle : une source douce derrière le logotype, qui s'installe.
    const room = easeOut(clamp01(t / 1400));
    if (room > 0) {
      const R = Math.max(L.W, L.H) * 0.55;
      const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, R);
      g.addColorStop(0, `rgba(255,255,255,${0.035 * room})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, L.W, L.H);
    }

    // Cadres à chanfreins
    ctx.lineWidth = hair;
    for (const f of L.frames) {
      const p = easeInOut(clamp01((t - f.delay) / 900));
      if (p <= 0) continue;
      ctx.strokeStyle = `rgba(255,255,255,${f.alpha})`;
      strokePoly(f.half, f.len * p);
      strokePoly(f.half, f.len * p, L.W / 2);
    }
    // Règles
    for (const tk of L.ticks) {
      const a = clamp01((t - tk.at) / 200);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${(tk.major ? 0.16 : 0.08) * a})`;
      ctx.fillRect(px(tk.x), px(tk.y), tk.w === 1 ? hair : tk.w, tk.h === 1 ? hair : tk.h);
    }

    // Traces + photons de charge
    for (const tr of L.traces) {
      const d = (t - tr.delay) * tr.speed;
      if (d <= 0) continue;
      const drawn = Math.min(tr.len, d);
      ctx.lineWidth = tr.led ? Math.max(hair, 0.5) : hair;
      ctx.strokeStyle = tr.led ? `rgba(196,30,58,${tr.alpha})` : `rgba(255,255,255,${tr.alpha})`;
      strokePoly(tr.pts, drawn);
      ctx.lineWidth = hair;
      if (d < tr.len) {
        tail(tr, drawn, 48, 1);
        const [hx, hy] = pointAt(tr.segs, drawn);
        photon(hx, hy, tr.led, 1);
      } else {
        const since = t - tr.end;
        const [vx, vy] = tr.pts[tr.pts.length - 1] ?? [0, 0];
        const va = 0.3 + 0.7 * Math.exp(-since / 180);
        ctx.strokeStyle = tr.led ? `rgba(196,30,58,${va})` : `rgba(255,255,255,${va * 0.7})`;
        ctx.strokeRect(snap(vx - 2), snap(vy - 2), 4, 4);
        if (since < 220) photon(vx, vy, tr.led, 1 - since / 220);
      }
    }

    // Impulsions de veille : l'énergie continue de circuler tant que l'écran reste.
    if (!opts.reduced && t > L.settled && t > nextPulse) {
      nextPulse = t + 140 + rnd() * 220;
      const trace = L.traces[Math.floor(rnd() * L.traces.length)];
      if (trace && pulses.length < 6) pulses.push({ trace, start: t, speed: 0.9 + rnd() * 0.5 });
    }
    for (const p of [...pulses]) {
      const d = (t - p.start) * p.speed;
      if (d > p.trace.len + 40 || !L.traces.includes(p.trace)) {
        pulses.splice(pulses.indexOf(p), 1);
        continue;
      }
      tail(p.trace, Math.min(d, p.trace.len), 40, 0.55);
      if (d < p.trace.len) {
        const [hx, hy] = pointAt(p.trace.segs, d);
        photon(hx, hy, p.trace.led, 0.6);
      }
    }

    // Nano-pixels
    for (const p of L.pixels) {
      if (t < p.at) continue;
      const k = Math.exp(-(t - p.at) / 240);
      const a = Math.min(1, p.base + 0.75 * k);
      ctx.fillStyle = p.led ? `rgba(196,30,58,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    // Anneau du logotype + équerres LED
    const rp = easeOut(clamp01((t - 160) / 560));
    if (rp > 0) {
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      strokePoly(L.ringHalf, L.ringLen * rp);
      strokePoly(L.ringHalf, L.ringLen * rp, L.cx);
      const ba = clamp01((t - 520) / 220);
      if (ba > 0) {
        const off = 8 * (1 - easeOut(ba));
        const B = 10;
        ctx.strokeStyle = `rgba(196,30,58,${0.85 * ba})`;
        ctx.lineWidth = Math.max(hair, 0.5);
        const { x0, x1, y0, y1 } = L.ring;
        for (const [x, y, sx, sy] of [
          [x0 - 6 - off, y0 - 6 - off, 1, 1],
          [x1 + 6 + off, y0 - 6 - off, -1, 1],
          [x0 - 6 - off, y1 + 6 + off, 1, -1],
          [x1 + 6 + off, y1 + 6 + off, -1, -1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(snap(x), snap(y + sy * B));
          ctx.lineTo(snap(x), snap(y));
          ctx.lineTo(snap(x + sx * B), snap(y));
          ctx.stroke();
        }
      }
    }

    // LED d'origine → trait d'axe qui se déplie à la largeur du logotype, puis s'efface sous les tracés.
    const unfold = easeInOut(clamp01(t / T_UNFOLD));
    const lineFade = 1 - clamp01((t - T_UNFOLD - 200) / 700);
    if (lineFade > 0) {
      const hw = Math.max(1, L.halfW * unfold);
      const g = ctx.createLinearGradient(L.cx - hw, 0, L.cx + hw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.95 * lineFade})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(L.cx - hw, px(L.cy), hw * 2, hair);
    }
    const ledFade = 1 - clamp01((t - 200) / 900);
    if (ledFade > 0) {
      const R = 36;
      const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, R);
      g.addColorStop(0, `rgba(196,30,58,${0.55 * ledFade})`);
      g.addColorStop(0.35, `rgba(196,30,58,${0.12 * ledFade})`);
      g.addColorStop(1, 'rgba(196,30,58,0)');
      ctx.fillStyle = g;
      ctx.fillRect(L.cx - R, L.cy - R, R * 2, R * 2);
      ctx.fillStyle = `rgba(255,120,140,${ledFade})`;
      ctx.fillRect(L.cx - 1, L.cy - 1, 2, 2);
    }

    if (!opts.reduced) raf = requestAnimationFrame(draw);
  };

  resize();
  raf = requestAnimationFrame(draw);
  window.addEventListener('resize', resize);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
