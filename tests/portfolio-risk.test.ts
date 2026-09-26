import { describe, expect, it } from 'vitest';
import { propDistance, projectionRuin } from '@/engine/portfolio';
import type { PropPlan } from '@/engine/propfirm';
import type { Session } from '@/engine/types';

function plan(dailyLossLimit?: number): PropPlan {
  return {
    id: 't',
    firm: 'T',
    label: 'Test',
    accountSize: 10_000,
    profitTarget: 1_000,
    maxDrawdown: 1_000,
    drawdownType: 'static',
    dailyLossLimit,
    minTradingDays: 1,
    phase: 'evaluation',
    version: 1,
    source: 'bundled',
  };
}

function session(pnl: number): Session {
  return {
    id: 's',
    date: '2026-01-05',
    account: 'A',
    instruments: [],
    source: 'manuel',
    tradeCount: 1,
    pnl,
    grossProfit: Math.max(0, pnl),
    grossLoss: Math.min(0, pnl),
    commission: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('propDistance', () => {
  it('alerte à 25 % du drawdown maximal, pas au-dessus', () => {
    const near = propDistance(plan(400), [session(-800)], [], 'A');
    expect(near.toDrawdown).toBe(200);
    expect(near.toTarget).toBe(1_800);
    expect(near.toDailyLoss).toBe(-400);
    expect(near.alert).toBe(true);

    const far = propDistance(plan(400), [session(-700)], [], 'A');
    expect(far.toDrawdown).toBe(300);
    expect(far.alert).toBe(false);

    const noDaily = propDistance(plan(), [session(-800)], [], 'A');
    expect(noDaily.toDailyLoss).toBeNull();
  });

  it('ruine prop = somme des drawdowns restants, sinon le max historique', () => {
    expect(projectionRuin([200, 50], 900)).toEqual({ ruinDrawdown: 250, source: 'prop' });
    expect(projectionRuin([], 900)).toEqual({ ruinDrawdown: 900, source: 'historique' });
  });
});
