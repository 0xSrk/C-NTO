/**
 * Livre des ordres en cours, tenu dans le process principal sur le port d'exécution du pont.
 * Lecture seule : il n'émet, n'annule ni ne modifie aucun ordre. Le renderer le lit par
 * `ntbridge:orders` et reçoit chaque changement d'état par `ntbridge:order-state`.
 */
import type { ExecutionPort } from '../execution/port';
import { OrderBook, type OrderBookView, type OrderChange } from '../execution/orderBook';

export class OrderBookHost {
  private readonly book = new OrderBook();
  private readonly unsubscribe: () => void;

  constructor(
    port: ExecutionPort,
    private readonly onChange: (change: OrderChange) => void = () => {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.book.setLink(port.status().state, this.now());
    this.unsubscribe = port.subscribe((event) => {
      if (event.kind === 'order') {
        const change = this.book.apply(event.order, this.now());
        if (change) this.onChange(change);
      } else if (event.kind === 'status') {
        this.book.setLink(event.state, this.now());
      }
    });
  }

  view(account?: string): OrderBookView {
    return this.book.view(this.now(), account);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
