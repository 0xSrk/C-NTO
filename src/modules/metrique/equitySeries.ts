import { customSeriesDefaultOptions, type AutoscaleInfo, type CustomData, type CustomSeriesOptions, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type PaneRendererCustomData, type PriceToCoordinateConverter, type Time } from 'lightweight-charts';
import { hatch, leader, lens, rulerTick, signaturePixel, trame, type Dot, type Pt } from './equityPaint';

/**
 * Séries de la courbe d'équité, peintes au trait du Lab : traits d'un pixel légèrement
 * lumineux, trame de points, repères de la planche (⊕ plus haut, ⊗ creux, borne du plancher),
 * zéro en lentille du sceau, règle de séances, pixel signature. Couleurs fournies par
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
  /** Papier de la carte : le disque sous un glyphe, le carré sous la borne. */
  paper: string;
  mono: string;
}

export interface EquityRow extends CustomData<Time> {
  equity: number;
  peak: number;
  drawdown: number;
  pnl: number;
  /** Ordinal de la séance qu'ouvre ce pas (règle de séances), ou `NONE`. */
  session: number;
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

/** Composants de la planche que la courbe dessine : ⊕ la cible (plus haut), ⊗ la mire (creux), la borne (plancher). */
export type GlyphKey = 'target' | 'mire' | 'borne';
/**
 * Image prête d'un composant, ou `null` tant qu'elle ne l'est pas. Une fonction, pas un objet : `applyOptions`
 * fusionne les objets en profondeur et recopierait une image dans l'autre.
 */
export type GlyphSource = (key: GlyphKey) => CanvasImageSource | null;

export interface TraitOptions extends CustomSeriesOptions {
  ink: Ink;
  marks: Marks;
  /** Pas survolé, ou `NONE`. */
  focus: number;
  glyph: GlyphSource;
  /** Drawdown maximal du plan suivi (> 0) : la borne du volet sous l'eau ; 0 sans plan. */
  floor: number;
  floorLabel: string;
}

type Scope = Parameters<Parameters<Parameters<ICustomSeriesPaneRenderer['draw']>[0]['useBitmapCoordinateSpace']>[0]>[0];
type Bars = PaneRendererCustomData<Time, EquityRow>['bars'];

const NO_MARKS: Marks = { high: NONE, highLabel: '', trough: NONE, troughLabel: '' };
const NO_INK: Ink = { line: 'gray', pos: 'gray', neg: 'gray', red: 'gray', faint: 'gray', label: 'gray', zero: 'gray', paper: 'transparent', mono: 'monospace' };
const NO_GLYPH: GlyphSource = () => null;

/**
 * Échelle du volet sous l'eau avec la borne du plan : la plage des données, étendue jusqu'au plancher (−`floor`) pour
 * que la borne reste en vue. Sans plan (`floor` nul), la plage des données telle quelle.
 */
export function floorRange(info: AutoscaleInfo | null, floor: number): AutoscaleInfo | null {
  if (!(floor > 0)) return info;
  const range = info?.priceRange;
  return { ...info, priceRange: { minValue: Math.min(range?.minValue ?? 0, -floor), maxValue: Math.max(range?.maxValue ?? 0, 0) } };
}

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

/** Repère de la planche : disque de papier, glyphe du composant, connecteur fini par un petit cercle, étiquette. */
function glyphMark(ctx: CanvasRenderingContext2D, scope: Scope, at: Pt, side: 'up' | 'right' | 'left', text: string, color: string, ink: Ink, image: CanvasImageSource | null): void {
  const k = scope.horizontalPixelRatio;
  const width = scope.bitmapSize.width;
  const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.font = `500 ${Math.round(9 * scope.verticalPixelRatio)}px ${ink.mono}`;
  ctxLs.letterSpacing = `${(1.3 * k).toFixed(1)}px`;
  const textWidth = ctx.measureText(text).width;
  // Le creux contre le bord droit : connecteur et étiquette passent à gauche.
  const way = side === 'up' ? 'up' : at.x + 27 * k + textWidth <= width - 4 * k ? 'right' : 'left';
  const l = leader(at, way, k);
  ctx.strokeStyle = ink.label;
  ctx.lineWidth = Math.max(1, Math.round(k));
  ctx.beginPath();
  ctx.moveTo(l.from.x, l.from.y);
  ctx.lineTo(l.to.x, l.to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(l.dot.x, l.dot.y, 1.9 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink.paper;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 6.6 * k, 0, Math.PI * 2);
  ctx.fill();
  if (image) {
    const size = 12 * k;
    ctx.drawImage(image, at.x - size / 2, at.y - size / 2, size, size);
  }
  const left = l.align === 'center' ? Math.min(Math.max(2 * k, l.text.x - textWidth / 2), width - textWidth - 2 * k) : l.align === 'left' ? l.text.x : l.text.x - textWidth;
  ctx.textBaseline = way === 'up' ? 'alphabetic' : 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, left, l.text.y);
  ctx.globalAlpha = 1;
  ctxLs.letterSpacing = '0px';
}

/** Le zéro en lentille du sceau : plein, épais au centre, effilé aux deux bouts. */
function paintLens(ctx: CanvasRenderingContext2D, width: number, y: number, bulge: number, color: string): void {
  const l = lens(0, width, y, bulge);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(l.from.x, l.from.y);
  ctx.bezierCurveTo(l.top[0].x, l.top[0].y, l.top[1].x, l.top[1].y, l.to.x, l.to.y);
  ctx.bezierCurveTo(l.bottom[0].x, l.bottom[0].y, l.bottom[1].x, l.bottom[1].y, l.from.x, l.from.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * La borne du plan suivi dans le volet sous l'eau : au-delà, la zone interdite hachurée ; le plancher en trait plein ;
 * le glyphe de la borne posé à son départ, sur un carré de papier ; l'étiquette au bout.
 */
function paintFloor(ctx: CanvasRenderingContext2D, scope: Scope, y: number, label: string, ink: Ink, image: CanvasImageSource | null): void {
  const h = scope.horizontalPixelRatio;
  const v = scope.verticalPixelRatio;
  const width = scope.bitmapSize.width;
  const height = scope.bitmapSize.height;
  const top = Math.round(y);
  if (top < height) {
    ctx.save();
    ctx.strokeStyle = ink.neg;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of hatch(0, Math.max(0, top), width, height, Math.max(4, Math.round(5 * h)))) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = ink.line;
  ctx.fillRect(0, top, width, Math.max(1, Math.round(v)));
  const cx = 6 * h;
  ctx.fillStyle = ink.paper;
  ctx.fillRect(cx - 6 * h, top - 6 * h, 12 * h, 12 * h);
  if (image) {
    const size = 10 * h;
    ctx.drawImage(image, cx - size / 2, top - size / 2, size, size);
  }
  if (label) {
    const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    ctx.font = `500 ${Math.round(9 * v)}px ${ink.mono}`;
    ctxLs.letterSpacing = `${(1.3 * h).toFixed(1)}px`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = ink.line;
    ctx.fillText(label, width - 4 * h - ctx.measureText(label).width, top - 3 * v);
    ctxLs.letterSpacing = '0px';
  }
}

/** Règle de séances au pied du volet : un trait par séance, un appui toutes les dix. */
function paintRuler(ctx: CanvasRenderingContext2D, scope: Scope, bars: Bars, ink: Ink): void {
  const h = scope.horizontalPixelRatio;
  const v = scope.verticalPixelRatio;
  const base = scope.bitmapSize.height - 1;
  const minor = Math.round(2 * v);
  const major = Math.round(4 * v);
  for (const bar of bars) {
    const tick = rulerTick(bar.originalData.session, minor, major);
    if (!tick) continue;
    ctx.fillStyle = tick === major ? ink.faint : ink.zero;
    ctx.fillRect(Math.round(bar.x * h), base - tick, Math.max(1, Math.round(h)), tick);
  }
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
    return { ...customSeriesDefaultOptions, ink: NO_INK, marks: NO_MARKS, focus: NONE, glyph: NO_GLYPH, floor: 0, floorLabel: '' };
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
    const { ink, marks, focus, glyph } = this.options;
    const h = scope.horizontalPixelRatio;
    const zero = conv(0);
    if (zero === null) return;
    const base = zero * scope.verticalPixelRatio;
    const width = scope.bitmapSize.width;
    const pts = points(bars, scope, conv, (row) => row.equity);
    const highs = points(bars, scope, conv, (row) => row.peak);

    // L'horizon : le zéro tracé comme la lentille du sceau, épais au centre, effilé aux bords.
    paintLens(ctx, width, base, 1.5 * scope.verticalPixelRatio, ink.label);
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
    // Repères de la planche : ⊕ la cible au plus haut, ⊗ la mire au creux du plus grand drawdown.
    const high = at(marks.high);
    if (high && marks.high !== last) glyphMark(ctx, scope, high, 'up', marks.highLabel, ink.label, ink, glyph('target'));
    const trough = at(marks.trough);
    if (trough) glyphMark(ctx, scope, trough, 'right', marks.troughLabel, ink.neg, ink, glyph('mire'));
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
    const { ink, focus, floor, floorLabel, glyph } = this.options;
    const h = scope.horizontalPixelRatio;
    const zero = conv(0);
    if (zero === null) return;
    const base = zero * scope.verticalPixelRatio;
    const pts = points(bars, scope, conv, (row) => row.drawdown);
    // La borne du plan suivi : derrière la trame, pour que le drawdown se lise par-dessus.
    const floorY = floor > 0 ? conv(-floor) : null;
    if (floorY !== null) paintFloor(ctx, scope, floorY * scope.verticalPixelRatio, floorLabel, ink, glyph('borne'));
    hairDots(ctx, 0, scope.bitmapSize.width, base, ink.zero, Math.round(3 * h), 0.9);
    const dots = trame(pts, base, { pitch: Math.max(3, Math.round(4 * h)), fade: 26 * scope.verticalPixelRatio, rMin: 0.3 * h, rMax: 1.05 * h }, { left: 0, right: scope.bitmapSize.width });
    paintDots(ctx, dots, ink.neg, 0.75);
    glowLine(ctx, pts, ink.neg, Math.max(1, h * 0.75), 4 * h);
    const hovered = focus === NONE ? undefined : pts.find((p) => p.index === focus);
    if (hovered && hovered.y > base + 1) photon(ctx, hovered.x, hovered.y, 8 * h, ink.neg, 0.8);
    paintRuler(ctx, scope, bars, ink);
  }
}
