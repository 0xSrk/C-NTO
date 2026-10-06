import { describe, expect, it } from 'vitest';
import { allocatedRiskStats } from '@/engine/inference';
import { computeDailyStats } from '@/engine/metrics';
import type { Session } from '@/engine/types';

function session(date: string, pnl: number): Session {
  return {
    id: date,
    date,
    account: 'A',
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

describe('ratios rapportés à la perte maximale', () => {
  const sessions = [session('2026-01-05', 200), session('2026-01-06', -80), session('2026-01-07', 50)];

  it('divise le repli par la perte autorisée et laisse le calcul nominal intact', () => {
    const maxLoss = 2_500;
    const allocated = allocatedRiskStats(sessions, maxLoss)!;
    expect(allocated.maxDrawdown).toBe(80);
    expect(allocated.maxDrawdownPct).toBeCloseTo(80 / maxLoss);
    expect(allocated.tradingDays).toBe(3);
    expect(allocated.calmar).toBeCloseTo((170 / 80) * (252 / 3));
    expect(allocated.ulcerIndex).toBeCloseTo(Math.sqrt((0 + (80 / maxLoss) ** 2 + (30 / maxLoss) ** 2) / 3));
    const nominal = computeDailyStats(sessions, 50_000);
    expect(nominal.calmar).not.toBeCloseTo(allocated.calmar);
    expect(allocatedRiskStats(sessions, 0)).toBeNull();
  });
});
