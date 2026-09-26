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
    const fake = transport([bar(30, 3), bar(10, 1), bar(10, 9)]);
    const port = createPort('nt8-bridge', { nt8: fake.port });
    expect(port.sourceId).toBe('nt8-bridge');
    expect(port.capabilities).toEqual({ history: true, live: ['bars', 'tick', 'quote'], instruments: 'any' });
    const history = await port.history!({ instrument: 'MNQ 12-26', timeframe: 5, from: 0, to: 100 });
    expect(history.map((row) => row.time)).toEqual([10, 30]);
    expect(history[0]?.close).toBe(9);

    const seen: FeedEvent[] = [];
    const stop = port.subscribe!({ instrument: 'MNQ 12-26', kind: 'bars', timeframe: 5 }, (event) => seen.push(event));
    await new Promise((resolve) => setImmediate(resolve));
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(40, 1), final: false });
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(40, 2), final: true });
    fake.emit({ kind: 'bar', instrument: 'MNQ 12-26', timeframe: 5, bar: bar(40, 8), final: false });
    const bars = seen.filter((event) => event.kind === 'bar');
    expect(bars).toHaveLength(2);
    if (bars[1]?.kind === 'bar') expect(bars[1].bar.close).toBe(2);
    stop();
    port.dispose();
    port.dispose();
    expect(fake.unsubs).toEqual(['sub-1']);
    await expect(port.history!({ instrument: 'MNQ 12-26', timeframe: 5, from: 0, to: 1 })).rejects.toThrow(/libéré/);
  });
});
