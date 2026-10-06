import { describe, expect, it } from 'vitest';
import { dailyLimit, dayLoss, DEFAULT_TRADER_RULES, tradingDayNow } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { liveSession } from '@/modules/metrique/liveSession';

const now = zonedToUtc('2026-10-06', '10:00', ET_ZONE);
const day = tradingDayNow(now);
const session: Session = {
  id: 's1',
  date: day,
  account: 'Sim101',
  instruments: ['MNQ'],
  source: 'ninjatrader',
  tradeCount: 3,
  pnl: -120,
  grossProfit: 40,
  grossLoss: -160,
  commission: 0,
  tags: [],
  createdAt: now,
  updatedAt: now,
};
const trade: Trade = {
  id: 't1',
  sessionId: 's1',
  instrument: 'MNQ',
  account: 'Sim101',
  direction: 'long',
  qty: 1,
  entryTime: now - 60_000,
  exitTime: now - 30_000,
  entryPrice: 20_000,
  exitPrice: 19_990,
  pnl: -120,
  commission: 0,
};
const rules = { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500, maxTradesPerDay: 8 };
const account = {
  name: 'Sim101',
  cashValue: 50_000,
  realizedPnl: -80,
  unrealizedPnl: -40,
  positions: [{ instrument: 'MNQ 12-26', quantity: 2, avgPrice: 21_000 }],
};

describe('A13.1 séance en cours', () => {
  const base = {
    link: 'live',
    now,
    accounts: [account],
    account: 'Sim101',
    sessions: [session],
    trades: [trade],
    rules,
    plan: { dailyLossLimit: 400 },
  };

  it('dit la fraîcheur des comptes : 10 s frais, 10 min périmés, rien hors pont live', () => {
    const fresh = liveSession({ ...base, accountsAt: now - 10_000 });
    const stale = liveSession({ ...base, accountsAt: now - 10 * 60_000 });
    expect(fresh?.fresh).toBe(true);
    expect(fresh?.ageMs).toBe(10_000);
    expect(stale?.fresh).toBe(false);
    expect(stale?.ageMs).toBe(600_000);
    expect(liveSession({ ...base, link: 'lost', accountsAt: now - 10_000 })).toBeNull();
    const loss = dayLoss({ sessions: [session], trades: [trade], day, account: 'Sim101', unrealized: -40 });
    expect(fresh?.loss).toBe(loss.loss);
    expect(fresh?.trades).toBe(loss.trades);
    expect(fresh?.limit).toEqual({ amount: dailyLimit(rules, { dailyLossLimit: 400 })!.amount, source: 'plan' });
    expect(fresh?.maxTrades).toBe(8);
    expect(fresh?.realized).toBe(-80);
    expect(fresh?.unrealized).toBe(-40);
    expect(fresh?.balance).toBe(50_000);
    expect(fresh?.positions).toEqual([{ account: 'Sim101', instrument: 'MNQ 12-26', quantity: 2 }]);
  });
});
