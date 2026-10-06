/**
 * Dernière cotation reçue du pont NinjaTrader, par instrument. Pur : le renderer y range les
 * `marketdata.quote` que le process principal relaie. Rien ne s'abonne ici : sans abonnement aux
 * cotations (décision laissée à l'ADMIN), le livre reste vide et l'outil `market_quote` le dit.
 */
import { resolveSymbol } from '../instruments';

/** Au-delà, une cotation est signalée périmée (`stale`). */
export const QUOTE_STALE_MS = 10_000;
/** Instruments gardés au plus ; au-delà, le moins récemment coté sort. */
export const QUOTES_MAX = 200;

export interface LastQuote {
  /** Nom NinjaTrader complet (`MNQ 12-26`). */
  instrument: string;
  /** `null` : côté pas encore reçu (l'AddOn 2.2.0 envoie 0 avant la première mise à jour du côté). */
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Heure de la cotation selon l'AddOn (epoch ms). */
  time: number;
  /** Heure de réception par le desk (epoch ms) : l'âge se mesure d'ici. */
  receivedAt: number;
}

function price(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function norm(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

export class QuoteBook {
  private readonly rows = new Map<string, LastQuote>();

  /** Range une cotation (`{ instrument, time, bid, ask, last? }`). Une charge invalide est ignorée. */
  apply(raw: unknown, receivedAt: number): LastQuote | null {
    if (!raw || typeof raw !== 'object') return null;
    const q = raw as Record<string, unknown>;
    const instrument = typeof q.instrument === 'string' && q.instrument.trim() && q.instrument.length <= 64 ? q.instrument.trim() : null;
    const time = typeof q.time === 'number' && Number.isFinite(q.time) ? q.time : null;
    if (!instrument || time === null) return null;
    const row: LastQuote = { instrument, bid: price(q.bid), ask: price(q.ask), last: price(q.last), time, receivedAt };
    if (row.bid === null && row.ask === null && row.last === null) return null;
    const key = norm(instrument);
    this.rows.delete(key);
    this.rows.set(key, row);
    if (this.rows.size > QUOTES_MAX) {
      const oldest = [...this.rows.entries()].sort((a, b) => a[1].receivedAt - b[1].receivedAt)[0];
      if (oldest) this.rows.delete(oldest[0]);
    }
    return row;
  }

  all(): LastQuote[] {
    return [...this.rows.values()];
  }

  clear(): void {
    this.rows.clear();
  }
}

/**
 * Cotation d'un instrument : nom NinjaTrader exact d'abord ; sinon racine du registre (`MNQ`), avec ou
 * sans échéance, et alors le contrat coté le plus récemment. `null` si rien ne correspond.
 */
export function findQuote(rows: readonly LastQuote[], raw: string): LastQuote | null {
  const wanted = norm(raw);
  if (!wanted) return null;
  const exact = rows.find((row) => norm(row.instrument) === wanted);
  if (exact) return exact;
  const asked = resolveSymbol(wanted);
  if (!asked) return null;
  return (
    rows
      .filter((row) => {
        const got = resolveSymbol(row.instrument);
        return !!got && got.symbol === asked.symbol && (!asked.contractMonth || got.contractMonth === asked.contractMonth);
      })
      .sort((a, b) => b.receivedAt - a.receivedAt)[0] ?? null
  );
}
