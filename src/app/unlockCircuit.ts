/**
 * Le circuit de l'ouverture (4.1) — canvas, net au pixel physique.
 *
 * La phrase admise se défait en glyphes, au pas du geste du code d'accolades ; chaque glyphe se pose en pastille et
 * pousse sa piste, à 45° quand la place le permet, vers la pointe de l'horizon du sceau. La lumière court alors sur les
 * lignes du sceau — les tracés mêmes du master, rallumés par-dessus les siens —, et le point d'or s'allume en son
 * centre. Le sceau glisse au centre de l'écran et se plie dans son horizon ; le point d'or se partage sur l'axe et le
 * circuit s'étend jusqu'aux bords autour du mot (celui du chargement, aux couleurs du Système 4.1 : l'ivoire, l'or pour
 * l'axe). Ses cadres se retirent, les lignes du châssis — barre de titre, rail, barre d'état — se tracent là où le
 * desk, monté dessous, a les siennes, et le voile se lève sur un desk déjà formé.
 *
 * Tout se calcule depuis le temps écoulé et la géométrie relue à chaque image : un zoom ou un redimensionnement ne
 * perd pas la chorégraphie.
 */
import { sealShapes } from '@/design/Seal';
import { glyphDelays, SEAT_DOMINO, type GlyphPlan } from './seatGlyphs';

export type Pt = readonly [number, number];

/* ─── Les temps ─── */

/** Les glyphes de la phrase tournent au pas du geste du code d'accolades : même écart, même vie, même cadence. */
export const UNLOCK_GLYPHS: GlyphPlan = SEAT_DOMINO;
/**
 * Au plus autant de glyphes ; le geste, lui, ne dépasse jamais sa durée (`maxTotal`). La rangée s'arrête plus tôt si le
 * champ montre moins de points (`glyphCapacity`) : 28 à 1180 × 720.
 */
export const UNLOCK_GLYPH_MAX = 32;

/**
 * Combien de points le champ masqué montre à la fois, de sa largeur utile et du pas d'un point (un caractère de la police
 * mono, plus l'interlettre) : la rangée de glyphes n'en pose pas plus, sinon elle sauterait du défilement du champ et
 * déborderait sur « Coller ». Sans mesure, la borne haute.
 */
export function glyphCapacity(inner: number, advance: number): number {
  if (!(inner > 0) || !(advance > 0)) return UNLOCK_GLYPH_MAX;
  return Math.max(1, Math.min(UNLOCK_GLYPH_MAX, Math.floor(inner / advance)));
}
/** Une piste va de sa pastille à la pointe de l'horizon en ce temps, quelle que soit sa longueur. */
export const TRAVEL_MS = 380;
/** La lumière parcourt l'horizon du sceau, de sa pointe droite à sa pointe gauche. */
export const HORIZON_MS = 460;
/** Puis chaque anneau, du dehors au dedans, de ses pointes droites à ses pointes gauches. */
export const RING_LEAD_MS = 60;
export const RING_STEP_MS = 80;
export const RING_MS = 520;
/** Le point d'or s'allume après la dernière arrivée, et tient avant que le sceau ne parte. */
export const GOLD_AFTER_MS = 160;
export const GOLD_HOLD_MS = 120;
/** Le sceau glisse au centre (ms), se plie à partir de (ms), pendant (ms), jusqu'à cette hauteur. */
export const GLIDE_MS = 500;
export const FOLD_AT_MS = 340;
export const FOLD_MS = 240;
export const SEAL_FOLDED = 0.004;
/** Le point d'or se partage sur l'axe et file jusqu'à l'anneau du mot. */
export const SPLIT_MS = 200;
/** « DESK UNLOCKED » : le mot ne se traduit pas. Il se déplie de la ligne, comme le sceau s'y est plié. */
export const UNLOCK_SEAL = 'DESK UNLOCKED';
export const WORD_AT_MS = 120;
export const WORD_MS = 380;
/** Le circuit s'étend, puis les lignes du châssis se tracent ; le voile se lève. */
export const SPREAD_MS = 560;
export const FORM_MS = 380;
export const FADE_MS = 420;

/** La lumière du sceau, de la première arrivée à son dernier anneau. */
const LIGHT_MS = Math.max(HORIZON_MS, RING_LEAD_MS + 2 * RING_STEP_MS + RING_MS);

/** Les temps de l'ouverture (ms depuis l'admission), pour `count` caractères de la phrase. */
export interface UnlockTimeline {
  count: number;
  /** Départ de chaque glyphe. */
  delays: number[];
  /** Pose de chaque glyphe en pastille : sa piste part. */
  sets: number[];
  /** Arrivée de chaque piste à la pointe de l'horizon. */
  arrivals: number[];
  /** La fiche s'efface autour des glyphes. */
  trace: number;
  /** La lumière commence à courir sur le sceau. */
  seal: number;
  gold: number;
  glide: number;
  fold: number;
  spread: number;
  word: number;
  form: number;
  reveal: number;
  end: number;
}

