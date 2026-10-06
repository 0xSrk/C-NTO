/**
 * Types du module émis vers `dist-electron/execution/orderBook.js`.
 * L'implémentation est `src/engine/execution/orderBook.ts`.
 */
export const TERMINAL_ORDER_STATES: readonly string[];
export const ORDER_HISTORY_MAX: number;
export const ACTIVE_ORDERS_MAX: number;
export type BookLink = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
export interface OrderBookUpdate {
  account: string;
  orderId: string;
  instrument: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stopLimit';
  qty: number;
  state: string;
  limit?: number;
  stop?: number;
  tag?: string;
}
export interface BookOrder extends OrderBookUpdate {
  byAgent: boolean;
  terminal: boolean;
  since: number;
  updatedAt: number;
}
export interface OrderChange {
  order: BookOrder;
  previousState: string | null;
}
export interface OrderBookView {
  link: BookLink;
  asOf: number | null;
  complete: boolean;
  active: (BookOrder & { unconfirmed: boolean })[];
  terminal: BookOrder[];
}
export function isTerminalOrderState(state: string): boolean;
export class OrderBook {
  apply(update: OrderBookUpdate, at: number): OrderChange | null;
  setLink(link: BookLink, at: number): void;
  restore(orders: readonly OrderBookUpdate[], at: number): void;
  view(now: number, account?: string): OrderBookView;
}
