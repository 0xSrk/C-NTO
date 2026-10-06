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
          const series: FakeSeries = { kind: view.constructor.name, pane, options: merge(structuredClone(view.defaultOptions()), options), data: [] };
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

async function mount() {
  const { EquityCard } = await import('@/modules/metrique/EquityChart');
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(EquityCard, { sessions, trades }));
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
    const rows = curve.steps.map((step) => ({ time: step.time, equity: step.equity, peak: step.peak, drawdown: step.drawdown, pnl: step.pnl }));
    for (const row of chart.series) expect(row.data).toEqual(rows);
    expect(marks(chart)).toEqual({ high: 2, highLabel: 'PLUS HAUT +400', trough: 3, troughLabel: 'CREUX −450' });
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
