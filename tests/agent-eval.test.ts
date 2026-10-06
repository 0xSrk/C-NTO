import { describe, expect, it } from 'vitest';
import { generateNasdaqEvents } from '@/engine/calendar';
import { mergeCalendarEvents } from '@/engine/macroMerge';
import { computeTradeStats } from '@/engine/metrics';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import { etDateKey } from '@/lib/time';
import { drawdownGauge } from '@/modules/metrique/drawdownLimit';
import { filterJournal, scopeFor, shiftDateKey } from '@/modules/metrique/range';
import { lastResult, readTool, runScenario, SCENARIO_NOW } from './helpers/agentEval';
import { DEMO_ACCOUNT, DEMO_PLAN, demoDesk } from './helpers/demoDesk';
import { systemOf } from './helpers/scriptedLlm';

/** Arrondi des outils (`round` de `tools.ts`) : deux décimales, sauf mention. */
const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
/** Journée affichée par l'écran Métrique à l'instant du scénario. */
const AS_OF = etDateKey(SCENARIO_NOW);

/**
 * Scénarios dorés différentiels : un tour complet de l'agent (vraie boucle, vrais outils, vrais
 * schémas) sur le jeu de démo, comparé à ce que les moteurs de l'écran calculent sur les mêmes
 * données. Aucun nombre en dur : l'attendu est recalculé.
 */
describe('agent · scénarios dorés', () => {
  it('profit factor du journal : celui de la tuile K.03, repris tel quel dans la réponse', async () => {
    const desk = demoDesk();
    const run = await runScenario({
      ports: desk.ports,
      question: 'Quel est mon profit factor ?',
      script: [{ calls: [{ name: 'desk_overview' }] }, (req) => ({ text: `Profit factor : ${lastResult<{ profitFactor: number }>(req, 'desk_overview').profitFactor}` })],
    });
    const screen = computeTradeStats(filterJournal(desk.sessions, desk.trades, 'tout', AS_OF, null).trades);
    const out = readTool<{ profitFactor: number; trades: number }>(run.results[0]);
    expect(run.outcome).toEqual({ rounds: 2, exhausted: false });
    expect(out.trades).toBe(screen.count);
    expect(out.profitFactor).toBe(r2(screen.profitFactor));
    expect(run.transcript.at(-1)).toEqual({ role: 'assistant', content: `Profit factor : ${r2(screen.profitFactor)}`, toolCalls: undefined });
  });

  it('statut et marge du plan suivi : le rejeu de l’onglet Firme prop et la jauge K.04, sur le compte suivi', async () => {
    const desk = demoDesk();
    const run = await runScenario({
      ports: desk.ports,
      script: [{ calls: [{ name: 'desk_overview' }, { name: 'propfirm_status' }] }, { text: 'Synthèse' }],
    });
    const plan = findPlan(DEMO_PLAN)!;
    const scope = scopeFor('prop', desk.sessions, desk.trades, '30j', AS_OF, DEMO_ACCOUNT);
    const ev = evaluatePlan(plan, scope.sessions, scope.trades, scope.account ?? undefined);
    const overview = readTool<{ plan: Record<string, unknown> }>(run.results[0]);
    const status = readTool<Record<string, unknown>>(run.results[1]);
    expect(run.results.map((x) => x.name)).toEqual(['desk_overview', 'propfirm_status']);
    expect(overview.plan).toMatchObject({ id: plan.id, account: DEMO_ACCOUNT, status: ev.status, balance: r2(ev.balance), floor: r2(ev.floor), buffer: r2(ev.buffer), targetProgress: r2(ev.targetProgress, 4) });
    expect(status).toMatchObject({ account: DEMO_ACCOUNT, status: ev.status, balance: r2(ev.balance), highWater: r2(ev.highWater), floor: r2(ev.floor), buffer: r2(ev.buffer), daysTraded: ev.daysTraded });
    expect(status.failedOn).toBe(ev.failedOn);
    expect(status.passedOn ?? undefined).toBe(ev.passedOn);
    // La jauge K.04 lit la marge datée du même rejeu sur tout l'historique du compte.
    const gauge = drawdownGauge({ plan, account: DEMO_ACCOUNT, history: scope, maxDrawdown: 0, startingBalance: desk.startingBalance });
    expect(gauge.kind).toBe('plan');
    if (gauge.kind === 'plan') {
      const margin = { date: gauge.date, lastLow: r2(gauge.lastLow), floor: r2(gauge.floor), margin: r2(gauge.margin) };
      expect(overview.plan.margin).toEqual(margin);
      expect(status.margin).toEqual(margin);
    }
  });

  it('catalyseurs de demain : la date vient de la consigne, la liste du calendrier fusionné de l’écran', async () => {
    const desk = demoDesk();
    let asked = '';
    const run = await runScenario({
      ports: desk.ports,
      question: 'Quels catalyseurs majeurs demain ?',
      script: [
        (req) => {
          const today = /Date locale : (\d{4}-\d{2}-\d{2})/.exec(systemOf(req))?.[1] ?? '';
          asked = shiftDateKey(today, 1);
          return { calls: [{ name: 'calendar_events', args: { from: asked, to: asked, minImpact: 3 } }] };
        },
        (req) => ({ text: lastResult<{ events: { title: string }[] }>(req, 'calendar_events').events.map((e) => e.title).join(' · ') }),
      ],
    });
    const year = Number(asked.slice(0, 4));
    const screen = mergeCalendarEvents(generateNasdaqEvents(year), desk.officialEvents).filter((e) => e.date === asked && e.impact >= 3);
    const out = readTool<{ count: number; events: { date: string; title: string; timeET?: string; source: string }[] }>(run.results[0]);
    expect(asked).toBe(shiftDateKey(new Date(SCENARIO_NOW).toISOString().slice(0, 10), 1));
    expect(screen.length).toBeGreaterThan(0);
    expect(out.count).toBe(screen.length);
    expect(out.events.map((e) => [e.date, e.timeET, e.title, e.source])).toEqual(screen.map((e) => [e.date, e.timeET, e.title, e.source ?? 'local']));
    expect(run.transcript.at(-1)?.content).toBe(screen.map((e) => e.title).join(' · '));
  });

  it('un pas manquant au script lève une erreur : le scénario ne passe pas en silence', async () => {
    const desk = demoDesk();
    await expect(runScenario({ ports: desk.ports, script: [{ calls: [{ name: 'desk_overview' }] }] })).rejects.toThrow(/script épuisé/);
  });
});
