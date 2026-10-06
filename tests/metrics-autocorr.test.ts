import { describe, expect, it } from 'vitest';
import { autocorrelations, dailyResultSeries, pearson, sessionWinRateSeries } from '@/engine/inference';
import type { Session, Trade } from '@/engine/types';

function session(id: string, date: string, pnl: number): Session {
  return {
    id,
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

function trade(sessionId: string, pnl: number): Trade {
  return {
    id: sessionId,
    sessionId,
    instrument: 'NQ',
    direction: 'long',
    qty: 1,
    entryTime: 0,
    exitTime: 1,
    entryPrice: 1,
    exitPrice: 1,
    pnl,
    commission: 0,
  };
}

describe('autocorrélation', () => {
  it('mesure le décalage 1 et la bande ± 1,96 / √n', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8];
    const lag1 = autocorrelations(series, [1])[0]!;
    expect(lag1.rho).toBeCloseTo(pearson(series.slice(0, 7), series.slice(1)));
    expect(lag1.rho).toBeGreaterThan(0.9);
    expect(lag1.band).toBeCloseTo(1.96 / Math.sqrt(series.length));
    expect(lag1.outside).toBe(true);
    expect(autocorrelations([4, 4, 4, 4], [1])[0]?.rho).toBe(0);
    expect(autocorrelations([1, Number.NaN, 2, 3], [1])[0]?.band).toBeCloseTo(1.96 / Math.sqrt(3));
  });

  it('ignore une séance sans trade et suit l’ordre des dates', () => {
    const sessions = [session('b', '2026-01-06', -10), session('a', '2026-01-05', 10), session('c', '2026-01-07', 0)];
    const trades = [trade('a', 10), trade('a', -5), trade('b', -10)];
    expect(sessionWinRateSeries(sessions, trades)).toEqual([0.5, 0]);
    expect(dailyResultSeries(sessions)).toEqual([10, -10, 0]);
  });
});
