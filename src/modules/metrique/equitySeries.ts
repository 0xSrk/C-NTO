import { customSeriesDefaultOptions, type CustomData, type CustomSeriesOptions, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type PaneRendererCustomData, type PriceToCoordinateConverter, type Time } from 'lightweight-charts';
import { labelLeft, signaturePixel, trame, type Dot, type Pt } from './equityPaint';

/**
 * Séries de la courbe d'équité, peintes au trait du Lab : traits d'un pixel légèrement
 * lumineux, trame de points, repères fins, pixel rouge signature. Couleurs fournies par
 * l'appelant, lues dans les jetons.
 */

export interface Ink {
  line: string;
  pos: string;
  neg: string;
  red: string;
  faint: string;
  label: string;
  zero: string;
  mono: string;
}

export interface EquityRow extends CustomData<Time> {
  equity: number;
  peak: number;
  drawdown: number;
  pnl: number;
}

/**
 * Indices logiques des pas ; `NONE` (−1) pour aucun. Pas de `null` : `applyOptions` fusionne les
 * options et ignore un `null` posé sur un nombre, le repère resterait affiché.
 */
export const NONE = -1;

export interface Marks {
  /** Plus haut à annoter (hors dernier pas), et son texte. */
  high: number;
  highLabel: string;
  /** Creux du plus grand drawdown, et son texte. */
  trough: number;
  troughLabel: string;
}

export interface TraitOptions extends CustomSeriesOptions {
  ink: Ink;
  marks: Marks;
  /** Pas survolé, ou `NONE`. */
  focus: number;
}

type Scope = Parameters<Parameters<Parameters<ICustomSeriesPaneRenderer['draw']>[0]['useBitmapCoordinateSpace']>[0]>[0];
type Bars = PaneRendererCustomData<Time, EquityRow>['bars'];

const NO_MARKS: Marks = { high: NONE, highLabel: '', trough: NONE, troughLabel: '' };
const NO_INK: Ink = { line: 'gray', pos: 'gray', neg: 'gray', red: 'gray', faint: 'gray', label: 'gray', zero: 'gray', mono: 'monospace' };

