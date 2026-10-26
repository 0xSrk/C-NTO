/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { equityCurve } from '@/engine/equityCurve';
import type { Session, Trade } from '@/engine/types';

interface FakeSeries {
  kind: string;
  pane: number;
  options: Record<string, unknown>;
  data: { time: number; equity?: number; peak?: number; drawdown?: number; pnl?: number }[];
}

interface FakeChart {
  series: FakeSeries[];
  crosshair: ((param: { time?: number; point?: { x: number; y: number } }) => void) | null;
  fits: number;
  range: { from: number; to: number };
  removed: boolean;
}

// Le canevas n'existe pas sous jsdom : lightweight-charts est remplacé par un enregistreur.
const state = vi.hoisted(() => ({ charts: [] as FakeChart[] }));
vi.mock('lightweight-charts', () => {
  /** Même fusion que `applyOptions` de la bibliothèque : un `null` posé sur un nombre est ignoré. */
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const key of Object.keys(src)) {
      const value = src[key];
      if (value === undefined) continue;
      if (typeof value !== 'object' || dst[key] === undefined || Array.isArray(value)) dst[key] = value;
      else if (value !== null) merge(dst[key] as Record<string, unknown>, value as Record<string, unknown>);
    }
    return dst;
  };
  /** Même copie que `clone` de la bibliothèque : les objets en profondeur, les fonctions par référence. */
  const clone = (src: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const value = src[key];
      out[key] = value && typeof value === 'object' && !Array.isArray(value) ? clone(value as Record<string, unknown>) : value;
    }
    return out;
  };
  return {
    customSeriesDefaultOptions: { color: '#000' },
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Magnet: 3 },
    LineStyle: { Dotted: 1, SparseDotted: 4 },
    createChart: () => {
      const chart: FakeChart = { series: [], crosshair: null, fits: 0, range: { from: 0, to: 20 }, removed: false };
      state.charts.push(chart);
      return {
        addCustomSeries: (view: { constructor: { name: string }; defaultOptions: () => Record<string, unknown> }, options: Record<string, unknown>, pane = 0) => {
          const series: FakeSeries = { kind: view.constructor.name, pane, options: merge(clone(view.defaultOptions()), options), data: [] };
          chart.series.push(series);
          return {
            setData: (data: FakeSeries['data']) => {
              series.data = data;
            },
            applyOptions: (next: Record<string, unknown>) => {
              merge(series.options, next);
            },
          };
        },
        panes: () => [0, 1, 2].map(() => ({ setHeight: () => undefined })),
        subscribeCrosshairMove: (cb: FakeChart['crosshair']) => {
          chart.crosshair = cb;
        },
        timeScale: () => ({
          fitContent: () => {
            chart.fits++;
          },
          getVisibleLogicalRange: () => chart.range,
          setVisibleLogicalRange: (range: FakeChart['range']) => {
            chart.range = range;
          },
          coordinateToLogical: () => 10,
        }),
        applyOptions: () => undefined,
        remove: () => {
          chart.removed = true;
        },
      };
    },
  };
});

function session(id: string, date: string, pnl: number, tradeCount = 1): Session {
  return { id, date, account: 'Sim101', instruments: ['MNQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, exit: string, pnl: number): Trade {
  const exitTime = Date.parse(exit);
  return { id, sessionId, instrument: 'MNQ', direction: 'long', qty: 1, entryTime: exitTime - 60_000, exitTime, entryPrice: 100, exitPrice: 101, pnl, commission: 0 };
}

const sessions = [session('a', '2026-09-01', 100, 2), session('b', '2026-09-02', 300), session('c', '2026-09-03', -450), session('d', '2026-09-04', 200)];
const trades = [
  trade('t1', 'a', '2026-09-01T13:30:00Z', 40),
  trade('t2', 'a', '2026-09-01T14:00:00Z', 60),
  trade('t3', 'b', '2026-09-02T14:00:00Z', 300),
  trade('t4', 'c', '2026-09-03T14:00:00Z', -450),
  trade('t5', 'd', '2026-09-04T14:00:00Z', 200),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const size = { clientWidth: 800, clientHeight: 300 };

async function mount(props: { floor?: number | null; stats?: { trades: number; winRate: number; profitFactor: number } } = {}) {
  const { EquityCard } = await import('@/modules/metrique/EquityChart');
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(EquityCard, { sessions, trades, ...props }));
  });
  const chart = state.charts.at(-1);
  if (!chart) throw new Error('graphique non créé');
  return chart;
}

const trait = (chart: FakeChart, kind: string) => chart.series.find((row) => row.kind === kind)!;
const marks = (chart: FakeChart) => trait(chart, 'EquityTrait').options.marks;
const readout = () => host!.querySelector('[aria-live]')!.textContent ?? '';

// Jetons du Système 3.4 (sous jsdom, tokens.css n'est pas chargé) : le graphique doit les lire.
const TOKENS = '[role="img"] { --text-0: #edebe4; --pos: #74c69d; --neg: #e0735f; --gold: #e5263d; }';

