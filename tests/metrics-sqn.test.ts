import { describe, expect, it } from 'vitest';
import { computeTradeStats, mean, stddev } from '@/engine/metrics';
import type { Trade } from '@/engine/types';

function trade(pnl: number, i: number, extra: Partial<Trade> = {}): Trade {
  const entry = Date.UTC(2026, 0, 5, 14, 30) + i * 60_000;
  return {
    id: `t${i}`,
    sessionId: 's1',
    instrument: 'NQ',
    direction: 'long',
    qty: 1,
    entryTime: entry,
    exitTime: entry + 30_000,
    entryPrice: 20_000,
    exitPrice: 20_000,
    pnl,
    commission: 0,
    ...extra,
  };
}

describe('SQN plafonné et Kelly sans les nuls', () => {
  it('plafonne le SQN à √100 dès que l’échantillon dépasse 100', () => {
    const pnls = Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? 10 : -4));
    const stats = computeTradeStats(pnls.map((pnl, i) => trade(pnl, i)));
    const uncapped = (Math.sqrt(pnls.length) * mean(pnls)) / stddev(pnls);
    const capped = (Math.sqrt(100) * mean(pnls)) / stddev(pnls);
    expect(stats.sqn).toBeCloseTo(capped);
    expect(stats.sqn).not.toBeCloseTo(uncapped);
    expect(capped).toBeCloseTo(uncapped * Math.sqrt(100 / 120));
  });

  it('calcule le Kelly sans les trades de PnL nul', () => {
    const withFlat = computeTradeStats([trade(100, 0), trade(-50, 1), trade(0, 2)]);
    const decisive = computeTradeStats([trade(100, 0), trade(-50, 1)]);
    const payoff = 100 / 50;
    const old = 1 / 3 - (1 / 3) / payoff;
    expect(withFlat.kelly).toBeCloseTo(0.5 - 0.5 / payoff);
    expect(withFlat.kelly).toBeCloseTo(decisive.kelly);
    expect(withFlat.kelly).not.toBeCloseTo(old);
    expect(withFlat.breakeven).toBe(1);
  });
});