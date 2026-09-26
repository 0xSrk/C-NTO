import { create } from 'zustand';
import { tr } from '@/i18n';
import type { Bar, BarSeries } from '@/engine/bars';
import { DEFAULT_FUTURE } from '@/engine/instruments';
import { createPort, portWarnings, type MarketDataPort } from '@/engine/marketdata';
import { CSV_WORKER_MIN_LINES, csvLineCount } from '@/engine/import';
import { defaultParams, indicatorById, type IndicatorInstance } from '@/engine/indicators';
import type { Instrument } from '@/engine/types';
import { uid } from '@/lib/id';
import { listenWorker } from '@/lib/worker';
import { db, getSetting, setSetting } from './db';

interface BarsState {
  ready: boolean;
  series: BarSeries[];
  activeId: string | null;
  indicators: IndicatorInstance[];
  load: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  saveDemoSeries: (bars: Bar[], timeframe: number, endDate?: string) => Promise<BarSeries>;
  importCsv: (port: MarketDataPort, text: string, name: string, instrument: Instrument, timeframe: number, opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) => Promise<{ bars: number; warnings: string[] }>;
  remove: (id: string) => Promise<void>;
  addIndicator: (definitionId: string) => Promise<void>;
  updateIndicator: (id: string, params: Record<string, number | string>) => Promise<void>;
  toggleIndicator: (id: string) => Promise<void>;
  removeIndicator: (id: string) => Promise<void>;
}

const DEFAULT_INDICATORS: IndicatorInstance[] = [
  { id: 'ind_vwap', definitionId: 'vwap', params: { bands: '1' }, visible: true },
  { id: 'ind_ema21', definitionId: 'ema', params: { period: 21 }, visible: true },
  { id: 'ind_or', definitionId: 'opening-range', params: { minutes: 15 }, visible: true },
];

const HISTORY_SPAN = { from: 0, to: Number.MAX_SAFE_INTEGER } as const;

let loading: Promise<void> | null = null;

export const useBars = create<BarsState>((set, get) => ({
  ready: false,
  series: [],
  activeId: null,
  indicators: DEFAULT_INDICATORS,

  load() {
    if (loading) return loading;
    loading = (async () => {
      const existing = await db.barSeries.toArray();
      const series = existing.length > 0 ? existing : await (async () => {
        const port = createPort('demo');
        let bars: Bar[];
        try {
          if (!port.history) throw new Error('Port démo sans historique');
          bars = await port.history({ instrument: DEFAULT_FUTURE, timeframe: 5, ...HISTORY_SPAN });
        } finally {
          port.dispose();
        }
        return db.transaction('rw', db.barSeries, async () => {
          const again = await db.barSeries.toArray();
          if (again.length > 0) return again;
          const demo: BarSeries = { id: uid('b'), instrument: DEFAULT_FUTURE, timeframe: 5, label: tr('NQ · 5 min · démo synthétique', 'NQ · 5 min · synthetic demo', 'NQ · 5 min · demo sintética'), source: 'demo', bars, createdAt: Date.now() };
          await db.barSeries.add(demo);
          return [demo];
        });
      })();
      const activeId = (await getSetting<string | null>('chart.active', null)) ?? series[0]?.id ?? null;
      const indicators = await getSetting<IndicatorInstance[]>('chart.indicators', DEFAULT_INDICATORS);
      set({ series, activeId: series.some((sr) => sr.id === activeId) ? activeId : series[0]?.id ?? null, indicators, ready: true });
    })().finally(() => {
      loading = null;
    });
    return loading;
  },

  async setActive(id) {
    set({ activeId: id });
    await setSetting('chart.active', id);
  },

  async saveDemoSeries(bars, timeframe, endDate) {
    const existing = get().series.find((sr) => sr.source === 'demo');
    const demo: BarSeries = existing
      ? { ...existing, bars, timeframe, label: tr(`NQ · ${timeframe} min · démo synthétique${endDate ? ` · ${endDate}` : ''}`, `NQ · ${timeframe} min · synthetic demo${endDate ? ` · ${endDate}` : ''}`, `NQ · ${timeframe} min · demo sintética${endDate ? ` · ${endDate}` : ''}`) }
      : { id: uid('b'), instrument: DEFAULT_FUTURE, timeframe, label: tr('NQ · 5 min · démo synthétique', 'NQ · 5 min · synthetic demo', 'NQ · 5 min · demo sintética'), source: 'demo', bars, createdAt: Date.now() };
    await db.barSeries.put(demo);
    set({ series: existing ? get().series.map((sr) => (sr.id === demo.id ? demo : sr)) : [...get().series, demo], activeId: demo.id });
    await setSetting('chart.active', demo.id);
    return demo;
  },

  async importCsv(port, text, name, instrument, timeframe, opts = {}) {
    const readCsvPort = async (): Promise<{ bars: Bar[]; warnings: string[] }> => {
      if (!port.history) throw new Error('Port sans historique');
      const bars = await port.history({ instrument, timeframe, ...HISTORY_SPAN });
      return { bars, warnings: portWarnings(port) };
    };
    let parsed: { bars: Bar[]; warnings: string[] };
    if (typeof Worker !== 'undefined' && csvLineCount(text) > CSV_WORKER_MIN_LINES) {
      try {
        const worker = new Worker(new URL('../engine/bars.worker.ts', import.meta.url), { type: 'module' });
        const pending = listenWorker<{ bars: Bar[]; warnings: string[] }>(worker, { signal: opts.signal, onProgress: opts.onProgress });
        worker.postMessage({ text });
        parsed = await pending;
      } catch (e) {
        if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
        parsed = await readCsvPort();
      }
    } else {
      parsed = await readCsvPort();
    }
    const { bars, warnings } = parsed;
    if (bars.length === 0) return { bars: 0, warnings: warnings.length ? warnings : [tr('Aucune barre reconnue.', 'No bars recognized.', 'Ninguna barra reconocida.')] };
    const sr: BarSeries = { id: uid('b'), instrument, timeframe, label: `${instrument} · ${timeframe} min · ${name}`, source: 'csv', bars, createdAt: Date.now() };
    await db.barSeries.add(sr);
    set({ series: [...get().series, sr], activeId: sr.id });
    await setSetting('chart.active', sr.id);
    return { bars: bars.length, warnings };
  },

  async remove(id) {
    await db.barSeries.delete(id);
    const series = get().series.filter((sr) => sr.id !== id);
    const activeId = get().activeId === id ? series[0]?.id ?? null : get().activeId;
    set({ series, activeId });
    await setSetting('chart.active', activeId);
  },

  async addIndicator(definitionId) {
    const def = indicatorById(definitionId);
    if (!def) return;
    const indicators = [...get().indicators, { id: uid('ind'), definitionId, params: defaultParams(def), visible: true }];
    set({ indicators });
    await setSetting('chart.indicators', indicators);
  },

  async updateIndicator(id, params) {
    const indicators = get().indicators.map((i) => (i.id === id ? { ...i, params: { ...i.params, ...params } } : i));
    set({ indicators });
    await setSetting('chart.indicators', indicators);
  },

  async toggleIndicator(id) {
    const indicators = get().indicators.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i));
    set({ indicators });
    await setSetting('chart.indicators', indicators);
  },

  async removeIndicator(id) {
    const indicators = get().indicators.filter((i) => i.id !== id);
    set({ indicators });
    await setSetting('chart.indicators', indicators);
  },
}));
