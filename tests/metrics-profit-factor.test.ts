import { describe, expect, it } from 'vitest';
import { computeTradeStats, summarizeTrades } from '../src/engine/metrics';
import type { Trade } from '../src/engine/types';

/** 100 trades MNQ : 55 à +10 $ et 45 à −10 $ avant frais, 1,48 $ de commission chacun. */
const TRADES: Trade[] = Array.from({ length: 100 }, (_, i) => {
  const gross = i < 55 ? 10 : -10;
  return { id: `t${i}`, sessionId: 's', instrument: 'MNQ', direction: 'long', qty: 1, entryTime: i * 60_000, exitTime: i * 60_000 + 30_000, entryPrice: 20_000, exitPrice: 20_000 + gross / 2, pnl: gross - 1.48, commission: 1.48 };
});

describe('1.3 profit factor avant et après commissions', () => {
  const stats = computeTradeStats(TRADES);

  it('après commissions 0,907, avant commissions 1,222', () => {
    expect(stats.profitFactor).toBeCloseTo(0.907, 3);
    expect(stats.profitFactorBeforeFees).toBeCloseTo(1.222, 3);
  });

  it('une définition par notion : brut après frais (trades) et brut avant frais (séance)', () => {
    expect(stats.grossProfit).toBeCloseTo(55 * 8.52, 9);
    expect(stats.grossLoss).toBeCloseTo(-45 * 11.48, 9);
    expect(stats.grossProfitBeforeFees).toBeCloseTo(550, 9);
    expect(stats.grossLossBeforeFees).toBeCloseTo(-450, 9);
    const session = summarizeTrades(TRADES);
    expect(session.grossProfit).toBeCloseTo(stats.grossProfitBeforeFees, 9);
    expect(session.grossLoss).toBeCloseTo(stats.grossLossBeforeFees, 9);
  });
});
