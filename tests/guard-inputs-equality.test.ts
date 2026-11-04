import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TRADER_RULES, type AgentTraderRuleBlock } from '@/engine/agent/orders';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { DEFAULT_TRADER_RULES, type TraderRules } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * OROS5.9 : ce que le renderer passe à la garde du process principal à chaque `propose_order` ne change pas. Les
 * valeurs « avant » ont été relevées au HEAD qui précède le ticket (`11791c1`), par le même banc : la proposition part
 * par `useAgentOrders.propose`, et l'on lit ce que reçoit `window.canto.agentOrders.propose`.
 */

const NOW = zonedToUtc('2026-10-07', '08:25', ET_ZONE);
const DAY = '2026-10-07';

function session(id: string, account: string, pnl: number): Session {
  return { id, date: DAY, account, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: NOW, updatedAt: NOW };
}
function trade(id: string, sessionId: string, account: string, pnl: number): Trade {
  return { id, sessionId, instrument: 'MNQ', account, direction: 'long', qty: 2, entryTime: NOW - 40 * 60_000, exitTime: NOW - 30 * 60_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 4, pnl, commission: 0 };
}
const CPI: CalendarEventRow = { id: 'bls:cpi', sourceId: 'bls', date: DAY, timeET: '08:30', title: 'Consumer Price Index', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: NOW };

const order = (account: string, instrument = 'MNQ 12-26', qty = 1): Record<string, unknown> => ({ account, instrument, side: 'buy', qty, type: 'market', reason: 'cassure du plus haut de la veille' });
const loss = { sessions: [session('s1', 'SimApex1', -600)], trades: [trade('t1', 's1', 'SimApex1', -600)] };
const lossApex = { sessions: [session('s2', 'Apex-PA-50K', -600)], trades: [trade('t2', 's2', 'Apex-PA-50K', -600)] };
// OROS5.48b (décision 15, changement voulu) : la perte du jour atteinte ferme la journée CME, et la règle transmise dit depuis
// quand, à l'heure de New York (la sortie de −600 $ à 07:55 ET) ; la perte relue suit, telle qu'avant.
const lossRule = (n: number): AgentTraderRuleBlock => ({ rule: 'after_daily_limit', detail: `journée fermée depuis 07:55 ET : perte du jour ${n} $ ≥ limite 500 $ (règle du trader)` });
const windowRule: AgentTraderRuleBlock = { rule: 'catalyst_window', detail: 'Consumer Price Index à 08:30 ET : pas d’entrée à ± 10 min' };
const listRule = (symbol: string): AgentTraderRuleBlock => ({ rule: 'instrument_not_allowed', detail: `${symbol} hors des instruments autorisés (ES)` });

interface Case {
  name: string;
  planId: string;
  planAccount: string;
  rules: Partial<TraderRules>;
  sessions: Session[];
  trades: Trade[];
  /** Latent de chaque compte du pont ; `null` : pont hors ligne. */
  unrealized: Record<string, number> | null;
  events: CalendarEventRow[];
  args: Record<string, unknown>;
  /** Relevé au HEAD d'avant : la marge et la règle transmises au process principal. */
  before: [number | null, AgentTraderRuleBlock | null];
  /** Toutes les règles enfreintes, dans l'ordre de la garde. */
  blocks: AgentTraderRuleBlock[];
}

