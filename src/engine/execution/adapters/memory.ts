import type { AccountView, ExecutionEvent, ExecutionPort, Fill, LinkState, OrderAck, OrderRequest, Unsubscribe } from '../port';

/**
 * Double en mémoire : accuse réception, émet un fill sur demande.
 * Sert aux tests du port et du routeur, pas au pont NT8.
 */
export class MemoryExecutionPort implements ExecutionPort {
  readonly sourceId = 'memory';
  readonly capabilities = { submit: true, cancel: true, flatten: true, accounts: 'sim' as const };
  link: LinkState = 'live';
  private seq = 0;
  private readonly orders = new Map<string, OrderRequest>();
  private readonly listeners = new Set<(event: ExecutionEvent) => void>();

  async submit(order: OrderRequest): Promise<OrderAck> {
    if (!order.tag.trim()) return { ok: false, code: -32013, message: 'tag obligatoire' };
    if (!Number.isInteger(order.qty) || order.qty <= 0) return { ok: false, code: -32602, message: 'quantité invalide' };
    const orderId = `mem-${++this.seq}`;
    this.orders.set(orderId, order);
    this.emit({
      kind: 'order',
      order: {
        account: order.account,
        orderId,
        instrument: order.instrument,
        side: order.side,
        type: order.type,
        qty: order.qty,
        state: 'accepted',
        limit: order.limit,
        stop: order.stop,
        tag: order.tag,
      },
    });
    return { ok: true, orderId, latencyMs: 0 };
  }

  async cancel(account: string, orderId: string): Promise<{ ok: true } | { ok: false; code: number; message: string }> {
    const order = this.orders.get(orderId);
    if (!order || order.account !== account) return { ok: false, code: -32000, message: 'ordre inconnu' };
    this.orders.delete(orderId);
    this.emit({
      kind: 'order',
      order: {
        account,
        orderId,
        instrument: order.instrument,
        side: order.side,
        type: order.type,
        qty: order.qty,
        state: 'cancelled',
        tag: order.tag,
      },
    });
    return { ok: true };
  }

  async flatten(account: string): Promise<{ ok: true; closed: number } | { ok: false; code: number; message: string }> {
    let closed = 0;
    for (const [orderId, order] of this.orders) {
      if (order.account !== account) continue;
      this.orders.delete(orderId);
      closed += 1;
    }
    const accounts: AccountView[] = [{ name: account, positions: [] }];
    this.emit({ kind: 'accounts', accounts });
    return { ok: true, closed };
  }

  /** Le test déclenche le fill : l'adaptateur ne l'invente pas tout seul. */
  emitFill(fill: Fill): void {
    this.emit({ kind: 'fill', fill });
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
