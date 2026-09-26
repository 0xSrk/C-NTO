import { describe, expect, it } from 'vitest';
import { generateDemoBars } from '@/engine/bars';
import { getInstrument } from '@/engine/instruments';
import { createPort, demoSeedFromDate } from '@/engine/marketdata';

const ALL = { from: 0, to: Number.MAX_SAFE_INTEGER };

describe('port de données de marché', () => {
  it('la démo reproduit generateDemoBars (NQ, graine 42)', async () => {
    const port = createPort('demo');
    const bars = await port.history!({ instrument: 'NQ', timeframe: 5, ...ALL });
    expect(bars).toEqual(generateDemoBars());
    expect(bars.map((b) => b.time)).toEqual([...bars.map((b) => b.time)].sort((a, b) => a - b));
    expect(new Set(bars.map((b) => b.time)).size).toBe(bars.length);
    port.dispose();
    port.dispose();
  });

  it('une date de fin reprend la même graine que le graphique', async () => {
    const endDate = '2026-09-11';
    const port = createPort('demo', { demo: { endDate, days: 3 } });
    const bars = await port.history!({ instrument: 'NQ', timeframe: 5, ...ALL });
    expect(bars).toEqual(generateDemoBars({ endDate, days: 3, timeframe: 5, seed: demoSeedFromDate(endDate) }));
    port.dispose();
  });

  it('arrondit sur le tick de la fiche, pas sur 0,25', async () => {
    const tick = getInstrument('6E').tickSize;
    const port = createPort('demo', { demo: { days: 1, seed: 3 } });
    const bars = await port.history!({ instrument: '6E', timeframe: 60, ...ALL });
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      for (const px of [bar.open, bar.high, bar.low, bar.close]) {
        expect(Math.abs(px / tick - Math.round(px / tick))).toBeLessThan(1e-6);
      }
    }
    port.dispose();
  });

  it('le CSV trie et dédoublonne, puis se libère deux fois', async () => {
    const text = ['20260915 093500;2;3;1;2.5;10', '20260915 093000;1;2;0.5;1.5;8', '20260915 093000;9;9;9;9;1'].join('\n');
    const port = createPort('csv', { csvText: text });
    const bars = await port.history!({ instrument: 'ES', timeframe: 5, ...ALL });
    expect(bars.map((b) => b.time)).toEqual([...bars.map((b) => b.time)].sort((a, b) => a - b));
    expect(new Set(bars.map((b) => b.time)).size).toBe(bars.length);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.open).toBe(9);
    const clipped = await port.history!({ instrument: 'ES', timeframe: 5, from: bars[1]!.time, to: bars[1]!.time });
    expect(clipped).toHaveLength(1);
    port.dispose();
    port.dispose();
    await expect(port.history!({ instrument: 'ES', timeframe: 5, ...ALL })).rejects.toThrow(/libéré/);
  });

  it('refuse une source inconnue', () => {
    expect(() => createPort('nt8-bridge')).toThrow(/inconnue/);
    expect(() => createPort('')).toThrow(/inconnue/);
  });
});
