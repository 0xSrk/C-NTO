/** Types de `src/engine/execution/port.ts`. Import de type seulement : pas de JS émis. */
export type Unsubscribe = () => void;
export type OrderSide = 'buy' | 'sell';
export type OrderKind = 'market' | 'limit' | 'stop' | 'stopLimit';
export type LinkState = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
export interface OrderRequest {
  instrument: string;
  side: OrderSide;
  qty: number;
  type: OrderKind;
  limit?: number;
  stop?: number;
  oco?: string;
  tag: string;
  account: string;
}
export type OrderAck = { ok: true; orderId: string; latencyMs?: number } | { ok: false; code: number; message: string };
export interface Fill {
  account: string;
  instrument: string;
  side: OrderSide;
  qty: number;
  price: number;
  time: number;
  executionId: string;
  orderId?: string;
}
export interface OrderUpdate {
  account: string;
  orderId: string;
  instrument: string;
  side: OrderSide;
  type: OrderKind;
  qty: number;
  state: string;
  limit?: number;
  stop?: number;
  tag?: string;
}
export interface AccountView {
  name: string;
  positions: { instrument: string; qty: number; avgPrice: number }[];
}
export type ExecutionEvent =
  | { kind: 'fill'; fill: Fill }
  | { kind: 'order'; order: OrderUpdate }
  | { kind: 'accounts'; accounts: AccountView[] }
  | { kind: 'status'; state: LinkState; detail?: string };
export interface ExecutionPort {
  readonly sourceId: string;
  readonly capabilities: { submit: boolean; cancel: boolean; flatten: boolean; accounts: 'sim' | 'declared' };
  submit(order: OrderRequest): Promise<OrderAck>;
  cancel(account: string, orderId: string): Promise<{ ok: true } | { ok: false; code: number; message: string }>;
  flatten(account: string): Promise<{ ok: true; closed: number } | { ok: false; code: number; message: string }>;
  subscribe(onEvent: (event: ExecutionEvent) => void): Unsubscribe;
  status(): { state: LinkState };
  dispose(): void;
}