/** `#rrggbb` ou `rgb(a)(…)` → `rgba(r,g,b,a)` ; une autre couleur est rendue telle quelle. */
export function alpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb?.[1]) {
    const [r, g, b] = rgb[1].split(',').map((part) => part.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

/**
 * Barres visibles, plus un voisin de chaque côté pour que le trait entre et sorte du cadre.
 * La bibliothèque ne recalcule l'abscisse que des barres visibles : celle d'un voisin peut dater
 * d'un rendu précédent (zoom, défilement). Elle est donc reprise de l'espacement des barres.
 */
export function visible(data: PaneRendererCustomData<Time, EquityRow> | null): Bars {
  if (!data?.visibleRange) return [];
  const { from, to } = data.visibleRange;
  const inner = data.bars.slice(Math.max(0, from), Math.min(data.bars.length, to));
  const first = inner[0];
  const last = inner[inner.length - 1];
  if (!first || !last) return [];
  const before = data.bars[from - 1];
  const after = data.bars[to];
  return [
    ...(before ? [{ ...before, x: first.x - data.barSpacing * (first.time - before.time) }] : []),
    ...inner,
    ...(after ? [{ ...after, x: last.x + data.barSpacing * (after.time - last.time) }] : []),
  ];
}

function points(bars: Bars, scope: Scope, conv: PriceToCoordinateConverter, pick: (row: EquityRow) => number): (Pt & { index: number })[] {
  const out: (Pt & { index: number })[] = [];
  for (const bar of bars) {
    const y = conv(pick(bar.originalData));
    if (y === null) continue;
    out.push({ x: bar.x * scope.horizontalPixelRatio, y: y * scope.verticalPixelRatio, index: bar.time });
  }
  return out;
}

/** Trame en huit niveaux : un chemin et un seul remplissage par niveau. */
function paintDots(ctx: CanvasRenderingContext2D, dots: readonly Dot[], color: string, strength: number): void {
  const levels: Dot[][] = Array.from({ length: 8 }, () => []);
  for (const dot of dots) levels[Math.min(7, Math.floor(dot.k * 8))]!.push(dot);
  ctx.fillStyle = color;
  levels.forEach((level, i) => {
    if (!level.length) return;
    ctx.globalAlpha = strength * (0.18 + 0.82 * ((i + 0.5) / 8) ** 1.4);
    ctx.beginPath();
    for (const dot of level) {
      ctx.moveTo(dot.x + dot.r, dot.y);
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    }
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/** Trait d'un pixel, légèrement lumineux : un halo large et pâle, puis le fil net. */
function glowLine(ctx: CanvasRenderingContext2D, pts: readonly Pt[], color: string, width: number, glow: number): void {
  if (pts.length < 2) return;
  const path = new Path2D();
  pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.09;
  ctx.lineWidth = width * 4;
  ctx.stroke(path);
  ctx.globalAlpha = 0.95;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/** Filet horizontal pointillé d'un pixel physique. */
function hairDots(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, color: string, gap: number, a: number): void {
  const yy = Math.round(y);
  ctx.fillStyle = color;
  ctx.globalAlpha = a;
  for (let x = Math.ceil(x1 / gap) * gap; x <= x2; x += gap) ctx.fillRect(Math.round(x), yy, 1, 1);
  ctx.globalAlpha = 1;
}

/** Repère au trait : point carré, fil vertical, étiquette en capitales espacées. */
function mark(ctx: CanvasRenderingContext2D, scope: Scope, at: Pt, up: boolean, text: string, color: string, ink: Ink): void {
  const h = scope.horizontalPixelRatio;
  const v = scope.verticalPixelRatio;
  const x = Math.round(at.x) + 0.5;
  const length = 22 * v;
  const end = up ? at.y - length : at.y + length;
  const g = ctx.createLinearGradient(0, at.y, 0, end);
  g.addColorStop(0, alpha(color, 0.85));
  g.addColorStop(1, alpha(color, 0.15));
  ctx.strokeStyle = g;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, at.y + (up ? -3 * v : 3 * v));
  ctx.lineTo(x, end);
  ctx.stroke();
  const s = Math.max(3, Math.round(3 * h));
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(at.x - s / 2), Math.round(at.y - s / 2), s, s);
  ctx.font = `500 ${Math.round(9 * v)}px ${ink.mono}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(1.3 * h).toFixed(1)}px`;
  ctx.textBaseline = up ? 'bottom' : 'top';
  const width = ctx.measureText(text).width;
  const left = labelLeft(x, width, 5 * h, scope.bitmapSize.width - 4 * h);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, left, up ? end + 2 * v : end - 2 * v);
  ctx.globalAlpha = 1;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
}

/** Lueur douce (photon) autour d'un point. */
function photon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, strength: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, alpha(color, 0.42 * strength));
  g.addColorStop(0.35, alpha(color, 0.14 * strength));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** Le pixel rouge signature du Lab. */
function pixel(ctx: CanvasRenderingContext2D, scope: Scope, at: Pt, ink: Ink): void {
  const h = scope.horizontalPixelRatio;
  photon(ctx, at.x, at.y, 20 * h, ink.red, 1);
  for (const cell of signaturePixel(at.x, at.y, 1.5 * h, 0.5 * h)) {
    ctx.globalAlpha = cell.alpha;
    ctx.fillStyle = cell.core ? ink.line : ink.red;
    ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
  }
  ctx.globalAlpha = 1;
}

/** Pas survolé : un carré creux d'un pixel, à peine lumineux. */
function focusMark(ctx: CanvasRenderingContext2D, scope: Scope, at: Pt, color: string): void {
  const s = Math.round(6 * scope.horizontalPixelRatio);
  photon(ctx, at.x, at.y, 10 * scope.horizontalPixelRatio, color, 0.5);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(at.x - s / 2) + 0.5, Math.round(at.y - s / 2) + 0.5, s, s);
}

abstract class TraitView implements ICustomSeriesPaneView<Time, EquityRow, TraitOptions> {
  protected data: PaneRendererCustomData<Time, EquityRow> | null = null;
  protected options: TraitOptions = this.defaultOptions();

  update(data: PaneRendererCustomData<Time, EquityRow>, options: TraitOptions): void {
    this.data = data;
    this.options = options;
  }

  isWhitespace(data: EquityRow | { time: Time }): data is { time: Time } {
    return (data as Partial<EquityRow>).equity === undefined;
  }

  defaultOptions(): TraitOptions {
    return { ...customSeriesDefaultOptions, ink: NO_INK, marks: NO_MARKS, focus: NONE };
  }

  renderer(): ICustomSeriesPaneRenderer {
    return {
      draw: (target, conv) => {
        target.useBitmapCoordinateSpace((scope) => {
          const bars = visible(this.data);
          if (!bars.length) return;
          scope.context.save();
          this.paint(scope, bars, conv);
          scope.context.restore();
        });
      },
    };
  }

  abstract priceValueBuilder(row: EquityRow): number[];
  protected abstract paint(scope: Scope, bars: Bars, conv: PriceToCoordinateConverter): void;
}

/** Volet principal : trame sous la crête, fil lumineux, plus haut pointillé, repères, pixel signature. */
export class EquityTrait extends TraitView {
  priceValueBuilder(row: EquityRow): number[] {
    return [Math.max(row.peak, row.equity, 0), Math.min(row.equity, 0), row.equity];
  }

  protected paint(scope: Scope, bars: Bars, conv: PriceToCoordinateConverter): void {
    const ctx = scope.context;
    const { ink, marks, focus } = this.options;
    const h = scope.horizontalPixelRatio;
    const zero = conv(0);
    if (zero === null) return;
    const base = zero * scope.verticalPixelRatio;
    const width = scope.bitmapSize.width;
    const pts = points(bars, scope, conv, (row) => row.equity);
    const highs = points(bars, scope, conv, (row) => row.peak);

    hairDots(ctx, 0, width, base, ink.zero, Math.round(3 * h), 0.9);
    // Plus haut en marches : un filet pointillé qui ne descend jamais.
    for (let i = 0; i < highs.length - 1; i++) {
      const a = highs[i]!;
      const b = highs[i + 1]!;
      hairDots(ctx, a.x, b.x, a.y, ink.faint, Math.round(4 * h), 0.55);
    }

    const plan = { pitch: Math.max(3, Math.round(4 * h)), fade: 64 * scope.verticalPixelRatio, rMin: 0.32 * h, rMax: 1.15 * h };
    const dots = trame(pts, base, plan, { left: 0, right: width });
    paintDots(
      ctx,
      dots.filter((dot) => dot.y <= base),
      ink.line,
      0.66,
    );
    paintDots(
      ctx,
      dots.filter((dot) => dot.y > base),
      ink.neg,
      0.75,
    );

    const lineWidth = Math.max(1, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, base);
    ctx.clip();
    glowLine(ctx, pts, ink.line, lineWidth, 6 * h);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, base, width, scope.bitmapSize.height - base);
    ctx.clip();
    glowLine(ctx, pts, ink.neg, lineWidth, 6 * h);
    ctx.restore();

    const last = this.data?.bars[this.data.bars.length - 1]?.time;
    const at = (index: number | undefined) => (index === undefined || index === NONE ? undefined : pts.find((p) => p.index === index));
    const high = at(marks.high);
    if (high && marks.high !== last) mark(ctx, scope, high, true, marks.highLabel, ink.label, ink);
    const trough = at(marks.trough);
    if (trough) mark(ctx, scope, trough, false, marks.troughLabel, ink.neg, ink);
    const hovered = at(focus);
    if (hovered && focus !== last) focusMark(ctx, scope, hovered, ink.line);
    const end = last === undefined ? undefined : at(last);
    if (end) pixel(ctx, scope, end, ink);
  }
}

