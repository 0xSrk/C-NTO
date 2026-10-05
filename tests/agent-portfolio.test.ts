import { describe, expect, it } from 'vitest';
import { executeDeskTool } from '@/engine/agent/runner';
import type { Pocket } from '@/engine/portfolio/types';
import { fakePorts } from './helpers/deskPorts';

const now = Date.now();

describe('portfolio_snapshot', () => {
  it('poche futures sur le pont vivant : valeur, exposition au multiplicateur de la racine, levier', async () => {
    const pocket: Pocket = { id: 'p1', name: 'Futures perso', kind: 'futures', currency: 'USD', account: 'Sim101', createdAt: now };
    const ports = fakePorts({
      portfolio: async () => ({ pockets: [pocket], positions: [], cash: [{ id: 'c1', pocketId: 'p1', currency: 'USD', amount: 50_000, at: now - 86_400_000 }], fx: [], base: 'USD' }),
      bridge: async () => ({
        nt: {
          link: 'live',
          addonVersion: '2.1.1',
          heartbeatLatencyMs: 10,
          ordersOpen: true,
          maxContractsPerOrder: 20,
          accounts: [{ name: 'Sim101', cashValue: 50_000, realizedPnl: 0, unrealizedPnl: 0, positions: [{ instrument: 'NQ 12-26', quantity: 1, avgPrice: 21_000 }] }],
        },
        copier: null,
      }),
    });
    const out = (await executeDeskTool(ports, 'portfolio_snapshot', {}, { source: 'orch' })) as Record<string, any>;
    expect(out.base).toBe('USD');
    expect(out.bridge).toBe('live');
    expect(out.pockets[0]).toMatchObject({ name: 'Futures perso', kind: 'futures', currency: 'USD' });
    expect(out.exposure.totalNotional).toBe(420_000);
    expect(out.exposure.byInstrument[0]).toEqual({ key: 'NQ 12-26', notional: 420_000 });
    expect(out.exposure.grossLeverage).toBeGreaterThan(1);
  });

  it('pont hors ligne : l’exposition futures n’est pas comptée et la note le dit', async () => {
    const pocket: Pocket = { id: 'p1', name: 'Futures perso', kind: 'futures', currency: 'USD', account: 'Sim101', createdAt: now };
    const out = (await executeDeskTool(fakePorts({ portfolio: async () => ({ pockets: [pocket], positions: [], cash: [], fx: [], base: 'USD' }) }), 'portfolio_snapshot', {}, { source: 'llm' })) as Record<string, any>;
    expect(out.bridge).toBe('absent');
    expect(out.exposure.totalNotional).toBe(0);
    expect(out.exposure.notes).toEqual([{ pocket: 'Futures perso', text: 'pont hors ligne' }]);
  });
});
