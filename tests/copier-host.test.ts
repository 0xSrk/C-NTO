import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ExecutionEvent, ExecutionPort } from '@/engine/execution/port';
import { confirmCopierArm, CopierHost, copierArmDialog } from '../electron/nt-bridge/copier-host';
import { Nt8ExecutionPort } from '../electron/nt-bridge/execution-port';
import { NtBridgeHost } from '../electron/nt-bridge/index';
import { NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-copieur';

function sync(extra: Record<string, unknown> = {}) {
  return {
    masterAccount: 'Sim101',
    latencyBudgetMs: 60_000,
    newsBlackout: false,
    windowStart: '00:00',
    windowEnd: '23:59',
    followerBufferFloor: 0.3,
    flattenOnCut: false,
    maxContractsPerOrder: 20,
    catalysts: [],
    followers: [
      { account: 'Sim102', sizing: { mode: 'ratio', value: 1, maxContracts: 20 }, symbolMap: { mode: 'micro' } },
      { account: 'Sim103', sizing: { mode: 'fixe', value: 2, maxContracts: 20 }, symbolMap: { mode: 'identique' } },
    ],
    ...extra,
  };
}

describe('hôte de réplication', () => {
  const servers: NtBridgeServer[] = [];
  const hosts: { dispose(): void }[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const host of hosts.splice(0)) host.dispose();
    for (const socket of sockets.splice(0)) socket.close();
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('le dialogue d’armement annule par défaut', async () => {
    const fr = copierArmDialog('fr');
    expect(fr).toMatchObject({ type: 'warning', defaultId: 1, cancelId: 1, noLink: true });
    expect(fr.buttons).toEqual(['Armer la réplication', 'Annuler']);
    expect(copierArmDialog('en').buttons[0]).toBe('Arm replication');
    expect(copierArmDialog('es').buttons[0]).toBe('Armar la réplica');
    const logs: string[] = [];
    const refused = await confirmCopierArm({
      win: { isDestroyed: () => false },
      locale: 'fr',
      showMessageBox: async () => ({ response: 1 }),
      log: (line) => logs.push(line),
    });
    expect(refused).toBe(false);
    expect(logs).toEqual([]);
    const absent = await confirmCopierArm({
      win: null,
      locale: 'fr',
      showMessageBox: async () => ({ response: 0 }),
      log: () => {},
    });
    expect(absent).toBe(false);
  });

  it('fill Sim101 → Sim102 et Sim103, rejeu nul, blackout, Couper < 200 ms, redémarrage désarmé', async () => {
    const sink: { port?: Nt8ExecutionPort } = {};
    const server = new NtBridgeServer({
      token: TOKEN,
      port: 0,
      onExecution: (payload) => sink.port?.ingestExecution(payload),
      onOrder: (order) => sink.port?.ingestOrder(order),
      onAccounts: (accounts) => sink.port?.ingestAccounts(accounts),
      onStatus: () => sink.port?.ingestLink(server.status().link),
    });
    servers.push(server);
    const port = new Nt8ExecutionPort(server);
    sink.port = port;
    const bound = await server.start();
    const logs: string[] = [];
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-cpy-'));
    const host = new CopierHost(port, dir, (line) => logs.push(line));
    hosts.push(host);
    host.open();
    expect(host.status().armed).toBe(false);
    expect(host.configure(sync())).toBe(true);
    host.arm();

    const submits: { account?: string; quantity?: number; instrument?: string; tag?: string }[] = [];
    const cancels: { account?: string; orderId?: string }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${bound}/?token=${TOKEN}`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { account?: string; quantity?: number; instrument?: string; tag?: string; orderId?: string } };
      if (msg.method === 'order.submit' && msg.id !== undefined) {
        submits.push(msg.params ?? {});
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { orderId: `nt-${submits.length}` } }));
      }
      if (msg.method === 'order.cancel' && msg.id !== undefined) {
        cancels.push(msg.params ?? {});
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
      }
      if (msg.method === 'order.flatten' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { closed: 1 } }));
      }
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1', addonVersion: 'fake', accounts: ['Sim101', 'Sim102', 'Sim103'], protocol: 1 } }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.status().link).toBe('live');

    const sendFill = (id: string) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'bridge.execution',
        params: { Instrument: 'NQ 12-26', Action: 'Buy', Quantity: 1, Price: 21000, Time: Date.now(), ID: id, 'E/X': 'Entry', Account: 'Sim101', Commission: 0, Rate: 1, Connection: 'Simulated' },
      }));
    };
    sendFill('ex-1');
    await waitFor(() => host.status().routed === 2);
    expect(submits.map((row) => row.account).sort()).toEqual(['Sim102', 'Sim103']);
    expect(submits.find((row) => row.account === 'Sim102')).toMatchObject({ quantity: 10, instrument: 'MNQ 12-26', tag: 'canto-cpy' });
    expect(submits.find((row) => row.account === 'Sim103')).toMatchObject({ quantity: 2, instrument: 'NQ 12-26', tag: 'canto-cpy' });
    expect(logs.join('\n')).not.toMatch(/token|jeton/i);

    sendFill('ex-1');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(submits).toHaveLength(2);

    host.configure(sync({ newsBlackout: true, catalysts: [{ at: Date.now() }] }));
    sendFill('ex-blackout');
    await waitFor(() => logs.some((line) => line.includes('motif=blackout')));
    expect(submits).toHaveLength(2);

    const started = performance.now();
    const cut = host.cut();
    expect(performance.now() - started).toBeLessThan(200);
    expect(host.status().armed).toBe(false);
    expect(cut.cancelled).toHaveLength(2);
    await waitFor(() => cancels.length === 2);

    host.dispose();
    const restarted = new CopierHost(port, dir, (line) => logs.push(line));
    hosts.push(restarted);
    restarted.open();
    expect(restarted.status().armed).toBe(false);
    restarted.configure(sync());
    restarted.arm();
    const before = submits.length;
    sendFill('ex-1');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(submits.length).toBe(before);
  });
});

describe('Couper pendant un submit', () => {
  it('annule l’ordre qui revient après le désarmement', async () => {
    const gate: { listener: ((event: ExecutionEvent) => void) | null; release: ((ack: { ok: true; orderId: string }) => void) | null } = { listener: null, release: null };
    const cancels: string[] = [];
    const port: ExecutionPort = {
      sourceId: 'memory',
      capabilities: { submit: true, cancel: true, flatten: true, accounts: 'sim' },
      status: () => ({ state: 'live' }),
      subscribe(cb) {
        gate.listener = cb;
        return () => {
          gate.listener = null;
        };
      },
      submit() {
        return new Promise((resolve) => {
          gate.release = resolve;
        });
      },
      async cancel(_account, orderId) {
        cancels.push(orderId);
        return { ok: true };
      },
      async flatten() {
        return { ok: true, closed: 0 };
      },
      dispose() {},
    };
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-cut-'));
    const host = new CopierHost(port, dir, () => {});
    host.open();
    host.configure(sync());
    host.arm();
    gate.listener?.({
      kind: 'fill',
      fill: { account: 'Sim101', instrument: 'NQ', side: 'buy', qty: 1, price: 1, time: Date.now(), executionId: 'ex-race' },
    });
    await waitFor(() => gate.release !== null);
    host.cut();
    gate.release?.({ ok: true, orderId: 'late-1' });
    await waitFor(() => cancels.length === 1);
    expect(cancels).toEqual(['late-1']);
    expect(host.status().routed).toBe(0);
    expect(host.status().armed).toBe(false);
    host.dispose();
  });
});

describe('kill switch du pont', () => {
  const hosts: NtBridgeHost[] = [];
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.dispose()));
  });

  it('désarme le routeur', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-host-'));
    const host = new NtBridgeHost(dir, () => dir);
    hosts.push(host);
    await host.start();
    host.configureCopier(sync());
    host.armCopier();
    expect(host.copierStatus().armed).toBe(true);
    host.killSwitch();
    expect(host.copierStatus().armed).toBe(false);
  });
});

async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
