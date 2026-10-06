/**
 * Ordres en cours, lecture seule. Le process principal tient le livre ; l'écran le relit
 * et se désabonne au démontage. Aucune action (annuler, modifier).
 */

import type { OrderBookView, OrderChange } from '@/engine/execution/orderBook';

export const INCOMPLETE_BOOK = ['livre incomplet (AddOn 2.2.0)', 'incomplete book (AddOn 2.2.0)', 'libro incompleto (AddOn 2.2.0)'] as const;

export interface OrderRow {
  account: string;
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  state: string;
  byAgent: boolean;
}

export interface OrdersPanel {
  incomplete: string | null;
  rows: OrderRow[];
}

export function ordersPanel(view: OrderBookView | null): OrdersPanel | null {
  if (!view) return null;
  return {
    incomplete: view.complete ? null : INCOMPLETE_BOOK[0],
    rows: view.active.map((order) => ({
      account: order.account,
      instrument: order.instrument,
      side: order.side,
      qty: order.qty,
      state: order.state,
      byAgent: order.byAgent,
    })),
  };
}

export interface OrdersApi {
  orders?: () => Promise<OrderBookView | null>;
  onOrder?: (cb: (change: OrderChange) => void) => () => void;
}

/** Charge le livre et le tient à jour. Le retour se désabonne. */
export function watchOrders(api: OrdersApi | undefined, onView: (view: OrderBookView | null) => void): () => void {
  if (!api?.orders) return () => undefined;
  let dead = false;
  const load = () => {
    void api.orders!().then((view) => {
      if (!dead) onView(view);
    });
  };
  load();
  const stop = api.onOrder?.(() => load()) ?? (() => undefined);
  return () => {
    dead = true;
    stop();
  };
}
