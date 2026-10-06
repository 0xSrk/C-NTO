import { afterEach, describe, expect, it } from 'vitest';
import { toolBlurb, toolSchemas } from '@/engine/agent/tools';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import { computeDailyStats, computeTradeStats, sessionDates } from '@/engine/metrics';
import { monteCarlo } from '@/engine/montecarlo';
import { evaluatePlan, findPlan, planMargin, setUserPlans, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { drawdownGauge } from '@/modules/metrique/drawdownLimit';
import { filterJournal, monteCarloSample, rangeFrom, scopeFor } from '@/modules/metrique/range';
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

/** Le compte de la démo copié sur `Sim101` : mêmes journées, mêmes PnL. */
function copied(sessions: readonly Session[], account: string): Session[] {
  return sessions.map((row) => ({ ...row, id: `${row.id}_${account}`, account }));
}

type McOut = { error?: string; message?: string; accounts?: string[]; account?: string | null; sampleDays?: number; runs?: number; horizon?: number; finalPnl?: Record<string, number>; targetProbability?: number | null };

describe('A6.3 monte_carlo : un compte, comme l’onglet E', () => {
  it('plusieurs comptes sans `account` : account_required et la liste, message en trois langues', async () => {
    const desk = demoDesk();
    const ports = fakePorts({ ...desk.ports, sessions: () => [...desk.sessions, ...copied(desk.sessions, 'Sim101')], trades: () => desk.trades });
    const messages = new Set<string>();
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const out = await callTool<McOut>(ports, 'monte_carlo');
      expect(out.error, locale).toBe('account_required');
      expect(out.accounts, locale).toEqual([DEMO_ACCOUNT, 'Sim101']);
      messages.add(out.message ?? '');
    }
    useI18n.setState({ locale: 'fr' });
    expect(messages.size).toBe(3);
  });

  it('avec `account` : l’échantillon et la projection de l’écran, comptes copiés écartés', async () => {
    const desk = demoDesk();
    const all = [...desk.sessions, ...copied(desk.sessions, 'Sim101')];
    const ports = fakePorts({ ...desk.ports, sessions: () => all, trades: () => desk.trades });
    const out = await callTool<McOut>(ports, 'monte_carlo', { account: DEMO_ACCOUNT });
    const plan = findPlan(DEMO_PLAN)!;
    const sample = monteCarloSample(scopeFor('mc', all, desk.trades, 'tout', '2026-10-01', DEMO_ACCOUNT), 'seances');
    const screen = monteCarlo(sample, { runs: 1000, horizon: 60, seed: 1337, ruinDrawdown: plan.maxDrawdown, target: plan.profitTarget })!;
    expect(out).toMatchObject({ account: DEMO_ACCOUNT, sampleDays: sample.length, runs: screen.runs, horizon: screen.horizon });
    expect(out.finalPnl?.p50).toBe(r2(screen.finalPnl.p50));
    expect(out.targetProbability).toBe(r2(screen.targetProbability!, 4));
  });

  it('un seul compte : pris d’office ; runs et horizon rendus sont ceux de la projection', async () => {
    const desk = demoDesk();
    const implicit = await callTool<McOut>(desk.ports, 'monte_carlo');
    const explicit = await callTool<McOut>(desk.ports, 'monte_carlo', { account: DEMO_ACCOUNT });
    expect(implicit).toEqual(explicit);
    expect(implicit).toMatchObject({ account: DEMO_ACCOUNT, runs: 1000, horizon: 60 });
    expect(await callTool<McOut>(desk.ports, 'monte_carlo', { runs: 150.6, horizon: 2 })).toMatchObject({ runs: 151, horizon: 5 });
  });
});

