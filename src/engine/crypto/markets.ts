/**
 * Registre des marchés crypto, de leurs timeframes et de leurs hôtes : la seule liste, lue par le
 * renderer comme par le process principal (émis vers `dist-electron/crypto/markets.js` par
 * `electron/tsconfig.sources.json`). Fixé dans le code en v1 : quatre marchés affichables et les deux
 * séries Binance qui ne servent que de source au CVD (`docs/ONGLET-CRYPTO.md` § 5).
 * Aucun import : ce module tourne des deux côtés, et le process principal le compile seul.
 */

export type CryptoVenue = 'coinbase' | 'binance' | 'bybit';

/** Les quatre marchés que le chart affiche : les seuls à entrer dans la watchlist et à porter une alerte. */
export type CryptoMarketId = 'coinbase:BTC-USD' | 'coinbase:ONDO-USD' | 'binance:ONEUSDT' | 'bybit:ZIGUSDT';
/** Séries Binance qui ne servent que de source au CVD : jamais affichées, jamais en watchlist, sans alerte. */
export type CryptoProxyId = 'binance:BTCUSDT' | 'binance:ONDOUSDT';
export type CryptoSeriesId = CryptoMarketId | CryptoProxyId;

/** État d'une venue, tel que son voyant l'affiche. */
export type VenueState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'blocked';

/** Les six timeframes du chart, en minutes. */
export const CRYPTO_TIMEFRAMES = [1, 5, 15, 60, 240, 1440] as const;
export type CryptoTimeframe = (typeof CRYPTO_TIMEFRAMES)[number];

export interface CryptoMarket {
  id: CryptoSeriesId;
  venue: CryptoVenue;
  /** Symbole natif de la venue. */
  symbol: string;
  base: string;
  quote: string;
  label: string;
  /** Pas de prix, relevé dans les métadonnées de la venue le 9 octobre 2026. */
  tickSize: number;
  /** Décimales du pas de prix : celles de l'affichage. */
  precision: number;
  /** Vrai pour les quatre marchés que le chart affiche. */
  chartable: boolean;
  /** Série Binance dont le CVD complète ce marché. */
  cvdProxy?: CryptoProxyId;
}

/** Bougie : `time` est son ouverture, en secondes UTC. */
export interface CryptoBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Part du volume prise par les acheteurs agresseurs ; absente quand la source ne la donne pas. */
  buyVolume?: number;
}

/** Dernier prix d'une série : `time` est en millisecondes. */
export interface CryptoTicker {
  market: CryptoSeriesId;
  last: number;
  /** Variation sur 24 h, en pourcent ; `null` quand elle n'est pas connue. */
  change24hPct: number | null;
  time: number;
}

/** Transaction : `time` est en millisecondes, `aggressor` est le côté qui a pris la liquidité. */
export interface CryptoTrade {
  market: CryptoSeriesId;
  time: number;
  price: number;
  size: number;
  aggressor: 'buy' | 'sell';
}

/** Ce que le process principal pousse au renderer ; `final` : la bougie est close. */
export type CryptoFeedEvent =
  | { kind: 'ticker'; ticker: CryptoTicker }
  | { kind: 'bar'; series: CryptoSeriesId; timeframe: CryptoTimeframe; bar: CryptoBar; final: boolean };

/**
 * Les six séries, dans l'ordre du registre : les quatre marchés affichables, puis les deux sources du
 * CVD Binance. Les pas de prix viennent des métadonnées des exchanges (`quote_increment`,
 * `PRICE_FILTER.tickSize`, `priceFilter.tickSize`), relevées le 9 octobre 2026.
 */
