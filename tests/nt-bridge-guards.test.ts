import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { authorizeLiveAccount, realAccountDialog } from '../electron/nt-bridge/index';
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

  it('dialogue Annuler : le compte réel n’est pas ajouté', async () => {
    const allow = vi.fn(async (name: string) => name);
    const fr = realAccountDialog('APEX-50K', 'fr');
    expect(fr).toMatchObject({ type: 'warning', defaultId: 1, cancelId: 1, noLink: true });
    expect(fr.buttons).toEqual(['Autoriser les ordres réels sur APEX-50K', 'Annuler']);
    expect(realAccountDialog('APEX-50K', 'en').buttons).toEqual(['Allow real orders on APEX-50K', 'Cancel']);
    expect(realAccountDialog('APEX-50K', 'es').buttons).toEqual(['Autorizar órdenes reales en APEX-50K', 'Cancelar']);
    const result = await authorizeLiveAccount({
      win: { isDestroyed: () => false },
      account: 'APEX-50K',
      locale: 'fr',
      showMessageBox: async () => ({ response: 1 }),
      allow,
      log: () => {},
    });
    expect(result).toBeNull();
    expect(allow).not.toHaveBeenCalled();
  });

  it('dialogue Autoriser : le compte est ajouté, le journal n’a pas de jeton', async () => {
    const allow = vi.fn(async (name: string) => [name]);
    const logs: string[] = [];
    const at = new Date('2026-09-27T07:31:00.000Z');
    const result = await authorizeLiveAccount({
      win: { isDestroyed: () => false },
      account: ' APEX-50K ',
      locale: 'fr',
      showMessageBox: async (_win, options) => {
        expect(options.buttons[0]).toBe('Autoriser les ordres réels sur APEX-50K');
        expect(options.defaultId).toBe(1);
        return { response: 0 };
      },
      allow,
      log: (line) => logs.push(line),
      now: at,
    });
    expect(result).toEqual(['APEX-50K']);
    expect(allow).toHaveBeenCalledWith('APEX-50K');
    expect(logs).toEqual(['nt-bridge compte réel autorisé APEX-50K 2026-09-27T07:31:00.000Z']);
    expect(logs.join('\n')).not.toMatch(/token|jeton/i);
  });

  it('un appel sans fenêtre attachée est refusé', async () => {
    const allow = vi.fn(async (name: string) => name);
    const show = vi.fn(async () => ({ response: 0 }));
    const absent = await authorizeLiveAccount({
      win: null,
      account: 'APEX-50K',
      locale: 'fr',
      showMessageBox: show,
      allow,
      log: () => {},
    });
    const destroyed = await authorizeLiveAccount({
      win: { isDestroyed: () => true },
      account: 'APEX-50K',
      locale: 'fr',
      showMessageBox: show,
      allow,
      log: () => {},
    });
    expect(absent).toBeNull();
    expect(destroyed).toBeNull();
    expect(show).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });
});
