import { describe, expect, it } from 'vitest';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import type { DeskPorts } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import type { Session } from '@/engine/types';

const now = 1_760_000_000_000;

function ports(over: Partial<DeskPorts> = {}): DeskPorts {
  return {
    sessions: () => [],
    trades: () => [],
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
    portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
    barSeries: async () => [],
    events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
    proposeOrder: async () => ({ ok: false, status: 'refused', reason: 'disabled', detail: '' }),
    ...over,
  };
}

const row = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: 'bls:x',
  sourceId: 'bls',
  date: '2026-10-02',
  timeET: '08:30',
  title: 'Employment Situation',
  category: 'emploi',
  impact: 3,
  instruments: [],
  estimated: false,
  syncedAt: now,
  ...over,
});

interface CalOut {
  error?: string;
  count?: number;
  events?: { date: string; title: string; source: string; estimated: boolean; forecast?: string; previous?: string }[];
}

describe('calendar_events lit les sources officielles', () => {
  it('NFP et FOMC viennent des sources synchronisées, avec leur source et leurs chiffres', async () => {
    const official = [
      row({ id: 'bls:nfp', previous: '142K', forecast: '150K' }),
      row({ id: 'fed:fomc', sourceId: 'fed', date: '2026-10-28', timeET: '14:00', title: 'FOMC Statement', category: 'banque-centrale' }),
    ];
    const out = (await executeDeskTool(ports({ officialEvents: () => official }), 'calendar_events', { from: '2026-10-01', to: '2026-10-31' }, { source: 'llm' })) as CalOut;
    const nfp = out.events?.find((e) => e.date === '2026-10-02' && e.source === 'bls');
    expect(nfp).toMatchObject({ estimated: false, previous: '142K', forecast: '150K' });
    expect(out.events?.some((e) => e.date === '2026-10-28' && e.source === 'fed')).toBe(true);
  });

  it('sans synchronisation, l’outil ne fabrique ni NFP ni FOMC', async () => {
    const out = (await executeDeskTool(ports(), 'calendar_events', { from: '2026-10-01', to: '2026-10-31' }, { source: 'llm' })) as CalOut;
    expect(out.events?.some((e) => /employment|fomc/i.test(e.title))).toBe(false);
  });

  it('couvre les années intermédiaires et borne la plage', async () => {
    const middle = row({ id: 'bls:mid', date: '2026-06-05' });
    const out = (await executeDeskTool(ports({ officialEvents: () => [middle] }), 'calendar_events', { from: '2025-12-01', to: '2027-01-31', minImpact: 3 }, { source: 'llm' })) as CalOut;
    expect(out.events?.some((e) => e.date === '2026-06-05')).toBe(true);
    const tooLong = (await executeDeskTool(ports(), 'calendar_events', { from: '2024-01-01', to: '2027-01-01' }, { source: 'llm' })) as CalOut;
    expect(typeof tooLong.error).toBe('string');
    const reversed = (await executeDeskTool(ports(), 'calendar_events', { from: '2026-10-31', to: '2026-10-01' }, { source: 'llm' })) as CalOut;
    expect(typeof reversed.error).toBe('string');
  });
});

describe('propfirm_status suit le compte de l’écran Métrique', () => {
  const session = (id: string, account: string): Session =>
    ({ id, date: '2026-09-14', account, instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl: -800, grossProfit: 0, grossLoss: -800, commission: 0, tags: [], createdAt: now, updatedAt: now }) as Session;
  const sessions = [session('a', 'Sim101'), session('b', 'Sim102'), session('c', 'Sim103')];

  it('compte suivi par défaut ; un argument account le remplace ; vide = tous', async () => {
    const p = ports({ sessions: () => sessions, planAccount: () => 'Sim101' });
    const tracked = (await executeDeskTool(p, 'propfirm_status', {}, { source: 'llm' })) as { account: string | null; status: string; balance: number };
    expect(tracked.account).toBe('Sim101');
    expect(tracked.balance).toBe(49_200);
    const all = (await executeDeskTool(p, 'propfirm_status', { account: '' }, { source: 'llm' })) as { account: string | null; status: string; balance: number };
    expect(all.account).toBeNull();
    expect(all.balance).toBe(47_600);
    expect(all.status).not.toBe(tracked.status);
    const overview = (await executeDeskTool(p, 'desk_overview', {}, { source: 'llm' })) as { plan: { account: string | null; status: string } };
    expect(overview.plan).toMatchObject({ account: 'Sim101', status: tracked.status });
  });
});