/** P&L par pas : un fil vertical d'un pixel, coiffé d'un carré, gains et pertes. */
export class StemTrait extends TraitView {
  priceValueBuilder(row: EquityRow): number[] {
    return [Math.max(row.pnl, 0), Math.min(row.pnl, 0), row.pnl];
  }

  protected paint(scope: Scope, bars: Bars, conv: PriceToCoordinateConverter): void {
    const ctx = scope.context;
    const { ink, focus } = this.options;
    const h = scope.horizontalPixelRatio;
    const v = scope.verticalPixelRatio;
    const zero = conv(0);
    if (zero === null) return;
    const base = Math.round(zero * v);
    hairDots(ctx, 0, scope.bitmapSize.width, base, ink.zero, Math.round(3 * h), 0.9);
    const cap = Math.max(2, Math.round(2 * h));
    for (const bar of bars) {
      const y = conv(bar.originalData.pnl);
      if (y === null || bar.originalData.pnl === 0) continue;
      const color = bar.originalData.pnl < 0 ? ink.neg : ink.pos;
      const x = Math.round(bar.x * h);
      const top = Math.round(y * v);
      const lit = bar.time === focus;
      ctx.globalAlpha = lit ? 1 : 0.78;
      ctx.shadowColor = color;
      ctx.shadowBlur = (lit ? 6 : 3) * h;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.min(top, base), 1, Math.abs(top - base));
      ctx.fillRect(x - Math.floor(cap / 2), top - Math.floor(cap / 2), cap, cap);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

/** Drawdown sous l'eau : trame suspendue à zéro, bord d'un pixel lumineux. */
export class UnderwaterTrait extends TraitView {
  priceValueBuilder(row: EquityRow): number[] {
    return [0, row.drawdown, row.drawdown];
  }

  protected paint(scope: Scope, bars: Bars, conv: PriceToCoordinateConverter): void {
    const ctx = scope.context;
    const { ink, focus } = this.options;
    const h = scope.horizontalPixelRatio;
    const zero = conv(0);
    if (zero === null) return;
    const base = zero * scope.verticalPixelRatio;
    const pts = points(bars, scope, conv, (row) => row.drawdown);
    hairDots(ctx, 0, scope.bitmapSize.width, base, ink.zero, Math.round(3 * h), 0.9);
    const dots = trame(pts, base, { pitch: Math.max(3, Math.round(4 * h)), fade: 26 * scope.verticalPixelRatio, rMin: 0.3 * h, rMax: 1.05 * h }, { left: 0, right: scope.bitmapSize.width });
    paintDots(ctx, dots, ink.neg, 0.75);
    glowLine(ctx, pts, ink.neg, Math.max(1, h * 0.75), 4 * h);
    const hovered = focus === NONE ? undefined : pts.find((p) => p.index === focus);
    if (hovered && hovered.y > base + 1) photon(ctx, hovered.x, hovered.y, 8 * h, ink.neg, 0.8);
  }
}
