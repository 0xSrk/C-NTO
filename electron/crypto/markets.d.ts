/**
 * Types du module émis vers `dist-electron/crypto/markets.js`.
 * L'implémentation est `src/engine/crypto/markets.ts`.
 */
export type CryptoVenue = 'coinbase' | 'binance' | 'bybit';
export type CryptoMarketId = 'coinbase:BTC-USD' | 'coinbase:ONDO-USD' | 'binance:ONEUSDT' | 'bybit:ZIGUSDT';
export type CryptoProxyId = 'binance:BTCUSDT' | 'binance:ONDOUSDT';
export type CryptoSeriesId = CryptoMarketId | CryptoProxyId;
export type VenueState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'blocked';
export const CRYPTO_TIMEFRAMES: readonly [1, 5, 15, 60, 240, 1440];
export type CryptoTimeframe = (typeof CRYPTO_TIMEFRAMES)[number];
export interface CryptoMarket {
  id: CryptoSeriesId;
  venue: CryptoVenue;
  symbol: string;
  base: string;
  quote: string;
  label: string;
  tickSize: number;
  precision: number;
  chartable: boolean;
  cvdProxy?: CryptoProxyId;
}
/** `time` : ouverture de la bougie, en secondes UTC. */
export interface CryptoBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume?: number;
}
/** `time` en millisecondes. */
export interface CryptoTicker {
  market: CryptoSeriesId;
  last: number;
  change24hPct: number | null;
  time: number;
}
/** `time` en millisecondes. */
export interface CryptoTrade {
  market: CryptoSeriesId;
  time: number;
  price: number;
  size: number;
  aggressor: 'buy' | 'sell';
}
export type CryptoFeedEvent =
  | { kind: 'ticker'; ticker: CryptoTicker }
  | { kind: 'bar'; series: CryptoSeriesId; timeframe: CryptoTimeframe; bar: CryptoBar; final: boolean };
export const CRYPTO_MARKETS: readonly CryptoMarket[];
export const CHARTABLE_MARKETS: readonly CryptoMarketId[];
export const DEFAULT_CRYPTO_MARKET: CryptoMarketId;
export const DEFAULT_CRYPTO_TIMEFRAME: CryptoTimeframe;
export const CRYPTO_HOSTS: readonly string[];
export function cryptoMarket(id: string): CryptoMarket | undefined;
export function isChartableMarket(v: unknown): v is CryptoMarketId;
export function isCryptoSeriesId(v: unknown): v is CryptoSeriesId;
export function isCryptoTimeframe(v: unknown): v is CryptoTimeframe;
export function cryptoHostAllowed(url: string, protocol: 'https:' | 'wss:'): boolean;
