import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CLOSE } from '../electron/nt-bridge/protocol';
import { ManualClock, NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-de-test-nt8';

function collect(ws: WebSocket): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  const waiters: ((msg: Record<string, unknown>) => void)[] = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return () =>
    new Promise((resolve) => {
      const next = queue.shift();
      if (next) resolve(next);
      else waiters.push(resolve);
    });
}

async function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

describe('serveur du pont NT8', () => {
  const servers: NtBridgeServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('refuse un autre hôte que 127.0.0.1', () => {
    expect(() => new NtBridgeServer({ token: TOKEN, host: '0.0.0.0' })).toThrow(/127\.0\.0\.1/);
  });

  it('ferme 4401 sans jeton valide', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=mauvais`);
    await expect(closeCode(ws)).resolves.toBe(CLOSE.BAD_TOKEN);
  });

  it('ferme la première connexion en 4409 quand une seconde arrive', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    const port = await server.start();
    const first = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    await new Promise((resolve) => first.once('open', resolve));
    const closed = closeCode(first);
    const second = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    await new Promise((resolve) => second.once('open', resolve));
    await expect(closed).resolves.toBe(CLOSE.REPLACED);
    second.close();
  });

  it('passe lost après 6 s de silence, puis live au battement', async () => {
    const clock = new ManualClock();
    const server = new NtBridgeServer({ token: TOKEN, port: 0, clock });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    const next = collect(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1', addonVersion: 'test', accounts: ['Sim101'], protocol: 1 } }));
    const hello = await next();
    expect(hello.id).toBe(1);
    expect(server.status().link).toBe('live');
    clock.advance(6000);
    const lost = await next();
    expect(lost.method).toBe('bridge.lost');
    expect(server.status().link).toBe('lost');
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: clock.now() } }));
    for (let i = 0; i < 20 && server.status().link !== 'live'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(server.status().link).toBe('live');
    ws.close();
  });
});