describe('A6.4 desk_overview : période et compte, comme le Tableau de bord', () => {
  it('sans argument, le résultat reste celui d’avant (tout le journal, trades sans séance compris)', async () => {
    const desk = demoDesk();
    const orphan = { ...desk.trades[0]!, id: 't_orphelin', sessionId: 's_inconnue', pnl: 1234 };
    const sessions = [...desk.sessions, ...copied(desk.sessions.slice(-20), 'Sim101')];
    const trades = [...desk.trades, orphan];
    const ports = fakePorts({ ...desk.ports, sessions: () => sessions, trades: () => trades });
    const out = await callTool<Record<string, unknown>>(ports, 'desk_overview');
    const t = computeTradeStats(trades);
    const d = computeDailyStats(sessions, desk.startingBalance);
    expect(out).toMatchObject({
      sessions: sessions.length,
      trades: t.count,
      netPnl: r2(t.netPnl),
      winRate: r2(t.winRate, 4),
      profitFactor: r2(t.profitFactor),
      expectancy: r2(t.expectancy),
      payoffRatio: r2(t.payoffRatio),
      sqn: r2(t.sqn),
      maxDrawdownTrades: r2(t.maxDrawdown),
      sharpeDaily: r2(d.sharpe),
      sortinoDaily: r2(d.sortino),
      maxDrawdownDaily: r2(d.maxDrawdown),
      winDayRate: r2(d.winDayRate, 4),
      bestDay: r2(d.bestDay),
      worstDay: r2(d.worstDay),
      consistencyShare: r2(d.consistency, 4),
      tradingDays: d.tradingDays,
    });
    expect(out.slice).toBeUndefined();
  });

  it('{from, to, account} : Sharpe, Sortino et profit factor du Tableau de bord sur la même tranche', async () => {
    const desk = demoDesk();
    const sessions = [...desk.sessions, ...copied(desk.sessions, 'Sim101')];
    const ports = fakePorts({ ...desk.ports, sessions: () => sessions, trades: () => desk.trades });
    const asOf = '2026-10-01';
    const from = rangeFrom('90j', asOf)!;
    const out = await callTool<Record<string, unknown>>(ports, 'desk_overview', { from, to: asOf, account: DEMO_ACCOUNT });
    const shown = filterJournal(sessions, desk.trades, '90j', asOf, DEMO_ACCOUNT);
    const daily = computeDailyStats(shown.sessions, desk.startingBalance, 20, { from, to: asOf });
    const stats = computeTradeStats(shown.trades);
    expect(out).toMatchObject({
      sessions: shown.sessions.length,
      trades: stats.count,
      profitFactor: r2(stats.profitFactor),
      sharpeDaily: r2(daily.sharpe),
      sortinoDaily: r2(daily.sortino),
      maxDrawdownDaily: r2(daily.maxDrawdown),
      tradingDays: daily.tradingDays,
      slice: { from, to: asOf, account: DEMO_ACCOUNT },
    });
    // Le plan suivi reste rejoué sur tout l'historique de son compte, pas sur la tranche.
    const ev = evaluatePlan(findPlan(DEMO_PLAN)!, sessions, desk.trades, DEMO_ACCOUNT);
    expect(out.plan).toMatchObject({ status: ev.status, buffer: r2(ev.buffer) });
  });
});

type Provenance = { asOf?: string; sources?: Record<string, number>; demo?: boolean };

