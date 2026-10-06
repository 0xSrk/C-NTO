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
import { propBufferAlert, propLiveBuffer } from '@/engine/agent/events';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import { evaluatePlan, findPlan, planMargin, setUserPlans, type PropPlan } from '@/engine/propfirm';
import { useBridge } from '@/store/bridge';
import { trackedPropShare, traderRuleFor } from '@/store/deskEvents';
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

describe('A17.2 la garde de l’agent et l’alerte prop_buffer lisent la marge datée de la jauge K.04 (décision 2)', () => {
  const base = { planId: 'apex-50', account: 'A', maxDrawdown: 2_500, buffer: 1_225, floor: 48_000, balance: 49_225 };

  it('la marge datée remplace la marge de clôture ; un latent négatif la diminue encore', () => {
    expect(propLiveBuffer({ ...base, margin: 175, unrealized: 0 })).toEqual({ liveBuffer: 175, share: 0.07 });
    expect(propLiveBuffer({ ...base, margin: 175, unrealized: -100 })).toEqual({ liveBuffer: 75, share: 0.03 });
    expect(propLiveBuffer({ ...base, margin: 175, unrealized: 400 })?.liveBuffer).toBe(175);
    // Sans séance rejouée (aucune marge datée), la marge de clôture reste la référence.
    expect(propLiveBuffer({ ...base, margin: null, unrealized: 0 })?.liveBuffer).toBe(1_225);
    const alert = propBufferAlert(0, { ...base, margin: 175, marginDate: '2026-09-22', unrealized: 0 });
    expect(alert.data).toMatchObject({ liveBuffer: 175, margin: 175, marginDate: '2026-09-22', journalBuffer: 1_225, remainingShare: 0.07 });
  });

  it('cas 1.6 : la garde lit 7 % (la jauge), plus 49 % (la clôture), et refuse d’ouvrir', () => {
    // Cas 1.6 de AUDIT : 60 jours ouvrés depuis le 01/07/2026, compte A, un trade NQ par jour, MAE de 1 100 $ le dernier.
    const days: string[] = [];
    for (let t = Date.parse('2026-07-01T12:00:00Z'); days.length < 60; t += 86_400_000) {
      const dow = new Date(t).getUTCDay();
      if (dow >= 1 && dow <= 5) days.push(new Date(t).toISOString().slice(0, 10));
    }
    const pnlOf = (i: number) => (i <= 14 ? 200 : i <= 29 ? -60 : i <= 58 ? -25 : -50);
    const trades: Trade[] = days.map((date, i) => {
      const pnl = pnlOf(i);
      const entry = Date.parse(`${date}T10:00:00-04:00`);
      return { id: `t${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime: entry, exitTime: entry + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, mae: i === 59 ? 1_100 : Math.max(0, -pnl) };
    });
    const sessions = groupIntoSessions(trades, 18, 'csv');
    const plan: PropPlan = { ...findPlan('apex-50')!, id: 'cas-16', source: 'user', profitTarget: 1e9 };
    setUserPlans([plan]);
    try {
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: plan.id, planAccount: 'A' } });
      useJournal.setState({ sessions, trades });
      useBridge.setState({ nt: null });
      const ev = evaluatePlan(plan, sessions, trades, 'A');
      const gauge = planMargin(ev)!;
      expect(gauge.margin).toBe(175);
      expect(ev.buffer / plan.maxDrawdown).toBeCloseTo(0.49, 2);
      const share = trackedPropShare('A');
      expect(share).toBeCloseTo(gauge.margin / plan.maxDrawdown, 6);
      // La part lue pour le compte du plan refuse une ouverture (seuil 25 %), là où 49 % la laissait passer.
      expect(guardProposal(order(), ON, snap({ propShare: share }))).toMatchObject({ ok: false, reason: 'prop_buffer' });
      expect(guardProposal(order(), ON, snap({ propShare: ev.buffer / plan.maxDrawdown })).ok).toBe(true);
    } finally {
      setUserPlans([]);
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
      useJournal.setState({ sessions: [], trades: [] });
    }
  });
});

