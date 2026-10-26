import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { curveAt, hatch, labelLeft, leader, lens, rulerTick, sessionMarks, signaturePixel, trame, type Pt } from '@/modules/metrique/equityPaint';
import { alpha, EquityTrait, NONE, StemTrait, UnderwaterTrait, visible, type EquityRow, type GlyphKey, type Ink, type TraitOptions } from '@/modules/metrique/equitySeries';

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

/** Point d'une cubique de Bézier. */
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

describe('OROS3.2a géométrie de la planche : lentille, règle de séances, repères, borne', () => {
  it('le zéro est la lentille du sceau : effilée aux deux bouts, épaisse au centre, symétrique', () => {
    const l = lens(0, 400, 100, 2);
    expect(l.from).toEqual({ x: 0, y: 100 });
    expect(l.to).toEqual({ x: 400, y: 100 });
    const top = bezier(l.from, l.top[0], l.top[1], l.to, 0.5);
    const bottom = bezier(l.to, l.bottom[0], l.bottom[1], l.from, 0.5);
    expect(top.x).toBeCloseTo(200);
    expect(top.y).toBeCloseTo(98.5);
    expect(bottom.y).toBeCloseTo(101.5);
    // Effilée : à 5 % de la longueur, l'épaisseur n'est plus qu'une fraction de celle du centre.
    const edge = bezier(l.from, l.top[0], l.top[1], l.to, 0.05);
    expect(100 - edge.y).toBeLessThan((100 - top.y) / 3);
  });

  it('règle de séances : l’ordinal de la séance qu’ouvre chaque pas, rien au départ ni sur un trade de la même séance', () => {
    const steps = [{ date: '2026-08-31', origin: true as const }, { date: '2026-09-01' }, { date: '2026-09-01' }, { date: '2026-09-02' }, { date: '2026-09-03' }, { date: '2026-09-03' }];
    expect(sessionMarks(steps)).toEqual([NONE, 1, NONE, 2, 3, NONE]);
    expect(sessionMarks([])).toEqual([]);
  });

  it('règle de séances : un trait par séance, un appui toutes les dix', () => {
    expect(rulerTick(NONE, 2, 4)).toBe(0);
    expect(rulerTick(1, 2, 4)).toBe(2);
    expect(rulerTick(9, 2, 4)).toBe(2);
    expect(rulerTick(10, 2, 4)).toBe(4);
    expect(rulerTick(20, 2, 4)).toBe(4);
  });

  it('repère : le connecteur part du glyphe et finit sur un petit cercle, l’étiquette au-delà', () => {
    const up = leader({ x: 100, y: 80 }, 'up', 1);
    expect(up.from).toEqual({ x: 100, y: 72 });
    expect(up.to).toEqual({ x: 100, y: 63 });
    expect(up.dot).toEqual({ x: 100, y: 61 });
    expect(up.text.y).toBeLessThan(up.dot.y);
    expect(up.align).toBe('center');
    const right = leader({ x: 100, y: 80 }, 'right', 2);
    expect(right.from).toEqual({ x: 116, y: 80 });
    expect(right.dot).toEqual({ x: 142, y: 80 });
    expect(right.text.x).toBeGreaterThan(right.dot.x);
    expect(right.align).toBe('left');
    const left = leader({ x: 100, y: 80 }, 'left', 1);
    expect(left.dot.x).toBe(79);
    expect(left.text.x).toBeLessThan(left.dot.x);
    expect(left.align).toBe('right');
  });

  it('hachure de la zone au-delà de la borne : traits à 45°, tous dans le cadre', () => {
    const lines = hatch(0, 50, 100, 70, 6);
    expect(lines.length).toBeGreaterThan(10);
    for (const [a, b] of lines) {
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(50 - 1e-9);
        expect(p.y).toBeLessThanOrEqual(70 + 1e-9);
      }
      expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y));
    }
    expect(hatch(0, 50, 100, 50, 6)).toEqual([]);
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

const INK: Ink = { line: '#edebe4', pos: '#74c69d', neg: '#e0735f', red: '#e5263d', faint: '#80858e', label: '#a3a7af', zero: '#33363d', paper: '#14151a', mono: 'monospace' };

function row(time: number, equity: number, peak: number, drawdown: number, pnl: number, session = NONE): EquityRow {
  return { time: time as EquityRow['time'], equity, peak, drawdown, pnl, session };
}

const ROWS = [row(1, 0, 0, 0, 0), row(2, 300, 300, 0, 300, 1), row(3, -100, 300, -400, -400, 2), row(4, 200, 300, -100, 300, 3)];

/** Glyphes de la planche, rendus d'avance par la carte (ici : des jetons reconnaissables). */
const SPRITES: Record<GlyphKey, { sprite: GlyphKey }> = { target: { sprite: 'target' }, mire: { sprite: 'mire' }, borne: { sprite: 'borne' } };
const glyph = (key: GlyphKey) => SPRITES[key] as unknown as CanvasImageSource;

function paint(view: EquityTrait | StemTrait | UnderwaterTrait, options: Partial<TraitOptions>, rows: EquityRow[] = ROWS) {
  const { ctx, calls } = recorder();
  view.update(
    { bars: rows.map((originalData, i) => ({ x: 20 + i * 100, time: i, originalData, barColor: '' })), barSpacing: 100, visibleRange: { from: 0, to: rows.length }, conflationFactor: 1 },
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

describe('OROS3.2a la courbe au trait de la planche', () => {
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

  const MARKS = { high: 1, highLabel: 'PLUS HAUT +300', trough: 2, troughLabel: 'CREUX −400' };
  const images = (calls: ReturnType<typeof paint>) => calls.filter((call) => call.op === 'drawImage').map((call) => ({ key: (call.args[0] as { sprite: GlyphKey }).sprite, box: call.args.slice(1) as number[] }));

  it('le zéro est tracé comme la lentille du sceau, plus en pointillé', () => {
    const calls = paint(new EquityTrait(), { marks: MARKS, glyph });
    expect(calls.filter((call) => call.op === 'bezierCurveTo')).toHaveLength(2);
    const lensFill = calls.find((call) => call.op === 'fill' && call.fill === INK.label);
    expect(lensFill).toBeDefined();
    // Le zéro (y = 100) n'est plus semé de points d'un pixel.
    expect(calls.some((call) => call.op === 'fillRect' && call.fill === INK.zero && call.args[1] === 100)).toBe(false);
  });

  it('⊕ au plus haut et ⊗ au creux : glyphes de la planche centrés sur le pas, posés sur un disque de papier', () => {
    const calls = paint(new EquityTrait(), { marks: MARKS, glyph });
    const drawn = images(calls);
    expect(drawn.map((d) => d.key)).toEqual(['target', 'mire']);
    const [target, mire] = drawn;
    // Plus haut : pas 1 (x 120, 300 USD → y 40) ; creux : pas 2 (x 220, équité −100 USD → y 120). Glyphe de 12 px.
    expect(target!.box).toEqual([114, 34, 12, 12]);
    expect(mire!.box).toEqual([214, 114, 12, 12]);
    const papers = calls.filter((call) => call.op === 'arc' && (call.args[2] as number) > 6 && (call.args[2] as number) < 7);
    expect(papers.map((call) => [call.args[0], call.args[1]])).toEqual([
      [120, 40],
      [220, 120],
    ]);
  });

  it('chaque repère a son connecteur, fini par un petit cercle, et garde son étiquette', () => {
    const calls = paint(new EquityTrait(), { marks: MARKS, glyph });
    const dots = calls.filter((call) => call.op === 'arc' && (call.args[2] as number) > 1.5 && (call.args[2] as number) < 2.5);
    expect(dots.map((call) => [call.args[0], call.args[1]])).toEqual([
      [120, 21],
      [241, 120],
    ]);
    expect(calls.filter((call) => call.op === 'fillText').map((call) => call.args[0])).toEqual(['PLUS HAUT +300', 'CREUX −400']);
  });

  it('sans glyphe chargé, le repère se dessine quand même (disque, connecteur, étiquette), sans image', () => {
    const calls = paint(new EquityTrait(), { marks: MARKS });
    expect(images(calls)).toEqual([]);
    expect(calls.filter((call) => call.op === 'fillText')).toHaveLength(2);
  });

  it('le creux contre le bord droit : connecteur et étiquette passent à gauche', () => {
    const calls = paint(new EquityTrait(), { marks: { ...MARKS, trough: 3, troughLabel: 'CREUX −100' }, glyph }, [row(1, 0, 0, 0, 0), row(2, 300, 300, 0, 300, 1), row(3, 200, 300, -100, -100, 2), row(4, 150, 300, -150, -50, 3)]);
    const dot = calls.filter((call) => call.op === 'arc' && (call.args[2] as number) > 1.5 && (call.args[2] as number) < 2.5).at(-1)!;
    expect(dot.args[0]).toBe(320 - 21);
  });

  it('la borne du plan : plancher en trait plein, zone au-delà hachurée, glyphe de la borne à son départ, étiquette', () => {
    const calls = paint(new UnderwaterTrait(), { floor: 300, floorLabel: 'PLANCHER −300', glyph });
    // −300 USD → y 160.
    const floorLine = calls.filter((call) => call.op === 'fillRect' && call.fill === INK.line && call.args[1] === 160 && (call.args[2] as number) >= 399);
    expect(floorLine).toHaveLength(1);
    const borne = images(calls);
    expect(borne).toEqual([{ key: 'borne', box: [1, 155, 10, 10] }]);
    expect(calls.filter((call) => call.op === 'fillText').map((call) => call.args[0])).toEqual(['PLANCHER −300']);
    const hatchStrokes = calls.filter((call) => call.op === 'lineTo');
    expect(hatchStrokes.length).toBeGreaterThan(10);
    for (const call of hatchStrokes) expect(call.args[1] as number).toBeGreaterThanOrEqual(160);
  });

  it('sans plan suivi, aucune borne : ni trait, ni glyphe, ni étiquette', () => {
    const calls = paint(new UnderwaterTrait(), { glyph });
    expect(images(calls)).toEqual([]);
    expect(calls.some((call) => call.op === 'fillText')).toBe(false);
  });

  it('règle de séances au pied du volet : un trait par séance, un appui toutes les dix', () => {
    const rows = [row(1, 0, 0, 0, 0), row(2, 10, 10, 0, 10, 9), row(3, 20, 20, 0, 10, 10), row(4, 30, 30, 0, 10, NONE)];
    const calls = paint(new UnderwaterTrait(), {}, rows);
    const ticks = calls.filter((call) => call.op === 'fillRect' && (call.args[2] as number) === 1 && (call.args[1] as number) + (call.args[3] as number) === 199);
    expect(ticks.map((call) => [call.args[0], call.args[3]])).toEqual([
      [120, 2],
      [220, 4],
    ]);
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

describe('OROS3.2e lisibilité des repères (revue au rendu réel)', () => {
  const MARKS = { high: 1, highLabel: 'PLUS-HAUT +300', trough: 2, troughLabel: 'CREUX −400' };
  const glyph = () => ({}) as CanvasImageSource;

  it('l’étiquette du creux est à l’encre des axes, comme celle du plus-haut : la perte se lit au volet sous l’eau', () => {
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
      },
    );
    try {
      const calls = paint(new EquityTrait(), { marks: MARKS, glyph });
      const texts = calls.filter((call) => call.op === 'fillText');
      expect(texts.map((call) => [call.args[0], call.fill])).toEqual([
        ['PLUS-HAUT +300', INK.label],
        ['CREUX −400', INK.label],
      ]);
      // Chaque étiquette posée sur un fond de papier qui la contient : la courbe passe derrière sans la brouiller.
      for (const text of texts) {
        const at = calls.indexOf(text);
        const backing = calls.slice(0, at).reverse().find((call) => call.op === 'fillRect' && call.fill === INK.paper);
        expect(backing, String(text.args[0])).toBeDefined();
        const [x, , w] = backing!.args as number[];
        const [, tx] = text.args as [string, number];
        expect(tx).toBeGreaterThanOrEqual(x!);
        expect(tx + String(text.args[0]).length * 6).toBeLessThanOrEqual(x! + w!);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
