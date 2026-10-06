import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { curveAt, labelLeft, signaturePixel, trame } from '@/modules/metrique/equityPaint';
import { alpha, EquityTrait, NONE, StemTrait, UnderwaterTrait, visible, type EquityRow, type Ink, type TraitOptions } from '@/modules/metrique/equitySeries';

describe('géométrie du trait', () => {
  const line = [
    { x: 0, y: 100 },
    { x: 40, y: 20 },
    { x: 80, y: 60 },
  ];

  it('ordonnée interpolée, nulle hors de la ligne', () => {
    expect(curveAt(line, 0)).toBe(100);
    expect(curveAt(line, 20)).toBe(60);
    expect(curveAt(line, 60)).toBe(40);
    expect(curveAt(line, -1)).toBeNull();
    expect(curveAt(line, 81)).toBeNull();
    expect(curveAt([], 0)).toBeNull();
  });

  it('trame : grille fixe, entre la ligne et la base, sans toucher ni l’une ni l’autre ; plus grosse contre la crête', () => {
    const plan = { pitch: 4, fade: 40, rMin: 0.3, rMax: 1.2 };
    const dots = trame(line, 100, plan, { left: 0, right: 80 });
    expect(dots.length).toBeGreaterThan(50);
    for (const dot of dots) {
      expect(dot.x % 4).toBe(0);
      expect(dot.y % 4).toBe(0);
      const edge = curveAt(line, dot.x)!;
      expect(dot.y).toBeGreaterThanOrEqual(edge + 2);
      expect(dot.y).toBeLessThanOrEqual(98);
      expect(dot.r).toBeGreaterThanOrEqual(0.3);
      expect(dot.r).toBeLessThanOrEqual(1.2);
    }
    const column = dots.filter((dot) => dot.x === 40).sort((a, b) => a.y - b.y);
    expect(column[0]!.y).toBe(24);
    expect(column.at(-1)!.y).toBe(96);
    expect(column[0]!.r).toBeGreaterThan(column.at(-1)!.r);
    expect(column.map((dot) => dot.r)).toEqual([...column.map((dot) => dot.r)].sort((a, b) => b - a));
  });

  it('trame sous zéro : de la base jusqu’à la ligne ; rien sur une colonne au ras de la base ; rien hors du cadre', () => {
    const below = [
      { x: 0, y: 50 },
      { x: 40, y: 90 },
    ];
    const dots = trame(below, 50, { pitch: 4, fade: 20, rMin: 0.3, rMax: 1 }, { left: 0, right: 40 });
    const column = dots.filter((dot) => dot.x === 40);
    expect(column[0]!.y).toBe(52);
    expect(column.at(-1)!.y).toBeLessThanOrEqual(88);
    expect(dots.some((dot) => dot.x === 0)).toBe(false);
    expect(trame(below, 50, { pitch: 4, fade: 20, rMin: 0.3, rMax: 1 }, { left: 10, right: 20 }).every((dot) => dot.x >= 10 && dot.x <= 20)).toBe(true);
  });

  it('pixel signature : 5 × 5 cellules alignées, cœur blanc unique, coins éteints, centré', () => {
    const cells = signaturePixel(100.4, 50.6, 3, 1);
    expect(cells).toHaveLength(25);
    expect(cells.filter((cell) => cell.core)).toEqual([expect.objectContaining({ alpha: 1 })]);
    expect(cells.every((cell) => Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.size === 3)).toBe(true);
    const corners = cells.filter((cell) => cell.alpha === 0.22);
    expect(corners).toHaveLength(4);
    const core = cells.find((cell) => cell.core)!;
    expect(Math.abs(core.x + 1.5 - 100.4)).toBeLessThanOrEqual(1);
    expect(Math.abs(core.y + 1.5 - 50.6)).toBeLessThanOrEqual(1);
  });

  it('étiquette à droite du repère, à gauche au bord', () => {
    expect(labelLeft(100, 60, 5, 400)).toBe(105);
    expect(labelLeft(380, 60, 5, 400)).toBe(315);
  });

  it('alpha sur une couleur de jeton', () => {
    expect(alpha('#e5263d', 0.4)).toBe('rgba(229,38,61,0.4)');
    expect(alpha('rgba(116, 198, 157, 0.5)', 0.1)).toBe('rgba(116,198,157,0.1)');
    expect(alpha('gray', 0.3)).toBe('gray');
  });
});

/** Contexte 2D enregistreur : chaque appel et chaque couleur posée. */
function recorder() {
  const calls: { op: string; args: unknown[]; fill: unknown; alpha: number }[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '' };
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      return (...args: unknown[]) => {
        calls.push({ op: String(key), args, fill: target.fillStyle, alpha: target.globalAlpha as number });
      };
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
  return { ctx, calls };
}

const INK: Ink = { line: '#edebe4', pos: '#74c69d', neg: '#e0735f', red: '#e5263d', faint: '#80858e', label: '#a3a7af', zero: '#33363d', mono: 'monospace' };

function row(time: number, equity: number, peak: number, drawdown: number, pnl: number): EquityRow {
  return { time: time as EquityRow['time'], equity, peak, drawdown, pnl };
}

const ROWS = [row(1, 0, 0, 0, 0), row(2, 300, 300, 0, 300), row(3, -100, 300, -400, -400), row(4, 200, 300, -100, 300)];