const CASES: Case[] = [
  { name: 'plan suivi, compte Sim* suivi, latent −2 000', planId: 'apex-50', planAccount: 'SimApex1', rules: {}, sessions: [], trades: [], unrealized: { SimApex1: -2_000, Sim101: -50 }, events: [], args: order('SimApex1'), before: [0.2, null], blocks: [] },
  { name: 'plan suivi, autre compte Sim*', planId: 'apex-50', planAccount: 'SimApex1', rules: {}, sessions: [], trades: [], unrealized: { SimApex1: -2_000, Sim101: -50 }, events: [], args: order('Sim101'), before: [null, null], blocks: [] },
  { name: 'plan suivi, nom replié (casse et espaces)', planId: 'apex-50', planAccount: 'SimApex1', rules: { maxDailyLoss: 500 }, ...loss, unrealized: { SimApex1: -2_000 }, events: [], args: order('  simAPEX1 '), before: [-0.04, lossRule(2600)], blocks: [lossRule(2600)] },
  { name: 'plan suivi hors Sim*, proposition sur Sim*', planId: 'apex-50', planAccount: 'Apex-PA-50K', rules: { maxDailyLoss: 500 }, ...lossApex, unrealized: { 'Apex-PA-50K': -300, Sim101: 0 }, events: [], args: order('Sim101'), before: [null, null], blocks: [] },
  { name: 'plan suivi hors Sim*, proposition sur le compte suivi', planId: 'apex-50', planAccount: 'Apex-PA-50K', rules: { maxDailyLoss: 500 }, ...lossApex, unrealized: { 'Apex-PA-50K': -300 }, events: [], args: order('Apex-PA-50K'), before: [0.64, lossRule(900)], blocks: [lossRule(900)] },
  { name: 'tous les comptes suivis', planId: 'apex-50', planAccount: '', rules: { maxDailyLoss: 500 }, ...loss, unrealized: { SimApex1: -100, Sim101: -50 }, events: [], args: order('Sim101'), before: [0.7, lossRule(750)], blocks: [lossRule(750)] },
  { name: 'aucun plan suivi', planId: '', planAccount: '', rules: {}, sessions: [], trades: [], unrealized: { Sim101: -50 }, events: [], args: order('Sim101'), before: [null, null], blocks: [] },
  { name: 'pont hors ligne', planId: 'apex-50', planAccount: 'SimApex1', rules: {}, sessions: [], trades: [], unrealized: null, events: [], args: order('SimApex1'), before: [1, null], blocks: [] },
  { name: 'perte du jour atteinte', planId: '', planAccount: 'SimApex1', rules: { maxDailyLoss: 500 }, ...loss, unrealized: { SimApex1: 0 }, events: [], args: order('SimApex1'), before: [null, lossRule(600)], blocks: [lossRule(600)] },
  { name: 'fenêtre de catalyseur', planId: '', planAccount: 'SimApex1', rules: { catalystBlackoutMin: 10 }, sessions: [], trades: [], unrealized: { SimApex1: 0 }, events: [CPI], args: order('SimApex1'), before: [null, windowRule], blocks: [windowRule] },
  { name: 'instrument hors liste', planId: '', planAccount: 'SimApex1', rules: { allowedInstruments: ['ES'] }, sessions: [], trades: [], unrealized: { SimApex1: 0 }, events: [], args: order('SimApex1'), before: [null, listRule('MNQ')], blocks: [listRule('MNQ')] },
  { name: 'trois règles à la fois', planId: 'apex-50', planAccount: 'SimApex1', rules: { maxDailyLoss: 500, catalystBlackoutMin: 10, allowedInstruments: ['ES'] }, ...loss, unrealized: { SimApex1: -100 }, events: [CPI], args: order('SimApex1'), before: [0.72, lossRule(700)], blocks: [lossRule(700), windowRule, listRule('MNQ')] },
  { name: 'fenêtre et instrument, sans perte', planId: '', planAccount: 'SimApex1', rules: { catalystBlackoutMin: 10, allowedInstruments: ['ES'] }, sessions: [], trades: [], unrealized: { SimApex1: 0 }, events: [CPI], args: order('SimApex1'), before: [null, windowRule], blocks: [windowRule, listRule('MNQ')] },
  { name: 'arguments mal formés', planId: 'apex-50', planAccount: 'SimApex1', rules: { allowedInstruments: ['ES'] }, sessions: [], trades: [], unrealized: { SimApex1: -2_000 }, events: [], args: { account: 42, instrument: null, qty: 'deux', reason: 'r' }, before: [null, listRule('')], blocks: [listRule('')] },
];

