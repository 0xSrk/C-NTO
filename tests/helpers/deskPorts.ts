import type { DeskPorts } from '@/engine/agent/ports';

/** Ports du desk vides, à surcharger champ par champ dans un test d'outil. */
export function fakePorts(over: Partial<DeskPorts> = {}): DeskPorts {
  return {
    sessions: () => [],
    trades: () => [],
    startingBalance: () => 50_000,
    planId: () => '',
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
    ...over,
  };
}
