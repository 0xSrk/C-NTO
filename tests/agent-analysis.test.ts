import { describe, expect, it } from 'vitest';
import type { DeskPorts } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

const now = 1_760_000_000_000;
const session = (id: string, date: string, account: string, pnl: number): Session =>
  ({ id, date, account, instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: now, updatedAt: now }) as Session;
const trade = (id: string, sessionId: string, instrument: string, direction: 'long' | 'short', entry: number, pnl: number): Trade =>
  ({ id, sessionId, instrument, direction, qty: 1, entryTime: entry, exitTime: entry + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 }) as Trade;

function ports(sessions: Session[], trades: Trade[]): DeskPorts {
  return {
    sessions: () => sessions,
    trades: () => trades,
    startingBalance: () => 50_000,
    planId: () => 'topstep-50',
    planAccount: () => '',
    updateSession: async () => undefined,
    notes: () => [],
    createNote: async (title) => ({ id: 'n', title }),
    branchNote: async () => null,
    linkNotes: async () => null,
    calendarEntries: () => [],
    officialEvents: () => [],
    bridge: async () => ({ nt: null, copier: null }),
    workingOrders: async () => null,
    marketQuotes: () => [],
    marketFeed: () => 'closed',
    portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
    barSeries: async () => [],
    events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
    proposeOrder: async () => ({ ok: false, status: 'refused', reason: 'disabled', detail: '' }),
  };
}

describe('journal_breakdown', () => {
  const sessions = [session('s1', '2026-09-15', 'Sim101', 100), session('s2', '2026-09-15', 'Sim102', -50)];
  const trades = [
    trade('t1', 's1', 'NQ', 'long', zonedToUtc('2026-09-14', '21:30', ET_ZONE), 100),
    trade('t2', 's2', 'ES', 'short', zonedToUtc('2026-09-15', '10:00', ET_ZONE), -50),
  ];

  it('heure et jour à New York, instrument, sens ; seuls les créneaux occupés', async () => {
    const out = (await executeDeskTool(ports(sessions, trades), 'journal_breakdown', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(out).toMatchObject({ timezone: 'America/New_York', account: null, trades: 2, netPnl: 50 });
    expect(out.byHour).toEqual([
      { key: '10', trades: 1, pnl: -50, winRate: 0 },
      { key: '21', trades: 1, pnl: 100, winRate: 1 },
    ]);
    // Lundi 21:30 ET appartient à la séance CME du mardi 15/09, comme sa séance s1 (1.1).
    expect((out.byWeekday as { key: string }[]).map((b) => b.key)).toEqual(['mar']);
    expect((out.byInstrument as { key: string }[]).map((b) => b.key).sort()).toEqual(['ES', 'NQ']);
    expect(out.direction).toMatchObject({ long: { trades: 1, pnl: 100 }, short: { trades: 1, pnl: -50 } });
  });

  it('filtre de compte', async () => {
    const out = (await executeDeskTool(ports(sessions, trades), 'journal_breakdown', { account: 'Sim102' }, { source: 'llm' })) as Record<string, unknown>;
    expect(out).toMatchObject({ account: 'Sim102', trades: 1, netPnl: -50 });
  });
});

describe('monte_carlo', () => {
  const days = Array.from({ length: 20 }, (_, i) => session(`d${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`, 'Sim101', i % 3 === 0 ? -300 : 250));

  it('plan suivi par défaut, graine fixe, bornes', async () => {
    const p = ports(days, []);
    const a = (await executeDeskTool(p, 'monte_carlo', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(a).toMatchObject({ sampleDays: 20, runs: 1000, horizon: 60, ruinDrawdown: 2000, target: 3000 });
    expect(typeof a.ruinProbability).toBe('number');
    expect(typeof a.targetProbability).toBe('number');
    const b = await executeDeskTool(p, 'monte_carlo', {}, { source: 'llm' });
    expect(b).toEqual(a);
    const big = (await executeDeskTool(p, 'monte_carlo', { runs: 99_999, horizon: 99_999 }, { source: 'llm' })) as Record<string, unknown>;
    expect(big).toMatchObject({ runs: 2000, horizon: 250 });
  });

  it('échantillon trop court : le dire', async () => {
    const out = (await executeDeskTool(ports(days.slice(0, 5), []), 'monte_carlo', {}, { source: 'llm' })) as { error?: string };
    expect(out.error).toMatch(/5/);
  });
});
