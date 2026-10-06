import type { DeskPorts } from '@/engine/agent/ports';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';

/** Ports du desk vides, à surcharger champ par champ dans un test d'outil. */
export function fakePorts(over: Partial<DeskPorts> = {}): DeskPorts {
  return {
    sessions: () => [],
    trades: () => [],
    startingBalance: () => 50_000,
    planId: () => '',
    planAccount: () => '',
    traderRules: () => DEFAULT_TRADER_RULES,
    riskPerContract: () => 0,
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
    ...over,
  };
}
