import { describe, expect, it } from 'vitest';
import { computeDailyStats, computeTradeStats, drawdownSeries } from '@/engine/metrics';
import { monteCarlo } from '@/engine/montecarlo';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';

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

function trade(pnl: number, i: number): Trade {
  const entry = Date.UTC(2026, 0, 5, 15, 0) + i * 3_600_000;
  return {
    id: `t${i}`,
    sessionId: '2026-01-05',
    instrument: 'NQ',
    direction: 'long',
    qty: 1,
    entryTime: entry,
    exitTime: entry + 600_000,
    entryPrice: 20_000,
    exitPrice: 20_000 + pnl / 20,
    pnl,
    commission: 4,
    risk: 100,
  };
}

/**
 * Règle 6 : ces sorties restent celles d'avant l'étape 2.
 * Le cas a moins de 100 trades et aucun PnL nul : SQN et Kelly n'y bougent pas non plus.
 */
describe('consommateurs inchangés (règle 6)', () => {
  it('fige monteCarlo, drawdownSeries, evaluatePlan, computeTradeStats et computeDailyStats', () => {
    const pnls = [120, -40, 80, -30, 50];
    const mc = monteCarlo(pnls, { runs: 200, horizon: 5, seed: 1, ruinDrawdown: 100, target: 200 });
    const dd = drawdownSeries(
      pnls.map((pnl, i) => ({ t: i * 1000, pnl })),
      1_000,
    );
    const plan = findPlan('apex-50');
    expect(plan).toBeTruthy();
    const sessions = [session('2026-01-05', 200), session('2026-01-06', -80), session('2026-01-07', 50)];
    const ev = evaluatePlan(plan!, sessions, [], 'A');
    const trades = [trade(200, 0), trade(-100, 1), trade(300, 2)];
    const stats = computeTradeStats(trades);
    const daily = computeDailyStats(sessions, 50_000);

    expect({
      mc: {
        horizon: mc?.horizon,
        targetProbability: mc?.targetProbability,
        ruinProbability: mc?.ruinProbability,
        finalMean: mc?.finalPnl.mean,
        ddMean: mc?.maxDrawdown.mean,
      },
      dd: {
        maxDrawdown: dd.maxDrawdown,
        maxDrawdownPct: dd.maxDrawdownPct,
        ulcerIndex: dd.ulcerIndex,
        maxDrawdownPeriods: dd.maxDrawdownPeriods,
        equity: dd.equity.map((p) => p.equity),
      },
      plan: { status: ev.status, balance: ev.balance, floor: ev.floor, highWater: ev.highWater, buffer: ev.buffer },
      trade: {
        count: stats.count,
        winRate: stats.winRate,
        netPnl: stats.netPnl,
        profitFactor: stats.profitFactor,
        profitFactorBeforeFees: stats.profitFactorBeforeFees,
        expectancy: stats.expectancy,
        sqn: stats.sqn,
        kelly: stats.kelly,
        rMultiples: stats.rMultiples,
      },
      daily: {
        days: daily.days,
        netPnl: daily.netPnl,
        sharpe: daily.sharpe,
        sortino: daily.sortino,
        calmar: daily.calmar,
        maxDrawdown: daily.maxDrawdown,
        ulcerIndex: daily.ulcerIndex,
        tradingDays: daily.tradingDays,
        rolling: daily.rolling.map((p) => ({ date: p.date, expectancy: p.expectancy, sharpe: p.sharpe })),
      },
    }).toMatchInlineSnapshot(`
      {
        "daily": {
          "calmar": 179.21399999999997,
          "days": 3,
          "maxDrawdown": 80,
          "netPnl": 170,
          "rolling": [
            {
              "date": "2026-01-05",
              "expectancy": 200,
              "sharpe": 0,
            },
            {
              "date": "2026-01-06",
              "expectancy": 60,
              "sharpe": 4.810702354423639,
            },
            {
              "date": "2026-01-07",
              "expectancy": 56.666666666666664,
              "sharpe": 6.419939228247982,
            },
          ],
          "sharpe": 6.419939228247983,
          "sortino": 19.47594670356232,
          "tradingDays": 3,
          "ulcerIndex": 0.0009826459885092127,
        },
        "dd": {
          "equity": [
            1120,
            1080,
            1160,
            1130,
            1180,
          ],
          "maxDrawdown": 40,
          "maxDrawdownPct": 0.03571428571428571,
          "maxDrawdownPeriods": 1,
          "ulcerIndex": 0.01971982157758433,
        },
        "mc": {
          "ddMean": 56,
          "finalMean": 172.15,
          "horizon": 5,
          "ruinProbability": 0.15,
          "targetProbability": 0.455,
        },
        "plan": {
          "balance": 50170,
          "buffer": 2470,
          "floor": 47700,
          "highWater": 50200,
          "status": "en-cours",
        },
        "trade": {
          "count": 3,
          "expectancy": 133.33333333333334,
          "kelly": 0.5333333333333333,
          "netPnl": 400,
          "profitFactor": 5,
          "profitFactorBeforeFees": 5.291666666666667,
          "rMultiples": [
            2,
            -1,
            3,
          ],
          "sqn": 1.1094003924504583,
          "winRate": 0.6666666666666666,
        },
      }
    `);
  });
});
