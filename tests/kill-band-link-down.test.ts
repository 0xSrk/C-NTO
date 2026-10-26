/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NtBridgeServer } from '../electron/nt-bridge/server';
import { killEngaged } from '@/app/killState';
import type { NtBridgeStatus } from '@/lib/desk';

describe('OROS3.1b le kill switch se voit même lien tombé', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('le statut du pont porte la fermeture du canal d’ordres, lien vivant ou non', async () => {
    const server = new NtBridgeServer({ token: 'jeton', port: 0, policy: { extraAccounts: [], maxContractsPerOrder: 20 } });
    servers.push(server);
    await server.start();
    expect(server.status().ordersClosed).toBe(false);
    server.killSwitch();
    const status = server.status();
    expect(status.link).not.toBe('live');
    expect(status.ordersClosed).toBe(true);
  });

  it('la bande de niveau 3 se pose sur un canal fermé, même sans AddOn connecté', () => {
    const lost = { link: 'lost', ordersOpen: false, ordersClosed: true } as NtBridgeStatus;
    expect(killEngaged(lost)).toBe(true);
    expect(killEngaged({ link: 'lost', ordersOpen: false, ordersClosed: false } as NtBridgeStatus)).toBe(false);
    expect(killEngaged({ link: 'live', ordersOpen: false } as NtBridgeStatus)).toBe(true);
  });
});
