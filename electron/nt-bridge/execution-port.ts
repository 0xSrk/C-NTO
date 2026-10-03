/**
 * `ExecutionPort` au-dessus de l'hôte NT8 déjà là.
 * `submit` → `order.submit`, `cancel` → `order.cancel`, `flatten` → `order.flatten`.
 * Aucun changement de `protocol.ts` ni de l'AddOn C#.
 */
import type { ExecutionEvent, ExecutionPort, Fill, LinkState, OrderAck, OrderKind, OrderRequest, OrderSide, OrderUpdate, Unsubscribe } from '../execution/port';
import type { AccountSnapshot, ExecutionPayload, OrderNotice } from './protocol';
import type { NtBridgeServer } from './server';

function sideOf(action: string): OrderSide | null {
  if (action === 'Buy' || action === 'BuyToCover') return 'buy';
  if (action === 'Sell' || action === 'SellShort') return 'sell';
  return null;
}

function kindOf(type: string): OrderKind {
  if (type === 'Limit') return 'limit';
  if (type === 'StopMarket') return 'stop';
  if (type === 'StopLimit') return 'stopLimit';
  return 'market';
}

function actionOf(side: OrderSide): 'Buy' | 'Sell' {
  return side === 'buy' ? 'Buy' : 'Sell';
}

function typeOf(kind: OrderKind): 'Market' | 'Limit' | 'StopMarket' | 'StopLimit' {
  if (kind === 'limit') return 'Limit';
  if (kind === 'stop') return 'StopMarket';
  if (kind === 'stopLimit') return 'StopLimit';
  return 'Market';
}

export function executionToFill(payload: ExecutionPayload): Fill | null {
  const side = sideOf(payload.action);
  if (!side || !payload.id) return null;
  return {
    account: payload.account,
    instrument: payload.instrument,
    side,
    qty: payload.quantity,
    price: payload.price,
    time: payload.time,
    executionId: payload.id,
    orderId: payload.orderId || undefined,
  };
}

export class Nt8ExecutionPort implements ExecutionPort {
  readonly sourceId = 'nt8';
  readonly capabilities = { submit: true, cancel: true, flatten: true, accounts: 'sim' as const };
  private link: LinkState;
  private readonly listeners = new Set<(event: ExecutionEvent) => void>();

  constructor(private readonly server: NtBridgeServer) {
    this.link = server.status().link;
  }

  ingestExecution(payload: ExecutionPayload): void {
    const fill = executionToFill(payload);
    if (fill) this.emit({ kind: 'fill', fill });
  }

  ingestOrder(notice: OrderNotice): void {
    const side = sideOf(notice.action) ?? 'buy';
    const order: OrderUpdate = {
      account: notice.account,
      orderId: notice.orderId,
      instrument: notice.instrument,
      side,
      type: kindOf(notice.type),
      qty: notice.quantity,
      state: notice.state,
      limit: notice.limitPrice,
      stop: notice.stopPrice,
      tag: notice.tag,
    };
    this.emit({ kind: 'order', order });
  }

  ingestAccounts(accounts: AccountSnapshot[]): void {
    this.emit({
      kind: 'accounts',
      accounts: accounts.map((account) => ({
        name: account.name,
        positions: account.positions.map((position) => ({ instrument: position.instrument, qty: position.quantity, avgPrice: position.avgPrice })),
      })),
    });
  }

  ingestLink(link: LinkState): void {
    this.link = link;
    this.emit({ kind: 'status', state: link });
  }

  async submit(order: OrderRequest): Promise<OrderAck> {
    const result = await this.server.submit({
      account: order.account,
      instrument: order.instrument,
      action: actionOf(order.side),
      quantity: order.qty,
      type: typeOf(order.type),
      limitPrice: order.limit,
      stopPrice: order.stop,
      oco: order.oco,
      tag: order.tag,
    });
    if (!result.ok) return result;
    return { ok: true, orderId: result.orderId, latencyMs: result.latencyMs };
  }

  cancel(account: string, orderId: string): Promise<{ ok: true } | { ok: false; code: number; message: string }> {
    return this.server.cancel(account, orderId);
  }

  flatten(account: string): Promise<{ ok: true; closed: number } | { ok: false; code: number; message: string }> {
    return this.server.flatten(account);
  }

  subscribe(onEvent: (event: ExecutionEvent) => void): Unsubscribe {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  status(): { state: LinkState } {
    return { state: this.link };
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(event: ExecutionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
