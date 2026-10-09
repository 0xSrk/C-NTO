/**
 * Types du module émis vers `dist-electron/crypto/venues.js`.
 * L'implémentation est `src/engine/crypto/venues.ts`.
 */
import type { CryptoBar, CryptoSeriesId, CryptoTimeframe, CryptoVenue } from './markets';

/** Bougies demandées en un appel à Binance et à Bybit, et plafond de ce que l'historique rend. */
export const HISTORY_BARS: 500;
/**
 * Les URLs à interroger pour l'historique d'une série, de la page la plus récente à la plus ancienne, et le
 * regroupement à appliquer aux bougies lues : `aggregate` bougies de `timeframe / aggregate` minutes font une
 * bougie de `timeframe`. Série ou timeframe hors du registre, `nowSec` qui n'est pas une date : aucune URL.
 */
export function historyRequests(series: CryptoSeriesId, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number };
/**
 * Les bougies d'une réponse de venue (JSON décodé), par time croissant (secondes) et sans doublon. Une ligne courte
 * ou non finie est écartée. Lève seulement `Error(retMsg)` pour Bybit quand `retCode` n'est pas 0.
 */
export function parseCandles(venue: CryptoVenue, json: unknown): CryptoBar[];
/**
 * Seaux de `timeframe × factor × 60` secondes alignés sur l'epoch UTC. `timeframe` est celui des bougies reçues
 * (en minutes), `factor` leur nombre par bougie rendue : pour un historique de `historyRequests`,
 * `aggregateBars(bars, timeframe / aggregate, aggregate)`. Remet l'entrée en ordre et la dédoublonne.
 */
export function aggregateBars(bars: CryptoBar[], timeframe: CryptoTimeframe, factor: number): CryptoBar[];