export function unlockTimeline(count: number): UnlockTimeline {
  const n = Math.max(1, Math.min(UNLOCK_GLYPH_MAX, Math.floor(count) || 1));
  const delays = glyphDelays(n, UNLOCK_GLYPHS);
  const sets = delays.map((d) => d + UNLOCK_GLYPHS.spin);
  const arrivals = sets.map((t) => t + TRAVEL_MS);
  const trace = Math.min(...sets);
  const seal = Math.min(...arrivals);
  const gold = Math.max(Math.max(...arrivals) + GOLD_AFTER_MS, seal + LIGHT_MS);
  const glide = gold + GOLD_HOLD_MS;
  const fold = glide + FOLD_AT_MS;
  const spread = fold + FOLD_MS;
  const word = spread + WORD_AT_MS;
  const form = spread + SPREAD_MS;
  const reveal = form + Math.round(FORM_MS * 0.7);
  const end = reveal + FADE_MS + 240;
  return { count: n, delays, sets, arrivals, trace, seal, gold, glide, fold, spread, word, form, reveal, end };
}

/** Mouvement réduit : ni glyphes ni circuit ; le mot paraît, puis le voile se lève. */
export function reducedTimeline(): UnlockTimeline {
  return { count: 0, delays: [], sets: [], arrivals: [], trace: 0, seal: 0, gold: 0, glide: 0, fold: 0, spread: 0, word: 0, form: 0, reveal: 280, end: 520 };
}

/* ─── Le sceau, tel que le dessine le master (`src/design/seal/seal-negative.svg`, boîte −404 −370 808 740) ─── */

export const SEAL_BOX = { x: -404, y: -370, w: 808, h: 740 } as const;
/** L'horizon : sa ligne (y) et ses pointes (x). */
export const SEAL_HZ_Y = -12.8;
export const SEAL_HZ_TIP = 402.5;

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Du repère du master à l'écran, pour un sceau posé dans `rect` (glissé et plié compris : l'échelle suit ses deux axes). */
export function sealMap(rect: RectLike): { at: (x: number, y: number) => Pt; sx: number; sy: number; ox: number; oy: number } {
  const sx = rect.width / SEAL_BOX.w;
  const sy = rect.height / SEAL_BOX.h;
  const ox = rect.left - SEAL_BOX.x * sx;
  const oy = rect.top - SEAL_BOX.y * sy;
  return { sx, sy, ox, oy, at: (x, y) => [ox + x * sx, oy + y * sy] };
}

/**
 * Les anneaux du master, un tracé par anneau : le master les donne en un seul, six arcs (haut et bas de chacun) ;
 * ils se regroupent par rayon, du dehors au dedans.
 */
export function ringArcs(d: string): { r: number; d: string }[] {
  const groups = new Map<number, string[]>();
  for (const sub of d.split(/(?=M)/)) {
    const r = Number.parseFloat(/A\s*([\d.]+)/.exec(sub)?.[1] ?? 'NaN');
    if (!Number.isFinite(r)) continue;
    const key = Math.round(r * 100) / 100;
    groups.set(key, [...(groups.get(key) ?? []), sub.trim()]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([r, subs]) => ({ r, d: subs.join(' ') }));
}

/* ─── Les pistes : des pastilles de la phrase à la pointe de l'horizon ─── */

export const LANES = 7;
export const AXIS_LANE = (LANES - 1) / 2;
const LANE_DROP = 8;
const LANE_GAP = 4;
const BUNDLE_GAP = 3;
/** Le faisceau se forme à cette distance de la pointe, puis s'y resserre. */
const ELBOW = 18;

/**
 * La voie de chaque pastille : de gauche à droite, de haut en bas ; ainsi aucune piste n'en croise une autre. L'axe,
 * la voie du milieu, est toujours pris : une phrase courte et impaire y pose sa pastille du milieu, les autres
 * s'écartent symétriquement ; sinon la pastille de l'axe est celle que la répartition y amène.
 */
export function laneOf(i: number, n: number): number {
  if (n === 1) return AXIS_LANE;
  if (n < LANES && n % 2 === 1) {
    // l'écart à l'axe, arrondi en miroir : 1,5 donne 2 et −1,5 donne −2
    const x = (i - (n - 1) / 2) * ((LANES - 1) / (n - 1));
    return AXIS_LANE + Math.sign(x) * Math.round(Math.abs(x));
  }
  return Math.min(LANES - 1, Math.floor((i * LANES) / Math.max(1, n)));
}

export interface RouteInput {
  pads: readonly Pt[];
  /** Bas du champ de la phrase. */
  fieldBottom: number;
  /** Pointe droite de l'horizon du sceau. */
  tip: Pt;
}

/** La montée la plus raide qu'on trace (dx/dy) : en deçà, les pistes ne se lisent plus, on n'en trace aucune. */
const MIN_RUN = 0.25;

/**
 * Une polyligne par pastille : elle descend sur sa voie, file vers le sceau, monte (ou descend) jusqu'au faisceau et
 * s'y resserre sur la pointe ; la voie du milieu se pose exactement sur l'horizon : c'est l'axe, à l'or. Toutes les
 * montées ont la même pente, 45° quand la place le permet, sinon celle que demande la pastille la plus serrée : des
 * montées parallèles, chacune partant d'autant plus loin que sa voie est loin du faisceau, ne se coupent jamais (une
 * pente par piste les croisait dans les fenêtres basses). Sans place pour monter, aucune piste, comme sans sceau.
 */
export function routes({ pads, fieldBottom, tip }: RouteInput): Pt[][] {
  const n = pads.length;
  const [tx, ty] = tip;
  const elbowX = tx + ELBOW;
  const lane = (k: number) => {
    const laneY = fieldBottom + LANE_DROP + k * LANE_GAP;
    const bundleY = ty + (k - AXIS_LANE) * BUNDLE_GAP;
    return { laneY, bundleY, rise: Math.abs(laneY - bundleY) };
  };
  let run = 1;
  for (const [i, [px]] of pads.entries()) {
    const { rise } = lane(laneOf(i, n));
    const room = px - 4 - elbowX;
    if (rise > 0) run = Math.min(run, room / rise);
    else if (room < 0) run = -1;
  }
  if (run < MIN_RUN) return [];
  return pads.map(([px, py], i) => {
    const k = laneOf(i, n);
    const { laneY, bundleY, rise } = lane(k);
    const pts: Pt[] = [
      [px, py],
      [px, laneY],
      [elbowX + rise * run, laneY],
      [elbowX, bundleY],
      [tx + 10 + Math.abs(k - AXIS_LANE) * 2, bundleY],
      [tx, ty],
    ];
    return pts;
  });
}

/* ─── Outils de tracé ─── */

/** Une polyligne, ses segments mesurés une fois. */
export interface Poly {
  pts: readonly Pt[];
  seg: readonly number[];
  len: number;
}

export function poly(pts: readonly Pt[]): Poly {
  const seg: number[] = [];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l);
    len += l;
  }
  return { pts, seg, len };
}

