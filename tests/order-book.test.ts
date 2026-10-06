import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ORDER_HISTORY_MAX, OrderBook, type OrderBookUpdate, type OrderChange } from '@/engine/execution/orderBook';
import { Nt8ExecutionPort } from '../electron/nt-bridge/execution-port';
import { OrderBookHost } from '../electron/nt-bridge/order-book-host';
import { NtBridgeServer } from '../electron/nt-bridge/server';

const order = (over: Partial<OrderBookUpdate> = {}): OrderBookUpdate => ({
  account: 'Sim101',
  orderId: 'o1',
  instrument: 'MNQ 12-26',
  side: 'buy',
  type: 'limit',
  qty: 2,
  state: 'Submitted',
  limit: 21_000,
  tag: 'Entry',
  ...over,
});

describe('livre des ordres en cours', () => {
  it('transitions : actif jusqu’à l’état terminal, un changement par état', () => {
    const book = new OrderBook();
    book.setLink('live', 1_000);
    const changes: [string | null, string][] = [];
    for (const [state, at] of [
      ['Submitted', 1_100],
      ['Accepted', 1_200],
      ['Accepted', 1_250],
      ['Working', 1_300],
      ['PartFilled', 1_400],
    ] as const) {
      const change = book.apply(order({ state }), at);
      if (change) changes.push([change.previousState, change.order.state]);
    }
    expect(changes).toEqual([
      [null, 'Submitted'],
      ['Submitted', 'Accepted'],
      ['Accepted', 'Working'],
      ['Working', 'PartFilled'],
    ]);
    const working = book.view(2_000);
    expect(working.active).toHaveLength(1);
    expect(working.active[0]).toMatchObject({ orderId: 'o1', state: 'PartFilled', since: 1_100, updatedAt: 1_400, terminal: false, byAgent: false, unconfirmed: false, limit: 21_000 });

    expect(book.apply(order({ state: 'Filled' }), 1_500)?.previousState).toBe('PartFilled');
    expect(book.apply(order({ state: 'Filled' }), 1_510)).toBeNull();
    book.apply(order({ orderId: 'o2', state: 'Working' }), 1_600);
    book.apply(order({ orderId: 'o2', state: 'Cancelled' }), 1_700);
    book.apply(order({ orderId: 'o3', state: 'Rejected' }), 1_800);
    const done = book.view(2_000);
    expect(done.active).toEqual([]);
    expect(done.terminal.map((o) => [o.orderId, o.state, o.terminal])).toEqual([
      ['o3', 'Rejected', true],
      ['o2', 'Cancelled', true],
      ['o1', 'Filled', true],
    ]);
  });

  it('historique court : les derniers terminaux seulement, du plus récent au plus ancien', () => {
    const book = new OrderBook();
    book.setLink('live', 0);
    for (let i = 0; i < ORDER_HISTORY_MAX + 5; i++) book.apply(order({ orderId: `f${i}`, state: 'Filled' }), i + 1);
    const terminal = book.view(1_000).terminal;
    expect(terminal).toHaveLength(ORDER_HISTORY_MAX);
    expect(terminal[0]?.orderId).toBe(`f${ORDER_HISTORY_MAX + 4}`);
  });

  it('reconnexion : incomplet tant qu’aucun état complet n’est connu, ordres d’avant la coupure non confirmés', () => {
    const book = new OrderBook();
    expect(book.view(0)).toMatchObject({ link: 'absent', asOf: null, complete: false, active: [], terminal: [] });
    book.setLink('connecting', 900);
    book.setLink('live', 1_000);
    // L'AddOn 2.2.0 n'envoie pas d'instantané : un ordre posé avant la connexion échappe au livre.
    expect(book.view(1_500)).toMatchObject({ link: 'live', asOf: 1_500, complete: false });
    book.restore([order({ state: 'Working' })], 1_100);
    expect(book.view(1_500).complete).toBe(true);
    // Battement en retard, socket ouverte : rien n'est perdu.
    book.setLink('stale', 1_200);
    book.setLink('live', 1_300);
    expect(book.view(1_500).complete).toBe(true);

    book.setLink('lost', 2_000);
    expect(book.view(2_500)).toMatchObject({ link: 'lost', asOf: 2_000, complete: false });
    book.setLink('connecting', 3_000);
    book.setLink('live', 3_100);
    const back = book.view(3_500);
    expect(back).toMatchObject({ link: 'live', asOf: 3_500, complete: false });
    expect(back.active[0]).toMatchObject({ orderId: 'o1', state: 'Working', unconfirmed: true });

    // Une mise à jour après la reprise confirme l'ordre ; le livre reste incomplet.
    expect(book.apply(order({ state: 'Working', limit: 21_010 }), 3_200)).toBeNull();
    expect(book.view(3_500).active[0]).toMatchObject({ unconfirmed: false, limit: 21_010 });
    expect(book.view(3_500).complete).toBe(false);
    book.restore([], 3_300);
    expect(book.view(3_500)).toMatchObject({ complete: true, active: [] });
  });

  it('ordre tagué canto-agent reconnu ; filtre par compte', () => {
    const book = new OrderBook();
    book.setLink('live', 0);
    book.apply(order({ orderId: 'a1', tag: 'canto-agent' }), 10);
    book.apply(order({ orderId: 'm1', account: 'Sim102', tag: 'Entry' }), 20);
    book.apply(order({ orderId: 'c1', tag: 'canto-cpy' }), 30);
    book.apply(order({ orderId: 'n1', tag: undefined }), 40);
    expect(book.view(100).active.map((o) => [o.orderId, o.byAgent])).toEqual([
      ['a1', true],
      ['m1', false],
      ['c1', false],
      ['n1', false],
    ]);
    expect(book.view(100, 'Sim102').active.map((o) => o.orderId)).toEqual(['m1']);
  });
});

