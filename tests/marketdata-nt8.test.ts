import { describe, expect, it } from 'vitest';
import type { Bar } from '@/engine/bars';
import { createPort, type FeedEvent, type Nt8Transport } from '@/engine/marketdata';

function bar(time: number, close: number): Bar {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

function transport(seed: Bar[]): { port: Nt8Transport; emit: (event: FeedEvent) => void; unsubs: string[] } {
  const listeners = new Set<(event: FeedEvent) => void>();
  const unsubs: string[] = [];
  const port: Nt8Transport = {
    async subscribe() {
      return { ok: true, subscriptionId: 'sub-1' };
    },
    async unsubscribe(id) {
      unsubs.push(id);
      return { ok: true };
    },
    async history() {
      return { ok: true, bars: seed };
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { port, emit: (event) => listeners.forEach((cb) => cb(event)), unsubs };
}

describe('adaptateur nt8-bridge', () => {
  it('trie l’historique, remplace une barre non finale, ignore après final, dispose deux fois', async () => {
    // Horodatage NinjaTrader : clôture de la barre. Le desk date à l'ouverture (−5 min = −300 s).
    const T = 1_000_000;
    const fake = transport([bar(T + 600, 3), bar(T, 1), bar(T, 9)]);
    const port = createPort('nt8-bridge', { nt8: fake.port });
    expect(port.sourceId).toBe('nt8-bridge');
    expect(port.capabilities).toEqual({ history: true, live: ['bars', 'tick', 'quote'], instruments: 'any' });
    const history = await port.history!({ instrument: 'MNQ 12-26', timeframe: 5, from: 0, to: 2 * T });
    expect(history.map((row) => row.time)).toEqual([T - 300, T + 300]);
    expect(history[0]?.close).toBe(9);

    const seen: FeedEvent[] = [];
    const stop = port.subscribe!({ instrument: 'MNQ 12-26', kind: 'bars', timeframe: 5 }, (event) => seen.push(event));
    await new Promise((resolve) => setImmediate(resolve));
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(T + 900, 1), final: false });
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(T + 900, 2), final: true });
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(T + 900, 8), final: false });
    const bars = seen.filter((event) => event.kind === 'bar');
    expect(bars).toHaveLength(2);
    if (bars[1]?.kind === 'bar') expect(bars[1].bar).toMatchObject({ time: T + 600, close: 2 });
    stop();
    port.dispose();
    port.dispose();
    expect(fake.unsubs).toEqual(['sub-1']);
    await expect(port.history!({ instrument: 'MNQ 12-26', timeframe: 5, from: 0, to: 1 })).rejects.toThrow(/libéré/);
  });
});

describe('barres NinjaTrader dans le desk', () => {
  it('la barre 09:30–09:35 (horodatée 09:35 par NinjaTrader) ouvre à 09:30', async () => {
    const { ntBarToOpenTime } = await import('@/engine/marketdata/adapters/nt8');
    const close935 = Date.UTC(2026, 8, 14, 13, 35) / 1000; // 09:35 ET (EDT)
    expect(ntBarToOpenTime(bar(close935, 1), 5).time).toBe(Date.UTC(2026, 8, 14, 13, 30) / 1000);
    expect(ntBarToOpenTime(bar(close935, 1), undefined).time).toBe(close935);
  });

  it('une barre en direct ne remplace pas la série choisie par le trader ; elle remplace la démo', async () => {
    const { useBars } = await import('@/store/bars');
    const csv = { id: 'csv1', instrument: 'NQ', timeframe: 5, label: 'csv', source: 'csv' as const, bars: [], createdAt: 0 };
    const demo = { ...csv, id: 'demo1', source: 'demo' as const };
    useBars.setState({ series: [csv, demo], activeId: 'csv1' });
    useBars.getState().applyNtBar('NQ 12-26', 5, bar(1_000_000, 1), false);
    expect(useBars.getState().activeId).toBe('csv1');
    expect(useBars.getState().series.find((s) => s.id === 'nt8:NQ:5')?.bars[0]?.time).toBe(1_000_000 - 300);
    useBars.setState({ activeId: 'demo1' });
    useBars.getState().applyNtBar('NQ 12-26', 5, bar(1_000_300, 1), false);
    expect(useBars.getState().activeId).toBe('nt8:NQ:5');
  });
});
