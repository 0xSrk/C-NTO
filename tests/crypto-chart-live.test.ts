/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoBar } from '@/engine/crypto/markets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Calls {
  /** Longueur de chaque `setData`, série par série. */
  setData: { kind: string; length: number }[];
  /** Heure de chaque `update`, série par série. */
  update: { kind: string; time: number }[];
  fitContent: number;
  ranges: { from: number; to: number }[];
}

// Le canevas n'existe pas sous jsdom : lightweight-charts est remplacé par un enregistreur des appels qui touchent
// les données et la vue (`setData`, `update`, `fitContent`, `setVisibleLogicalRange`).
const calls = vi.hoisted((): Calls => ({ setData: [], update: [], fitContent: 0, ranges: [] }));
vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  HistogramSeries: 'Histogram',
  LineSeries: 'Line',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  createSeriesMarkers: () => ({ setMarkers: () => undefined }),
  createChart: () => ({
    addSeries: (kind: string) => ({
      setData: (data: unknown[]) => calls.setData.push({ kind, length: data.length }),
      update: (point: { time: number }) => calls.update.push({ kind, time: point.time }),
      applyOptions: () => undefined,
      createPriceLine: () => ({ applyOptions: () => undefined }),
      removePriceLine: () => undefined,
    }),
    panes: () => [{ setHeight: () => undefined }, { setHeight: () => undefined }],
    subscribeCrosshairMove: () => undefined,
    timeScale: () => ({
      fitContent: () => {
        calls.fitContent++;
      },
      setVisibleLogicalRange: (range: { from: number; to: number }) => calls.ranges.push(range),
    }),
    applyOptions: () => undefined,
    removeSeries: () => undefined,
    remove: () => undefined,
  }),
}));

// jsdom mesure tout à 0 : le cadre du graphique est déclaré prêt (arbitrage R5 du plan).
vi.mock('@/modules/visual/chartBox', () => ({
  chartHostReady: () => true,
  safePaneHeight: (requested: number) => requested,
}));

import { mergeLiveBar } from '@/engine/crypto/tradeBars';
import { Chart } from '@/modules/visual/Chart';

const H = 3600;
const T0 = 1_791_500_400; // 2026-10-09 22:20 UTC, une heure pleine près
/** `n` bougies 1h closes, de `T0` en montant ; la dernière porte un volume acheteur (Binance) ou non (Coinbase). */
const history = (n: number, start = T0): CryptoBar[] =>
  Array.from({ length: n }, (_, i) => ({ time: start + i * H, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10, buyVolume: 6 }));

let root: Root | null = null;
let host: HTMLElement | null = null;

async function show(bars: CryptoBar[]) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(createElement(Chart, { bars, timeframe: 60, lines: [], trades: [] }));
  });
}

const reset = () => {
  calls.setData.length = 0;
  calls.update.length = 0;
  calls.fitContent = 0;
  calls.ranges.length = 0;
};

beforeEach(() => {
  reset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('Chart › vue pendant le direct (revue finale, S1)', () => {
  it('l’historique ouvre sur les 160 dernières bougies ; le direct ne pousse que la dernière et garde la vue', async () => {
    let bars = history(600);
    await show(bars);
    expect(calls.fitContent).toBe(1);
    expect(calls.ranges).toEqual([{ from: 440, to: 606 }]);
    expect(calls.setData).toEqual([
      { kind: 'Candlestick', length: 600 },
      { kind: 'Histogram', length: 600 },
    ]);
    reset();

    // Le trader recule ou zoome ; puis la bougie en cours bouge (même heure), puis une bougie s'ouvre (heure suivante).
    const lastTime = bars.at(-1)!.time;
    bars = mergeLiveBar(bars, { ...bars.at(-1)!, close: 700.25, high: 701 }, 3000);
    await show(bars);
    bars = mergeLiveBar(bars, { time: lastTime + H, open: 700.25, high: 700.5, low: 700, close: 700.4, volume: 0.2, buyVolume: 0.1 }, 3000);
    await show(bars);

    expect(calls.fitContent).toBe(0);
    expect(calls.ranges).toEqual([]);
    expect(calls.setData).toEqual([]);
    expect(calls.update).toEqual([
      { kind: 'Candlestick', time: lastTime },
      { kind: 'Histogram', time: lastTime },
      { kind: 'Candlestick', time: lastTime + H },
      { kind: 'Histogram', time: lastTime + H },
    ]);
  });

  it('au plafond, la plus ancienne tombe : tout est renvoyé, la vue reste où elle est', async () => {
    let bars = history(3000);
    await show(bars);
    reset();
    bars = mergeLiveBar(bars, { time: bars.at(-1)!.time + H, open: 1, high: 1, low: 1, close: 1, volume: 1, buyVolume: 1 }, 3000);
    expect(bars).toHaveLength(3000);
    await show(bars);
    expect(calls.setData).toEqual([
      { kind: 'Candlestick', length: 3000 },
      { kind: 'Histogram', length: 3000 },
    ]);
    expect(calls.fitContent).toBe(0);
    expect(calls.ranges).toEqual([]);
  });

  it('autre marché ou timeframe (série vidée, puis un autre historique) : la vue repart de la fenêtre d’ouverture', async () => {
    await show(history(600));
    reset();
    await show([]);
    await show(history(300, T0 + 7 * H));
    expect(calls.setData.filter((row) => row.kind === 'Candlestick').map((row) => row.length)).toEqual([0, 300]);
    expect(calls.update).toEqual([]);
    expect(calls.fitContent).toBe(2);
    expect(calls.ranges).toEqual([{ from: 140, to: 306 }]);
  });

  it('un historique qui remplace la série sans passer par le vide repart aussi de la fenêtre d’ouverture', async () => {
    await show(history(600));
    reset();
    // Mêmes heures, autres objets : un nouvel historique, pas le direct.
    await show(history(600));
    expect(calls.update).toEqual([]);
    expect(calls.fitContent).toBe(1);
    expect(calls.ranges).toEqual([{ from: 440, to: 606 }]);
  });
});