beforeEach(() => {
  state.charts.length = 0;
  const style = document.createElement('style');
  style.dataset.tokens = '';
  style.textContent = TOKENS;
  document.head.append(style);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  for (const [key, value] of Object.entries(size)) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
});

afterEach(() => {
  document.head.querySelector('style[data-tokens]')?.remove();
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const key of Object.keys(size)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals();
});

describe('Métrique › A.02 courbe d’équité', () => {
  it('trois volets au trait du Lab : équité, P&L par pas, drawdown ; repères fins, couleurs des jetons', async () => {
    const chart = await mount();
    const curve = equityCurve(sessions, trades, 'session');
    expect(chart.series.map((row) => [row.kind, row.pane])).toEqual([
      ['EquityTrait', 0],
      ['StemTrait', 1],
      ['UnderwaterTrait', 2],
    ]);
    // Règle de séances : chaque pas porte l'ordinal de la séance qu'il ouvre (−1 au départ).
    const rows = curve.steps.map((step, i) => ({ time: step.time, equity: step.equity, peak: step.peak, drawdown: step.drawdown, pnl: step.pnl, session: i === 0 ? -1 : i }));
    for (const row of chart.series) expect(row.data).toEqual(rows);
    expect(marks(chart)).toEqual({ high: 2, highLabel: 'PLUS-HAUT +400', trough: 3, troughLabel: 'CREUX −450' });
    const ink = trait(chart, 'EquityTrait').options.ink as Record<string, string>;
    expect([ink.line, ink.pos, ink.neg, ink.red]).toEqual(['#edebe4', '#74c69d', '#e0735f', '#e5263d']);
    expect(chart.fits).toBe(1);
  });

  it('le survol allume le pas sur les trois volets, puis s’éteint', async () => {
    const chart = await mount();
    const step = equityCurve(sessions, trades, 'session').steps[3]!;
    await act(async () => chart.crosshair!({ time: step.time, point: { x: 10, y: 10 } }));
    expect(chart.series.map((row) => row.options.focus)).toEqual([3, 3, 3]);
    await act(async () => chart.crosshair!({}));
    expect(chart.series.map((row) => row.options.focus)).toEqual([-1, -1, -1]);
  });

  it('les étiquettes des repères suivent la langue du desk', async () => {
    const chart = await mount();
    const { useI18n } = await import('@/i18n');
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(marks(chart)).toMatchObject({ highLabel: 'HIGH +400', troughLabel: 'TROUGH −450' });
  });

  it('la lecture montre le dernier pas, puis le pas sous le curseur', async () => {
    const chart = await mount();
    expect(readout()).toMatch(/04\/09/);
    expect(readout()).toMatch(/\+150,00/);
    const step = equityCurve(sessions, trades, 'session').steps[3]!;
    await act(async () => chart.crosshair!({ time: step.time, point: { x: 10, y: 10 } }));
    expect(readout()).toMatch(/03\/09/);
    expect(readout()).toMatch(/−50,00/);
    expect(readout()).toMatch(/−450,00/);
    await act(async () => chart.crosshair!({}));
    expect(readout()).toMatch(/04\/09/);
  });

  it('bascule Trade : un pas par trade, recadré', async () => {
    const chart = await mount();
    const button = [...host!.querySelectorAll('button')].find((row) => row.textContent === 'Trade')!;
    await act(async () => button.click());
    expect(trait(chart, 'EquityTrait').data.map((row) => row.equity)).toEqual([0, 40, 100, 400, -50, 150]);
    expect(marks(chart)).toMatchObject({ high: 3, trough: 4 });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(chart.fits).toBe(2);
    expect(readout()).toMatch(/MNQ/);
  });

  it('la molette seule laisse défiler la page ; Ctrl + molette zoome ; double-clic recadre', async () => {
    const chart = await mount();
    const el = host!.querySelector('[role="img"]')!;
    const plain = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    el.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(chart.range).toEqual({ from: 0, to: 20 });
    const zoom = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(chart.range.to - chart.range.from).toBeLessThan(20);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(chart.fits).toBe(2);
  });

  it('démonté, le graphique est retiré', async () => {
    const chart = await mount();
    act(() => root!.unmount());
    root = null;
    expect(chart.removed).toBe(true);
  });
});

/** Image du navigateur, simulée : jsdom ne charge rien ; `load()` fait ce que ferait le navigateur. */
class FakeImage {
  static made: FakeImage[] = [];
  onload: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  src = '';
  constructor() {
    FakeImage.made.push(this);
  }
  load() {
    this.complete = true;
    this.naturalWidth = 24;
    this.onload?.();
  }
}

