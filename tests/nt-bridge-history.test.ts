import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HISTORY_MAX_SECONDS, HISTORY_TIMEOUT_MS, validateHistory } from '../electron/nt-bridge/protocol';
import { ManualClock, NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-historique';
const TO = 1_791_295_350;
const FROM = TO - 5 * 86_400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('A13.4 historique du pont : fenêtre validée dans le process principal', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('n’admet que des secondes que l’AddOn sait convertir, et ne transmet que les champs connus', () => {
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: FROM, to: TO, contractMonth: '12-26' })).toEqual({ ok: true, req: { instrument: 'NQ 12-26', timeframe: 5, from: FROM, to: TO } });
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: 0, to: HISTORY_MAX_SECONDS }).ok).toBe(true);
    // L'ancienne demande de Visual, et une fenêtre en millisecondes, débordent `DateTime` dans l'AddOn.
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: 0, to: Number.MAX_SAFE_INTEGER })).toEqual({ ok: false, code: -32602, message: 'marketdata.history invalide' });
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: FROM * 1000, to: TO * 1000 }).ok).toBe(false);
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: TO, to: FROM }).ok).toBe(false);
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 5, from: FROM + 0.5, to: TO }).ok).toBe(false);
    expect(validateHistory({ instrument: 'NQ 12-26', timeframe: 0, from: FROM, to: TO }).ok).toBe(false);
    expect(validateHistory({ timeframe: 5, from: FROM, to: TO }).ok).toBe(false);
  });

  it('refuse une fenêtre invalide avant tout envoi, même pont absent', async () => {
    const server = new NtBridgeServer({ token: TOKEN, port: 0 });
    servers.push(server);
    await expect(server.history({ instrument: 'NQ 12-26', timeframe: 5, from: 0, to: Number.MAX_SAFE_INTEGER })).resolves.toEqual({ ok: false, detail: 'marketdata.history invalide' });
    await expect(server.history({ instrument: 'NQ 12-26', timeframe: 5, from: FROM, to: TO })).resolves.toEqual({ ok: false, detail: 'aucune source live' });
  });

  it('transmet la fenêtre validée et attend l’AddOn plus longtemps que l’AddOn n’attend NinjaTrader', async () => {
    const addonWait = Number(/done\.WaitOne\((\d+)\)/.exec(readFileSync('ninjatrader/CantoBridge.cs', 'utf8'))?.[1]);
    expect(addonWait).toBe(15_000);
    expect(HISTORY_TIMEOUT_MS).toBeGreaterThan(addonWait);

    const clock = new ManualClock();
    const server = new NtBridgeServer({ token: TOKEN, port: 0, clock });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    const asked: unknown[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { method?: string; params?: unknown };
      if (msg.method === 'marketdata.history') asked.push(msg.params);
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 } }));
    await sleep(30);
    expect(server.status().link).toBe('live');

    let settled = false;
    const reply = server.history({ instrument: 'NQ 12-26', timeframe: 5, from: FROM, to: TO, extra: 'x' }).then((result) => {
      settled = true;
      return result;
    });
    await sleep(30);
    expect(asked).toEqual([{ instrument: 'NQ 12-26', timeframe: 5, from: FROM, to: TO }]);

    // Le pont reste vivant (battements) : seul le délai de l'historique peut clore la demande.
    const beat = async () => {
      clock.advance(2_000);
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: clock.now() } }));
      await sleep(20);
    };
    while (clock.now() < 14_000) await beat();
    expect(settled).toBe(false);
    while (clock.now() < HISTORY_TIMEOUT_MS) await beat();
    await expect(reply).resolves.toEqual({ ok: false, detail: 'délai dépassé' });
    ws.close();
  });
});
