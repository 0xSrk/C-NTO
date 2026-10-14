import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-release';
const wait = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Un AddOn factice : chaque abonnement reçoit `s<n>`, chaque désabonnement est noté. */
async function addon(port: number): Promise<{ ws: WebSocket; unsubscribed: string[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
  const unsubscribed: string[] = [];
  let seq = 0;
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { subscriptionId?: string } };
    if (msg.id === undefined) return;
    if (msg.method === 'marketdata.subscribe') ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { subscriptionId: `s${++seq}` } }));
    if (msg.method === 'marketdata.unsubscribe') {
      unsubscribed.push(String(msg.params?.subscriptionId));
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
    }
  });
  await new Promise((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1.5', addonVersion: 'fake', accounts: ['Sim101'], protocol: 1 } }));
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: Date.now() } }));
  await wait();
  return { ws, unsubscribed };
}

describe('pont NT8 · abonnements de la page qui s’en va', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('releaseSubscriptions ferme chez l’AddOn chaque abonnement encore ouvert, une seule fois', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    const { ws, unsubscribed } = await addon(await server.start());
    expect(server.status().link).toBe('live');

    const ids: string[] = [];
    for (const req of [
      { instrument: 'MNQ 12-26', kind: 'bars', timeframe: 5 },
      { instrument: 'MNQ 12-26', kind: 'quote' },
      { instrument: 'MES 12-26', kind: 'tick' },
    ]) {
      const sub = await server.subscribe(req);
      if (!sub.ok) throw new Error(sub.detail);
      ids.push(sub.subscriptionId);
    }
    // La page en ferme un elle-même.
    expect(await server.unsubscribe(ids[1]!)).toEqual({ ok: true });
    expect(unsubscribed).toEqual(['s2']);

    expect(await server.releaseSubscriptions()).toBe(2);
    expect(unsubscribed.slice(1).sort()).toEqual(['s1', 's3']);
    // Rien de plus au départ suivant ; la page suivante se réabonne.
    expect(await server.releaseSubscriptions()).toBe(0);
    expect(unsubscribed).toHaveLength(3);
    const next = await server.subscribe({ instrument: 'MNQ 12-26', kind: 'bars', timeframe: 5 });
    expect(next).toEqual({ ok: true, subscriptionId: 's4' });
    ws.close();
  });

  it('pont hors ligne au départ de la page : rien n’est envoyé, les identifiants partent au départ suivant', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    const port = await server.start();
    const first = await addon(port);
    const sub = await server.subscribe({ instrument: 'MNQ 12-26', kind: 'quote' });
    expect(sub.ok).toBe(true);
    first.ws.close();
    await wait();
    expect(server.status().link).not.toBe('live');
    expect(await server.releaseSubscriptions()).toBe(0);
    expect(first.unsubscribed).toEqual([]);

    // L'AddOn garde ses abonnements à travers une reconnexion : le départ suivant les ferme.
    const second = await addon(port);
    expect(await server.releaseSubscriptions()).toBe(1);
    expect(second.unsubscribed).toEqual(['s1']);
    second.ws.close();
  });

  it('electron/main.ts : la page qui s’en va ferme aussi ses abonnements NinjaTrader', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const create = main.slice(main.indexOf('function createWindow('), main.indexOf('const chromiumLang'));
    const wiring = create.slice(create.indexOf('onPageLeft(win.webContents, '));
    expect(wiring.slice(0, 400)).toContain('void ntBridge?.releaseSubscriptions();');
  });

  it('NtBridgeHost relaie releaseSubscriptions au serveur, 0 sans serveur', () => {
    const host = readFileSync('electron/nt-bridge/index.ts', 'utf8');
    const method = host.slice(host.indexOf('  releaseSubscriptions(): Promise<number> {'));
    expect(method.slice(0, 200)).toContain('if (!this.server) return Promise.resolve(0);');
    expect(method.slice(0, 200)).toContain('return this.server.releaseSubscriptions();');
  });
});
