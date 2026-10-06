import { describe, expect, it, vi } from 'vitest';
import type { OrderBookView, OrderChange } from '@/engine/execution/orderBook';
import { INCOMPLETE_BOOK, ordersPanel, watchOrders } from '@/modules/metrique/liveOrders';

const order = {
  account: 'Sim101',
  orderId: 'ord-1',
  instrument: 'MNQ 12-26',
  side: 'buy' as const,
  type: 'limit' as const,
  qty: 1,
  state: 'Working',
  byAgent: true,
  terminal: false,
  since: 1,
  updatedAt: 2,
  unconfirmed: false,
};

const view: OrderBookView = {
  link: 'live',
  asOf: 2,
  complete: false,
  active: [order],
  terminal: [],
};

describe('A13.2 ordres en cours', () => {
  it('marque le livre incomplet et les ordres de l’agent, sans action', () => {
    const panel = ordersPanel(view);
    expect(panel?.incomplete).toBe(INCOMPLETE_BOOK[0]);
    expect(panel?.rows).toEqual([{ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, state: 'Working', byAgent: true }]);
    expect(JSON.stringify(panel)).not.toMatch(/cancel|flatten|modifier|annuler/i);
    expect(ordersPanel({ ...view, complete: true })?.incomplete).toBeNull();
  });

  it('le démontage se désabonne', () => {
    const stops = vi.fn();
    let seen = false;
    const stop = watchOrders(
      {
        orders: async () => view,
        onOrder: (cb: (change: OrderChange) => void) => {
          seen = typeof cb === 'function';
          return stops;
        },
      },
      () => undefined,
    );
    expect(seen).toBe(true);
    stop();
    expect(stops).toHaveBeenCalledTimes(1);
  });
});
