import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HISTORY_MAX_BARS, MAX_FRAME_BYTES, clampHistoryWindow } from '../electron/nt-bridge/protocol';
import { NtBridgeServer } from '../electron/nt-bridge/server';
import { HISTORY_DAYS, HISTORY_MAX_BARS as VISUAL_MAX_BARS, historyWindow } from '../src/modules/visual/ntFollow';

/**
 * SEC1.4 — Visual demandait cinq jours d'historique quelle que soit l'unité. En 1 minute, la réponse de l'AddOn
 * (≈ 6 900 barres, ≈ 650 Ko) dépassait la trame du pont (256 Ko) : `ws` fermait le lien (1009), les ordres en vol
 * échouaient et le kill switch n'avait plus de destinataire jusqu'à la reconnexion. La fenêtre est bornée à
 * `HISTORY_MAX_BARS` barres, dans le process principal d'abord (toute source), dans Visual ensuite (ce qu'il annonce).
 */

const TOKEN = 'jeton-fenetre';
const HELLO = { kind: 'ninjatrader', ntVersion: '8', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 };
const NOW_S = 1_794_250_000;
const DAY = 86_400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Msg = { id?: number; method?: string; params?: { instrument: string; timeframe: number; from: number; to: number } };

/**
 * Un AddOn qui répond comme la 2.2.0 : une barre par unité dans la fenêtre demandée, sans la borner lui-même
 * (`CantoBridge.cs`, `History` : jusqu'à 50 000 barres). Les prix ont la longueur d'un NQ réel.
 */
function addon(port: number): Promise<{ ws: WebSocket; asked: NonNullable<Msg['params']>[]; closed: Promise<number> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    const asked: NonNullable<Msg['params']>[] = [];
    const closed = new Promise<number>((done) => ws.once('close', (code) => done(code)));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      if (msg.method !== 'marketdata.history' || !msg.params) return;
      asked.push(msg.params);
      const step = msg.params.timeframe * 60;
      const bars: unknown[] = [];
      for (let time = Math.ceil(msg.params.from / step) * step; time <= msg.params.to; time += step) {
        bars.push({ time, open: 25_123.25, high: 25_131.75, low: 25_118.5, close: 25_127.25, volume: 1_842 });
      }
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { bars } }));
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: HELLO }));
      resolve({ ws, asked, closed });
    });
  });
}