/** La même polyligne, en miroir autour de x = `cx`. */
const mirror = (p: Poly, cx: number): Poly => ({ pts: p.pts.map(([x, y]): Pt => [2 * cx - x, y]), seg: p.seg, len: p.len });

/** Point à la distance `d` le long d'une polyligne. */
export function pointAt(p: Poly, d: number): Pt {
  let left = d;
  for (let i = 0; i < p.seg.length; i++) {
    const l = p.seg[i]!;
    if (left <= l) {
      const a = p.pts[i]!;
      const b = p.pts[i + 1]!;
      const k = l ? left / l : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    left -= l;
  }
  return p.pts[p.pts.length - 1] ?? [0, 0];
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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

/* ─── Le circuit qui s'étend du point d'or (celui du chargement, aux couleurs du 4.1) ─── */

export interface RingBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** L'anneau du mot : il contient le mot et le sceau plié, symétrique autour du point d'or, comme celui du chargement. */
export function ringAround(cx: number, cy: number, boxes: readonly RectLike[]): RingBox {
  let half = 40;
  let top = cy - 4;
  let bottom = cy + 4;
  for (const b of boxes) {
    half = Math.max(half, cx - b.left, b.left + b.width - cx);
    top = Math.min(top, b.top);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return { x0: Math.round(cx - half - 24), x1: Math.round(cx + half + 24), y0: Math.round(top - 28), y1: Math.round(bottom + 28) };
}

interface Trace {
  path: Poly;
  delay: number;
  speed: number;
  axis: boolean;
  alpha: number;
}

export interface Spread {
  traces: Trace[];
  pixels: { x: number; y: number; at: number; base: number; axis: boolean }[];
  frames: { half: Poly; other: Poly; delay: number; alpha: number }[];
  ticks: { x: number; y: number; w: number; h: number; at: number; major: boolean }[];
  ring: RingBox & { half: Poly; other: Poly };
  cx: number;
  cy: number;
}

/** Le plan du circuit, centré sur le point d'or (cx, cy), autour de l'anneau du mot. */
export function buildSpread(W: number, H: number, cx: number, cy: number, ring: RingBox): Spread {
  const traces: Trace[] = [];
  const add = (pts: Pt[], o: Omit<Trace, 'path'>) => traces.push({ path: poly(pts), ...o });

  // Bus vertical : quinze voies à 16 px sur l'anneau, qui s'évasent vers le haut et vers le bas.
  const V = 7;
  for (const dir of [-1, 1] as const) {
    const from = dir < 0 ? ring.y0 : ring.y1;
    const to = dir < 0 ? 72 : H - 72;
    const room = Math.abs(to - from) - 32;
    if (room < 16) continue;
    const flare = Math.max(0, Math.min(24, (room - 8) / V));
    for (let j = -V; j <= V; j++) {
      const xs = cx + j * 16;
      const xe = cx + j * (16 + flare);
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
        { delay: 120 + Math.abs(j) * 26 + (dir > 0 ? 50 : 0), speed: 0.75, axis: false, alpha: j === 0 ? 0.22 : 0.11 },
      );
    }
  }
  // Bus latéraux : sept voies à 12 px, évasées à 32 px ; l'axe, sur l'horizon, est à l'or et prend le relais du point.
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
      add(pts, { delay: k === 0 ? SPLIT_MS - 20 : 120 + Math.abs(k) * 40, speed: k === 0 ? 1.2 : 0.95, axis: k === 0, alpha: k === 0 ? 0.7 : 0.11 });
    }
  }

  const rnd = mulberry(W * 7919 + H);
  const pixels: Spread['pixels'] = [];
  for (const t of traces) {
    for (let d = 6; d < t.path.len; d += 8) {
      const [x, y] = pointAt(t.path, d);
      pixels.push({ x, y, at: t.delay + d / t.speed, base: t.axis ? 0.5 : 0.2, axis: t.axis });
    }
  }
  const diag = Math.hypot(W, H);
  for (let y = 48; y < H - 48; y += 8) {
    for (let x = 48; x < W - 48; x += 8) {
      if (rnd() > 0.04) continue;
      if (x > ring.x0 - 8 && x < ring.x1 + 8 && y > ring.y0 - 8 && y < ring.y1 + 8) continue;
      const dist = Math.hypot(x - cx, y - cy);
      pixels.push({ x, y, at: 120 + (dist / diag) * 900 + rnd() * 220, base: 0.07, axis: rnd() < 0.05 });
    }
  }

  const frames = [24, 32].map((m, i) => {
    const c = 12;
    const half = poly([
      [W / 2, m],
      [W - m - c, m],
      [W - m, m + c],
      [W - m, H - m - c],
      [W - m - c, H - m],
      [W / 2, H - m],
    ]);
    return { half, other: mirror(half, W / 2), delay: 60 + i * 120, alpha: i ? 0.05 : 0.09 };
  });

  const ticks: Spread['ticks'] = [];
  for (let y = 64; y <= H - 64; y += 8) {
    const major = Math.round((y - cy) / 8) % 5 === 0;
    const len = major ? 7 : 3;
    const at = 220 + Math.abs(y - cy) * 0.8;
    ticks.push({ x: 33, y, w: len, h: 1, at, major }, { x: W - 33 - len, y, w: len, h: 1, at, major });
  }
  for (let x = 80; x <= W - 80; x += 8) {
    const major = Math.round((x - cx) / 8) % 5 === 0;
    if (!major) continue;
    const at = 280 + Math.abs(x - cx) * 0.5;
    ticks.push({ x, y: 33, w: 1, h: 5, at, major }, { x, y: H - 33 - 5, w: 1, h: 5, at, major });
  }

  const C = 8;
  const half = poly([
    [cx, ring.y0],
    [ring.x1 - C, ring.y0],
    [ring.x1, ring.y0 + C],
    [ring.x1, ring.y1 - C],
    [ring.x1 - C, ring.y1],
    [cx, ring.y1],
  ]);
  return { traces, pixels, frames, ticks, ring: { ...ring, half, other: mirror(half, cx) }, cx, cy };
}

