/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bar } from '@/engine/bars';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeLine {
  options: Record<string, unknown>;
  /** Chaque `applyOptions` reçu, dans l'ordre. */
  updates: Record<string, unknown>[];
  removed: boolean;
}

interface FakeSeries {
  kind: string;
  pane: number;
  options: Record<string, unknown>;
  /** Chaque `applyOptions` reçu, dans l'ordre. */
  applied: Record<string, unknown>[];
  lines: FakeLine[];
  removeCalls: number;
}

interface FakeChart {
  options: Record<string, unknown>;
  series: FakeSeries[];
  removed: boolean;
}

// Le canevas n'existe pas sous jsdom : lightweight-charts est remplacé par un enregistreur
// qui garde les options des séries et les appels `createPriceLine` / `removePriceLine`.
const state = vi.hoisted(() => ({ charts: [] as FakeChart[] }));
vi.mock('lightweight-charts', () => {
  /** Même fusion que `applyOptions` de la bibliothèque : profonde sur les objets, les fonctions sont posées telles quelles. */
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const key of Object.keys(src)) {
      const value = src[key];
      if (value === undefined) continue;
      if (typeof value !== 'object' || value === null || dst[key] === undefined || typeof dst[key] !== 'object' || Array.isArray(value)) dst[key] = value;
      else merge(dst[key] as Record<string, unknown>, value as Record<string, unknown>);
    }
    return dst;
  };
  const priceLine = (series: FakeSeries, options: Record<string, unknown>) => {
    const line: FakeLine = { options: merge({}, options), updates: [], removed: false };
    series.lines.push(line);
    return {
      applyOptions: (next: Record<string, unknown>) => {
        line.updates.push(next);
        merge(line.options, next);
      },
      line,
    };
  };
  return {
    CandlestickSeries: 'Candlestick',
    HistogramSeries: 'Histogram',
    LineSeries: 'Line',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    createSeriesMarkers: () => ({ setMarkers: () => undefined }),
    createChart: (_el: unknown, options: Record<string, unknown>) => {
      const chart: FakeChart = { options: merge({}, options), series: [], removed: false };
      state.charts.push(chart);
      return {
        addSeries: (kind: string, seriesOptions: Record<string, unknown>, pane = 0) => {
          const series: FakeSeries = { kind, pane, options: merge({}, seriesOptions), applied: [], lines: [], removeCalls: 0 };
          chart.series.push(series);
          const handles = new Map<unknown, FakeLine>();
          return {
            setData: () => undefined,
            applyOptions: (next: Record<string, unknown>) => {
              series.applied.push(next);
              merge(series.options, next);
            },
            createPriceLine: (lineOptions: Record<string, unknown>) => {
              const handle = priceLine(series, lineOptions);
              handles.set(handle, handle.line);
              return handle;
            },
            removePriceLine: (handle: unknown) => {
              series.removeCalls++;
              const line = handles.get(handle);
              if (line) line.removed = true;
            },
          };
        },
        panes: () => [{ setHeight: () => undefined }, { setHeight: () => undefined }],
        subscribeCrosshairMove: () => undefined,
        timeScale: () => ({ fitContent: () => undefined, setVisibleLogicalRange: () => undefined }),
        applyOptions: (next: Record<string, unknown>) => {
          merge(chart.options, next);
        },
        removeSeries: () => undefined,
        remove: () => {
          chart.removed = true;
        },
      };
    },
  };
});

// jsdom mesure tout à 0 : le cadre du graphique est déclaré prêt (arbitrage R5 du plan).
vi.mock('@/modules/visual/chartBox', () => ({
  chartHostReady: () => true,
  safePaneHeight: (requested: number) => requested,
}));

import { Chart } from '@/modules/visual/Chart';
import { useI18n } from '@/i18n';
import { cssToken } from '@/lib/cssToken';
import { fixedFormatterForTest, fmtPrice } from '@/lib/format';

type ChartProps = Parameters<typeof Chart>[0];

const BARS: Bar[] = [
  { time: 1_700_000_000, open: 0.00215, high: 0.00218, low: 0.00214, close: 0.002163, volume: 1200 },
  { time: 1_700_000_060, open: 0.002163, high: 0.00219, low: 0.00216, close: 0.00217, volume: 900 },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(props: Partial<ChartProps> = {}) {
  const full = { bars: BARS, timeframe: 1, lines: [], trades: [], ...props } as ChartProps;
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(createElement(Chart, full));
  });
}

