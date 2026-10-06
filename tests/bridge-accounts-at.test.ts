import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { DeskBridgeView } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { bridgeSnapshots } from '@/engine/portfolio/view';
import type { Pocket } from '@/engine/portfolio/types';
import { ManualClock, NtBridgeServer } from '../electron/nt-bridge/server';
import { fakePorts } from './helpers/deskPorts';

const TOKEN = 'jeton-comptes';
const ACCOUNT = { name: 'Sim101', cashValue: 50_000, realizedPnl: 120, unrealizedPnl: -40, positions: [{ instrument: 'NQ 12-26', quantity: 1, avgPrice: 21_000 }] };

describe('heure de réception des comptes du pont', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('le statut du pont date les comptes à leur réception', async () => {
    const clock = new ManualClock();
    clock.t = 1_000_000;
    const server = new NtBridgeServer({ token: TOKEN, port: 0, clock });
    servers.push(server);
    const port = await server.start();
    expect(server.status().accountsAt).toBeNull();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 } }));
    await waitFor(() => server.status().link === 'live');
    expect(server.status().accountsAt).toBeNull();
    clock.t = 1_004_000;
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.accounts', params: { accounts: [ACCOUNT] } }));
    await waitFor(() => server.status().accountsAt !== null);
    clock.t = 1_009_000;
    expect(server.status().accountsAt).toBe(1_004_000);
    ws.close();
  });

  it('bridgeSnapshots : daté de la réception, borné à maintenant, l’instant de l’appel sans heure', () => {
    const now = 2_000_000;
    const view = (accountsAt?: number | null) => ({ link: 'live', accounts: [ACCOUNT], ...(accountsAt === undefined ? {} : { accountsAt }) });
    expect(bridgeSnapshots(view(now - 600_000), now)[0]?.at).toBe(now - 600_000);
    expect(bridgeSnapshots(view(now + 5_000), now)[0]?.at).toBe(now);
    expect(bridgeSnapshots(view(null), now)[0]?.at).toBe(now);
    expect(bridgeSnapshots(view(), now)[0]?.at).toBe(now);
    expect(bridgeSnapshots({ ...view(now), link: 'lost' }, now)).toEqual([]);
  });

  it('comptes reçus il y a 10 min : portfolio_snapshot ne les marque pas frais ; bridge_status rend accountsAt', async () => {
    const now = Date.now();
    const pocket: Pocket = { id: 'p1', name: 'Futures perso', kind: 'futures', currency: 'USD', account: 'Sim101', createdAt: now };
    const bridge = (accountsAt: number): DeskBridgeView => ({
      nt: { link: 'live', addonVersion: '2.2.0', heartbeatLatencyMs: 10, ordersOpen: true, maxContractsPerOrder: 20, accounts: [ACCOUNT], accountsAt },
      copier: null,
    });
    const ports = (accountsAt: number) =>
      fakePorts({
        portfolio: async () => ({ pockets: [pocket], positions: [], cash: [{ id: 'c1', pocketId: 'p1', currency: 'USD', amount: 50_000, at: now - 86_400_000 }], fx: [], base: 'USD' }),
        bridge: async () => bridge(accountsAt),
      });

    const old = (await executeDeskTool(ports(now - 600_000), 'portfolio_snapshot', {}, { source: 'orch' })) as Record<string, any>;
    expect(old.bridge).toBe('live');
    expect(old.pockets[0].mark).toBe('journal');
    expect(old.exposure.totalNotional).toBe(0);

    const fresh = (await executeDeskTool(ports(now - 5_000), 'portfolio_snapshot', {}, { source: 'orch' })) as Record<string, any>;
    expect(fresh.pockets[0].mark).toBe('pont');
    expect(fresh.exposure.totalNotional).toBe(420_000);

    const status = (await executeDeskTool(ports(now - 600_000), 'bridge_status', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(status.accountsAt).toBe(new Date(now - 600_000).toISOString());
    const none = (await executeDeskTool(fakePorts({ bridge: async () => ({ nt: { ...bridge(now).nt!, accountsAt: null }, copier: null }) }), 'bridge_status', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(none.accountsAt).toBeNull();
  });
});

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
