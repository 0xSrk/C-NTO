import { describe, expect, it } from 'vitest';
import { evaluatePlan, type PropPlan } from '../src/engine/propfirm';
import type { Session, Trade } from '../src/engine/types';

const PLAN: PropPlan = { id: 'test', firm: 'Test', label: 'Test', accountSize: 50_000, profitTarget: 1e9, maxDrawdown: 2_500, drawdownType: 'intraday-trailing', phase: 'evaluation', version: 1, source: 'user' };
const SESSION: Session = { id: 's', date: '2026-09-15', account: 'A', instruments: ['NQ'], source: 'csv', tradeCount: 2, pnl: 200, grossProfit: 200, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
const at = (hhmm: string) => Date.parse(`2026-09-15T${hhmm}:00-04:00`);

function trade(id: string, from: string, to: string, mae: number, pnl: number): Trade {
  return { id, sessionId: 's', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime: at(from), exitTime: at(to), entryPrice: 20_000, exitPrice: 20_000, pnl, commission: 0, mae };
}

const low = (trades: Trade[]) => evaluatePlan(PLAN, [{ ...SESSION, pnl: trades.reduce((acc, t) => acc + t.pnl, 0), tradeCount: trades.length }], trades, 'A').timeline[0]!.intradayLow;

describe('1.7 positions ouvertes en même temps', () => {
  it('deux trades qui se chevauchent : leurs excursions défavorables s’additionnent, −1 200 $', () => {
    expect(low([trade('a', '10:00', '11:00', 600, 100), trade('b', '10:15', '10:45', 600, 100)])).toBe(-1_200);
  });

  it('sans chevauchement, le calcul d’avant : cumul des trades sortis moins l’excursion', () => {
    // 10:00–10:30 MAE 300, +100 ; 11:00–11:30 MAE 200, −50 : plus-bas −300, puis 100 − 200 = −100.
    expect(low([trade('a', '10:00', '10:30', 300, 100), trade('b', '11:00', '11:30', 200, -50)])).toBe(-300);
    expect(low([trade('a', '10:00', '10:30', 50, 100), trade('b', '10:30', '11:00', 250, -50)])).toBe(-150);
  });

  it('un chevauchement fait échouer un compte que les trades isolés auraient épargné', () => {
    const tight = { ...PLAN, maxDrawdown: 1_000 };
    const trades = [trade('a', '10:00', '11:00', 600, 100), trade('b', '10:15', '10:45', 600, 100)];
    expect(evaluatePlan(tight, [{ ...SESSION }], trades, 'A').status).toBe('echec');
  });
});
