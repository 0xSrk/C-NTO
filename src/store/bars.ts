import { create } from 'zustand';
import { generateDemoBars, importBarsCsv, type BarSeries } from '@/engine/bars';
import { defaultParams, indicatorById, type IndicatorInstance } from '@/engine/indicators';
import type { Instrument } from '@/engine/types';
import { uid } from '@/lib/id';
import { db, getSetting, setSetting } from './db';

interface BarsState {
  ready: boolean;
  series: BarSeries[];
  activeId: string | null;
  indicators: IndicatorInstance[];
  load: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  regenerateDemo: (opts?: { endDate?: string; days?: number; timeframe?: number }) => Promise<BarSeries>;
  importCsv: (text: string, name: string, instrument: Instrument, timeframe: number) => Promise<{ bars: number; warnings: string[] }>;
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

function seedFromDate(date?: string): number {
  if (!date) return 42;
  let h = 7;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export const useBars = create<BarsState>((set, get) => ({
  ready: false,
  series: [],
  activeId: null,
  indicators: DEFAULT_INDICATORS,

  async load() {
    let series = await db.barSeries.toArray();
    if (series.length === 0) {
      const demo: BarSeries = { id: uid('b'), instrument: 'NQ', timeframe: 5, label: 'NQ · 5 min · démo synthétique', source: 'demo', bars: generateDemoBars({ days: 12, timeframe: 5, seed: 42 }), createdAt: Date.now() };
      await db.barSeries.add(demo);
      series = [demo];
    }
    const activeId = (await getSetting<string | null>('chart.active', null)) ?? series[0]?.id ?? null;
    const indicators = await getSetting<IndicatorInstance[]>('chart.indicators', DEFAULT_INDICATORS);
    set({ series, activeId: series.some((sr) => sr.id === activeId) ? activeId : series[0]?.id ?? null, indicators, ready: true });
  },

  async setActive(id) {
    set({ activeId: id });
    await setSetting('chart.active', id);
  },

  async regenerateDemo(opts = {}) {
    const existing = get().series.find((sr) => sr.source === 'demo');
    const bars = generateDemoBars({ days: opts.days ?? 12, timeframe: opts.timeframe ?? 5, seed: seedFromDate(opts.endDate), endDate: opts.endDate });
    const demo: BarSeries = existing
      ? { ...existing, bars, timeframe: opts.timeframe ?? existing.timeframe, label: `NQ · ${opts.timeframe ?? existing.timeframe} min · démo synthétique${opts.endDate ? ` · ${opts.endDate}` : ''}` }
      : { id: uid('b'), instrument: 'NQ', timeframe: opts.timeframe ?? 5, label: 'NQ · 5 min · démo synthétique', source: 'demo', bars, createdAt: Date.now() };
    await db.barSeries.put(demo);
    set({ series: existing ? get().series.map((sr) => (sr.id === demo.id ? demo : sr)) : [...get().series, demo], activeId: demo.id });
    await setSetting('chart.active', demo.id);
    return demo;
  },

  async importCsv(text, name, instrument, timeframe) {
    const { bars, warnings } = importBarsCsv(text);
    if (bars.length === 0) return { bars: 0, warnings: warnings.length ? warnings : ['Aucune barre reconnue.'] };
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