describe('A6.5 chaque lecture du journal est datée et sourcée', () => {
  const NOW = Date.parse('2026-10-02T13:45:00Z');
  /** Un vrai journal NinjaTrader, mêlé au jeu de démo comme le fait « Jeu de démonstration ». */
  const real = [session('r1', '2026-09-28', 'Sim101', 250), session('r2', '2026-09-29', 'Sim101', -120), session('r3', '2026-09-30', 'Sim101', 80)];

  it('asOf vient de l’horloge du desk ; sources compte les séances lues ; demo signale la démo mêlée', async () => {
    const desk = demoDesk({ extra: { sessions: real, trades: [] }, now: NOW });
    const calls: [string, Record<string, unknown>, number][] = [
      ['desk_overview', {}, desk.sessions.length],
      ['journal_breakdown', {}, desk.sessions.length],
      ['monte_carlo', { account: DEMO_ACCOUNT }, desk.sessions.length - real.length],
      ['propfirm_status', {}, desk.sessions.length - real.length],
      ['list_sessions', { limit: 200 }, 143],
    ];
    for (const [name, args, count] of calls) {
      const out = await callTool<Provenance>(desk.ports, name, args);
      expect(out.asOf, name).toBe(new Date(NOW).toISOString());
      const sources = out.sources ?? {};
      expect(Object.values(sources).reduce((a, b) => a + b, 0), name).toBe(Math.min(count, 200));
      expect(out.demo, name).toBe(true);
    }
    const overview = await callTool<Provenance>(desk.ports, 'desk_overview');
    expect(overview.sources).toEqual({ demo: desk.sessions.length - real.length, ninjatrader: real.length });
    const own = await callTool<Provenance>(desk.ports, 'desk_overview', { account: 'Sim101' });
    expect(own.sources).toEqual({ ninjatrader: real.length });
    expect(own.demo).toBeUndefined();
  });

  it('list_sessions rend le compte et la source de chaque séance, et filtre par compte', async () => {
    const desk = demoDesk({ extra: { sessions: real, trades: [] }, now: NOW });
    const out = await callTool<{ count: number; sessions: { id: string; account: string | null; source: string }[] }>(desk.ports, 'list_sessions', { account: 'Sim101' });
    expect(out.count).toBe(3);
    expect(out.sessions.map((x) => [x.id, x.account, x.source])).toEqual([
      ['r3', 'Sim101', 'ninjatrader'],
      ['r2', 'Sim101', 'ninjatrader'],
      ['r1', 'Sim101', 'ninjatrader'],
    ]);
  });

  it('get_session : une date portée par plusieurs comptes est ambiguë sans `account`', async () => {
    const both = [session('a', '2026-09-28', 'Sim101', 250), session('b', '2026-09-28', 'Sim102', 250)];
    const ports = fakePorts({ sessions: () => both });
    const out = await callTool<{ ambiguous?: boolean; candidates?: { id: string; account: string | null }[]; session?: Session }>(ports, 'get_session', { date: '2026-09-28' });
    expect(out.ambiguous).toBe(true);
    expect(out.candidates?.map((c) => [c.id, c.account])).toEqual([
      ['a', 'Sim101'],
      ['b', 'Sim102'],
    ]);
    expect(out.session).toBeUndefined();
    const picked = await callTool<{ session?: Session }>(ports, 'get_session', { date: '2026-09-28', account: 'Sim102' });
    expect(picked.session?.id).toBe('b');
    expect((await callTool<{ session?: Session }>(ports, 'get_session', { id: 'a' })).session?.id).toBe('a');
  });

  it('get_session : deux séances du même compte le même jour, la première comme avant', async () => {
    const twice = [session('a1', '2026-09-28', 'Sim101', 100), session('a2', '2026-09-28', 'Sim101', 50)];
    const out = await callTool<{ ambiguous?: boolean; session?: Session }>(fakePorts({ sessions: () => twice }), 'get_session', { date: '2026-09-28' });
    expect(out.ambiguous).toBeUndefined();
    expect(out.session?.id).toBe('a1');
  });
});

