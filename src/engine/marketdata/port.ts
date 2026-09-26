import type { Bar } from '../bars';

/**
 * Temps : les barres restent en **epoch secondes UTC** (`Bar.time`).
 * `Quote` et `Tick` sont en **epoch millisecondes**, comme `Trade`.
 * On ne réécrit pas l'existant pour unifier les deux.
 *
 * Une barre `final: false` peut être remplacée par la suivante de même `time`.
 * `final: true` est immuable. Clé d'unicité côté Visual :
 * `(sourceId, instrument, timeframe, time)`.
 */

export type Timeframe = number;
export type FeedKind = 'bars' | 'quote' | 'tick';

export interface Quote {
  instrument: string;
  time: number;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
}

export interface Tick {
  instrument: string;
  time: number;
  price: number;
  size: number;
  side?: 'buy' | 'sell';
}

export interface HistoryRequest {
  instrument: string;
  timeframe: Timeframe;
  from: number;
  to: number;
  contractMonth?: string;
}

export interface SubscribeRequest {
  instrument: string;
  kind: FeedKind;
  timeframe?: Timeframe;
  contractMonth?: string;
}

export type FeedEvent =
  | { kind: 'bar'; instrument: string; timeframe: Timeframe; bar: Bar; final: boolean }
  | { kind: 'quote'; quote: Quote }
  | { kind: 'tick'; tick: Tick }
  | { kind: 'status'; state: 'connecting' | 'live' | 'stale' | 'closed' | 'error'; detail?: string };

export type Unsubscribe = () => void;

export interface MarketDataPort {
  /** Identifiant de la source dans `sources.ts` */
  readonly sourceId: string;
  readonly capabilities: { history: boolean; live: FeedKind[]; instruments: 'any' | string[] };
  history?(req: HistoryRequest): Promise<Bar[]>;
  subscribe?(req: SubscribeRequest, onEvent: (e: FeedEvent) => void): Unsubscribe;
  /** Libère connexions, timers, workers. Idempotent. */
  dispose(): void;
}

/** Tri et dédoublonnage par `time` : la dernière barre d'un même instant gagne. */
export function dedupeBars(bars: Bar[]): Bar[] {
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const out: Bar[] = [];
  for (const bar of sorted) {
    const last = out[out.length - 1];
    if (last && last.time === bar.time) out[out.length - 1] = bar;
    else out.push(bar);
  }
  return out;
}