describe('livre des ordres dans le process principal', () => {
  const servers: NtBridgeServer[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('les trames bridge.order de l’AddOn 2.2.0 alimentent le livre, un changement par état', async () => {
    const sink: { port?: Nt8ExecutionPort } = {};
    const server = new NtBridgeServer({
      token: 'jeton-livre',
      port: 0,
      onOrder: (notice) => sink.port?.ingestOrder(notice),
      onStatus: () => sink.port?.ingestLink(server.status().link),
    });
    servers.push(server);
    const port = new Nt8ExecutionPort(server);
    sink.port = port;
    const changes: OrderChange[] = [];
    const host = new OrderBookHost(port, (change) => changes.push(change));
    const bound = await server.start();
    expect(host.view()).toMatchObject({ link: 'absent', asOf: null, complete: false });

    const ws = new WebSocket(`ws://127.0.0.1:${bound}/?token=jeton-livre`);
    sockets.push(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 } }));
    // Charge exacte de `OnOrderUpdate` (CantoBridge.cs 2.2.0) : état NinjaTrader, `Order.Name` en tag.
    const notice = (state: string) =>
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.order', params: { account: 'Sim101', orderId: 'nt-7', instrument: 'MNQ 12-26', action: 'Buy', type: 'Limit', quantity: 1, state, tag: 'canto-agent', limitPrice: 21_000.25 } }));
    for (const state of ['Submitted', 'Accepted', 'Accepted', 'Working']) notice(state);
    await waitFor(() => changes.length === 3);
    const live = host.view();
    expect(live.link).toBe('live');
    expect(live.complete).toBe(false);
    expect(live.active).toEqual([
      expect.objectContaining({ account: 'Sim101', orderId: 'nt-7', instrument: 'MNQ 12-26', side: 'buy', type: 'limit', qty: 1, state: 'Working', limit: 21_000.25, tag: 'canto-agent', byAgent: true }),
    ]);
    notice('Filled');
    await waitFor(() => changes.length === 4);
    expect(changes.map((c) => c.order.state)).toEqual(['Submitted', 'Accepted', 'Working', 'Filled']);
    expect(host.view().active).toEqual([]);
    expect(host.view().terminal[0]).toMatchObject({ orderId: 'nt-7', state: 'Filled', byAgent: true });
    host.dispose();
  });
});

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