describe('A6.6 sorties bornées', () => {
  it('list_sessions : 200 séances aux notes de 20 000 caractères tiennent sous 100 000 caractères', async () => {
    const long = 'n'.repeat(20_000);
    const many = Array.from({ length: 200 }, (_, i) =>
      session(`s_${String(i).padStart(3, '0')}`, new Date(Date.parse('2026-01-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), 'Sim101', i, { note: long, tags: ['revue', 'plan respecté'], rating: 3 }),
    );
    const desk = demoDesk({ journal: { sessions: many, trades: [] } });
    const run = await callTool<{ truncated?: boolean; count: number; sessions: { note?: string; noteTruncated?: boolean }[] }>(desk.ports, 'list_sessions', { limit: 200 });
    expect(run.count).toBe(200);
    expect(run.truncated).toBe(true);
    expect(run.sessions.every((x) => (x.note?.length ?? 0) <= 280 && x.noteTruncated === true)).toBe(true);
    expect(JSON.stringify(run).length).toBeLessThan(100_000);
    // Une note courte passe entière, sans marque.
    const short = await callTool<{ truncated?: boolean; sessions: { note?: string; noteTruncated?: boolean }[] }>(fakePorts({ sessions: () => [session('c', '2026-09-28', 'Sim101', 1, { note: 'courte' })] }), 'list_sessions');
    expect(short.truncated).toBeUndefined();
    expect(short.sessions[0]).toMatchObject({ note: 'courte' });
    expect(short.sessions[0]?.noteTruncated).toBeUndefined();
  });

  it('get_session : 200 trades au plus, identifiants d’exécution comptés, statistiques sur tous les trades', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `exec-${i}`);
    const big = session('s_big', '2026-09-28', 'Sim101', 0, { tradeCount: 250, executionIds: ids });
    const start = zonedToUtc('2026-09-28', '09:30', ET_ZONE);
    const many = Array.from({ length: 250 }, (_, i) => trade(`t${i}`, 's_big', start + i * 60_000, start + i * 60_000 + 30_000, i % 2 ? 10 : -10, { executionIds: ['a', 'b'] }));
    const out = await callTool<{ session: Record<string, unknown>; trades: unknown[]; truncated?: boolean; tradeCount?: number; stats: { winRate: number } }>(fakePorts({ sessions: () => [big], trades: () => many }), 'get_session', { id: 's_big' });
    expect(out.trades).toHaveLength(200);
    expect(out.truncated).toBe(true);
    expect(out.tradeCount).toBe(250);
    expect(out.session.executionIds).toBeUndefined();
    expect(out.session.executionCount).toBe(400);
    expect(out.stats.winRate).toBe(r2(computeTradeStats(many).winRate, 4));
    expect(JSON.stringify(out)).not.toContain('exec-');
  });

  it('calendar_events : entrées personnelles bornées en nombre et en longueur', async () => {
    const entries = Array.from({ length: 150 }, (_, i) => ({ date: '2026-10-05', kind: 'note', title: `Entrée ${i}`, body: 'b'.repeat(5_000) }));
    const out = await callTool<{ personal: { body?: string }[]; personalCount?: number; personalTruncated?: boolean }>(fakePorts({ calendarEntries: () => entries }), 'calendar_events', { from: '2026-10-01', to: '2026-10-31' });
    expect(out.personal.length).toBeLessThanOrEqual(100);
    expect(out.personal.every((e) => (e.body?.length ?? 0) <= 280)).toBe(true);
    expect(out.personalCount).toBe(150);
    expect(out.personalTruncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(60_000);
  });
});

describe('A6.8 profit factor d’une tranche, et « sans perte » dit comme tel', () => {
  it('journal_breakdown sur un mois de la démo : le profit factor de l’onglet Analyse', async () => {
    const desk = demoDesk();
    const out = await callTool<{ profitFactor?: number; noLoss?: boolean; trades: number }>(desk.ports, 'journal_breakdown', { from: '2026-09-01', to: '2026-09-30' });
    const month = desk.sessions.filter((x) => x.date >= '2026-09-01' && x.date <= '2026-09-30');
    const ids = new Set(month.map((x) => x.id));
    const screen = computeTradeStats(desk.trades.filter((x) => ids.has(x.sessionId)), sessionDates(month));
    expect(out.trades).toBe(screen.count);
    expect(out.profitFactor).toBe(r2(screen.profitFactor));
    expect(out.noLoss).toBeUndefined();
  });

  it('une tranche sans perte rend noLoss: true, pas un profit factor nul', async () => {
    const desk = demoDesk();
    const byId = new Map<string, Trade[]>();
    for (const x of desk.trades) byId.set(x.sessionId, [...(byId.get(x.sessionId) ?? []), x]);
    const day = desk.sessions.find((x) => (byId.get(x.id) ?? []).every((t) => t.pnl > 0) && (byId.get(x.id)?.length ?? 0) > 1)!;
    expect(day).toBeDefined();
    expect(computeTradeStats(byId.get(day.id)!).profitFactor).toBe(Infinity);
    const slice = { from: day.date, to: day.date, account: DEMO_ACCOUNT };
    const breakdown = await callTool<Record<string, unknown>>(desk.ports, 'journal_breakdown', slice);
    const overview = await callTool<Record<string, unknown>>(desk.ports, 'desk_overview', slice);
    const detail = await callTool<{ stats: Record<string, unknown> }>(desk.ports, 'get_session', { id: day.id });
    for (const out of [breakdown, overview, detail.stats]) {
      expect(out.noLoss).toBe(true);
      expect('profitFactor' in out).toBe(false);
    }
  });
});
