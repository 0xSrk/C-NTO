/**
 * Livre des ordres en cours du pont NinjaTrader. Pur : tourne dans le process principal (émis vers
 * `dist-electron/execution/orderBook.js` par `electron/tsconfig.sources.json`) et dans les tests.
 *
 * L'AddOn 2.2.0 envoie `bridge.order` à chaque `Account.OrderUpdate` : l'ordre entier (compte,
 * identifiant, instrument, action, type, quantité totale, état NinjaTrader, `Order.Name` en tag, prix
 * limite et stop s'ils sont posés). Ni quantité remplie, ni prix moyen, ni instantané des ordres à la
 * connexion : un ordre posé avant la connexion du pont, ou changé pendant une coupure, échappe au
 * livre. Il le dit (`complete: false`) tant qu'aucun état complet n'est chargé (`restore`).
 */
import { AGENT_ORDER_TAG } from '../agent/orders';

/** États NinjaTrader sans retour : l'ordre quitte le livre actif (même liste que `IsTerminal` de l'AddOn). */
export const TERMINAL_ORDER_STATES: readonly string[] = ['Filled', 'Cancelled', 'Rejected'];
/** Derniers ordres terminés gardés, du plus récent au plus ancien. */
export const ORDER_HISTORY_MAX = 20;
/** Au-delà, les plus anciens ordres actifs sont oubliés et le livre se dit incomplet. */
export const ACTIVE_ORDERS_MAX = 500;

export type BookLink = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';

/** Mise à jour d'ordre telle que le port d'exécution la rend (`OrderUpdate`). */
export interface OrderBookUpdate {
  account: string;
  orderId: string;
  instrument: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stopLimit';
  /** Quantité totale de l'ordre (l'AddOn 2.2.0 n'envoie pas la quantité remplie). */
  qty: number;
  /** État NinjaTrader tel quel (`Submitted`, `Accepted`, `Working`, `PartFilled`, `Filled`…). */
  state: string;
  limit?: number;
  stop?: number;
  tag?: string;
}

export interface BookOrder extends OrderBookUpdate {
  /** Tag `canto-agent` : ordre proposé par un agent et confirmé par le trader. */
  byAgent: boolean;
  terminal: boolean;
  /** Première mise à jour reçue (epoch ms). */
  since: number;
  /** Dernière mise à jour reçue (epoch ms). */
  updatedAt: number;
}

/** Changement d'état d'un ordre : `previousState` nul pour un ordre vu pour la première fois. */
export interface OrderChange {
  order: BookOrder;
  previousState: string | null;
}

export interface OrderBookView {
  link: BookLink;
  /**
   * Instant jusqu'où le livre suit le flux de l'AddOn sans coupure : maintenant tant que le lien est
   * vivant, l'instant de la coupure sinon, `null` si le pont n'a jamais été en ligne.
   */
  asOf: number | null;
  /** Vrai seulement après un état complet (`restore`) sans coupure depuis. Toujours faux avec l'AddOn 2.2.0. */
  complete: boolean;
  /** Ordres actifs, du plus ancien au plus récent. `unconfirmed` : vu avant la dernière coupure, sans nouvelle depuis. */
  active: (BookOrder & { unconfirmed: boolean })[];
  /** Derniers ordres terminés (rempli, annulé, rejeté), du plus récent au plus ancien. */
  terminal: BookOrder[];
}

export function isTerminalOrderState(state: string): boolean {
  return TERMINAL_ORDER_STATES.includes(state);
}

function keyOf(order: { account: string; orderId: string }): string {
  return `${order.account}\u0000${order.orderId}`;
}

function flowing(link: BookLink): boolean {
  return link === 'live' || link === 'stale';
}

export class OrderBook {
  private readonly active = new Map<string, BookOrder>();
  private history: BookOrder[] = [];
  private link: BookLink = 'absent';
  private complete = false;
  private everLive = false;
  /** Instant où le flux s'est interrompu (lien ni `live` ni `stale`), `null` s'il coule. */
  private downSince: number | null = null;
  /** Instant où le flux a repris pour la dernière fois. */
  private resumedAt = 0;

  /**
   * Applique une mise à jour. Le livre garde toujours les derniers champs reçus ; le retour n'est
   * non nul que si l'état change (ordre nouveau ou état différent).
   */
  apply(update: OrderBookUpdate, at: number): OrderChange | null {
    const key = keyOf(update);
    const before = this.active.get(key) ?? this.history.find((row) => keyOf(row) === key);
    const terminal = isTerminalOrderState(update.state);
    const order: BookOrder = {
      account: update.account,
      orderId: update.orderId,
      instrument: update.instrument,
      side: update.side,
      type: update.type,
      qty: update.qty,
      state: update.state,
      ...(update.limit !== undefined ? { limit: update.limit } : {}),
      ...(update.stop !== undefined ? { stop: update.stop } : {}),
      ...(update.tag !== undefined ? { tag: update.tag } : {}),
      byAgent: update.tag === AGENT_ORDER_TAG,
      terminal,
      since: before?.since ?? at,
      updatedAt: at,
    };
    if (before?.terminal) this.history = this.history.filter((row) => keyOf(row) !== key);
    if (terminal) {
      this.active.delete(key);
      this.history = [order, ...this.history].slice(0, ORDER_HISTORY_MAX);
    } else {
      this.active.set(key, order);
      this.trim();
    }
    if (before && before.state === order.state) return null;
    return { order, previousState: before?.state ?? null };
  }

  /** État du lien du pont. Toute interruption du flux rend le livre incomplet. */
  setLink(link: BookLink, at: number): void {
    if (flowing(link)) {
      if (!this.everLive || this.downSince !== null) this.resumedAt = at;
      this.everLive = true;
      this.downSince = null;
    } else {
      this.complete = false;
      if (this.everLive && this.downSince === null) this.downSince = at;
    }
    this.link = link;
  }

  /**
   * État complet des ordres (un instantané de l'AddOn) : remplace le livre actif, garde l'historique.
   * L'AddOn 2.2.0 n'en envoie pas ; sans lui, le livre reste incomplet.
   */
  restore(orders: readonly OrderBookUpdate[], at: number): void {
    const listed = new Set(orders.map(keyOf));
    for (const key of [...this.active.keys()]) if (!listed.has(key)) this.active.delete(key);
    for (const update of orders) this.apply(update, at);
    this.complete = flowing(this.link) && this.active.size <= ACTIVE_ORDERS_MAX;
  }

  view(now: number, account?: string): OrderBookView {
    const mine = (order: BookOrder) => !account || order.account === account;
    return {
      link: this.link,
      asOf: flowing(this.link) ? now : this.downSince,
      complete: this.complete,
      active: [...this.active.values()]
        .filter(mine)
        .sort((a, b) => a.since - b.since)
        .map((order) => ({ ...order, unconfirmed: order.updatedAt < this.resumedAt })),
      terminal: this.history.filter(mine),
    };
  }

  private trim(): void {
    if (this.active.size <= ACTIVE_ORDERS_MAX) return;
    const oldest = [...this.active.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of oldest.slice(0, this.active.size - ACTIVE_ORDERS_MAX)) this.active.delete(key);
    this.complete = false;
  }
}
