import { describe, expect, it } from 'vitest';
import { buildEquityPoints, consolidateEquity, portfolioDay, riskFromEquity } from '@/engine/portfolio';
import type { CashBalance, FxRate, Pocket, Position } from '@/engine/portfolio';
import type { Session } from '@/engine/types';
import { loadVector } from './helpers/loadVector';

interface Vector {
  base: string;
  rate: number;
  accountSize: number;
  dates: string[];
  propPnl: number[];
  consolidated: number[];
  maxDrawdown: number;
  currentDrawdown: number;
}

const openAt = Date.parse('2026-01-05T15:00:00.000Z');
const markAt = Date.parse('2026-01-16T15:00:00.000Z');

function session(date: string, pnl: number): Session {
  return {
    id: `s-${date}`,
    date,
    account: 'APEX-1',
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

describe('courbe consolidée', () => {
  const vector = loadVector<Vector>('portfolio-consolidated.json');

  function fixture() {
    const prop: Pocket = { id: 'p-prop', name: 'Apex', kind: 'propfirm', currency: 'USD', account: 'APEX-1', planId: 'apex-50', createdAt: 0 };
    const actions: Pocket = { id: 'p-act', name: 'Actions', kind: 'actions', currency: 'EUR', createdAt: 0 };
    const position: Position = {
      id: 'pos',
      pocketId: 'p-act',
      symbol: 'AIR',
      quantity: 10,
      avgPrice: 100,
      lastPrice: 110,
      lastPriceAt: markAt,
      multiplier: 1,
      currency: 'EUR',
      openedAt: openAt,
    };
    const cash: CashBalance = { id: 'c', pocketId: 'p-act', currency: 'EUR', amount: 1_000, at: openAt };
    const fx: FxRate = { pair: 'EURUSD', rate: vector.rate, at: 0, by: 'utilisateur' };
    const sessions = vector.dates.map((date, i) => session(date, vector.propPnl[i] ?? 0));
    return { pockets: [prop, actions], ctx: { sessions, positions: [position], cash: [cash], fx: [fx] }, fx };
  }

  it('vingt journées, calculées à la main, et buildEquityPoints est idempotent', () => {
    expect(vector.dates).toHaveLength(20);
    expect(portfolioDay(openAt)).toBe(vector.dates[0]);
    expect(portfolioDay(markAt)).toBe(vector.dates[9]);
    const { pockets, ctx, fx } = fixture();
    const once = buildEquityPoints(pockets, ctx);
    const twice = buildEquityPoints([...pockets].reverse(), ctx);
    expect(twice).toEqual(once);

    const act = once.filter((p) => p.pocketId === 'p-act');
    expect(act.map((p) => p.date)).toEqual([vector.dates[0], vector.dates[9]]);
    expect(act.map((p) => p.equity)).toEqual([2_000, 2_100]);
    expect(act.map((p) => p.pnl)).toEqual([0, 100]);

    const curve = consolidateEquity(pockets, once, [fx], vector.base);
    expect(curve.excluded).toEqual([]);
    expect(curve.series.map((p) => p.equity)).toEqual(vector.consolidated);
    const risk = riskFromEquity(curve.series);
    expect(risk.maxDrawdown).toBe(vector.maxDrawdown);
    expect(risk.currentDrawdown).toBe(vector.currentDrawdown);
  });

  it('sans le taux, la poche actions sort de la courbe', () => {
    const { pockets, ctx } = fixture();
    const points = buildEquityPoints(pockets, ctx);
    const curve = consolidateEquity(pockets, points, [], 'USD');
    expect(curve.excluded).toEqual([{ pocketId: 'p-act', reason: 'taux EUR/USD manquant' }]);
    const propOnly = curve.series.map((p) => p.equity);
    expect(propOnly[0]).toBe(50_200);
    expect(propOnly[propOnly.length - 1]).toBe(50_150);
    expect(propOnly).not.toEqual(vector.consolidated);
  });
});
