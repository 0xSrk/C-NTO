import { describe, expect, it } from 'vitest';
import { ROUTINES, renderRoutine } from '@/engine/agent/routines';
import type { Bar, BarSeries } from '@/engine/bars';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { buildMetricsContext, type DayContext } from '@/engine/metricsContext';
import { findPlan } from '@/engine/propfirm';
import { tradeRisk } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { callTool } from './helpers/agentEval';
import { fakePorts } from './helpers/deskPorts';

const AT = Date.parse('2026-09-30T20:00:00Z');
const r = (v: number | null, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const session = (id: string, account: string): Session => ({
  id,
  date: '2026-09-30',
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 4,
  pnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  commission: 0,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
});

const trade = (id: string, sessionId: string, account: string, minute: number, over: Partial<Trade>): Trade => ({
  id,
  sessionId,
  instrument: 'MNQ',
  account,
  direction: 'long',
  qty: 2,
  entryTime: AT + minute * 60_000,
  exitTime: AT + (minute + 5) * 60_000,
  entryPrice: 20_000,
  exitPrice: 20_030,
  pnl: 60,
  commission: 0,
  ...over,
});

describe('A6.12 get_session rend le risque et le R de chaque trade, comme l’onglet C', () => {
  // Quatre sources : stop saisi, risque saisi, risque fixe par contrat, aucune.
  const plan = findPlan('topstep-50');
  const trades = (account: string, sid: string): Trade[] => [
    trade(`${sid}_stop`, sid, account, 0, { stopPrice: 19_990, targetPrice: 20_040 }),
    trade(`${sid}_saisi`, sid, account, 10, { risk: 80, pnl: -40, exitPrice: 19_990 }),
    trade(`${sid}_fixe`, sid, account, 20, { pnl: 15, exitPrice: 20_007.5 }),
    trade(`${sid}_nul`, sid, account, 30, { qty: 0, pnl: 0, exitPrice: 20_000 }),
  ];
  const all = [...trades('Sim101', 's_plan'), ...trades('Sim202', 's_autre')];
  const ports = fakePorts({
    sessions: () => [session('s_plan', 'Sim101'), session('s_autre', 'Sim202')],
    trades: () => all,
    startingBalance: () => 50_000,
    planId: () => 'topstep-50',
    planAccount: () => 'Sim101',
    riskPerContract: () => 25,
  });

  type Row = { id: string; stopPrice?: number; targetPrice?: number; risk: { amount: number | null; source: string; plannedRr: number | null; realizedR: number | null; capitalShare: number | null } };
  type Out = { riskCapital: { amount: number; basis: string }; trades: Row[] };

  const expected = (list: Trade[], capital: number) =>
    list.map((t) => {
      const risk = tradeRisk(t, 25, capital);
      return {
        id: t.id,
        ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}),
        ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}),
        risk: { amount: r(risk.risk, 2), source: risk.source, plannedRr: r(risk.plannedRr, 2), realizedR: r(risk.realizedR, 2), capitalShare: r(risk.lossPct, 4) },
      };
    });

  it('compte suivi par le plan : capital = perte maximale du plan', async () => {
    const out = await callTool<Out>(ports, 'get_session', { id: 's_plan' });
    expect(plan?.maxDrawdown).toBe(2_000);
    expect(out.riskCapital).toEqual({ amount: 2_000, basis: 'plan' });
    const rows = out.trades.map((t) => ({ id: t.id, ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}), ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}), risk: t.risk }));
    expect(rows).toEqual(expected(trades('Sim101', 's_plan'), 2_000));
    // Les quatre sources sont lues : la comparaison n'est pas vide.
    expect(out.trades.map((t) => t.risk.source)).toEqual(['stop', 'saisi', 'fixe', 'absent']);
  });

  it('autre compte : capital de référence', async () => {
    const out = await callTool<Out>(ports, 'get_session', { id: 's_autre' });
    expect(out.riskCapital).toEqual({ amount: 50_000, basis: 'reference' });
    const rows = out.trades.map((t) => ({ id: t.id, ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}), ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}), risk: t.risk }));
    expect(rows).toEqual(expected(trades('Sim202', 's_autre'), 50_000));
  });
});

