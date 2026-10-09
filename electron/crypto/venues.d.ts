/**
 * Types du module émis vers `dist-electron/crypto/venues.js`.
 * L'implémentation est `src/engine/crypto/venues.ts`.
 */
import type { CryptoBar, CryptoSeriesId, CryptoTicker, CryptoTimeframe, CryptoTrade, CryptoVenue } from './markets';

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

/**
 * Le flux WebSocket public de la venue, en `wss:` (Binance sur le port 9443). Venue inconnue : chaîne vide, que
 * `cryptoHostAllowed` refuse.
 */
export function wsUrl(venue: CryptoVenue): string;
/** Les liquidations de tous les perps USDT de Binance : un flux à part, pour la température du marché. */
export const FORCE_ORDER_URL: 'wss://fstream.binance.com/ws/!forceOrder@arr';
/** Le funding de tous les perps USDT de Binance, en un appel. */
export const PREMIUM_INDEX_URL: 'https://fapi.binance.com/fapi/v1/premiumIndex';
/** La variation sur 24 h de toutes les paires spot de Binance, en un appel. */
export const TICKER_24H_URL: 'https://api.binance.com/api/v3/ticker/24hr';
/** L'open interest horaire de BTC ou d'ETH sur Binance : 25 points, de quoi lire la variation sur 24 h. */
export function openInterestUrl(symbol: 'BTCUSDT' | 'ETHUSDT'): string;
/**
 * Les clés de flux d'une série, dans la langue de sa venue : Coinbase `canal:produit` plus `heartbeat:produit`,
 * Binance `symbole@flux` (symbole en minuscules, `kline_<intervalle>` pour les bougies), Bybit `topic.symbole`.
 * Coinbase et Bybit n'ont pas de flux de bougies : `bars` leur donne les trades, et le timeframe ne change pas la clé.
 * Série ou genre inconnus, ou bougies Binance sans timeframe du registre : aucune clé.
 */
export function streamKeys(series: CryptoSeriesId, kind: 'ticker' | 'bars', timeframe?: CryptoTimeframe): string[];
/**
 * Le message JSON qui abonne (`on`) ou désabonne la socket d'une venue des flux `keys` : Coinbase
 * `{ type, channels: [{ name, product_ids }] }` (canaux regroupés), Binance `{ method, params, id }`, Bybit
 * `{ op, args }` (sans identifiant). Venue inconnue : chaîne vide.
 */
export function subscribeMessage(venue: CryptoVenue, keys: readonly string[], on: boolean, id: number): string;
/**
 * Ce qu'un message de flux donne : un ticker, un trade (`aggressor` est le côté qui a pris la liquidité), une
 * bougie Binance entière (`final` : elle est close), la preuve de vie de la socket, l'erreur de la venue, ou rien.
 */
export type WsParsed =
  | { kind: 'ticker'; ticker: CryptoTicker }
  | { kind: 'trade'; trade: CryptoTrade }
  | { kind: 'kline'; series: CryptoSeriesId; timeframe: CryptoTimeframe; bar: CryptoBar; final: boolean }
  | { kind: 'heartbeat' }
  | { kind: 'error'; detail: string }
  | { kind: 'ignored' };
/**
 * Lit un message de flux, le texte JSON tel que la socket le livre. Ne lève jamais et ne rend jamais de tableau
 * vide : un texte illisible ou coupé, une venue ou un type inconnus, un symbole hors du registre, un côté qui n'est
 * pas celui de la venue, un nombre non fini donnent `[{ kind: 'ignored' }]` ; un message de trades porte un trade par
 * ligne valide. Les acquittements d'abonnement ne donnent rien, `heartbeat` est la preuve de vie.
 */
export function parseWsMessage(venue: CryptoVenue, raw: string): WsParsed[];
