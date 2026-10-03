import { afterEach, describe, expect, it } from 'vitest';
import { importCsvAuto } from '@/engine/import';
import { executionPayloadToCsv } from '../electron/nt-bridge/execution-csv';
import { Nt8ExecutionPort } from '../electron/nt-bridge/execution-port';
import type { ExecutionPayload } from '../electron/nt-bridge/protocol';
import { NtBridgeServer, type NtMarketEvent } from '../electron/nt-bridge/server';
import WebSocket from 'ws';

const TOKEN = 'jeton-e2e';

function execution(partial: Partial<ExecutionPayload> & Pick<ExecutionPayload, 'id' | 'action' | 'price' | 'time'>): ExecutionPayload {
  return {
    instrument: 'MNQ 12-26',
    quantity: 1,
    entryExit: partial.action === 'Buy' ? 'Entry' : 'Exit',
    position: '-',
    orderId: 'ord',
    name: 'canto-e2e',
    commission: 0.5,
    rate: 1,
    account: 'Sim101',
    connection: 'Simulated',
    ...partial,
  };
}

describe('pont NT8 de bout en bout', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('bars, ordre Sim101, exécution, trade, kill switch < 200 ms', async () => {
    const market: NtMarketEvent[] = [];
    const csvRows: ExecutionPayload[] = [];
    const server = new NtBridgeServer({
      token: TOKEN,
      port: 0,
      onMarket: (event) => market.push(event),
      onExecution: (payload) => csvRows.push(payload),
    });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { instrument?: string; timeframe?: number; account?: string; tag?: string } };
      if (msg.method === 'marketdata.subscribe' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { subscriptionId: 'bars-1' } }));
        for (const time of [1_700_000_000, 1_700_000_300, 1_700_000_600]) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'marketdata.bar',
            params: { instrument: 'MNQ 12-26', timeframe: 5, bar: { time, open: 1, high: 2, low: 1, close: 2, volume: 3 }, final: true },
          }));
        }
      }
      if (msg.method === 'order.submit' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { orderId: 'nt-77', latencyMs: 1 } }));
        const fill = execution({ id: 'ex-exit', action: 'Sell', price: 21010, time: Date.parse('2026-09-26T15:33:02.000Z'), orderId: 'nt-77', name: msg.params?.tag ?? '' });
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.execution', params: { Instrument: fill.instrument, Action: fill.action, Quantity: fill.quantity, Price: fill.price, Time: fill.time, ID: fill.id, 'E/X': 'Exit', Account: fill.account, Name: fill.name, Commission: fill.commission, Rate: fill.rate, Connection: fill.connection, 'Order ID': fill.orderId } }));
      }
      if (msg.method === 'order.flatten' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { closed: 1 } }));
      }
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1.5', addonVersion: 'fake', accounts: ['Sim101'], protocol: 1 } }));
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: Date.now() } }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(server.status().link).toBe('live');

    const sub = await server.subscribe({ instrument: 'MNQ 12-26', kind: 'bars', timeframe: 5 });
    expect(sub.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const bars = market.filter((event) => event.kind === 'bar');
    expect(bars).toHaveLength(3);

    const entry = execution({ id: 'ex-entry', action: 'Buy', price: 21000, time: Date.parse('2026-09-26T15:31:02.000Z') });
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.execution', params: { Instrument: entry.instrument, Action: entry.action, Quantity: entry.quantity, Price: entry.price, Time: entry.time, ID: entry.id, 'E/X': 'Entry', Account: entry.account, Commission: 0.5, Rate: 1, Connection: 'Simulated' } }));
    const submitted = await server.submit({ account: 'Sim101', instrument: 'MNQ 12-26', action: 'Sell', quantity: 1, type: 'Market', tag: 'canto-e2e' });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.orderId).toBe('nt-77');
    await new Promise((resolve) => setTimeout(resolve, 40));

    const imported = importCsvAuto(executionPayloadToCsv(csvRows), { source: 'ninjatrader' });
    expect(imported.trades).toHaveLength(1);
    expect(imported.trades[0]?.account).toBe('Sim101');

    const started = performance.now();
    const killed = server.killSwitch();
    expect(performance.now() - started).toBeLessThan(200);
    expect(killed.accounts).toEqual(['Sim101']);
    ws.close();
  });

  it('un ordre du port arrive à l’AddOn factice et le fill ressort', async () => {
    const sink: { port?: Nt8ExecutionPort } = {};
    const server = new NtBridgeServer({
      token: TOKEN,
      port: 0,
      onExecution: (payload) => sink.port?.ingestExecution(payload),
    });
    servers.push(server);
    const bound = await server.start();
    const port = new Nt8ExecutionPort(server);
    sink.port = port;
    const fills: string[] = [];
    port.subscribe((event) => {
      if (event.kind === 'fill') fills.push(event.fill.executionId);
    });
    const seen: { tag?: string; account?: string }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${bound}/?token=${TOKEN}`);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { tag?: string; account?: string } };
      if (msg.method === 'order.submit' && msg.id !== undefined) {
        seen.push(msg.params ?? {});
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { orderId: 'nt-port' } }));
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'bridge.execution',
          params: { Instrument: 'MNQ 12-26', Action: 'Buy', Quantity: 1, Price: 21000, Time: Date.now(), ID: 'ex-port', Account: 'Sim101', Commission: 0, Rate: 1, Connection: 'Simulated' },
        }));
      }
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1', addonVersion: 'fake', accounts: ['Sim101'], protocol: 1 } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const ack = await port.submit({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', tag: 'canto-e2e' });
    expect(ack.ok).toBe(true);
    expect(seen[0]).toMatchObject({ account: 'Sim101', tag: 'canto-e2e' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fills).toEqual(['ex-port']);
    const blocked = await port.submit({ account: 'APEX-50K', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', tag: 'canto-e2e' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(-32010);
    ws.close();
  });
});