const svgOf = (img: FakeImage) => decodeURIComponent(img.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
const glyphOf = (chart: FakeChart, kind: string) => trait(chart, kind).options.glyph as (key: string) => unknown;

describe('OROS3.2b la carte A.02 : composants de la planche, borne du plan, plaque de lecture', () => {
  beforeEach(() => {
    FakeImage.made.length = 0;
    vi.stubGlobal('Image', FakeImage);
  });

  it('⊕, ⊗ et la borne sont les composants de la planche, encrés en ivoire, donnés au trait une fois chargés', async () => {
    const { COMPONENTS, GLYPH_ID } = await import('@/design/micro/assets');
    const chart = await mount();
    const made = FakeImage.made;
    expect(made).toHaveLength(3);
    const byGlyph = (n: number) => made.find((img) => svgOf(img).includes(`skg-${n}"`))!;
    const target = byGlyph(GLYPH_ID.target);
    const mire = byGlyph(GLYPH_ID.mire);
    const borne = byGlyph(GLYPH_ID.borne);
    for (const [img, n] of [[target, GLYPH_ID.target], [mire, GLYPH_ID.mire], [borne, GLYPH_ID.borne]] as const) {
      const svg = svgOf(img);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" /);
      expect(svg).not.toContain('var(--k)');
      expect(svg).toContain('#edebe4');
      // Le dessin du master, intact : seule l'encre change (et la graisse, réglée à part).
      expect(svg.replaceAll('#edebe4', 'var(--k)')).toContain(COMPONENTS[n]!.replace(/^<svg /, '').replace(/<\/svg>$/, ''));
    }
    expect(glyphOf(chart, 'EquityTrait')('target')).toBeNull();
    await act(async () => made.forEach((img) => img.load()));
    expect(glyphOf(chart, 'EquityTrait')('target')).toBe(target);
    expect(glyphOf(chart, 'EquityTrait')('mire')).toBe(mire);
    expect(glyphOf(chart, 'UnderwaterTrait')('borne')).toBe(borne);
  });

  it('la borne du plan suivi passe au volet sous l’eau, et l’échelle du volet la contient', async () => {
    const chart = await mount({ floor: 2500 });
    const options = trait(chart, 'UnderwaterTrait').options;
    expect(options.floor).toBe(2500);
    expect(options.floorLabel).toMatch(/^PLANCHER −2\s?500$/u);
    const provider = options.autoscaleInfoProvider as (base: () => unknown) => { priceRange: { minValue: number; maxValue: number } } | null;
    expect(provider(() => ({ priceRange: { minValue: -450, maxValue: 0 } }))?.priceRange).toEqual({ minValue: -2500, maxValue: 0 });
    expect(host!.textContent).toMatch(/Plancher · borne/);
  });

  it('sans plan suivi, pas de borne : l’échelle reste celle des données, la légende n’en parle pas', async () => {
    const chart = await mount();
    const options = trait(chart, 'UnderwaterTrait').options;
    expect(options.floor).toBe(0);
    const provider = options.autoscaleInfoProvider as (base: () => unknown) => unknown;
    expect(provider(() => ({ priceRange: { minValue: -450, maxValue: 0 } }))).toEqual({ priceRange: { minValue: -450, maxValue: 0 } });
    expect(host!.textContent).not.toMatch(/Plancher · borne/);
  });

  it('la plaque A.02 en filigrane lit la courbe et les statistiques réelles, et se tait pour les lecteurs d’écran', async () => {
    await mount({ stats: { trades: 5, winRate: 0.8, profitFactor: 2.22 } });
    const plate = host!.querySelector('svg.mg-equity')!;
    expect(plate).not.toBeNull();
    const text = plate.textContent ?? '';
    expect(text).toContain('A.02 — EQUITY — NT8');
    expect(text).toContain('CUMUL +150,00 // DD −250,00');
    expect(text).toContain('– 4 – 5 – 80,0 – 2,22');
    expect(plate.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('sans statistiques transmises, la plaque dit « — » plutôt qu’un chiffre inventé', async () => {
    await mount();
    const text = host!.querySelector('svg.mg-equity')!.textContent ?? '';
    expect(text).toContain('– 4 – — – — – —');
    expect(text).not.toMatch(/\{\{/);
  });
});

describe('OROS3.2e graisse des composants peints (revue au rendu réel)', () => {
  it('un composant réduit à 12 px garde un trait d’environ un pixel : la graisse du master ne tomberait qu’au quart', async () => {
    const { COMPONENTS, GLYPH_ID } = await import('@/design/micro/assets');
    const { glyphSvg } = await import('@/modules/metrique/glyphSprite');
    const master = COMPONENTS[GLYPH_ID.target]!;
    // viewBox de 68,43 rendu sur 24 px : un pixel vaut 2,85 unités.
    const svg = glyphSvg(master, '#edebe4', '#14151a', 24, 1);
    expect(svg).toMatch(/<style>[^<]*stroke-width:\s*2\.85[^<]*<\/style><\/svg>$/);
    expect(svg).toContain(master.replace(/^<svg /, '').replace(/<\/svg>$/, '').replaceAll('var(--k)', '#edebe4'));
    // Sans graisse demandée, le master tel quel.
    expect(glyphSvg(master, '#edebe4', '#14151a', 24)).not.toContain('stroke-width:2.85');
  });
});
