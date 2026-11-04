import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_SIM_PREFIX } from '@/engine/agent/orders';
import { demoPocket, demoSettingsPatch, generateDemoJournal, generateDemoSimJournal, SIM_DEMO } from '@/engine/demo';
import { DEFAULT_TRADER_RULES, dailyLimit } from '@/engine/discipline';
import { evaluatePlan, findPlan } from '@/engine/propfirm';

const { account: DEMO_ACCOUNT, planId: DEMO_PLAN, dailyLoss: DAILY_LOSS } = SIM_DEMO;

/**
 * OROS5.30a — décision 14 de l'ADMIN : le jeu de démonstration gagne un plan suivi vivant sur un compte Sim*, une perte du
 * jour réglée, une poche prop rattachée, une hypothèse et un lien écrit par l'agent ; aucune trace d'ordre. OROS5.30 n'en
 * livrait que les deux derniers : le tirage posait toutes les séances sur Apex-PA-50K (hors Sim), le plan apex-50 y finissait
 * clos, la perte du jour restait à 0 et aucune poche n'était rattachée.
 */
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

describe('OROS5.30a · le jeu de démonstration tient la décision 14', () => {
  it('un compte Sim* dont le plan suivi reste en cours, quel que soit le jour du chargement', () => {
    expect(DEMO_ACCOUNT.startsWith(AGENT_SIM_PREFIX)).toBe(true);
    const plan = findPlan(DEMO_PLAN)!;
    expect(plan).toBeDefined();
    for (const end of ['2026-11-04T15:00:00Z', '2026-11-09T15:00:00Z', '2026-11-14T15:00:00Z', '2027-01-04T15:00:00Z']) {
      const sim = generateDemoSimJournal({ endDate: new Date(end) });
      expect(sim.sessions.length, end).toBeGreaterThanOrEqual(3);
      expect(new Set([...sim.sessions.map((s) => s.account), ...sim.trades.map((t) => t.account)]), end).toEqual(new Set([DEMO_ACCOUNT]));
      // la dernière séance au plus tard la veille, jamais un samedi ni un dimanche
      expect(sim.sessions.every((s) => s.date < end.slice(0, 10) && ![0, 6].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay())), end).toBe(true);
      expect(evaluatePlan(plan, sim.sessions, sim.trades, DEMO_ACCOUNT).status, end).toBe('en-cours');
      // aucune séance n'atteint la perte du jour de démonstration
      expect(Math.min(...sim.sessions.map((s) => s.pnl))).toBeGreaterThan(-DAILY_LOSS);
      // le tirage d'Apex-PA-50K ne change pas
      expect(new Set(generateDemoJournal({ sessions: 20, endDate: new Date(end) }).sessions.map((s) => s.account))).toEqual(new Set(['Apex-PA-50K']));
    }
  });

  it('les réglages : le plan suit le compte Sim, la perte du jour est réglée ; un réglage du trader n’est jamais remplacé', () => {
    const fresh = demoSettingsPatch({ planAccount: '', planId: DEMO_PLAN, traderRules: DEFAULT_TRADER_RULES });
    expect(fresh).toEqual({ planAccount: DEMO_ACCOUNT, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: DAILY_LOSS } });
    expect(dailyLimit(fresh.traderRules!, findPlan(DEMO_PLAN))?.amount).toBe(DAILY_LOSS);
    expect(demoSettingsPatch({ planAccount: '', planId: '', traderRules: DEFAULT_TRADER_RULES })).toMatchObject({ planId: DEMO_PLAN });
    expect(demoSettingsPatch({ planAccount: 'Apex-PA-50K', planId: 'mffu-50', traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 800 } })).toEqual({});
  });

  it('une poche prop rattachée au compte Sim et à son plan, sauf s’il en a déjà une', () => {
    expect(demoPocket([], 1_000)).toMatchObject({ kind: 'propfirm', account: DEMO_ACCOUNT, planId: DEMO_PLAN, currency: 'USD', createdAt: 1_000 });
    expect(demoPocket([{ kind: 'propfirm', account: DEMO_ACCOUNT }], 1_000)).toBeNull();
    expect(demoPocket([{ kind: 'futures', account: ' sim101 ' }], 1_000)).toBeNull();
    expect(demoPocket([{ kind: 'propfirm', account: 'Apex-PA-50K' }], 1_000)).not.toBeNull();
  });

  it('loadDemo écrit le compte Sim, la poche et les réglages, avec l’hypothèse et le lien ; aucune trace d’ordre', () => {
    const source = read('src/store/journal.ts');
    const body = source.slice(source.indexOf('async loadDemo()'), source.indexOf('async addManualSession('));
    expect(body).toMatch(/generateDemoSimJournal\(/);
    expect(body).toMatch(/db\.transaction\('rw', \[db\.sessions, db\.trades, db\.notes, db\.links, db\.pockets\]/);
    expect(body).toMatch(/demoPocket\(/);
    expect(body).toMatch(/demoSettingsPatch\(/);
    expect(body).toMatch(/useSettings\.getState\(\)\.update\(/);
    expect(body).toMatch(/usePortfolio\.getState\(\)\.load\(\)/);
    expect(body).toMatch(/generateDemoOntology\(/);
    expect(body).not.toMatch(/agentOrders|propose|closeDay|proposal/i);
  });
});