function weekdays(start: string, count: number): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${start}T12:00:00Z`);
  while (out.length < count) {
    const day = new Date(cursor);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(day.toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

describe('A6.13 day_context rend la fiche du contexte du jour, celle de l’onglet Analyse', () => {
  // Barres journalières d'un CSV (minuit UTC), amplitude variable : régimes et bandes se forment.
  const DATES = weekdays('2026-03-02', 160);
  const daily: Bar[] = DATES.map((date, i) => {
    const swing = 40 + 30 * Math.sin(i / 9) + (i % 7) * 4;
    const open = 20_000 + 150 * Math.sin(i / 5) + 3 * i;
    const close = open + 0.6 * swing * Math.sin(i * 1.7);
    return { time: Date.parse(`${date}T00:00:00Z`) / 1000, open, high: Math.max(open, close) + swing / 2, low: Math.min(open, close) - swing / 2, close, volume: 1 };
  });
  const nq: BarSeries = { id: 'csv-nq', instrument: 'NQ', timeframe: 1440, label: 'NQ · CSV', source: 'csv', bars: daily, createdAt: 0 };
  const nqDemo: BarSeries = { id: 'demo-nq', instrument: 'NQ', timeframe: 1440, label: 'NQ · démo', source: 'demo', bars: daily.slice(0, 200), createdAt: 0 };
  const esDemo: BarSeries = { id: 'demo-es', instrument: 'ES', timeframe: 1440, label: 'ES · démo', source: 'demo', bars: daily, createdAt: 0 };
  const clShort: BarSeries = { id: 'csv-cl', instrument: 'CL', timeframe: 1440, label: 'CL · CSV', source: 'csv', bars: daily.slice(0, 50), createdAt: 0 };
  // Trades en micro sur trois journées : la fiche les compte en équivalent standard.
  const tradedDays = [DATES[120]!, DATES[121]!, DATES.at(-1)!];
  const sessions: Session[] = tradedDays.map((date, i) => ({ ...session(`s${i}`, 'Sim101'), date }));
  const trades: Trade[] = tradedDays.map((date, i) => ({
    ...trade(`t${i}`, `s${i}`, 'Sim101', 0, { qty: 3 }),
    entryTime: Date.parse(`${date}T14:00:00Z`),
    exitTime: Date.parse(`${date}T14:20:00Z`),
  }));
  const cpi: CalendarEventRow = { id: 'bls:cpi', sourceId: 'bls', date: DATES.at(-1)!, timeET: '08:30', title: 'Consumer Price Index', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: AT };
  const portsFor = (series: BarSeries[], activeId: string | null = null) =>
    fakePorts({
      sessions: () => sessions,
      trades: () => trades,
      officialEvents: () => [cpi],
      barSeries: async () => series,
      activeSeriesId: () => activeId,
      regimeRules: () => ({ confirm: 1, minStay: 3 }),
    });

  const r = (v: number | undefined, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  const sheetOf = (day: DayContext) => ({
    date: day.date,
    regime: day.volCycle ?? null,
    band: day.volBand ?? null,
    volCT: r(day.volCT, 4),
    volMT: r(day.volMT, 4),
    volLT: r(day.volLT, 4),
    hv30: r(day.hv30, 4),
    hv60: r(day.hv60, 4),
    hv90: r(day.hv90, 4),
    atr14: r(day.atr14, 2),
    prevClose: r(day.prevClose, 2),
    traded: day.traded,
    trades: day.trades,
    contracts: r(day.contracts, 2),
    events: day.events,
    halfDay: day.halfDay,
    gapAtr: r(day.gapAtr, 2),
    dayRange: r(day.dayRange, 2),
    highVsPrevClose: r(day.highVsPrevClose, 2),
    lowVsPrevClose: r(day.lowVsPrevClose, 2),
    openToClose: r(day.openToClose, 2),
  });
  const engine = () =>
    buildMetricsContext({
      root: 'NQ',
      bars: daily,
      timeframe: 1440,
      trades,
      sessions,
      events: [{ date: cpi.date, timeET: cpi.timeET, title: cpi.title, impact: cpi.impact, estimated: cpi.estimated }],
      confirm: 1,
      minStay: 3,
    });
  type Out = Record<string, unknown> & { available: boolean; reason?: string; instrument: string | null };

  it('dernière fiche par défaut, égale à buildMetricsContext, régime et bande définis', async () => {
    const out = await callTool<Out>(portsFor([nq]), 'day_context', { instrument: 'NQ' });
    const last = engine().days.at(-1)!;
    expect(out).toMatchObject({ available: true, instrument: 'NQ', root: 'NQ', source: 'csv', latest: true, ...sheetOf(last) });
    // La comparaison n'est pas vide : la fiche porte un régime, une bande, des trades et la publication du jour.
    expect(last.volCycle && last.volBand).toBeTruthy();
    expect(out.contracts).toBe(0.3);
    expect(out.events).toEqual([{ family: expect.any(String), timeET: '08:30', impact: 3, estimated: false }]);
  });

  it('une date donnée, demandée par le contrat micro : la fiche de cette journée pour la racine', async () => {
    const out = await callTool<Out>(portsFor([nq]), 'day_context', { instrument: 'MNQ', date: DATES[121]! });
    const day = engine().days.find((d) => d.date === DATES[121])!;
    expect(out).toMatchObject({ available: true, root: 'NQ', latest: false, ...sheetOf(day) });
    expect(out.traded).toBe(true);
  });

  it('sans instrument : la série affichée, et jamais des prix synthétiques', async () => {
    expect(await callTool<Out>(portsFor([nqDemo, nq], 'csv-nq'), 'day_context', {})).toMatchObject({ available: true, instrument: 'NQ', source: 'csv' });
    // Série affichée de démonstration : une série réelle de la même racine.
    expect(await callTool<Out>(portsFor([nqDemo, nq], 'demo-nq'), 'day_context', {})).toMatchObject({ available: true, source: 'csv', ...sheetOf(engine().days.at(-1)!) });
    expect(await callTool<Out>(portsFor([esDemo], 'demo-es'), 'day_context', {})).toMatchObject({ available: false, reason: 'demo_series' });
    expect(await callTool<Out>(portsFor([esDemo, nq]), 'day_context', { instrument: 'ES' })).toMatchObject({ available: false, reason: 'demo_series', instrument: 'ES' });
    expect(await callTool<Out>(portsFor([nq]), 'day_context', { instrument: 'GC' })).toMatchObject({ available: false, reason: 'no_series', instrument: 'GC' });
  });

  it('sous 90 séances avant la fiche : historique insuffisant', async () => {
    expect(await callTool<Out>(portsFor([clShort]), 'day_context', { instrument: 'CL' })).toMatchObject({ available: false, reason: 'insufficient_history', instrument: 'CL' });
    expect(await callTool<Out>(portsFor([nq]), 'day_context', { instrument: 'NQ', date: DATES[40]! })).toMatchObject({ available: false, reason: 'insufficient_history', date: DATES[40] });
    expect(await callTool<Out>(portsFor([nq]), 'day_context', { instrument: 'NQ', date: '2025-01-06' })).toMatchObject({ available: false, reason: 'no_sheet', latestDate: DATES.at(-1) });
  });

  it('le brief d’avant-séance lit day_context, avec l’instrument demandé', () => {
    expect(ROUTINES.find((x) => x.name === 'pre_session_brief')!.reads).toContain('day_context');
    for (const locale of ['fr', 'en', 'es'] as const) {
      const out = renderRoutine('pre_session_brief', { instrument: 'MNQ 12-26' }, { locale, allowWrites: false, now: AT });
      expect(out.ok && out.text, locale).toContain('day_context');
      expect(out.ok && out.text, locale).toMatch(/day_context [^:]*"MNQ 12-26"/);
    }
  });
});

