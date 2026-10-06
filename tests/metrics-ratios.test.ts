import { describe, expect, it } from 'vitest';
import { ratioIntervals } from '@/engine/inference';
import { calendarSeries, computeDailyStats, aggregateByDate } from '@/engine/metrics';
import type { Session } from '@/engine/types';

function session(date: string, pnl: number): Session {
  return {
    id: date,
    date,
    instruments: ['NQ'],
    source: 'csv',
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

describe('intervalles des ratios', () => {
  const sessions = [session('2026-01-05', 200), session('2026-01-06', -80), session('2026-01-07', 150), session('2026-01-08', -40), session('2026-01-09', 90)];

  it('reprend la valeur de computeDailyStats et reste reproductible', () => {
    const daily = computeDailyStats(sessions, 50_000, 20, { from: '2026-01-05', to: '2026-01-09' });
    const once = ratioIntervals(sessions, 50_000, { from: '2026-01-05', to: '2026-01-09', draws: 80, seed: 3 });
    const twice = ratioIntervals(sessions, 50_000, { from: '2026-01-05', to: '2026-01-09', draws: 80, seed: 3 });
    expect(once).toEqual(twice);
    expect(once.sharpe.value).toBeCloseTo(daily.sharpe);
    expect(once.sortino.value).toBeCloseTo(daily.sortino);
    expect(once.calmar.value).toBeCloseTo(daily.calmar);
    expect(once.sharpe.low).toBeLessThanOrEqual(once.sharpe.high);
    expect(calendarSeries(aggregateByDate(sessions), { from: '2026-01-05', to: '2026-01-09' }).length).toBe(daily.tradingDays);
  });
});
