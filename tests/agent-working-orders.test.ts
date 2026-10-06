import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderData } from '@/engine/agent/events';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind } from '@/engine/agent/tools';
import { OrderBook, type OrderBookUpdate } from '@/engine/execution/orderBook';
import type { ExecutionEvent, ExecutionPort } from '@/engine/execution/port';
import { OrderBookHost } from '../electron/nt-bridge/order-book-host';
import { fakePorts } from './helpers/deskPorts';

const T0 = Date.UTC(2026, 9, 6, 13, 0);

const update = (over: Partial<OrderBookUpdate>): OrderBookUpdate => ({ account: 'Sim101', orderId: 'nt-1', instrument: 'MNQ 12-26', side: 'buy', type: 'limit', qty: 1, state: 'Working', ...over });

function book(): OrderBook {
  const b = new OrderBook();
  b.setLink('live', T0);
  b.apply(update({ orderId: 'nt-1', limit: 21_000.25, tag: 'canto-agent' }), T0 + 1_000);
  b.apply(update({ orderId: 'nt-2', side: 'sell', type: 'stop', qty: 2, state: 'Accepted', stop: 20_950, tag: 'Stop1' }), T0 + 2_000);
  b.apply(update({ account: 'Sim102', orderId: 'nt-3', instrument: 'NQ 12-26', type: 'market', state: 'Filled', tag: 'canto-cpy' }), T0 + 3_000);
  return b;
}

