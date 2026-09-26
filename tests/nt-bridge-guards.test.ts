import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ERR } from '../electron/nt-bridge/protocol';
import { NtBridgeServer } from '../electron/nt-bridge/server';
import { DEFAULT_MAX_CONTRACTS, accountAllowed, guardSubmit } from '../electron/nt-bridge/guards';

const TOKEN = 'jeton-garde';
const order = { account: 'Sim101', instrument: 'MNQ 12-26', action: 'Buy' as const, quantity: 1, type: 'Market' as const, tag: 'canto' };

describe('garde-fous du pont NT8', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('autorise Sim* par défaut et refuse le reste', () => {
    expect(accountAllowed('Sim101', [])).toBe(true);
    expect(accountAllowed('APEX-50K', [])).toBe(false);
    expect(accountAllowed('APEX-50K', ['APEX-50K'])).toBe(true);
    expect(DEFAULT_MAX_CONTRACTS).toBe(20);
  });

  it('refuse compte, plafond, tag et lien perdu', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0, policy: { extraAccounts: [], maxContractsPerOrder: 20 } });
    servers.push(server);
    await server.start();
    const outside = await server.submit({ ...order, account: 'APEX-50K' });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.code).toBe(ERR.ACCOUNT);
    const lost = await server.submit(order);
    expect(lost.ok).toBe(false);
    if (!lost.ok) expect(lost.code).toBe(ERR.LOST);
    const noTag = await server.submit({ ...order, tag: '  ' });
    expect(noTag.ok).toBe(false);
    if (!noTag.ok) expect(noTag.code).toBe(ERR.TAG);
    const capped = guardSubmit({ ...order, quantity: 21 }, { extraAccounts: [], maxContractsPerOrder: 20 }, { link: 'live', ordersClosed: false });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.code).toBe(ERR.QUANTITY);
  });

  it('le kill switch émet order.flatten pour chaque compte autorisé', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    const seen: Record<string, unknown>[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { account?: string } };
      seen.push(msg);
      if (msg.method === 'order.flatten' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { closed: 1 } }));
      }
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1', addonVersion: 'test', accounts: ['Sim101', 'APEX-50K'], protocol: 1 } }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const started = performance.now();
    const killed = server.killSwitch();
    expect(performance.now() - started).toBeLessThan(200);
    expect(killed.accounts).toEqual(['Sim101']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const flats = seen.filter((msg) => msg.method === 'order.flatten');
    expect(flats).toHaveLength(1);
    expect((flats[0]?.params as { account: string }).account).toBe('Sim101');
    const again = await server.submit(order);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe(ERR.LOST);
    ws.close();
  });
});
