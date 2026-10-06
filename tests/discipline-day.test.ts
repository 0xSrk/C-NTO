import { describe, expect, it } from 'vitest';
import { dailyLimit, dayLoss, tradingDayNow } from '@/engine/discipline';
import { getInstrument, tradingDayOf } from '@/engine/instruments';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';

const ET = (iso: string) => Date.parse(`${iso}-04:00`);

function session(id: string, date: string, pnl: number, account = 'PA-1', tradeCount = 1): Session {
  return { id, date, account, instruments: ['NQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, entry: number, exit: number, pnl: number, mae?: number, account = 'PA-1'): Trade {
  return { id, sessionId, instrument: 'NQ', account, direction: 'long', qty: 1, entryTime: entry, exitTime: exit, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, ...(mae !== undefined ? { mae } : {}) };
}

describe('journée CME et perte du jour', () => {
  it('dimanche 18 h 30 à New York compte pour le lundi, comme la date de séance du journal', () => {
    const sunday = ET('2026-10-04T18:30');
    expect(tradingDayNow(sunday)).toBe('2026-10-05');
    expect(tradingDayNow(ET('2026-10-04T17:59'))).toBe('2026-10-04');
    expect(tradingDayNow(ET('2026-10-05T16:59'))).toBe('2026-10-05');
    expect(tradingDayNow(ET('2026-10-05T18:00'))).toBe('2026-10-06');
    // Même journée que l'import (`tradingDayOf` de l'instrument) pour un trade sorti dimanche soir.
    expect(tradingDayOf(ET('2026-10-04T18:45'), getInstrument('NQ'))).toBe(tradingDayNow(sunday));

    const sessions = [session('s-sun', '2026-10-05', -300), session('s-fri', '2026-10-02', -900)];
    const trades = [trade('t1', 's-sun', ET('2026-10-04T18:31'), ET('2026-10-04T18:45'), -300)];
    const monday = dayLoss({ sessions, trades, day: tradingDayNow(ET('2026-10-05T10:00')), account: 'PA-1' });
    expect(monday).toMatchObject({ day: '2026-10-05', realized: -300, loss: 300, trades: 1 });
  });

  it('un latent positif est ignoré, un latent négatif s’ajoute ; une journée positive ne perd rien', () => {
    const sessions = [session('s1', '2026-10-06', -200), session('s2', '2026-10-06', 50, 'Sim101')];
    expect(dayLoss({ sessions, trades: [], day: '2026-10-06', account: 'PA-1', unrealized: 300 })).toMatchObject({ realized: -200, unrealized: 0, loss: 200 });
    expect(dayLoss({ sessions, trades: [], day: '2026-10-06', account: 'PA-1', unrealized: -150 })).toMatchObject({ realized: -200, unrealized: -150, loss: 350 });
    // Tous les comptes : −200 + 50.
    expect(dayLoss({ sessions, trades: [], day: '2026-10-06' })).toMatchObject({ account: null, realized: -150, loss: 150 });
    expect(dayLoss({ sessions: [session('s3', '2026-10-06', 400)], trades: [], day: '2026-10-06', account: 'PA-1', unrealized: -100 }).loss).toBe(0);
    expect(dayLoss({ sessions, trades: [], day: '2026-10-07', account: 'PA-1' })).toMatchObject({ realized: 0, loss: 0, intradayLow: 0, trades: 0 });
  });

  it('le plus-bas intrajournalier est celui de evaluatePlan().timeline le même jour', () => {
    const plan = findPlan('apex-50')!;
    const sessions = [session('a', '2026-10-05', 400, 'PA-1', 2), session('b', '2026-10-06', -150, 'PA-1', 3), session('x', '2026-10-06', -999, 'Sim101', 1)];
    const trades = [
      trade('a1', 'a', ET('2026-10-05T09:31'), ET('2026-10-05T09:50'), 300, 120),
      trade('a2', 'a', ET('2026-10-05T10:05'), ET('2026-10-05T10:30'), 100, 80),
      // Deux positions ouvertes en même temps : leurs excursions s'additionnent (correction 1.7).
      trade('b1', 'b', ET('2026-10-06T09:31'), ET('2026-10-06T09:45'), -200, 260),
      trade('b2', 'b', ET('2026-10-06T09:40'), ET('2026-10-06T10:10'), 150, 180),
      trade('b3', 'b', ET('2026-10-06T10:20'), ET('2026-10-06T10:40'), -100, 140),
      trade('x1', 'x', ET('2026-10-06T09:35'), ET('2026-10-06T09:36'), -999, 999, 'Sim101'),
    ];
    const timeline = evaluatePlan(plan, sessions, trades, 'PA-1').timeline;
    const replay = timeline.find((p) => p.date === '2026-10-06')!;
    const day = dayLoss({ sessions, trades, day: '2026-10-06', account: 'PA-1' });
    expect(replay.intradayLow).toBeLessThan(-300);
    expect(day.intradayLow).toBe(replay.intradayLow);
    expect(day.realized).toBe(replay.dayPnl);
    expect(dayLoss({ sessions, trades, day: '2026-10-05', account: 'PA-1' }).intradayLow).toBe(timeline.find((p) => p.date === '2026-10-05')!.intradayLow);
  });

  it('la limite retenue est la plus basse de la règle et du plan, avec sa source', () => {
    const tpt = findPlan('tpt-50')!;
    expect(tpt.dailyLossLimit).toBe(1_100);
    expect(dailyLimit({ maxDailyLoss: 500 }, tpt)).toEqual({ amount: 500, source: 'trader', trader: 500, plan: 1_100 });
    expect(dailyLimit({ maxDailyLoss: 1_500 }, tpt)).toEqual({ amount: 1_100, source: 'plan', trader: 1_500, plan: 1_100 });
    expect(dailyLimit({ maxDailyLoss: 0 }, tpt)).toEqual({ amount: 1_100, source: 'plan', trader: null, plan: 1_100 });
    expect(dailyLimit({ maxDailyLoss: 500 }, findPlan('apex-50'))).toEqual({ amount: 500, source: 'trader', trader: 500, plan: null });
    expect(dailyLimit({ maxDailyLoss: 0 }, findPlan('apex-50'))).toBeNull();
    expect(dailyLimit({ maxDailyLoss: 0 }, null)).toBeNull();
  });
});