describe('working_orders', () => {
  it('lecture seule ; sans pont dans le desk, le dire', async () => {
    expect(toolKind('working_orders')).toBe('read');
    const out = (await executeDeskTool(fakePorts(), 'working_orders', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(out.available).toBe(false);
    expect(typeof out.note).toBe('string');
  });

  it('ordres actifs, derniers terminaux, asOf, complete, byAgent ; orderId pour l’ordre de l’agent seulement', async () => {
    const b = book();
    const out = (await executeDeskTool(fakePorts({ workingOrders: async () => b.view(T0 + 5_000) }), 'working_orders', {}, { source: 'orch' })) as Record<string, any>;
    expect(out).toMatchObject({ link: 'live', asOf: new Date(T0 + 5_000).toISOString(), complete: false, account: null });
    expect(typeof out.note).toBe('string');
    expect(out.active).toEqual([
      {
        orderId: 'nt-1',
        account: 'Sim101',
        instrument: 'MNQ 12-26',
        side: 'buy',
        type: 'limit',
        qty: 1,
        state: 'Working',
        limit: 21_000.25,
        tag: 'canto-agent',
        byAgent: true,
        since: new Date(T0 + 1_000).toISOString(),
        updatedAt: new Date(T0 + 1_000).toISOString(),
      },
      { account: 'Sim101', instrument: 'MNQ 12-26', side: 'sell', type: 'stop', qty: 2, state: 'Accepted', stop: 20_950, tag: 'Stop1', byAgent: false, since: new Date(T0 + 2_000).toISOString(), updatedAt: new Date(T0 + 2_000).toISOString() },
    ]);
    expect(out.recent).toEqual([expect.objectContaining({ account: 'Sim102', state: 'Filled', byAgent: false })]);
    expect(out.recent[0].orderId).toBeUndefined();

    const sim102 = (await executeDeskTool(fakePorts({ workingOrders: async () => b.view(T0 + 5_000) }), 'working_orders', { account: 'Sim102' }, { source: 'llm' })) as Record<string, any>;
    expect(sim102.account).toBe('Sim102');
    expect(sim102.active).toEqual([]);
    expect(sim102.recent.map((o: { instrument: string }) => o.instrument)).toEqual(['NQ 12-26']);
  });

  it('après une coupure : asOf à la coupure, ordres d’avant marqués unconfirmed', async () => {
    const b = book();
    b.setLink('lost', T0 + 4_000);
    const lost = (await executeDeskTool(fakePorts({ workingOrders: async () => b.view(T0 + 9_000) }), 'working_orders', {}, { source: 'llm' })) as Record<string, any>;
    expect(lost).toMatchObject({ link: 'lost', asOf: new Date(T0 + 4_000).toISOString(), complete: false });
    b.setLink('live', T0 + 10_000);
    const back = (await executeDeskTool(fakePorts({ workingOrders: async () => b.view(T0 + 11_000) }), 'working_orders', {}, { source: 'llm' })) as Record<string, any>;
    expect(back.active.map((o: { unconfirmed?: boolean }) => o.unconfirmed)).toEqual([true, true]);
  });
});

describe('événement order', () => {
  it('données bornées ; identifiant pour l’ordre de l’agent seulement', () => {
    const agent = { order: { account: 'Sim101', orderId: 'nt-1', instrument: 'MNQ 12-26', side: 'buy', type: 'limit', qty: 1, state: 'Working', limit: 21_000, tag: 'canto-agent', byAgent: true, since: 1, updatedAt: 2 }, previousState: 'Accepted' };
    expect(orderData(agent)).toEqual({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'limit', state: 'Working', tag: 'canto-agent', byAgent: true, orderId: 'nt-1' });
    const manual = { order: { ...agent.order, orderId: 'nt-9', tag: 'x'.repeat(65), byAgent: false } };
    expect(orderData(manual)).toEqual({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'limit', state: 'Working', byAgent: false });
    expect(orderData({ order: { ...agent.order, state: '' } })).toBeNull();
    expect(orderData({ order: { ...agent.order, qty: Number.NaN } })).toBeNull();
    expect(orderData(null)).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('poussé une fois par changement d’état, depuis le livre du process principal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 3, 16, 0));
    const listeners = new Set<(event: ExecutionEvent) => void>();
    const port: ExecutionPort = {
      sourceId: 'test',
      capabilities: { submit: false, cancel: false, flatten: false, accounts: 'sim' },
      submit: async () => ({ ok: false, code: 0, message: '' }),
      cancel: async () => ({ ok: false, code: 0, message: '' }),
      flatten: async () => ({ ok: false, code: 0, message: '' }),
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      status: () => ({ state: 'live' }),
      dispose: () => listeners.clear(),
    };
    const emit = (state: string, limit = 21_000) => {
      for (const listener of listeners) listener({ kind: 'order', order: { account: 'Sim101', orderId: 'nt-1', instrument: 'MNQ 12-26', side: 'buy', type: 'limit', qty: 1, state, limit, tag: 'canto-agent' } });
    };
    const pushed: [string, { data: Record<string, unknown> }][] = [];
    let host: OrderBookHost | null = null;
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        orchestrator: { broadcast: (event: string, payload: never) => pushed.push([event, payload]) },
        ntbridge: {
          onExecution: () => () => {},
          // Le preload relaie `ntbridge:order-state` : ce que l'hôte du livre pousse.
          onOrder: (cb: (change: unknown) => void) => {
            host = new OrderBookHost(port, cb);
            return () => host?.dispose();
          },
        },
      },
    });
    vi.resetModules();
    const { useDeskEvents, deskEventLog } = await import('@/store/deskEvents');
    const stop = useDeskEvents.getState().start();
    expect(host).not.toBeNull();

    emit('Submitted');
    emit('Submitted');
    emit('Working');
    emit('Working', 21_010);
    emit('Filled');
    const orders = pushed.filter(([kind]) => kind === 'order');
    expect(orders.map(([, p]) => p.data.state)).toEqual(['Submitted', 'Working', 'Filled']);
    expect(orders[0]?.[1].data).toMatchObject({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'limit', tag: 'canto-agent', byAgent: true, orderId: 'nt-1' });
    expect(deskEventLog.read({ kinds: ['order'] }).events).toHaveLength(3);
    stop();
    expect(listeners.size).toBe(0);
  });
});