function paint(view: EquityTrait | StemTrait | UnderwaterTrait, options: Partial<TraitOptions>) {
  const { ctx, calls } = recorder();
  view.update(
    { bars: ROWS.map((originalData, i) => ({ x: 20 + i * 100, time: i, originalData, barColor: '' })), barSpacing: 100, visibleRange: { from: 0, to: 4 }, conflationFactor: 1 },
    { ...view.defaultOptions(), ink: INK, ...options },
  );
  const scope = { context: ctx, bitmapSize: { width: 400, height: 200 }, mediaSize: { width: 400, height: 200 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
  const target = { useBitmapCoordinateSpace: (f: (s: typeof scope) => void) => f(scope), useMediaCoordinateSpace: () => undefined };
  // Prix → ordonnée : 0 au milieu, 1 px pour 5 USD.
  view.renderer().draw(target as never, (price: number) => (100 - price / 5) as never, false);
  return calls;
}

describe('séries au trait du Lab', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('équité : pixel rouge au dernier pas, repères au trait, ni flèche ni carré de survol par défaut', () => {
    const calls = paint(new EquityTrait(), { marks: { high: 1, highLabel: 'PLUS HAUT +300', trough: 2, troughLabel: 'CREUX −400' } });
    const texts = calls.filter((call) => call.op === 'fillText').map((call) => call.args[0]);
    expect(texts).toEqual(['PLUS HAUT +300', 'CREUX −400']);
    const red = calls.filter((call) => call.op === 'fillRect' && call.fill === INK.red);
    expect(red).toHaveLength(24);
    const core = calls.filter((call) => call.op === 'fillRect' && call.fill === INK.line && call.alpha === 1);
    expect(core).toHaveLength(1);
    const [x, y] = core[0]!.args as number[];
    expect(Math.abs(x! + 1 - 320)).toBeLessThanOrEqual(2);
    expect(Math.abs(y! + 1 - (100 - 200 / 5))).toBeLessThanOrEqual(2);
    expect(calls.some((call) => call.op === 'strokeRect')).toBe(false);
    expect(calls.filter((call) => call.op === 'arc').length).toBeGreaterThan(20);
  });

  it('équité : sans repère, aucune étiquette ; le survol dessine un carré creux', () => {
    const none = paint(new EquityTrait(), { marks: { high: NONE, highLabel: '', trough: NONE, troughLabel: '' } });
    expect(none.some((call) => call.op === 'fillText')).toBe(false);
    const hovered = paint(new EquityTrait(), { focus: 1 });
    expect(hovered.filter((call) => call.op === 'strokeRect')).toHaveLength(1);
  });

  it('P&L : un fil et un carré par pas non nul, gains et pertes à leur couleur', () => {
    const calls = paint(new StemTrait(), {}).filter((call) => call.op === 'fillRect' && (call.fill === INK.pos || call.fill === INK.neg));
    expect(calls.filter((call) => call.fill === INK.pos)).toHaveLength(4);
    expect(calls.filter((call) => call.fill === INK.neg)).toHaveLength(2);
  });

  it('sous l’eau : trame rouge suspendue à zéro', () => {
    const calls = paint(new UnderwaterTrait(), {});
    const dots = calls.filter((call) => call.op === 'fill');
    expect(dots.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.op === 'arc').every((call) => (call.args[1] as number) > 100)).toBe(true);
  });

  it('bornes de l’échelle : zéro, plus haut et valeur courante', () => {
    expect(new EquityTrait().priceValueBuilder(row(1, -50, 300, -350, 10))).toEqual([300, -50, -50]);
    expect(new StemTrait().priceValueBuilder(row(1, 0, 0, 0, -40))).toEqual([0, -40, -40]);
    expect(new UnderwaterTrait().priceValueBuilder(row(1, 0, 0, -350, 0))).toEqual([0, -350, -350]);
  });
});

describe('barres visibles', () => {
  const bar = (time: number, x: number) => ({ time, x, originalData: row(time, 0, 0, 0, 0), barColor: '' });

  it('les voisins hors cadre sont replacés d’après l’espacement, pas d’après une abscisse périmée', () => {
    // Après un zoom, la bibliothèque laisse aux barres hors cadre l'abscisse d'un rendu précédent.
    const bars = [bar(0, 9999), bar(1, 9999), bar(2, 40), bar(3, 52), bar(4, 64), bar(5, -7)];
    const out = visible({ bars, barSpacing: 12, visibleRange: { from: 2, to: 5 }, conflationFactor: 1 });
    expect(out.map((b) => [b.time, b.x])).toEqual([
      [1, 28],
      [2, 40],
      [3, 52],
      [4, 64],
      [5, 76],
    ]);
  });

  it('au bord des données, pas de voisin ; sans plage visible, rien', () => {
    const bars = [bar(0, 10), bar(1, 22)];
    expect(visible({ bars, barSpacing: 12, visibleRange: { from: 0, to: 2 }, conflationFactor: 1 }).map((b) => b.time)).toEqual([0, 1]);
    expect(visible({ bars, barSpacing: 12, visibleRange: null, conflationFactor: 1 })).toEqual([]);
    expect(visible(null)).toEqual([]);
  });
});
