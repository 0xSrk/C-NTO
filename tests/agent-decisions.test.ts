import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentOrderHost } from '../electron/agent-orders';
import { AGENT_ORDER_DEFAULTS, guardProposal, parseTraderRule, type AgentOrderProposal, type AgentOrderSnapshot } from '@/engine/agent/orders';
import { DEFAULT_TRADER_RULES, type TraderRules } from '@/engine/discipline';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { traderRuleFor } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

const ON = { ...AGENT_ORDER_DEFAULTS, enabled: true };
const order = (over: Partial<AgentOrderProposal> = {}): AgentOrderProposal => ({ account: 'Sim101', instrument: 'MNQ', side: 'buy', qty: 1, type: 'market', reason: 'r', ...over });
const snap = (over: Partial<AgentOrderSnapshot> = {}): AgentOrderSnapshot => ({ now: 100_000, link: 'live', ordersOpen: true, position: 0, recent: [], busy: false, propShare: null, ...over });

describe('A17.1 les règles du trader gardent propose_order (décision 1 de l’ADMIN)', () => {
  const rule = { rule: 'after_daily_limit' as const, detail: 'perte du jour 600 $ ≥ limite 500 $' };

  it('une règle enfreinte refuse une ouverture ; une réduction de risque passe toujours', () => {
    expect(guardProposal(order(), ON, snap({ traderRule: rule }))).toEqual({ ok: false, reason: 'trader_rule', detail: rule.detail });
    expect(guardProposal(order({ side: 'sell' }), ON, snap({ position: 1, traderRule: rule }))).toEqual({ ok: true, resulting: 0, reducing: true });
    expect(guardProposal(order(), ON, snap({ traderRule: null }))).toEqual({ ok: true, resulting: 1, reducing: false });
  });

  it('le process principal ne retient qu’une des trois règles décidées, motif sur une ligne et borné', () => {
    expect(parseTraderRule(null)).toBeNull();
    expect(parseTraderRule('after_daily_limit')).toBeNull();
    expect(parseTraderRule({ rule: 'over_max_trades', detail: 'x' })).toBeNull();
    expect(parseTraderRule({ rule: 'catalyst_window', detail: 'CPI 08:30 ET ± 10 min' })).toEqual({ rule: 'catalyst_window', detail: 'CPI 08:30 ET ± 10 min' });
    const long = parseTraderRule({ rule: 'instrument_not_allowed', detail: `CL\nhors liste‮${'x'.repeat(500)}` });
    expect(long?.rule).toBe('instrument_not_allowed');
    expect(long?.detail).not.toMatch(/[\n‮]/);
    expect(long!.detail.length).toBeLessThanOrEqual(200);
    expect(parseTraderRule({ rule: 'after_daily_limit', detail: 42 })).toEqual({ rule: 'after_daily_limit', detail: '' });
  });

  it('le process principal refuse avant tout dialogue : rien n’est demandé ni soumis', async () => {
    const dialogs: unknown[] = [];
    const submitted: unknown[] = [];
    const host = new AgentOrderHost({
      userDataDir: mkdtempSync(path.join(tmpdir(), 'canto-decisions-')),
      locale: () => 'fr',
      window: () => ({ isDestroyed: () => false }),
      showMessageBox: (_w, options) => {
        dialogs.push(options);
        return Promise.resolve({ response: 0 });
      },
      bridge: () => ({ link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [] }] }),
      submit: async (o) => {
        submitted.push(o);
        return { ok: true, orderId: 'nt-1', latencyMs: 1 };
      },
      log: () => undefined,
      now: () => 1_000_000,
    });
    await host.enable();
    const before = dialogs.length;
    const out = await host.propose({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure' }, 'mcp', null, { rule: 'catalyst_window', detail: 'CPI 08:30 ET' });
    expect(out).toMatchObject({ status: 'refused', reason: 'trader_rule', detail: 'CPI 08:30 ET' });
    expect(dialogs.length).toBe(before);
    expect(submitted).toEqual([]);
  });
});

describe('A17.1 le renderer lit la règle enfreinte par la proposition, comme la veille discipline', () => {
  const NOW = zonedToUtc('2026-10-07', '08:25', ET_ZONE);
  const rules = (over: Partial<TraderRules>): TraderRules => ({ ...DEFAULT_TRADER_RULES, ...over });
  const session: Session = { id: 's1', date: '2026-10-07', account: 'Sim101', instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 1, pnl: -600, grossProfit: 0, grossLoss: -600, commission: 0, tags: [], createdAt: NOW, updatedAt: NOW };
  const loss: Trade = { id: 't1', sessionId: 's1', instrument: 'MNQ', account: 'Sim101', direction: 'long', qty: 2, entryTime: NOW - 40 * 60_000, exitTime: NOW - 30 * 60_000, entryPrice: 20_000, exitPrice: 19_850, pnl: -600, commission: 0 };
  const cpi: CalendarEventRow = { id: 'bls:cpi', sourceId: 'bls', date: '2026-10-07', timeET: '08:30', title: 'Consumer Price Index', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: NOW };

  afterEach(() => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
    useJournal.setState({ sessions: [], trades: [] });
    useMacro.setState({ events: [] });
  });

  const set = (traderRules: TraderRules, journal = false, events: CalendarEventRow[] = []) => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules, planAccount: 'Sim101' } });
    useJournal.setState({ sessions: journal ? [session] : [], trades: journal ? [loss] : [] });
    useMacro.setState({ events });
  };
  const proposal = { account: 'Sim101', instrument: 'MNQ 12-26', qty: 1 };

  it('perte du jour atteinte', () => {
    set(rules({ maxDailyLoss: 500 }), true);
    expect(traderRuleFor(proposal, NOW)).toMatchObject({ rule: 'after_daily_limit' });
  });

  it('fenêtre d’un catalyseur majeur', () => {
    set(rules({ catalystBlackoutMin: 10 }), false, [cpi]);
    expect(traderRuleFor(proposal, NOW)).toMatchObject({ rule: 'catalyst_window', detail: expect.stringContaining('08:30') });
    expect(traderRuleFor(proposal, NOW - 30 * 60_000)).toBeNull();
  });

  it('instrument hors de la liste du trader', () => {
    set(rules({ allowedInstruments: ['ES'] }));
    expect(traderRuleFor(proposal, NOW)).toMatchObject({ rule: 'instrument_not_allowed' });
    expect(traderRuleFor({ ...proposal, instrument: 'ES 12-26' }, NOW)).toBeNull();
  });

  it('règles inactives, ou règle hors décision (trades par journée) : rien ne bloque', () => {
    set(DEFAULT_TRADER_RULES, true, [cpi]);
    expect(traderRuleFor(proposal, NOW)).toBeNull();
    set(rules({ maxTradesPerDay: 1 }), true);
    expect(traderRuleFor(proposal, NOW)).toBeNull();
  });
});
