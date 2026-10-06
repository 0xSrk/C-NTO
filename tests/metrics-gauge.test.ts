import { describe, expect, it } from 'vitest';
import { groupIntoSessions } from '../src/engine/import/ninjatrader';
import { computeDailyStats } from '../src/engine/metrics';
import { evaluatePlan, findPlan, planMargin } from '../src/engine/propfirm';
import type { Trade } from '../src/engine/types';
import { drawdownGauge } from '../src/modules/metrique/drawdownLimit';
import { filterJournal } from '../src/modules/metrique/range';

/** 60 jours ouvrés depuis le 01/07/2026, compte A, un trade NQ par jour 10:00–11:00 ET (EDT). */
function businessDays(from: string, count: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < count; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const DAYS = businessDays('2026-07-01', 60);
const pnlOf = (i: number) => (i <= 14 ? 200 : i <= 29 ? -60 : i <= 58 ? -25 : -50);
const TRADES: Trade[] = DAYS.map((date, i) => {
  const pnl = pnlOf(i);
  const entryTime = Date.parse(`${date}T10:00:00-04:00`);
  return { id: `t${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, mae: i === 59 ? 1_100 : Math.max(0, -pnl) };
});
const SESSIONS = groupIntoSessions(TRADES, 18, 'csv');
const PLAN = { ...findPlan('apex-50')!, profitTarget: 1e9 };
const AS_OF = DAYS[59]!;

describe('1.6 jauge de repli branchée sur la marge réelle', () => {
  it('rejeu du plan sur tout l’historique : plus-haut 53 000, plancher 50 100, plus-bas 50 275, marge 175', () => {
    const margin = planMargin(evaluatePlan(PLAN, SESSIONS, TRADES, 'A'))!;
    expect(margin).toEqual({ date: AS_OF, highWater: 53_000, floor: 50_100, lastLow: 50_275, margin: 175 });
  });

  it('jauge sur 30J + compte A : la marge du plan, pas le repli de la période', () => {
    const shown = filterJournal(SESSIONS, TRADES, '30j', AS_OF, 'A');
    const daily = computeDailyStats(shown.sessions, PLAN.accountSize);
    // Avant : repli sur clôtures remis à zéro au début des 30 jours.
    expect(daily.maxDrawdown).toBe(575);
    const gauge = drawdownGauge({ plan: PLAN, account: 'A', history: { sessions: SESSIONS, trades: TRADES }, maxDrawdown: daily.maxDrawdown, startingBalance: PLAN.accountSize });
    expect(gauge).toMatchObject({ kind: 'plan', limit: 2_500, margin: 175, highWater: 53_000, floor: 50_100, lastLow: 50_275, date: AS_OF, status: 'en-cours' });
    expect(gauge.used).toBeCloseTo(0.93, 9);
  });

  it('sans plan suivi : le calcul de la période, signalé comme tel', () => {
    const gauge = drawdownGauge({ plan: null, account: 'A', history: { sessions: SESSIONS, trades: TRADES }, maxDrawdown: 575, startingBalance: 50_000 });
    expect(gauge).toEqual({ kind: 'clotures', limit: null, maxDrawdown: 575, used: 575 / 50_000 });
    expect(drawdownGauge({ plan: PLAN, account: null, history: { sessions: SESSIONS, trades: TRADES }, maxDrawdown: 575, startingBalance: 50_000 }).kind).toBe('clotures');
  });
});

describe('1.6 marge datée', () => {
  it('le rejeu s’arrête à l’objectif : la jauge dit à quelle date', () => {
    const easy = { ...PLAN, profitTarget: 2_000 };
    const gauge = drawdownGauge({ plan: easy, account: 'A', history: { sessions: SESSIONS, trades: TRADES }, maxDrawdown: 0, startingBalance: 50_000 });
    // +200 $ par jour : l'objectif de 2 000 $ tombe à la dixième séance.
    expect(gauge).toMatchObject({ kind: 'plan', status: 'objectif', date: DAYS[9] });
  });
});

