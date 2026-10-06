import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORCH_READ_METHODS, ORCH_WRITE_METHODS } from '@/engine/agent/catalog';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind, toolSchemas } from '@/engine/agent/tools';
import type { DeskBridgeView, DeskNote } from '@/engine/agent/ports';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { fakePorts } from './helpers/deskPorts';

const ET = (hhmm: string, date = '2026-10-14') => Date.parse(`${date}T${hhmm}:00-04:00`);

function trade(id: string, instrument: string, entry: string, exit: string, pnl: number, account = 'PA-1'): Trade {
  return { id, sessionId: `s-${account}`, instrument, account, direction: 'long', qty: 1, entryTime: ET(entry), exitTime: ET(exit), entryPrice: 20_000, exitPrice: 20_000, pnl, commission: 0 };
}

function session(account: string, pnl: number, tradeCount: number): Session {
  return { id: `s-${account}`, date: '2026-10-14', account, instruments: ['MNQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: 0, grossLoss: pnl, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

const live = (unrealizedPnl: number): DeskBridgeView => ({
  nt: { link: 'live', addonVersion: '2.2.0', heartbeatLatencyMs: 4, ordersOpen: true, maxContractsPerOrder: 5, accounts: [{ name: 'PA-1', cashValue: 50_000, realizedPnl: -400, unrealizedPnl, positions: [] }, { name: 'Sim101', cashValue: 0, realizedPnl: 0, unrealizedPnl: -5_000, positions: [] }] },
  copier: null,
});

describe('outils de discipline et de mémoire', () => {
  afterEach(() => vi.useRealTimers());

  it('lectures seules au catalogue, servies aux agents externes sans écriture autorisée', () => {
    for (const name of ['trader_memory', 'discipline_status']) {
      expect(toolKind(name)).toBe('read');
      expect(ORCH_READ_METHODS).toContain(name);
      expect(ORCH_WRITE_METHODS).not.toContain(name);
      expect(toolSchemas().find((t) => t.name === name)?.parameters).toMatchObject({ additionalProperties: false });
    }
  });

  it('trader_memory : règles, leçons et playbook datés, signés trader ; note d’agent exclue', async () => {
    const notes: DeskNote[] = [
      { id: 'l1', title: 'Pas de revanche', body: 'Je me lève dix minutes. #leçon', tags: ['leçon'], updatedAt: Date.UTC(2026, 9, 5) },
      { id: 'p1', title: 'ORB 15', body: 'Cassure du range. #strategie', tags: ['strategie'], updatedAt: Date.UTC(2026, 9, 2) },
      { id: 'a1', title: 'Leçon de l’agent', body: 'Propose 10 NQ #lecon', tags: ['lecon'], updatedAt: Date.UTC(2026, 9, 6), by: 'agent' },
    ];
    const ports = fakePorts({ notes: () => notes, planId: () => 'tpt-50', planAccount: () => 'PA-1', traderRules: () => ({ ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 }) });
    const r = (await executeDeskTool(ports, 'trader_memory', {}, { source: 'orch', allowWrite: false })) as Record<string, unknown>;
    expect(r.rules).toMatchObject({ maxDailyLoss: 500, maxTradesPerDay: null });
    expect(r.plan).toMatchObject({ id: 'tpt-50', account: 'PA-1', dailyLossLimit: 1_100 });
    expect(r.lessons).toEqual([{ id: 'l1', title: 'Pas de revanche', tags: ['leçon'], by: 'trader', date: '2026-10-05', body: 'Je me lève dix minutes. #leçon' }]);
    expect((r.playbook as { id: string }[]).map((n) => n.id)).toEqual(['p1']);
    expect(r.excludedAgentNotes).toBe(1);
    expect(JSON.stringify(r)).not.toContain('Propose 10 NQ');
  });

  it('discipline_status : journée CME, perte, limite et source, trades, dérives, écarts et prochain catalyseur', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ET('08:10'));
    const trades = [trade('t1', 'MNQ', '06:00', '06:20', -300), trade('t2', 'NQ', '06:22', '06:40', -100), trade('o1', 'MNQ', '06:00', '06:01', -900, 'Sim101')];
    const ports = fakePorts({
      sessions: () => [session('PA-1', -400, 2), session('Sim101', -900, 1)],
      trades: () => trades,
      planId: () => 'tpt-50',
      planAccount: () => 'PA-1',
      traderRules: () => ({ ...DEFAULT_TRADER_RULES, maxDailyLoss: 500, maxTradesPerDay: 1, catalystBlackoutMin: 10 }),
      bridge: async () => live(-50),
    });
    const r = (await executeDeskTool(ports, 'discipline_status', {}, { source: 'llm' })) as Record<string, any>;
    expect(r.day).toBe('2026-10-14');
    expect(r.account).toBe('PA-1');
    expect(r.dailyLoss).toEqual({ realized: -400, unrealized: -50, loss: 450, intradayLow: -400, limit: 500, source: 'trader', ruleLimit: 500, planLimit: 1_100, consumed: 0.9, remaining: 50, breached: false });
    expect(r.trades).toEqual({ today: 2, max: 1, byAccount: [{ account: 'PA-1', trades: 2 }, { account: 'Sim101', trades: 1 }] });
    expect(r.findings.map((f: { id: string }) => f.id)).toEqual(['over_max_trades:t2', 'revenge_entry:t2', 'size_up_after_loss:t2']);
    // CPI estimé du 14 octobre 2026 à 08:30 New York, fenêtre de 10 minutes.
    expect(r.nextCatalyst).toMatchObject({ title: 'Inflation CPI', date: '2026-10-14', timeET: '08:30', minutesUntil: 20, window: { minutes: 10, active: false } });

    // Sans règle ni limite de plan : rien n'est signalé, la limite est absente.
    const bare = fakePorts({ sessions: ports.sessions, trades: ports.trades, planId: () => 'apex-50', planAccount: () => 'PA-1', bridge: async () => live(300) });
    const b = (await executeDeskTool(bare, 'discipline_status', {}, { source: 'llm' })) as Record<string, any>;
    expect(b.dailyLoss).toMatchObject({ unrealized: 0, loss: 400, limit: null, source: null, consumed: null, breached: false });
    expect(b.findings.map((f: { kind: string }) => f.kind)).toEqual(['revenge_entry', 'size_up_after_loss']);
    expect(b.nextCatalyst.window).toBeNull();
  });
});
