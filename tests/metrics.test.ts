import { describe, expect, it } from 'vitest';
import { computeDailyStats, computeTradeStats, drawdownSeries, histogram, streakZScore } from '@/engine/metrics';
import type { Session, Trade } from '@/engine/types';

function trade(pnl: number, i: number, extra: Partial<Trade> = {}): Trade {
  const entry = Date.UTC(2026, 0, 5, 14, 30) + i * 3_600_000;
  return {
    id: `t${i}`,
    sessionId: 's1',
    instrument: 'NQ',
    direction: i % 2 ? 'short' : 'long',
    qty: 1,
    entryTime: entry,
    exitTime: entry + 600_000,
    entryPrice: 20_000,
    exitPrice: 20_000 + pnl / 20,
    pnl,
    commission: 4,
    ...extra,
  };
}

describe('computeTradeStats', () => {
  it('calcule les ratios de base', () => {
    const trades = [100, -50, 200, -50, 150, -100].map((p, i) => trade(p, i));
    const s = computeTradeStats(trades);
    expect(s.count).toBe(6);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(3);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.grossProfit).toBe(450);
    expect(s.grossLoss).toBe(-200);
    expect(s.netPnl).toBe(250);
    expect(s.profitFactor).toBeCloseTo(2.25);
    expect(s.expectancy).toBeCloseTo(250 / 6);
    expect(s.avgWin).toBeCloseTo(150);
    expect(s.avgLoss).toBeCloseTo(-200 / 3);
    expect(s.payoffRatio).toBeCloseTo(2.25);
    expect(s.largestWin).toBe(200);
    expect(s.largestLoss).toBe(-100);
    expect(s.maxDrawdown).toBe(100);
    expect(s.maxConsecWins).toBe(1);
    expect(s.maxConsecLosses).toBe(1);
    expect(s.long.count).toBe(3);
    expect(s.short.count).toBe(3);
    expect(s.commission).toBe(24);
  });

  it('gère un journal vide', () => {
    const s = computeTradeStats([]);
    expect(s.count).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(s.equity).toEqual([]);
  });

  it('mesure les séries et la dépendance (z-score)', () => {
    const alternating = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1));
    const clustered = [...Array(20).fill(1), ...Array(20).fill(-1)];
    expect(streakZScore(alternating)).toBeGreaterThan(1.96);
    expect(streakZScore(clustered)).toBeLessThan(-1.96);
    const s = computeTradeStats([100, 100, 100, -50, -50, 100].map((p, i) => trade(p, i)));
    expect(s.maxConsecWins).toBe(3);
    expect(s.maxConsecLosses).toBe(2);
    expect(s.currentStreak).toBe(1);
  });

  it('calcule MAE/MFE, R-multiples et Kelly', () => {
    const trades = [
      trade(200, 0, { mae: 50, mfe: 260, risk: 100 }),
      trade(-100, 1, { mae: 120, mfe: 20, risk: 100 }),
      trade(300, 2, { mae: 30, mfe: 320, risk: 100 }),
    ];
    const s = computeTradeStats(trades);
    expect(s.avgMae).toBeCloseTo((50 + 120 + 30) / 3);
    expect(s.avgMfe).toBeCloseTo(200);
    expect(s.edgeRatio).toBeCloseTo(200 / ((50 + 120 + 30) / 3));
    expect(s.rMultiples).toEqual([2, -1, 3]);
    expect(s.expectancyR).toBeCloseTo(4 / 3);
    const w = 2 / 3;
    const payoff = 250 / 100;
    expect(s.kelly).toBeCloseTo(w - (1 - w) / payoff);
  });
});

describe('drawdownSeries', () => {
  it('suit le pic et la durée du drawdown', () => {
    const pts = [100, 100, -150, -100, 50, 300].map((pnl, i) => ({ t: i * 1000, pnl }));
    const dd = drawdownSeries(pts, 1000);
    expect(dd.maxDrawdown).toBe(250);
    expect(dd.maxDrawdownPct).toBeCloseTo(250 / 1200);
    expect(dd.maxDrawdownPeriods).toBe(3);
    // durée mesurée du pic (t=1000) jusqu'à la récupération (t=5000)
    expect(dd.maxDrawdownDurationMs).toBe(4000);
    expect(dd.currentDrawdown).toBe(0);
    expect(drawdownSeries([0, 0, 0].map((pnl, i) => ({ t: i, pnl })), 100).maxDrawdownPeriods).toBe(0);
    expect(dd.equity[dd.equity.length - 1].equity).toBe(1300);
  });
});

describe('computeDailyStats', () => {
  const session = (date: string, pnl: number): Session => ({
    id: date,
    date,
    instruments: ['NQ'],
    source: 'manuel',
    tradeCount: 3,
    pnl,
    grossProfit: Math.max(0, pnl),
    grossLoss: Math.min(0, pnl),
    commission: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  });

  it('calcule Sharpe, consistance et jours', () => {
    const sessions = [
      session('2026-01-05', 500),
      session('2026-01-06', -200),
      session('2026-01-07', 300),
      session('2026-01-08', 1500),
      session('2026-01-09', -400),
    ];
    const d = computeDailyStats(sessions, 50_000);
    expect(d.days).toBe(5);
    expect(d.winDays).toBe(3);
    expect(d.netPnl).toBe(1700);
    expect(d.bestDay).toBe(1500);
    expect(d.consistency).toBeCloseTo(1500 / 1700);
    expect(d.sharpe).toBeGreaterThan(0);
    expect(d.sortino).toBeGreaterThan(d.sharpe);
    expect(d.maxDrawdown).toBe(400);
    expect(d.rolling.length).toBe(5);
    expect(d.rolling[4].pnl).toBe(1700);
  });

  it('agrège plusieurs comptes le même jour en une seule journée', () => {
    const d = computeDailyStats([{ ...session('2026-01-05', 500), account: 'A' }, { ...session('2026-01-05', -100), id: 'b', account: 'B' }, session('2026-01-06', 200)], 50_000);
    expect(d.days).toBe(2);
    expect(d.netPnl).toBe(600);
    expect(d.bestDay).toBe(400);
  });
});

describe('robustesse numérique', () => {
  it('ignore les valeurs non finies dans les histogrammes et les stats', () => {
    const h = histogram([1, NaN, 2, Infinity], 4);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(2);
    const s = computeTradeStats([trade(100, 0), trade(NaN, 1), trade(-50, 2)]);
    expect(s.count).toBe(2);
    expect(s.netPnl).toBe(50);
    expect(Number.isFinite(s.stdPnl)).toBe(true);
  });

  it('supporte 200 000 valeurs sans dépassement de pile', () => {
    const values = Array.from({ length: 200_000 }, (_, i) => (i % 7) - 3);
    expect(histogram(values, 10).length).toBe(10);
  });
});

describe('histogram', () => {
  it('répartit les valeurs', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.length).toBe(5);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(10);
    expect(h[4].count).toBe(2);
  });
});
