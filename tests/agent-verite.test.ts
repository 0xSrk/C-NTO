import { afterEach, describe, expect, it } from 'vitest';
import { toolBlurb, toolSchemas } from '@/engine/agent/tools';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import { computeTradeStats, sessionDates } from '@/engine/metrics';
import { evaluatePlan, findPlan, planMargin, setUserPlans, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { drawdownGauge } from '@/modules/metrique/drawdownLimit';
import { callTool } from './helpers/agentEval';
import { fakePorts } from './helpers/deskPorts';
import { DEMO_ACCOUNT, DEMO_PLAN, demoDesk } from './helpers/demoDesk';

const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const AT = Date.parse('2026-09-30T20:00:00Z');
const session = (id: string, date: string, account: string, pnl: number, over: Partial<Session> = {}): Session => ({
  id,
  date,
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 1,
  pnl,
  grossProfit: Math.max(0, pnl),
  grossLoss: Math.min(0, pnl),
  commission: 0,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const trade = (id: string, sessionId: string, entry: number, exit: number, pnl: number, over: Partial<Trade> = {}): Trade => ({
  id,
  sessionId,
  instrument: 'NQ',
  account: 'Sim101',
  direction: 'long',
  qty: 1,
  entryTime: entry,
  exitTime: exit,
  entryPrice: 20_000,
  exitPrice: 20_000 + pnl / 20,
  pnl,
  commission: 0,
  ...over,
});

type Bucket = { key: string; trades: number; pnl: number };

describe('A6.1 journal_breakdown : le jour est la journée CME de la séance, comme l’onglet Analyse', () => {
  // Séance du vendredi 18/09 (import avec une frontière à 19 h) : sa sortie, 18 h 20 ET, tombe
  // après la frontière CME de 18 h, donc sur la journée du samedi si l'on ne lit que l'heure.
  const sessions = [session('s_ven', '2026-09-18', 'Sim101', 300), session('s_mer', '2026-09-16', 'Sim101', -100)];
  const trades = [
    trade('t_ven', 's_ven', zonedToUtc('2026-09-18', '16:40', ET_ZONE), zonedToUtc('2026-09-18', '18:20', ET_ZONE), 300),
    trade('t_mer', 's_mer', zonedToUtc('2026-09-16', '10:00', ET_ZONE), zonedToUtc('2026-09-16', '10:30', ET_ZONE), -100),
  ];

  it('une séance du vendredi dont la sortie tombe un autre jour est comptée le vendredi', async () => {
    const out = await callTool<{ byWeekday: Bucket[]; byHour: Bucket[]; dayBasis: string; timezone: string }>(fakePorts({ sessions: () => sessions, trades: () => trades }), 'journal_breakdown');
    const screen = computeTradeStats(trades, sessionDates(sessions));
    expect(out.byWeekday.map((b) => b.key)).toEqual(screen.byWeekday.filter((b) => b.count > 0).map((b) => b.key));
    expect(out.byWeekday).toEqual([
      { key: 'mer', trades: 1, pnl: -100, winRate: 0 },
      { key: 'ven', trades: 1, pnl: 300, winRate: 1 },
    ]);
    expect(out.dayBasis).toBe('cme_session');
    // L'heure reste l'heure d'entrée à New York.
    expect(out.timezone).toBe('America/New_York');
    expect(out.byHour.map((b) => b.key)).toEqual(['10', '16']);
  });

  it('les trois descriptions disent la journée CME de la séance, plus « heure de New York » pour le jour', () => {
    const fr = toolSchemas().find((t) => t.name === 'journal_breakdown')!.description;
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const text = toolBlurb('journal_breakdown', fr);
      expect(text, locale).toMatch(/CME/);
      expect(text, locale).not.toMatch(/jour de semaine \(heure de New York\)|weekday \(New York time\)|día de la semana \(hora de Nueva York\)/);
    }
    useI18n.setState({ locale: 'fr' });
  });
});

/** Cas 1.6 de AUDIT : 60 jours ouvrés depuis le 01/07/2026, compte A, un trade NQ par jour, MAE de 1 100 $ le dernier. */
function case16(): { sessions: Session[]; trades: Trade[]; days: string[] } {
  const days: string[] = [];
  for (let t = Date.parse('2026-07-01T12:00:00Z'); days.length < 60; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) days.push(new Date(t).toISOString().slice(0, 10));
  }
  const pnlOf = (i: number) => (i <= 14 ? 200 : i <= 29 ? -60 : i <= 58 ? -25 : -50);
  const trades = days.map((date, i) => {
    const pnl = pnlOf(i);
    const entry = Date.parse(`${date}T10:00:00-04:00`);
    return trade(`t${i}`, '', entry, entry + 3_600_000, pnl, { account: 'A', mae: i === 59 ? 1_100 : Math.max(0, -pnl) });
  });
  return { sessions: groupIntoSessions(trades, 18, 'csv'), trades, days };
}

type Margin = { date: string; lastLow: number; floor: number; margin: number };
type PlanOut = { status: string; buffer: number; margin: Margin | null; passedOn: string | null };

describe('A6.2 marge datée du plan : celle de la jauge K.04, à côté de buffer', () => {
  afterEach(() => setUserPlans([]));

  it('cas 1.6 : desk_overview et propfirm_status rendent la marge de 175 $ de l’écran, buffer inchangé', async () => {
    const { sessions, trades, days } = case16();
    const plan: PropPlan = { ...findPlan('apex-50')!, id: 'cas-16', source: 'user', profitTarget: 1e9 };
    setUserPlans([plan]);
    const ports = fakePorts({ sessions: () => sessions, trades: () => trades, planId: () => plan.id, planAccount: () => 'A' });
    const ev = evaluatePlan(plan, sessions, trades, 'A');
    const screen = planMargin(ev)!;
    const gauge = drawdownGauge({ plan, account: 'A', history: { sessions, trades }, maxDrawdown: 0, startingBalance: plan.accountSize });
    const expected = { date: screen.date, lastLow: r2(screen.lastLow), floor: r2(screen.floor), margin: r2(screen.margin) };
    expect(gauge).toMatchObject({ kind: 'plan', margin: screen.margin, date: days[59] });

    const overview = await callTool<{ plan: PlanOut }>(ports, 'desk_overview');
    const status = await callTool<PlanOut>(ports, 'propfirm_status');
    for (const out of [overview.plan, status]) {
      expect(out.margin).toEqual(expected);
      expect(out.margin?.margin).toBe(175);
      // `buffer` (clôture − plancher) ne bouge pas : la garde A5 et l'événement prop_buffer le lisent.
      expect(out.buffer).toBe(r2(ev.buffer));
      expect(out.buffer).not.toBe(out.margin?.margin);
      expect(out.passedOn).toBeNull();
    }
  });

  it('démo : l’objectif atteint arrête le rejeu, la marge est datée de ce jour-là', async () => {
    const desk = demoDesk();
    const ev = evaluatePlan(findPlan(DEMO_PLAN)!, desk.sessions, desk.trades, DEMO_ACCOUNT);
    const status = await callTool<PlanOut>(desk.ports, 'propfirm_status');
    expect(ev.passedOn).toBeDefined();
    expect(status.passedOn).toBe(ev.passedOn);
    expect(status.margin?.date).toBe(planMargin(ev)!.date);
    expect(status.margin?.margin).toBe(r2(planMargin(ev)!.margin));
  });
});
