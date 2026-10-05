import { describe, expect, it } from 'vitest';
import type { Bar, BarSeries } from '@/engine/bars';
import { executeDeskTool } from '@/engine/agent/runner';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { fakePorts } from './helpers/deskPorts';

/** Barres de 5 min datées à l'ouverture, de `from` à `to` (HH:mm ET), prix croissants depuis `base`. */
function day(date: string, from: string, to: string, base: number): Bar[] {
  const out: Bar[] = [];
  let t = zonedToUtc(date, from, ET_ZONE) / 1000;
  const end = zonedToUtc(date, to, ET_ZONE) / 1000;
  let px = base;
  while (t <= end) {
    out.push({ time: t, open: px, high: px + 2, low: px - 1, close: px + 1, volume: 100 });
    px += 1;
    t += 300;
  }
  return out;
}

const day1 = day('2026-09-14', '09:30', '15:55', 21_000);
const day2 = day('2026-09-15', '09:30', '10:30', 21_200);
const nt8: BarSeries = { id: 'nt8:NQ:5', instrument: 'NQ', timeframe: 5, label: 'NQ 12-26 · 5 min · NinjaTrader', source: 'nt8-bridge', bars: [...day1, ...day2], createdAt: 0 };
const demo: BarSeries = { id: 'demo', instrument: 'NQ', timeframe: 5, label: 'démo', source: 'demo', bars: day('2026-09-15', '09:30', '10:00', 1), createdAt: 0 };

describe('market_levels', () => {
  it('pont d’abord : séance précédente, Opening Range des 15 premières minutes, dernier prix', async () => {
    const out = (await executeDeskTool(fakePorts({ barSeries: async () => [demo, nt8] }), 'market_levels', { instrument: 'NQ 12-26' }, { source: 'orch' })) as Record<string, any>;
    expect(out.series).toMatchObject({ source: 'nt8-bridge', synthetic: false, timeframe: 5 });
    expect(out.prevSession).toEqual({ high: Math.max(...day1.map((b) => b.high)), low: Math.min(...day1.map((b) => b.low)), close: day1.at(-1)!.close });
    const first3 = day2.slice(0, 3);
    expect(out.openingRange).toEqual({ minutes: 15, high: Math.max(...first3.map((b) => b.high)), low: Math.min(...first3.map((b) => b.low)) });
    expect(out.last.close).toBe(day2.at(-1)!.close);
    expect(typeof out.vwap.value).toBe('number');
    expect(out.atr14).toBeGreaterThan(0);
  });

  it('démo seule : marquée synthetic', async () => {
    const out = (await executeDeskTool(fakePorts({ barSeries: async () => [demo] }), 'market_levels', {}, { source: 'llm' })) as Record<string, any>;
    expect(out.series).toMatchObject({ source: 'demo', synthetic: true });
  });

  it('instrument hors registre ou sans barres : le dire', async () => {
    const unknown = (await executeDeskTool(fakePorts({ barSeries: async () => [nt8] }), 'market_levels', { instrument: 'ZZZ' }, { source: 'llm' })) as { error?: string };
    expect(unknown.error).toMatch(/ZZZ/);
    const none = (await executeDeskTool(fakePorts({ barSeries: async () => [nt8] }), 'market_levels', { instrument: 'CL' }, { source: 'llm' })) as { error?: string };
    expect(typeof none.error).toBe('string');
  });
});