describe('SEC1.4 historique du pont : une fenêtre bornée, le lien tient', () => {
  const servers: NtBridgeServer[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });
  async function serve() {
    const lines: string[] = [];
    const server = new NtBridgeServer({ token: TOKEN, port: 0, log: (line) => lines.push(line) });
    servers.push(server);
    const port = await server.start();
    const peer = await addon(port);
    sockets.push(peer.ws);
    await sleep(40);
    expect(server.status().link).toBe('live');
    return { server, lines, ...peer };
  }

  it('la borne tient dans une trame : 2 000 barres à 128 octets restent sous le plafond du pont', () => {
    expect(HISTORY_MAX_BARS).toBe(2_000);
    expect(HISTORY_MAX_BARS * 128).toBeLessThan(MAX_FRAME_BYTES);
  });

  it('ramène une fenêtre trop longue aux barres les plus récentes, sans toucher une fenêtre qui tient', () => {
    const wide = { instrument: 'NQ 12-26', timeframe: 1, from: NOW_S - 5 * DAY, to: NOW_S };
    const bounded = clampHistoryWindow(wide);
    expect(bounded).toEqual({ ...wide, from: NOW_S - (HISTORY_MAX_BARS - 1) * 60 });
    // Une barre par minute, bornes comprises : exactement la borne.
    expect((bounded.to - bounded.from) / 60 + 1).toBe(HISTORY_MAX_BARS);
    // Cinq jours en 5 minutes font 1 441 barres : la fenêtre passe telle quelle, le même objet.
    const fits = { instrument: 'NQ 12-26', timeframe: 5, from: NOW_S - 5 * DAY, to: NOW_S };
    expect(clampHistoryWindow(fits)).toBe(fits);
    // La borne suit l'unité, et `from` ne passe jamais sous zéro ni au-delà de `to`.
    expect(clampHistoryWindow({ ...wide, timeframe: 2 }).from).toBe(NOW_S - (HISTORY_MAX_BARS - 1) * 120);
    expect(clampHistoryWindow({ instrument: 'NQ 12-26', timeframe: 1, from: 0, to: 30 })).toEqual({ instrument: 'NQ 12-26', timeframe: 1, from: 0, to: 30 });
    const huge = clampHistoryWindow({ instrument: 'NQ 12-26', timeframe: 1_000_000, from: 0, to: NOW_S });
    expect(huge.from).toBe(0);
  });

  it('cinq jours en 1 minute : l’AddOn ne reçoit qu’une fenêtre bornée, le lien reste vivant', async () => {
    const { server, asked } = await serve();
    const reply = await server.history({ instrument: 'NQ 12-26', timeframe: 1, from: NOW_S - 5 * DAY, to: NOW_S });
    expect(asked).toEqual([{ instrument: 'NQ 12-26', timeframe: 1, from: NOW_S - (HISTORY_MAX_BARS - 1) * 60, to: NOW_S }]);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.bars.length).toBeGreaterThan(1_900);
    expect(reply.bars.length).toBeLessThanOrEqual(HISTORY_MAX_BARS);
    await sleep(40);
    expect(server.status().link).toBe('live');
  });

  it('un ordre en vol n’est plus perdu avec l’historique : il reçoit sa réponse', async () => {
    const { server, ws } = await serve();
    // L'AddOn répond à l'ordre après l'historique, comme sa boucle unique le fait.
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string };
      if (msg.method === 'order.submit') setTimeout(() => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { orderId: 'ord-1' } })), 60);
    });
    const order = server.submit({ account: 'Sim101', instrument: 'NQ 12-26', action: 'Buy', quantity: 1, type: 'Market', tag: 'canto-test' });
    const history = server.history({ instrument: 'NQ 12-26', timeframe: 1, from: NOW_S - 5 * DAY, to: NOW_S });
    await expect(history).resolves.toMatchObject({ ok: true });
    await expect(order).resolves.toMatchObject({ ok: true, orderId: 'ord-1' });
    expect(server.status().link).toBe('live');
  });

  it('une trame au-delà du plafond coupe toujours le lien, et le journal en dit la cause', async () => {
    const { server, ws, lines, closed } = await serve();
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: 1, pad: 'x'.repeat(MAX_FRAME_BYTES) } }));
    expect(await closed).toBe(1009);
    await sleep(20);
    expect(server.status().link).toBe('lost');
    expect(lines.some((line) => line.includes('pont perdu (trame trop grande'))).toBe(true);
  });
});

describe('SEC1.4 Visual demande au pont une fenêtre qu’il sait tenir', () => {
  const NOW_MS = NOW_S * 1000;

  it('la même borne des deux côtés du pont', () => {
    expect(VISUAL_MAX_BARS).toBe(HISTORY_MAX_BARS);
  });

  it('cinq jours quand l’unité le permet, sinon les 2 000 dernières barres', () => {
    expect(historyWindow(NOW_MS, 5)).toEqual({ from: NOW_S - HISTORY_DAYS * DAY, to: NOW_S });
    expect(historyWindow(NOW_MS, 15)).toEqual({ from: NOW_S - HISTORY_DAYS * DAY, to: NOW_S });
    expect(historyWindow(NOW_MS, 1)).toEqual({ from: NOW_S - (HISTORY_MAX_BARS - 1) * 60, to: NOW_S });
    expect(historyWindow(NOW_MS, 2)).toEqual({ from: NOW_S - (HISTORY_MAX_BARS - 1) * 120, to: NOW_S });
    // Ce que Visual demande, le process principal ne le rogne pas : les deux bornes disent la même fenêtre.
    for (const timeframe of [1, 2, 3, 5, 15, 60]) {
      const asked = { instrument: 'NQ 12-26', timeframe, ...historyWindow(NOW_MS, timeframe) };
      expect(clampHistoryWindow(asked)).toBe(asked);
    }
  });
});