async function bench(c: Case, sent: unknown[][]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('window', {
    location: { search: '' },
    canto: {
      agentOrders: {
        status: async () => ({ enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false }),
        propose: async (...args: unknown[]) => {
          sent.push(args);
          return { status: 'declined', detail: 'refusé par le trader' };
        },
      },
    },
  });
  vi.resetModules();
  const { useAgentOrders } = await import('@/store/agentOrders');
  const deskEvents = await import('@/store/deskEvents');
  const { useBridge } = await import('@/store/bridge');
  const { useJournal } = await import('@/store/journal');
  const { useMacro } = await import('@/store/macro');
  const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: c.planId, planAccount: c.planAccount, traderRules: { ...DEFAULT_TRADER_RULES, ...c.rules } } });
  useJournal.setState({ sessions: c.sessions, trades: c.trades });
  useMacro.setState({ events: c.events });
  useBridge.setState({ nt: c.unrealized ? ({ link: 'live', accounts: Object.entries(c.unrealized).map(([name, unrealizedPnl]) => ({ name, cashValue: 50_000, realizedPnl: 0, unrealizedPnl, positions: [] })) } as never) : null });
  return { useAgentOrders, deskEvents };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OROS5.9 · isoler les entrées que le renderer passe à la garde', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s : la proposition part avec la même marge et la même règle qu’avant', async (_name, c) => {
    const sent: unknown[][] = [];
    const { useAgentOrders } = await bench(c, sent);
    await useAgentOrders.getState().propose(c.args, 'llm');
    // OROS5.40 : le ticket de la proposition part en plus, étiquette que le process principal renvoie avec l'étape ; la
    // marge et la règle que lit la garde restent celles d'avant.
    expect(sent).toEqual([[c.args, 'llm', ...c.before, expect.stringMatching(/^p\d+$/)]]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s : propShareFor et traderRuleOf, exposés, rendent ce que reçoit le process principal', async (_name, c) => {
    const sent: unknown[][] = [];
    const { useAgentOrders, deskEvents } = await bench(c, sent);
    await useAgentOrders.getState().propose(c.args, 'llm');
    const account = typeof c.args.account === 'string' ? c.args.account.trim() : '';
    expect(deskEvents.propShareFor(account)).toEqual(sent[0]![2]);
    expect(deskEvents.traderRuleOf(c.args)).toEqual(sent[0]![3]);
    // toutes les règles enfreintes, dans l'ordre de la garde ; traderRuleFor en est la première
    const blocks = deskEvents.traderRulesOf(c.args);
    expect(blocks).toEqual(c.blocks);
    expect(blocks.map((b) => AGENT_TRADER_RULES.indexOf(b.rule))).toEqual([...blocks.map((b) => AGENT_TRADER_RULES.indexOf(b.rule))].sort((a, b) => a - b));
    expect(blocks[0] ?? null).toEqual(sent[0]![3]);
  });

  it('traderRuleFor est le premier élément de traderRuleBlocks', async () => {
    const c = CASES.find((row) => row.name === 'trois règles à la fois')!;
    const { deskEvents } = await bench(c, []);
    const proposal = { account: 'SimApex1', instrument: 'MNQ 12-26', qty: 1 };
    expect(deskEvents.traderRuleBlocks(proposal, NOW).map((b) => b.rule)).toEqual(['after_daily_limit', 'catalyst_window', 'instrument_not_allowed']);
    expect(deskEvents.traderRuleFor(proposal, NOW)).toEqual(deskEvents.traderRuleBlocks(proposal, NOW)[0]);
    // à 08:00, hors de la fenêtre de la CPI : la perte et la liste restent
    expect(deskEvents.traderRuleBlocks(proposal, NOW - 25 * 60_000).map((b) => b.rule)).toEqual(['after_daily_limit', 'instrument_not_allowed']);
  });
});
