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
  data: { time: number; value?: number; color?: string }[];
  markers: { time: number; text: string }[];
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
vi.mock('lightweight-charts', () => ({
  BaselineSeries: 'Baseline',
  LineSeries: 'Line',
  HistogramSeries: 'Histogram',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Magnet: 3 },
  LineStyle: { Dotted: 1 },
  createSeriesMarkers: (api: { __fake: FakeSeries }) => ({
    setMarkers: (markers: FakeSeries['markers']) => {
      api.__fake.markers = markers;
    },
  }),
  createChart: () => {
    const chart: FakeChart = { series: [], crosshair: null, fits: 0, range: { from: 0, to: 20 }, removed: false };
    state.charts.push(chart);
    return {
      addSeries: (kind: string, options: Record<string, unknown>, pane = 0) => {
        const series: FakeSeries = { kind, pane, options, data: [], markers: [] };
        chart.series.push(series);
        return {
          setData: (data: FakeSeries['data']) => {
            series.data = data;
          },
          __fake: series,
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
}));

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

const byPane = (chart: FakeChart, pane: number, kind: string) => chart.series.find((row) => row.pane === pane && row.kind === kind)!;
const readout = () => host!.querySelector('[aria-live]')!.textContent ?? '';

// Jetons du Système 3.4 (sous jsdom, tokens.css n'est pas chargé) : le graphique doit les lire.
const TOKENS = '[role="img"] { --pos: #74c69d; --neg: #e0735f; --mint-line: rgba(116, 198, 157, 0.5); --ember-line: rgba(224, 115, 95, 0.5); }';

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
  it('dessine l’équité, le plus haut, le P&L par séance et le drawdown ; marque le creux', async () => {
    const chart = await mount();
    const curve = equityCurve(sessions, trades, 'session');
    const equity = chart.series.find((row) => row.pane === 0 && row.kind === 'Baseline')!;
    expect(equity.data).toEqual(curve.steps.map((step) => ({ time: step.time, value: step.equity })));
    expect(equity.options.baseValue).toEqual({ type: 'price', price: 0 });
    expect(byPane(chart, 0, 'Line').data.map((row) => row.value)).toEqual([0, 100, 400, 400, 400]);
    const pnl = byPane(chart, 1, 'Histogram').data;
    expect(pnl[0]).toEqual({ time: curve.steps[0]!.time });
    expect(pnl.slice(1).map((row) => row.value)).toEqual([100, 300, -450, 200]);
    expect([pnl[2]?.color, pnl[3]?.color].map((color) => color?.replace(/\s/g, ''))).toEqual(['rgba(116,198,157,0.5)', 'rgba(224,115,95,0.5)']);
    expect([equity.options.topLineColor, equity.options.bottomLineColor]).toEqual(['#74c69d', '#e0735f']);
    expect(byPane(chart, 2, 'Baseline').data.map((row) => row.value)).toEqual([0, 0, 0, -450, -250]);
    expect(equity.markers).toEqual([expect.objectContaining({ time: curve.steps[3]!.time, text: '−450' })]);
    expect(chart.fits).toBe(1);
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
    const equity = chart.series.find((row) => row.pane === 0 && row.kind === 'Baseline')!;
    expect(equity.data.map((row) => row.value)).toEqual([0, 40, 100, 400, -50, 150]);
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