/* ─── Couleurs : le canevas ne lit pas var(--x) ─── */

type Rgb = readonly [number, number, number];

/** « #rrggbb », « #rgb » ou « rgb(r, g, b) » ; à défaut, `fallback`. */
export function rgbOf(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a})`;

/* ─── Le moteur ─── */

export interface UnlockCircuitOptions {
  timeline: UnlockTimeline;
  /** Le temps de l'ouverture (ms depuis l'admission), abrègement compris : l'horloge du verrou. */
  clock: () => number;
  /** L'ouverture a été abrégée : seules les lignes du châssis se tracent, le temps que le voile se lève. */
  abridged: () => boolean;
  /** Les cases des glyphes de la phrase, dans l'ordre. */
  pads: () => DOMRect[];
  /** Le champ de la phrase. */
  field: () => DOMRect | null;
  /** Le sceau, tel qu'il est posé à l'instant (glissé, plié). */
  seal: () => DOMRect | null;
  /** Ce qui porte le sceau : le moteur le fait glisser et plier à son horloge, celle de sa lumière. */
  sealCarrier: () => HTMLElement | null;
  /** Le mot « DESK UNLOCKED ». */
  word: () => DOMRect | null;
  /** Les lignes du châssis du desk monté dessous. */
  chassis: () => { title: DOMRect | null; rail: DOMRect | null; status: DOMRect | null };
}

/** Paliers d'intensité des nano-pixels et des règles : un remplissage par palier, non un par pixel. */
const LEVELS = 12;

export function runUnlockCircuit(canvas: HTMLCanvasElement, opts: UnlockCircuitOptions): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const tl = opts.timeline;
  const css = getComputedStyle(document.documentElement);
  const IVORY = rgbOf(css.getPropertyValue('--text-0'), [245, 242, 234]);
  const GOLD = rgbOf(css.getPropertyValue('--gold'), [204, 176, 102]);
  const ivoryInk = rgba(IVORY, 1);
  const goldInk = rgba(GOLD, 1);
  // Les lignes du sceau, celles du master : la lumière les remplit par-dessus les siennes.
  const shapes = sealShapes('negative');
  const rings = ringArcs(shapes.rings.map((sh) => sh.d).join(' ')).map((ring) => ({ r: ring.r, path: new Path2D(ring.d) }));
  const horizon = shapes.horizon.map((sh) => ({ path: new Path2D(sh.d), rule: (sh.evenOdd ? 'evenodd' : 'nonzero') as CanvasFillRule }));

  let dpr = 1;
  let W = 0;
  let H = 0;
  let frameLeft = 0;
  let frameTop = 0;
  let spread: Spread | null = null;
  let spreadKey = '';
  /** Les pistes, relues à chaque image jusqu'au départ du sceau ; ensuite figées, le temps de s'éteindre. */
  let traces: Poly[] | null = null;
  /** Le glissement posé sur le sceau à l'image précédente (px CSS de l'élément) : sans lui, sa place au repos. */
  let shift = 0;
  /** Les éclats, peints une fois par densité de pixels : un halo par encre. */
  let sprites: { dpr: number; ivory: HTMLCanvasElement; gold: HTMLCanvasElement } | null = null;
  const buckets: number[][] = Array.from({ length: LEVELS * 2 }, () => []);
  let raf = 0;

  const halo = (rgb: Rgb, peak: number) => {
    const size = Math.max(2, Math.ceil(24 * dpr));
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g) {
      const r = size / 2;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, rgba(rgb, peak));
      grad.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    return c;
  };

  const resize = () => {
    const f = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.max(1, Math.round(f.width * dpr));
    const bh = Math.max(1, Math.round(f.height * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    W = f.width;
    H = f.height;
    frameLeft = f.left;
    frameTop = f.top;
    if (!sprites || sprites.dpr !== dpr) sprites = { dpr, ivory: halo(IVORY, 0.42), gold: halo(GOLD, 0.6) };
  };
  const local = (r: DOMRect): RectLike => ({ left: r.left - frameLeft, top: r.top - frameTop, width: r.width, height: r.height });

  const draw = () => {
    resize();
    const t = opts.clock();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const hair = 1 / dpr;
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
    const px = (v: number) => Math.round(v * dpr) / dpr;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    // Tout s'éteint quand le voile se lève : le desk garde ses propres lignes.
    const veil = 1 - clamp01((t - tl.reveal - 80) / FADE_MS);
    // Les cadres et leurs règles se retirent quand les lignes du châssis prennent leur place.
    const rule = veil * (1 - clamp01((t - tl.form) / (FORM_MS * 0.6)));

    const strokeTo = (p: Poly, upTo: number) => {
      const first = p.pts[0];
      if (!first) return;
      let left = upTo;
      ctx.beginPath();
      ctx.moveTo(snap(first[0]), snap(first[1]));
      for (let i = 0; i < p.seg.length && left > 0; i++) {
        const l = p.seg[i]!;
        const a = p.pts[i]!;
        const b = p.pts[i + 1]!;
        const k = l ? Math.min(1, left / l) : 1;
        ctx.lineTo(snap(a[0] + (b[0] - a[0]) * k), snap(a[1] + (b[1] - a[1]) * k));
        left -= l;
      }
      ctx.stroke();
    };
    const photon = (x: number, y: number, gold: boolean, strength: number) => {
      if (strength <= 0 || !sprites) return;
      ctx.globalAlpha = Math.min(1, strength);
      ctx.drawImage(gold ? sprites.gold : sprites.ivory, x - 12, y - 12, 24, 24);
      ctx.fillStyle = gold ? goldInk : ivoryInk;
      ctx.fillRect(px(x) - hair, px(y) - hair, 3 * hair, 3 * hair);
      ctx.globalAlpha = 1;
    };
    const tail = (p: Poly, head: number, length: number, gold: boolean, strength: number) => {
      ctx.strokeStyle = gold ? goldInk : ivoryInk;
      for (let k = 0; k < length; k += 5) {
        const s0 = head - k;
        if (s0 <= 0) break;
        const [x1, y1] = pointAt(p, s0);
        const [x2, y2] = pointAt(p, Math.max(0, s0 - 5));
        ctx.globalAlpha = Math.max(0, (gold ? 0.85 : 0.6) * (1 - k / length) * strength);
        ctx.beginPath();
        ctx.moveTo(snap(x2), snap(y2));
        ctx.lineTo(snap(x1), snap(y1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const ink = (gold: boolean, alpha: number) => {
      ctx.strokeStyle = gold ? goldInk : ivoryInk;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    };
    /** Les points d'un palier d'intensité, remplis d'un coup. */
    const flushBuckets = () => {
      for (let b = 0; b < buckets.length; b++) {
        const list = buckets[b]!;
        if (!list.length) continue;
        ctx.fillStyle = b >= LEVELS ? goldInk : ivoryInk;
        ctx.globalAlpha = ((b % LEVELS) + 1) / LEVELS;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 4) ctx.rect(list[k]!, list[k + 1]!, list[k + 2]!, list[k + 3]!);
        ctx.fill();
        list.length = 0;
      }
      ctx.globalAlpha = 1;
    };
    const bucket = (gold: boolean, alpha: number, x: number, y: number, w: number, h: number) => {
      if (alpha <= 0.5 / LEVELS) return;
      const level = Math.min(LEVELS - 1, Math.max(0, Math.round(alpha * LEVELS) - 1));
      buckets[(gold ? LEVELS : 0) + level]!.push(x, y, w, h);
    };

    // Le sceau glisse au centre de l'écran et se plie dans son horizon à la même horloge que sa lumière : posé ici, à
    // chaque image, puis relu ; une transition de la feuille, menée ailleurs, laisserait la lumière en retard d'une image.
    const carrier = opts.sealCarrier();
    if (carrier && t >= tl.glide) {
      // L'écart au centre de l'écran se relit à chaque image, depuis la place du sceau au repos : un redimensionnement
      // (et le zoom automatique qui le suit) pendant le glissement ne décentre ni le sceau ni le circuit qui en part.
      const r = opts.seal();
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const rest = r && r.width > 0 ? r.left + r.width / 2 - shift * zoom : null;
      const dx = rest === null ? 0 : (frameLeft + W / 2 - rest) / zoom;
      const g = easeInOut(clamp01((t - tl.glide) / GLIDE_MS));
      const f = Math.pow(clamp01((t - tl.fold) / FOLD_MS), 2.2);
      shift = Number((dx * g).toFixed(2));
      carrier.style.translate = `${shift.toFixed(2)}px 0`;
      carrier.style.scale = `1 ${(1 - (1 - SEAL_FOLDED) * f).toFixed(4)}`;
      carrier.style.opacity = (t < tl.spread ? 1 - 0.5 * clamp01((t - tl.fold) / FOLD_MS) : 0.5 * (1 - clamp01((t - tl.spread) / 200))).toFixed(3);
    }
    const sealRect = opts.seal();
    const seal = sealRect && sealRect.width > 0 ? sealMap(local(sealRect)) : null;
    const center: Pt = seal ? seal.at(0, SEAL_HZ_Y) : [W / 2, H / 2];
    const quiet = opts.abridged();

    // 1 · Les pistes des pastilles vers la pointe de l'horizon, relues à chaque image tant que le sceau est en place.
    //     Sans sceau (fenêtre étroite : la fiche seule), pas de pistes ; le point d'or s'allume au centre de l'écran.
    if (!seal || quiet) traces = null;
    else if (t >= tl.trace - 40 && t < tl.glide) {
      const field = opts.field();
      const pads = opts.pads().map((r): Pt => [r.left - frameLeft + r.width / 2, r.top - frameTop + r.height * 0.58]);
      if (field && pads.length) {
        traces = routes({ pads, fieldBottom: field.bottom - frameTop, tip: seal.at(SEAL_HZ_TIP, SEAL_HZ_Y) }).map(poly);
      }
    }
    const busFade = 1 - clamp01((t - tl.glide) / 360);
    if (traces && busFade > 0) {
      traces.forEach((tr, i) => {
        const start = tl.sets[i] ?? tl.trace;
        const d = ((t - start) / TRAVEL_MS) * tr.len;
        if (d <= 0) return;
        const axis = laneOf(i, traces!.length) === AXIS_LANE;
        const drawn = Math.min(tr.len, d);
        ctx.lineWidth = axis ? Math.max(hair, 0.6) : hair;
        ink(axis, (axis ? 0.75 : 0.3) * busFade);
        strokeTo(tr, drawn);
        ctx.lineWidth = hair;
        const [sx, sy] = tr.pts[0]!;
        ctx.fillStyle = axis ? goldInk : ivoryInk;
        ctx.globalAlpha = 0.9 * busFade;
        ctx.fillRect(px(sx) - 1, px(sy) - 1, 3, 3);
        ctx.globalAlpha = 1;
        if (d < tr.len) {
          tail(tr, drawn, 44, axis, busFade);
          const [hx, hy] = pointAt(tr, drawn);
          photon(hx, hy, axis, busFade);
        }
      });
    }

    // 2 · La lumière court sur les lignes du sceau : l'horizon d'une pointe à l'autre, puis les trois anneaux, du dehors
    //     au dedans, de leurs pointes droites à leurs pointes gauches par le haut et par le bas. Ce sont les tracés du
    //     master, posés exactement sur les siens ; ils suivent le sceau qui glisse et se plie. Le halo est un double
    //     trait, non un flou : le flou du canevas coûte trop sur une si grande surface.
    if (seal && !quiet && t >= tl.seal) {
      const lit = 1 - clamp01((t - tl.fold) / FOLD_MS);
      if (lit > 0) {
        ctx.save();
        ctx.setTransform(dpr * seal.sx, 0, 0, dpr * seal.sy, dpr * seal.ox, dpr * seal.oy);
        ctx.strokeStyle = ivoryInk;
        ctx.fillStyle = ivoryInk;
        const glow = (draw: () => void) => {
          for (const [w, a] of [
            [7, 0.06],
            [3.5, 0.12],
          ] as const) {
            ctx.lineWidth = w / Math.max(seal.sx, 1e-3);
            ctx.globalAlpha = a * lit;
            draw();
          }
          ctx.globalAlpha = lit;
        };
        const hp = easeInOut(clamp01((t - tl.seal) / HORIZON_MS));
        if (hp > 0) {
          const hx = SEAL_HZ_TIP - 2 * SEAL_HZ_TIP * hp;
          ctx.save();
          ctx.beginPath();
          ctx.rect(hx, -160, SEAL_HZ_TIP + 12 - hx, 320);
          ctx.clip();
          glow(() => {
            for (const h of horizon) ctx.stroke(h.path);
          });
          for (const h of horizon) ctx.fill(h.path, h.rule);
          ctx.restore();
        }
        const heads: { p: number; r: number }[] = [];
        rings.forEach(({ r, path }, i) => {
          const p = easeInOut(clamp01((t - tl.seal - RING_LEAD_MS - i * RING_STEP_MS) / RING_MS));
          if (p <= 0) return;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 420, 0, -Math.PI * p, true);
          ctx.closePath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 420, 0, Math.PI * p, false);
          ctx.closePath();
          ctx.clip();
          glow(() => ctx.stroke(path));
          ctx.fill(path);
          ctx.restore();
          if (p < 1) heads.push({ p, r });
        });
        ctx.restore();
        // Les têtes de lumière : sur l'horizon, puis sur chaque anneau, en haut et en bas.
        if (hp > 0 && hp < 1) photon(...seal.at(SEAL_HZ_TIP - 2 * SEAL_HZ_TIP * hp, SEAL_HZ_Y), false, lit);
        for (const h of heads) {
          const a = Math.PI * h.p;
          photon(...seal.at(h.r * Math.cos(a), -h.r * Math.sin(a)), false, lit);
          photon(...seal.at(h.r * Math.cos(a), h.r * Math.sin(a)), false, lit);
        }
        // Chaque piste qui arrive pousse son éclat le long de l'horizon, jusqu'au centre.
        const [rx, ry] = seal.at(SEAL_HZ_TIP, SEAL_HZ_Y);
        for (const at of tl.arrivals) {
          const k = (t - at) / 300;
          if (k < 0 || k > 1) continue;
          photon(rx + (center[0] - rx) * easeOut(k), ry, false, 0.7 * (1 - k) * lit);
        }
      }
    }

    // 3 · Le point d'or, au centre du sceau ; il suit le sceau qui glisse, s'embrase quand le sceau se plie dans sa
    //     ligne (toute la lumière s'y rassemble), puis s'étire sur l'axe.
    const split = clamp01((t - tl.spread) / SPLIT_MS);
    const flare = easeOut(clamp01((t - tl.fold) / FOLD_MS));
    const gold = quiet ? 0 : clamp01((t - tl.gold) / 200) * (1 - split);
    if (gold > 0) {
      const [gx, gy] = center;
      const R = 18 + 22 * flare;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
      g.addColorStop(0, rgba(GOLD, (0.75 + 0.25 * flare) * gold));
      g.addColorStop(0.35, rgba(GOLD, (0.22 + 0.2 * flare) * gold));
      g.addColorStop(1, rgba(GOLD, 0));
      ctx.fillStyle = g;
      ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
      const half = (12 + 26 * flare) * easeOut(gold);
      ctx.fillStyle = goldInk;
      ctx.globalAlpha = gold;
      ctx.fillRect(gx - half, px(gy), half * 2, Math.max(hair, 1));
      ctx.fillRect(px(gx) - 1, px(gy) - 1, 3, 3);
      ctx.globalAlpha = 1;
    }

    // 4 · Du point d'or, le circuit s'étend jusqu'aux bords, autour du mot.
    const ts = t - tl.spread;
    if (ts > 0 && veil > 0 && !quiet) {
      const key = `${Math.round(W)}|${Math.round(H)}`;
      if (!spread || key !== spreadKey) {
        const [cx, cy] = center;
        const boxes: RectLike[] = [];
        const word = opts.word();
        if (word && word.width > 0) boxes.push(local(word));
        if (sealRect && sealRect.width > 0) boxes.push({ left: cx - (sealRect.width / 2) * 0.92, top: cy - 2, width: sealRect.width * 0.92, height: 4 });
        spread = buildSpread(W, H, cx, cy, ringAround(cx, cy, boxes));
        spreadKey = key;
      }
      const L = spread;
      // Le point d'or s'étire sur l'axe jusqu'à l'anneau, deux éclats en tête ; l'axe d'or prend le relais au-delà. Le mot
      // se déplie de cette ligne, qui s'efface sous lui.
      const reach = easeOut(split);
      const d = (L.ring.x1 - L.cx) * reach;
      const line = 1 - clamp01((ts - WORD_AT_MS) / (WORD_MS * 0.8));
      if (line > 0 && d > 0) {
        const g = ctx.createLinearGradient(L.cx - d, 0, L.cx + d, 0);
        g.addColorStop(0, rgba(GOLD, 0.2 * line));
        g.addColorStop(0.5, rgba(GOLD, 0.95 * line));
        g.addColorStop(1, rgba(GOLD, 0.2 * line));
        ctx.fillStyle = g;
        ctx.fillRect(L.cx - d, px(L.cy), 2 * d, Math.max(hair, 1));
      }
      if (split < 1) {
        photon(L.cx + d, L.cy, true, 1 - split * 0.4);
        photon(L.cx - d, L.cy, true, 1 - split * 0.4);
      }
      ctx.lineWidth = hair;
      if (rule > 0) {
        for (const f of L.frames) {
          const p = easeInOut(clamp01((ts - f.delay) / 700));
          if (p <= 0) continue;
          ink(false, f.alpha * rule);
          strokeTo(f.half, f.half.len * p);
          strokeTo(f.other, f.other.len * p);
        }
        ctx.globalAlpha = 1;
        for (const tk of L.ticks) {
          const a = clamp01((ts - tk.at) / 180) * rule;
          if (a > 0) bucket(false, (tk.major ? 0.15 : 0.07) * a, px(tk.x), px(tk.y), tk.w === 1 ? hair : tk.w, tk.h === 1 ? hair : tk.h);
        }
      }
      for (const tr of L.traces) {
        const dist = (ts - tr.delay) * tr.speed;
        if (dist <= 0) continue;
        const drawn = Math.min(tr.path.len, dist);
        ctx.lineWidth = tr.axis ? Math.max(hair, 0.6) : hair;
        ink(tr.axis, tr.alpha * veil);
        strokeTo(tr.path, drawn);
        ctx.lineWidth = hair;
        if (dist < tr.path.len) {
          tail(tr.path, drawn, 46, tr.axis, veil);
          const [hx, hy] = pointAt(tr.path, drawn);
          photon(hx, hy, tr.axis, veil);
        } else {
          const since = ts - tr.delay - tr.path.len / tr.speed;
          const [vx, vy] = tr.path.pts[tr.path.pts.length - 1] ?? [0, 0];
          ink(tr.axis, (0.3 + 0.6 * Math.exp(-since / 180)) * veil * (tr.axis ? 1 : 0.7));
          ctx.strokeRect(snap(vx - 2), snap(vy - 2), 4, 4);
        }
      }
      ctx.globalAlpha = 1;
      for (const p of L.pixels) {
        if (ts < p.at) continue;
        bucket(p.axis, Math.min(1, p.base + 0.7 * Math.exp(-(ts - p.at) / 240)) * veil, Math.round(p.x), Math.round(p.y), 1, 1);
      }
      flushBuckets();
      // L'anneau du mot, ses équerres à l'or.
      const rp = easeOut(clamp01((ts - 60) / 480));
      if (rp > 0) {
        ink(false, 0.15 * veil);
        strokeTo(L.ring.half, L.ring.half.len * rp);
        strokeTo(L.ring.other, L.ring.other.len * rp);
        const ba = clamp01((ts - 380) / 220) * veil;
        if (ba > 0) {
          const off = 8 * (1 - easeOut(ba));
          const B = 10;
          ink(true, 0.85 * ba);
          ctx.lineWidth = Math.max(hair, 0.6);
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
          ctx.lineWidth = hair;
        }
        ctx.globalAlpha = 1;
      }
    }

    // 5 · Le desk se forme : les lignes du châssis se tracent depuis le point d'or là où sont celles du desk, puis
    //     s'éteignent dans les siennes une fois le voile levé.
    const tf = t - tl.form;
    const settle = 1 - clamp01((t - tl.reveal - 200) / FADE_MS);
    if (tf > 0 && settle > 0) {
      const c = opts.chassis();
      const p = easeInOut(clamp01(tf / FORM_MS));
      const [ox, oy] = spread ? [spread.cx, spread.cy] : center;
      const top = c.title ? c.title.bottom - frameTop - 1 : null;
      const bottom = c.status ? c.status.top - frameTop : null;
      const lines = () => {
        ctx.beginPath();
        const half = Math.max(ox, W - ox) * p;
        for (const y of [top, bottom]) {
          if (y === null) continue;
          ctx.moveTo(snap(Math.max(0, ox - half)), snap(y));
          ctx.lineTo(snap(Math.min(W, ox + half)), snap(y));
        }
        if (c.rail) {
          const x = c.rail.right - frameLeft - 1;
          ctx.moveTo(snap(x), snap(oy + ((top ?? 0) - oy) * p));
          ctx.lineTo(snap(x), snap(oy + ((bottom ?? H) - oy) * p));
        }
        ctx.stroke();
      };
      ctx.strokeStyle = ivoryInk;
      // Leur halo, deux traits plus larges et plus pâles ; puis la ligne, au pixel.
      for (const [w, a] of [
        [5, 0.05],
        [2.5, 0.12],
        [hair, 0.85],
      ] as const) {
        ctx.lineWidth = w;
        ctx.globalAlpha = a * settle;
        lines();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = hair;
    }

    if (t < tl.end) raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}
