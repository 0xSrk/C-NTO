import { describe, expect, it } from 'vitest';
import { bilan, bilanBounds, bilanToCsv, bilanToJson, buildEquityPoints } from '@/engine/portfolio';
import type { FxRate, Pocket } from '@/engine/portfolio';
import type { Session } from '@/engine/types';
import { parseCsv } from '@/lib/csv';

const usd: Pocket = { id: 'usd', name: 'US', kind: 'propfirm', currency: 'USD', account: 'A', planId: 'apex-50', createdAt: 0 };
const eur: Pocket = { id: 'eur', name: 'EU', kind: 'actions', currency: 'EUR', createdAt: 0 };
const fx: FxRate = { pair: 'EURUSD', rate: 1.25, at: 0, by: 'utilisateur' };

function session(date: string, pnl: number, commission: number): Session {
  return {
    id: `s-${date}`,
    date,
    account: 'A',
    instruments: [],
    source: 'manuel',
    tradeCount: 1,
    pnl,
    grossProfit: Math.max(0, pnl),
    grossLoss: Math.min(0, pnl),
    commission,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('bilan', () => {
  it('les contributions somment au total, la variation de valeur nette aussi', () => {
    const sessions = [session('2026-01-05', 100, 2), session('2026-01-06', -40, 1)];
    const points = buildEquityPoints([usd, eur], {
      sessions,
      positions: [{ id: 'p', pocketId: 'eur', symbol: 'AIR', quantity: 8, avgPrice: 10, lastPrice: 20, lastPriceAt: Date.parse('2026-01-06T15:00:00.000Z'), multiplier: 1, currency: 'EUR', openedAt: Date.parse('2026-01-05T15:00:00.000Z') }],
      cash: [],
      fx: [fx],
    });
    const row = bilan({ from: '2026-01-05', to: '2026-01-06' }, { pockets: [usd, eur], points, sessions, fx: [fx], base: 'USD' });
    const sum = row.byPocket.reduce((a, p) => a + p.pnlBase, 0);
    expect(sum).toBeCloseTo(row.totalPnl);
    expect(row.byPocket.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1);
    expect(row.netEnd - row.netStart).toBeCloseTo(row.totalPnl);
    expect(row.commissions).toBe(3);
    expect(row.byPocket.find((p) => p.pocketId === 'usd')?.pnlBase).toBe(60);
    expect(row.byPocket.find((p) => p.pocketId === 'eur')?.pnlBase).toBe(100);
  });

  it('export CSV bien formé et JSON rond', () => {
    const sessions = [session('2026-01-05', 40, 2)];
    const points = buildEquityPoints([usd], { sessions, positions: [], cash: [], fx: [], });
    const row = bilan({ from: '2026-01-05', to: '2026-01-05' }, { pockets: [usd], points, sessions, fx: [], base: 'USD' });
    const parsed = parseCsv(bilanToCsv(row));
    expect(parsed.headers).toEqual(['poche', 'pnl', 'commission', 'devise']);
    const body = parsed.rows.filter((r) => r[0] !== 'total');
    const total = parsed.rows.find((r) => r[0] === 'total');
    const pnl = body.reduce((a, r) => a + Number(r[1]), 0);
    expect(pnl).toBeCloseTo(Number(total?.[1]));
    expect(JSON.parse(bilanToJson(row)).totalPnl).toBe(row.totalPnl);
  });

  it('30 j couvre trente journées civiles', () => {
    const asOf = Date.parse('2026-01-30T15:00:00.000Z');
    const bounds = bilanBounds('30j', asOf);
    expect(bounds.to).toBe('2026-01-30');
    expect(bounds.from).toBe('2026-01-01');
    const week = bilanBounds('7j', asOf);
    expect(week.from).toBe('2026-01-24');
  });
});
