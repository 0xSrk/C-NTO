import { describe, expect, it } from 'vitest';
import type { DeskBridgeView, DeskPorts } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind } from '@/engine/agent/tools';

function ports(view: DeskBridgeView): DeskPorts {
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
    bridge: async () => view,
    workingOrders: async () => null,
    portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
    barSeries: async () => [],
    events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
    proposeOrder: async () => ({ ok: false, status: 'refused', reason: 'disabled', detail: '' }),
  };
}

const nt = (link: string): NonNullable<DeskBridgeView['nt']> => ({
  link,
  addonVersion: '2.1.1',
  heartbeatLatencyMs: 12,
  ordersOpen: link === 'live',
  maxContractsPerOrder: 20,
  accounts: [
    {
      name: 'Sim101',
      cashValue: 50_123.456,
      realizedPnl: 120.5,
      unrealizedPnl: -40.25,
      positions: [
        { instrument: 'NQ 12-26', quantity: 2, avgPrice: 21_000.25 },
        { instrument: 'ES 12-26', quantity: 0, avgPrice: 0 },
      ],
    },
  ],
});

describe('bridge_status', () => {
  it('lecture seule', () => {
    expect(toolKind('bridge_status')).toBe('read');
  });

  it('pont vivant : comptes arrondis, positions ouvertes seulement, Copieur', async () => {
    const out = (await executeDeskTool(ports({ nt: nt('live'), copier: { armed: false, routed: 3, lastRefusal: { reason: 'window', account: 'Sim102', instrument: 'MNQ 12-26', qty: 10 } } }), 'bridge_status', {}, { source: 'orch' })) as Record<string, unknown>;
    expect(out).toMatchObject({ link: 'live', ordersOpen: true, maxContractsPerOrder: 20 });
    expect(out.note).toBeUndefined();
    expect(out.accounts).toEqual([{ name: 'Sim101', cash: 50_123.46, realizedPnl: 120.5, unrealizedPnl: -40.25, positions: [{ instrument: 'NQ 12-26', quantity: 2, avgPrice: 21_000.25 }] }]);
    expect(out.copier).toEqual({ armed: false, routed: 3, lastRefusal: { reason: 'window', account: 'Sim102', instrument: 'MNQ 12-26', qty: 10 } });
  });

  it('pont hors ligne : le dire ; pas de pont : le dire', async () => {
    const lost = (await executeDeskTool(ports({ nt: nt('lost'), copier: null }), 'bridge_status', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(typeof lost.note).toBe('string');
    const none = (await executeDeskTool(ports({ nt: null, copier: null }), 'bridge_status', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(none).toMatchObject({ link: 'absent' });
  });
});