async function unmount() {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

/** Dernier graphique créé, sa série de bougies et le formateur de prix posé sur l'échelle. */
const current = () => {
  const chart = state.charts.at(-1);
  if (!chart) throw new Error('graphique non créé');
  const candles = chart.series.find((row) => row.kind === 'Candlestick');
  if (!candles) throw new Error('série de bougies absente');
  const formatter = (chart.options.localization as { priceFormatter: (price: number) => string }).priceFormatter;
  return { chart, candles, formatter };
};

const line = (id: string, price: number, title = id.toUpperCase(), color = 'rgb(169, 150, 224)') => ({ id, price, title, color });

beforeEach(() => {
  state.charts.length = 0;
  useI18n.setState({ locale: 'fr' });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CRY4.1 › fmtPrice', () => {
  it('prend la précision demandée, deux décimales par défaut', () => {
    expect(fmtPrice(0.002163, 6)).toBe(fixedFormatterForTest(6).format(0.002163));
    expect(fmtPrice(23429.5)).toBe(fixedFormatterForTest(2).format(23429.5));
    expect(fmtPrice(23429.5, 2)).toBe(fmtPrice(23429.5));
  });

  it('écarte une valeur absente ou non finie, quelle que soit la précision', () => {
    for (const digits of [undefined, 6]) {
      expect(fmtPrice(null, digits)).toBe('—');
      expect(fmtPrice(undefined, digits)).toBe('—');
      expect(fmtPrice(Number.NaN, digits)).toBe('—');
      expect(fmtPrice(Number.POSITIVE_INFINITY, digits)).toBe('—');
    }
  });
});

describe('CRY4.1 › Chart › précision du prix', () => {
  it('sans la nouvelle prop, la série et l’échelle gardent deux décimales et un pas de 0,25', async () => {
    await render();
    const { candles, formatter } = current();
    expect(candles.options.priceFormat).toEqual({ type: 'price', precision: 2, minMove: 0.25 });
    expect(formatter(23429.5)).toBe(fixedFormatterForTest(2).format(23429.5));
  });

  it('applique la précision du marché à la série de bougies et à l’échelle', async () => {
    await render({ priceFormat: { precision: 6, minMove: 0.000001 } });
    const { candles, formatter } = current();
    expect(candles.options.priceFormat).toEqual({ type: 'price', precision: 6, minMove: 0.000001 });
    expect(formatter(0.002163)).toBe(fixedFormatterForTest(6).format(0.002163));
  });

  it('reprend la nouvelle précision au changement de marché, sans recréer le graphique', async () => {
    await render({ priceFormat: { precision: 6, minMove: 0.000001 } });
    await render({ priceFormat: { precision: 2, minMove: 0.5 } });
    expect(state.charts).toHaveLength(1);
    const { candles, formatter } = current();
    expect(candles.options.priceFormat).toEqual({ type: 'price', precision: 2, minMove: 0.5 });
    expect(formatter(82528.25)).toBe(fixedFormatterForTest(2).format(82528.25));
    expect(formatter(82528.25)).not.toBe(fixedFormatterForTest(6).format(82528.25));
  });

  it('ne réapplique rien quand seul l’objet change, pas ses valeurs', async () => {
    await render({ priceFormat: { precision: 6, minMove: 0.000001 } });
    const before = current().candles.applied.length;
    await render({ priceFormat: { precision: 6, minMove: 0.000001 } });
    await render();
    expect(current().candles.applied.length).toBe(before + 1);
    expect(current().candles.options.priceFormat).toEqual({ type: 'price', precision: 2, minMove: 0.25 });
  });

  it('une série sans les nouvelles props ne reçoit aucun applyOptions de format au démarrage', async () => {
    await render();
    expect(current().candles.applied).toEqual([]);
  });
});

describe('CRY4.1 › Chart › tracés horizontaux', () => {
  it('crée une ligne en tirets par tracé', async () => {
    await render({ priceLines: [line('agent', 82_400, 'AGENT'), line('alert', 83_000, 'ALERTE')] });
    const { candles } = current();
    expect(candles.lines).toHaveLength(2);
    expect(candles.lines.map((row) => row.options)).toMatchObject([
      { price: 82_400, title: 'AGENT', color: 'rgb(169, 150, 224)', lineStyle: 2 },
      { price: 83_000, title: 'ALERTE', color: 'rgb(169, 150, 224)', lineStyle: 2 },
    ]);
    expect(candles.removeCalls).toBe(0);
  });

  it('retire la ligne dont l’id a disparu et laisse l’autre intacte', async () => {
    await render({ priceLines: [line('a', 100), line('b', 200)] });
    await render({ priceLines: [line('b', 200)] });
    const { candles } = current();
    expect(candles.lines).toHaveLength(2);
    expect(candles.removeCalls).toBe(1);
    expect(candles.lines.map((row) => row.removed)).toEqual([true, false]);
    expect(candles.lines[1]?.updates).toEqual([]);
  });

  it('met à jour une ligne en place quand son prix, son titre ou sa couleur changent', async () => {
    await render({ priceLines: [line('a', 100, 'A', 'red'), line('b', 200)] });
    await render({ priceLines: [line('a', 110, 'A2', 'blue'), line('b', 200)] });
    const { candles } = current();
    expect(candles.lines).toHaveLength(2);
    expect(candles.removeCalls).toBe(0);
    expect(candles.lines[0]?.options).toMatchObject({ price: 110, title: 'A2', color: 'blue', lineStyle: 2 });
    expect(candles.lines[0]?.updates).toEqual([{ price: 110, title: 'A2', color: 'blue' }]);
    expect(candles.lines[1]?.updates).toEqual([]);
  });

  it('ne touche à rien quand la liste est reconstruite à l’identique', async () => {
    await render({ priceLines: [line('a', 100)] });
    await render({ priceLines: [line('a', 100)] });
    await render({ priceLines: [line('a', 100)], timeframe: 5 });
    const { candles } = current();
    expect(candles.lines).toHaveLength(1);
    expect(candles.lines[0]?.updates).toEqual([]);
    expect(candles.removeCalls).toBe(0);
  });

  it('ignore un prix non fini ou nul ou négatif : aucune ligne', async () => {
    await render({ priceLines: [line('nan', Number.NaN), line('inf', Number.POSITIVE_INFINITY), line('zero', 0), line('neg', -5), line('ok', 42)] });
    const { candles } = current();
    expect(candles.lines).toHaveLength(1);
    expect(candles.lines[0]?.options).toMatchObject({ price: 42, title: 'OK' });
  });

  it('retire la ligne dont le prix devient invalide, puis la recrée quand il redevient valide', async () => {
    await render({ priceLines: [line('a', 100)] });
    await render({ priceLines: [line('a', Number.NaN)] });
    expect(current().candles.removeCalls).toBe(1);
    expect(current().candles.lines.map((row) => row.removed)).toEqual([true]);
    await render({ priceLines: [line('a', 120)] });
    expect(current().candles.lines.map((row) => row.removed)).toEqual([true, false]);
    expect(current().candles.lines[1]?.options).toMatchObject({ price: 120 });
  });

  it('retire tous les tracés quand la prop disparaît', async () => {
    await render({ priceLines: [line('a', 100), line('b', 200)] });
    await render();
    expect(current().candles.removeCalls).toBe(2);
    expect(current().candles.lines.map((row) => row.removed)).toEqual([true, true]);
  });

  it('au démontage le graphique est retiré ; un nouveau montage retrace chaque ligne', async () => {
    await render({ priceLines: [line('a', 100), line('b', 200)] });
    const first = current().chart;
    await unmount();
    expect(first.removed).toBe(true);
    await render({ priceLines: [line('a', 100), line('b', 200)] });
    expect(state.charts).toHaveLength(2);
    expect(current().candles.lines).toHaveLength(2);
    expect(current().candles.lines.every((row) => !row.removed)).toBe(true);
  });

  it('un graphique recréé repart sans ligne héritée et reprend le format courant', async () => {
    const hover = () => undefined;
    await render({ onHover: hover, priceFormat: { precision: 6, minMove: 0.000001 }, priceLines: [line('a', 0.002)] });
    const first = current();
    await render({ onHover: () => undefined, priceFormat: { precision: 6, minMove: 0.000001 }, priceLines: [line('a', 0.002)] });
    expect(state.charts).toHaveLength(2);
    expect(first.chart.removed).toBe(true);
    const second = current();
    expect(second.chart).not.toBe(first.chart);
    expect(second.candles.lines).toHaveLength(1);
    expect(second.candles.lines[0]?.options).toMatchObject({ price: 0.002 });
    expect(second.candles.options.priceFormat).toEqual({ type: 'price', precision: 6, minMove: 0.000001 });
    expect(second.formatter(0.002163)).toBe(fixedFormatterForTest(6).format(0.002163));
  });
});

describe('CRY4.1 › cssToken', () => {
  it('rend la valeur calculée, sans espaces autour', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => (name === '--violet' ? '  #a996e0 ' : '') } as CSSStyleDeclaration);
    expect(cssToken('--violet', 'gray')).toBe('#a996e0');
  });

  it('rend le repli quand le jeton est vide ou absent', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => '   ' } as unknown as CSSStyleDeclaration);
    expect(cssToken('--violet', 'gray')).toBe('gray');
    vi.restoreAllMocks();
    expect(cssToken('--jeton-inexistant', 'gray')).toBe('gray');
  });

  it('lit la feuille de style réelle du document', () => {
    const style = document.createElement('style');
    style.textContent = ':root { --probe-cry41: #a996e0; }';
    document.head.append(style);
    try {
      expect(cssToken('--probe-cry41', 'gray')).toBe('#a996e0');
    } finally {
      style.remove();
    }
  });

  it('rend le repli sans document', () => {
    vi.stubGlobal('document', undefined);
    expect(cssToken('--violet', 'gray')).toBe('gray');
  });
});

describe('OROS3.5f › Chart › le dernier prix est or', () => {
  it('la ligne et l’étiquette du dernier prix prennent l’or du jeton --gold : ce qui vit est or', async () => {
    document.documentElement.style.setProperty('--gold', '#ccb066');
    await render();
    const { candles } = current();
    expect(candles.options.priceLineColor).toBe('#ccb066');
    expect(candles.options.priceLineVisible).not.toBe(false);
    document.documentElement.style.removeProperty('--gold');
  });
});