export const CRYPTO_MARKETS: readonly CryptoMarket[] = [
  {
    id: 'coinbase:BTC-USD',
    venue: 'coinbase',
    symbol: 'BTC-USD',
    base: 'BTC',
    quote: 'USD',
    label: 'BTC-USD · Coinbase',
    tickSize: 0.01,
    precision: 2,
    chartable: true,
    cvdProxy: 'binance:BTCUSDT',
  },
  {
    id: 'coinbase:ONDO-USD',
    venue: 'coinbase',
    symbol: 'ONDO-USD',
    base: 'ONDO',
    quote: 'USD',
    label: 'ONDO-USD · Coinbase',
    tickSize: 0.00001,
    precision: 5,
    chartable: true,
    cvdProxy: 'binance:ONDOUSDT',
  },
  {
    id: 'binance:ONEUSDT',
    venue: 'binance',
    symbol: 'ONEUSDT',
    base: 'ONE',
    quote: 'USDT',
    label: 'ONEUSDT · Binance',
    tickSize: 0.000001,
    precision: 6,
    chartable: true,
  },
  {
    id: 'bybit:ZIGUSDT',
    venue: 'bybit',
    symbol: 'ZIGUSDT',
    base: 'ZIG',
    quote: 'USDT',
    label: 'ZIGUSDT · Bybit',
    tickSize: 0.00001,
    precision: 5,
    chartable: true,
  },
  {
    id: 'binance:BTCUSDT',
    venue: 'binance',
    symbol: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    label: 'BTCUSDT · Binance',
    tickSize: 0.01,
    precision: 2,
    chartable: false,
  },
  {
    id: 'binance:ONDOUSDT',
    venue: 'binance',
    symbol: 'ONDOUSDT',
    base: 'ONDO',
    quote: 'USDT',
    label: 'ONDOUSDT · Binance',
    tickSize: 0.0001,
    precision: 4,
    chartable: false,
  },
];

/** Les marchés affichables, dans l'ordre du registre (un marché `chartable` a toujours un `CryptoMarketId`). */
export const CHARTABLE_MARKETS: readonly CryptoMarketId[] = CRYPTO_MARKETS.filter((m) => m.chartable).map((m) => m.id as CryptoMarketId);

export const DEFAULT_CRYPTO_MARKET: CryptoMarketId = 'coinbase:BTC-USD';
export const DEFAULT_CRYPTO_TIMEFRAME: CryptoTimeframe = 60;

/**
 * Hôtes des exchanges, triés. Liste à part : elle n'entre jamais dans `allowedHosts()` (`sources.ts`),
 * les conditions de ces exchanges n'ayant pas été revues pour un logiciel distribué (décision 9).
 * Noms d'hôte nus, en minuscules, sans port.
 */
export const CRYPTO_HOSTS: readonly string[] = [
  'api.binance.com',
  'api.bybit.com',
  'api.exchange.coinbase.com',
  'fapi.binance.com',
  'fstream.binance.com',
  'stream.binance.com',
  'stream.bybit.com',
  'ws-feed.exchange.coinbase.com',
];

/** La série du registre portant cet identifiant, affichable ou non. */
export function cryptoMarket(id: string): CryptoMarket | undefined {
  return CRYPTO_MARKETS.find((m) => m.id === id);
}

export function isChartableMarket(v: unknown): v is CryptoMarketId {
  return typeof v === 'string' && CHARTABLE_MARKETS.some((id) => id === v);
}

export function isCryptoSeriesId(v: unknown): v is CryptoSeriesId {
  return typeof v === 'string' && CRYPTO_MARKETS.some((m) => m.id === v);
}

export function isCryptoTimeframe(v: unknown): v is CryptoTimeframe {
  return typeof v === 'number' && CRYPTO_TIMEFRAMES.some((tf) => tf === v);
}

/**
 * Vrai si l'URL est analysable, dans le protocole demandé (`https:` pour le REST, `wss:` pour les flux),
 * sans utilisateur ni mot de passe, et si son hôte (en minuscules) est dans `CRYPTO_HOSTS`. Le port est libre.
 * Le protocole demandé est revérifié à l'exécution, quel que soit le typage de l'appelant : tout autre que
 * `https:` ou `wss:` (`http:`, `ws:`, `ftp:`, `file:`…) est refusé, même vers un hôte de la liste.
 */
export function cryptoHostAllowed(url: string, protocol: 'https:' | 'wss:'): boolean {
  if (protocol !== 'https:' && protocol !== 'wss:') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== protocol) return false;
    if (u.username !== '' || u.password !== '') return false;
    return CRYPTO_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
