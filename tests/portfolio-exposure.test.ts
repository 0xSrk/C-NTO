import { describe, expect, it } from 'vitest';
import { exposure } from '@/engine/portfolio';
import type { Pocket, Position } from '@/engine/portfolio';

const now = 1_800_000_000_000;

describe('exposure', () => {
  it('notionnel, concentration et levier brut', () => {
    const pocket: Pocket = { id: 'a', name: 'Actions', kind: 'actions', currency: 'USD', createdAt: now };
    const positions: Position[] = [
      { id: 'p1', pocketId: 'a', symbol: 'AAA', quantity: 3, avgPrice: 100, lastPrice: 100, currency: 'USD', openedAt: now },
      { id: 'p2', pocketId: 'a', symbol: 'BBB', quantity: -1, avgPrice: 100, lastPrice: 100, currency: 'USD', openedAt: now },
    ];
    const x = exposure({ pockets: [pocket], positions, snapshots: [], fx: [], base: 'USD', now, netValue: 200 });
    expect(x.totalNotional).toBe(400);
    expect(x.byInstrument.find((b) => b.key === 'AAA')?.notional).toBe(300);
    expect(x.byInstrument.find((b) => b.key === 'BBB')?.notional).toBe(100);
    expect(x.concentration).toBeCloseTo(0.75);
    expect(x.grossLeverage).toBeCloseTo(2);
    expect(x.byClass).toEqual([{ key: 'actions', notional: 400 }]);
    expect(x.byCurrency).toEqual([{ key: 'USD', notional: 400 }]);
  });

  it('futures sans pont : exposition 0 et mention', () => {
    const pocket: Pocket = { id: 'f', name: 'Fut', kind: 'futures', currency: 'USD', account: 'SIM', createdAt: now };
    const x = exposure({ pockets: [pocket], positions: [], snapshots: [], fx: [], base: 'USD', now, netValue: 1_000 });
    expect(x.totalNotional).toBe(0);
    expect(x.notes).toEqual([{ pocketId: 'f', text: 'pont hors ligne' }]);
    expect(x.grossLeverage).toBe(0);
    const live = exposure({
      pockets: [pocket],
      positions: [],
      snapshots: [{ account: 'SIM', cashValue: 1_000, unrealizedPnl: 0, positions: [{ instrument: 'NQ', quantity: 2, avgPrice: 100 }], at: now - 1_000 }],
      fx: [],
      base: 'USD',
      now,
      netValue: 1_000,
    });
    expect(live.notes).toEqual([]);
    expect(live.totalNotional).toBe(4_000);
    expect(live.byInstrument[0]?.key).toBe('NQ');
  });
});
