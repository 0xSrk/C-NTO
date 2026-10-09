/**
 * Les trois venues vues du process principal : l'historique des bougies (les URLs REST à interroger, puis la
 * lecture de leurs réponses), les flux WebSocket (URLs, clés de flux, messages d'abonnement, lecture des
 * messages reçus) et les URLs Binance de la température du marché.
 * Partagé par le process principal, qui fait les appels (`electron/crypto-feeds.ts`), et par le renderer
 * (émis vers `dist-electron/crypto/venues.js` par `electron/tsconfig.sources.json`). Il n'importe que
 * `./markets` : le process principal le compile sans alias ni `bars.ts`. Aucun réseau ici, seulement des
 * URLs, des messages à envoyer et du JSON déjà reçu. Barres en secondes UTC, trades et tickers en
 * millisecondes. Un nombre d'exchange passe par `Number(...)` puis `Number.isFinite` : une ligne qui n'en
 * tient pas un est écartée, jamais propagée.
 */
import {
  CRYPTO_TIMEFRAMES,
  cryptoMarket,
  isCryptoTimeframe,
  type CryptoBar,
  type CryptoSeriesId,
  type CryptoTicker,
  type CryptoTimeframe,
  type CryptoTrade,
  type CryptoVenue,
} from './markets';

/** Bougies demandées en un appel à Binance et à Bybit, et plafond de ce que l'historique rend. */
export const HISTORY_BARS = 500;

/** Bougies que Coinbase rend au plus par appel : au-delà de 300 granularités d'écart, l'API répond 400. */
const COINBASE_PAGE = 300;

/** Intervalle de chaque timeframe, dans la langue de la venue. */
const BINANCE_INTERVAL: Record<CryptoTimeframe, string> = { 1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d' };
const BYBIT_INTERVAL: Record<CryptoTimeframe, string> = { 1: '1', 5: '5', 15: '15', 60: '60', 240: '240', 1440: 'D' };

/** Rien à demander : série ou timeframe inconnus du registre, ou heure qui n'est pas une date. */
const none = (): { urls: string[]; aggregate: number } => ({ urls: [], aggregate: 1 });

/** L'instant en ISO 8601 UTC, ou `null` si la date n'existe pas (`toISOString` lève sur une date invalide). */
function iso(sec: number): string | null {
  const date = new Date(sec * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Coinbase : `start` et `end` sont compris tous les deux (relevé le 9 octobre 2026). Une page couvre donc
 * 300 créneaux, soit `end - start = 299` granularités, et les pages se suivent en remontant, sans trou ni
 * recouvrement. Coinbase n'a pas de bougie de 4 h : quatre pages d'une heure, regroupées par quatre.
 * La page la plus récente finit sur le dernier créneau du seau (de regroupement) qui contient `nowSec` : la
 * bougie entamée en fait partie, et la fenêtre commence sur une frontière de seau, jamais au milieu d'une 4 h.
 * Un `nowSec` qui n'est pas une date (NaN, infini, hors des bornes de `Date`) ne donne aucune URL.
 */
function coinbaseRequests(symbol: string, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number } {
  const { granularity, pages, aggregate } = timeframe === 240 ? { granularity: 3600, pages: 4, aggregate: 4 } : { granularity: timeframe * 60, pages: 2, aggregate: 1 };
  const bucket = granularity * aggregate;
  const newest = Math.floor(Math.floor(nowSec) / bucket) * bucket + bucket - granularity;
  const urls: string[] = [];
  for (let page = 0; page < pages; page++) {
    const end = newest - page * COINBASE_PAGE * granularity;
    const start = end - (COINBASE_PAGE - 1) * granularity;
    const from = iso(start);
    const to = iso(end);
    if (from === null || to === null) return none();
    urls.push(`https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}&start=${from}&end=${to}`);
  }
  return { urls, aggregate };
}

/**
 * Les URLs à interroger pour l'historique d'une série, et le regroupement que l'appelant doit appliquer aux
 * bougies lues : `aggregate` bougies de `timeframe / aggregate` minutes font une bougie de `timeframe`.
 * Binance et Bybit : un appel, les `HISTORY_BARS` dernières bougies, `aggregate` vaut 1. Coinbase : des pages
 * de 300 bougies, de la plus récente à la plus ancienne (deux pages, quatre en 4 h). Série ou timeframe hors
 * du registre, ou `nowSec` qui n'est pas une date : aucune URL.
 */
export function historyRequests(series: CryptoSeriesId, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number } {
  const market = cryptoMarket(series);
  if (!market || !isCryptoTimeframe(timeframe)) return none();
  const symbol = encodeURIComponent(market.symbol);
  switch (market.venue) {
    case 'binance':
      return { urls: [`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_INTERVAL[timeframe]}&limit=${HISTORY_BARS}`], aggregate: 1 };
    case 'bybit':
      return { urls: [`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${BYBIT_INTERVAL[timeframe]}&limit=${HISTORY_BARS}`], aggregate: 1 };
    case 'coinbase':
      return coinbaseRequests(symbol, timeframe, nowSec);
    default:
      return none();
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Un nombre d'exchange : `Number(...)` puis `Number.isFinite`. Ni `null`, ni booléen, ni tableau, ni chaîne vide ne passent pour 0. */
function num(v: unknown): number | null {
  if (typeof v !== 'number' && (typeof v !== 'string' || v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const seconds = (ms: number | null): number | null => (ms === null ? null : ms / 1000);

function makeBar(time: number | null, open: number | null, high: number | null, low: number | null, close: number | null, volume: number | null): CryptoBar | null {
  if (time === null || open === null || high === null || low === null || close === null || volume === null) return null;
  return { time: Math.floor(time), open, high, low, close, volume };
}

/** Coinbase : `[time (s), low, high, open, close, volume]`, des nombres. */
function coinbaseBar(row: unknown): CryptoBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  return makeBar(num(row[0]), num(row[3]), num(row[2]), num(row[1]), num(row[4]), num(row[5]));
}

/** Binance : `[openTime (ms), open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, …]`, des chaînes. */
function binanceBar(row: unknown): CryptoBar | null {
  if (!Array.isArray(row) || row.length < 10) return null;
  const bar = makeBar(seconds(num(row[0])), num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]));
  const buyVolume = num(row[9]);
  return bar && buyVolume !== null ? { ...bar, buyVolume } : null;
}

/** Bybit : `[startTime (ms), open, high, low, close, volume, turnover]`, des chaînes. */
function bybitBar(row: unknown): CryptoBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  return makeBar(seconds(num(row[0])), num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]));
}

/**
 * Bybit répond `{ retCode, retMsg, result: { list } }` et ne réussit qu'avec `retCode` à 0 ; toute autre réponse
 * lève `Error(retMsg)`. Réussie mais sans liste exploitable, elle ne porte aucune ligne.
 */
function bybitRows(json: unknown): unknown[] {
  const reply = isRecord(json) ? json : {};
  const code = num(reply.retCode);
  if (code !== 0) {
    const fallback = code === null ? 'bybit: unexpected response' : `bybit: retCode ${code}`;
    throw new Error(typeof reply.retMsg === 'string' && reply.retMsg.trim() !== '' ? reply.retMsg : fallback);
  }
  const list = isRecord(reply.result) ? reply.result.list : undefined;
  return Array.isArray(list) ? list : [];
}

/** Les bougies par time croissant, une seule par time : la dernière lue l'emporte. */
function sortedUnique(bars: CryptoBar[]): CryptoBar[] {
  const byTime = new Map<number, CryptoBar>();
  for (const bar of bars) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function readBars(rows: unknown[], toBar: (row: unknown) => CryptoBar | null): CryptoBar[] {
  const bars: CryptoBar[] = [];
  for (const row of rows) {
    const bar = toBar(row);
    if (bar) bars.push(bar);
  }
  return sortedUnique(bars);
}

/**
 * Les bougies d'une réponse de venue (le JSON déjà décodé), par time croissant et sans doublon. Toute ligne
 * courte ou dont un nombre n'est pas fini est écartée ; Binance est la seule à porter `buyVolume`. Rien ne lève,
 * hors le cas de Bybit : `retCode` autre que 0 lève `Error(retMsg)`. Venue inconnue : aucune bougie.
 */
export function parseCandles(venue: CryptoVenue, json: unknown): CryptoBar[] {
  switch (venue) {
    case 'coinbase':
      return readBars(Array.isArray(json) ? json : [], coinbaseBar);
    case 'binance':
      return readBars(Array.isArray(json) ? json : [], binanceBar);
    case 'bybit':
      return readBars(bybitRows(json), bybitBar);
    default:
      return [];
  }
}

function isFiniteBar(b: CryptoBar): boolean {
  return [b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) && (b.buyVolume === undefined || Number.isFinite(b.buyVolume));
}

function mergeBars(time: number, group: CryptoBar[]): CryptoBar {
  let open = 0;
  let close = 0;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  let buyVolume = 0;
  let allBuy = true;
  let first = true;
  for (const bar of group) {
    if (first) open = bar.open;
    first = false;
    close = bar.close;
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    volume += bar.volume;
    if (bar.buyVolume === undefined) allBuy = false;
    else buyVolume += bar.buyVolume;
  }
  return allBuy ? { time, open, high, low, close, volume, buyVolume } : { time, open, high, low, close, volume };
}

/**
 * Regroupe des bougies en seaux de `timeframe × factor × 60` secondes alignés sur l'epoch UTC : `timeframe` est
 * celui des bougies reçues (en minutes), `factor` leur nombre par bougie rendue. Ouverture de la première, plus
 * haut, plus bas, clôture de la dernière, volumes additionnés ; `buyVolume` n'est additionné que si toutes les
 * bougies du seau en portent un. L'entrée peut être dans le désordre et se recouper (pages fusionnées) : elle est
 * remise en ordre et dédoublonnée, avec `factor` à 1 comme avec un autre. Une bougie dont un nombre n'est pas
 * fini est écartée. Facteur ou timeframe qui ne définit aucun seau : aucune bougie.
 */
export function aggregateBars(bars: CryptoBar[], timeframe: CryptoTimeframe, factor: number): CryptoBar[] {
  const span = timeframe * factor * 60;
  if (!Number.isInteger(factor) || factor < 1 || !Number.isFinite(span) || span < 1) return [];
  const buckets = new Map<number, CryptoBar[]>();
  for (const bar of sortedUnique(bars.filter(isFiniteBar))) {
    const start = Math.floor(bar.time / span) * span;
    const group = buckets.get(start);
    if (group) group.push(bar);
    else buckets.set(start, [bar]);
  }
  return [...buckets].map(([time, group]) => mergeBars(time, group));
}

/**
 * Le flux WebSocket public de la venue, en `wss:`. Binance sur le port 9443, que `cryptoHostAllowed` laisse libre.
 * Venue inconnue : chaîne vide, que `cryptoHostAllowed` refuse.
 */
export function wsUrl(venue: CryptoVenue): string {
  switch (venue) {
    case 'coinbase':
      return 'wss://ws-feed.exchange.coinbase.com';
    case 'binance':
      return 'wss://stream.binance.com:9443/ws';
    case 'bybit':
      return 'wss://stream.bybit.com/v5/public/spot';
    default:
      return '';
  }
}

/** Les liquidations de tous les perps USDT de Binance : un flux à part, pour la température du marché. */
export const FORCE_ORDER_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
/** Le funding de tous les perps USDT de Binance, en un appel. */
export const PREMIUM_INDEX_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
/** La variation sur 24 h de toutes les paires spot de Binance, en un appel. */
export const TICKER_24H_URL = 'https://api.binance.com/api/v3/ticker/24hr';

/** L'open interest horaire de BTC ou d'ETH sur Binance : 25 points, de quoi lire la variation sur 24 h. */
export function openInterestUrl(symbol: 'BTCUSDT' | 'ETHUSDT'): string {
  return `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1h&limit=25`;
}

/**
 * Les clés de flux d'une série, dans la langue de sa venue : une clé est ce que le message d'abonnement nomme.
 * Coinbase : `canal:produit`, plus le `heartbeat` du produit, qui prouve la vie d'un marché sans trade. Binance :
 * `symbole@flux`, symbole en minuscules, le flux de bougies portant l'intervalle du timeframe. Bybit :
 * `topic.symbole`. Coinbase et Bybit n'ont pas de flux de bougies : `bars` leur donne les trades, que le process
 * principal assemble, et le timeframe ne change pas la clé. Série ou genre inconnus, ou bougies Binance sans
 * timeframe du registre : aucune clé.
 */
export function streamKeys(series: CryptoSeriesId, kind: 'ticker' | 'bars', timeframe?: CryptoTimeframe): string[] {
  const market = cryptoMarket(series);
  if (!market || (kind !== 'ticker' && kind !== 'bars')) return [];
  const { symbol } = market;
  switch (market.venue) {
    case 'coinbase':
      return [`${kind === 'ticker' ? 'ticker' : 'matches'}:${symbol}`, `heartbeat:${symbol}`];
    case 'binance':
      if (kind === 'ticker') return [`${symbol.toLowerCase()}@miniTicker`];
      return isCryptoTimeframe(timeframe) ? [`${symbol.toLowerCase()}@kline_${BINANCE_INTERVAL[timeframe]}`] : [];
    case 'bybit':
      return [`${kind === 'ticker' ? 'tickers' : 'publicTrade'}.${symbol}`];
    default:
      return [];
  }
}

/**
 * Les canaux d'un message d'abonnement Coinbase : les clés `canal:produit` regroupées par canal, dans l'ordre où
 * elles se présentent, chaque produit une seule fois. Une clé sans canal ou sans produit est écartée.
 */
function coinbaseChannels(keys: readonly string[]): { name: string; product_ids: string[] }[] {
  const channels = new Map<string, string[]>();
  for (const key of keys) {
    const colon = key.indexOf(':');
    if (colon < 1 || colon === key.length - 1) continue;
    const name = key.slice(0, colon);
    const product = key.slice(colon + 1);
    const products = channels.get(name);
    if (products === undefined) channels.set(name, [product]);
    else if (!products.includes(product)) products.push(product);
  }
  return [...channels].map(([name, products]) => ({ name, product_ids: products }));
}

/**
 * Le message JSON qui abonne (`on`) ou désabonne la socket d'une venue des flux `keys`. Coinbase :
 * `{ type, channels: [{ name, product_ids }] }`, un seul message pour tous les canaux. Binance :
 * `{ method, params, id }`, l'`id` revenant dans l'acquittement. Bybit : `{ op, args }`, sans identifiant.
 * Venue inconnue : chaîne vide.
 */
export function subscribeMessage(venue: CryptoVenue, keys: readonly string[], on: boolean, id: number): string {
  switch (venue) {
    case 'coinbase':
      return JSON.stringify({ type: on ? 'subscribe' : 'unsubscribe', channels: coinbaseChannels(keys) });
    case 'binance':
      return JSON.stringify({ method: on ? 'SUBSCRIBE' : 'UNSUBSCRIBE', params: [...keys], id });
    case 'bybit':
      return JSON.stringify({ op: on ? 'subscribe' : 'unsubscribe', args: [...keys] });
    default:
      return '';
  }
}

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

/** Un message sans suite : ni exception ni valeur douteuse, seulement « ignoré ». */
const ignored = (): WsParsed[] => [{ kind: 'ignored' }];

const finiteOrNull = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** La série du registre qui porte ce symbole natif sur cette venue, ou `null` : absent, mal typé ou hors registre. */
function seriesOf(venue: CryptoVenue, symbol: unknown): CryptoSeriesId | null {
  return typeof symbol === 'string' ? (cryptoMarket(`${venue}:${symbol}`)?.id ?? null) : null;
}

/** La variation depuis `open`, en pourcent ; `null` quand l'ouverture manque ou n'est pas positive, ou que le résultat déborde. */
function changeSince(open: number | null, last: number): number | null {
  return open !== null && open > 0 ? finiteOrNull((last / open - 1) * 100) : null;
}

/** L'horodatage ISO 8601 de Coinbase (en UTC, jusqu'à la microseconde) en millisecondes ; `null` si ce n'est pas une date. */
function coinbaseTime(v: unknown): number | null {
  return typeof v === 'string' ? finiteOrNull(Date.parse(v)) : null;
}

function coinbaseTicker(msg: Record<string, unknown>): CryptoTicker | null {
  const market = seriesOf('coinbase', msg.product_id);
  const last = num(msg.price);
  const time = coinbaseTime(msg.time);
  if (market === null || last === null || time === null) return null;
  return { market, last, change24hPct: changeSince(num(msg.open_24h), last), time };
}

/** Coinbase donne dans `side` le côté du maker : l'agresseur, qui a pris sa liquidité, est l'autre côté. */
function coinbaseTrade(msg: Record<string, unknown>): CryptoTrade | null {
  const market = seriesOf('coinbase', msg.product_id);
  const time = coinbaseTime(msg.time);
  const price = num(msg.price);
  const size = num(msg.size);
  const aggressor = msg.side === 'sell' ? 'buy' : msg.side === 'buy' ? 'sell' : null;
  if (market === null || time === null || price === null || size === null || aggressor === null) return null;
  return { market, time, price, size, aggressor };
}

/** Le texte de l'erreur de Coinbase : `message`, puis `reason` quand il y en a un ; jamais vide. */
function coinbaseError(msg: Record<string, unknown>): string {
  const parts = [msg.message, msg.reason].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  return parts.length > 0 ? parts.join(': ') : 'coinbase: error';
}

function parseCoinbase(msg: Record<string, unknown>): WsParsed[] {
  switch (msg.type) {
    case 'ticker': {
      const ticker = coinbaseTicker(msg);
      return ticker ? [{ kind: 'ticker', ticker }] : [];
    }
    case 'match':
    case 'last_match': {
      const trade = coinbaseTrade(msg);
      return trade ? [{ kind: 'trade', trade }] : [];
    }
    case 'heartbeat':
      return [{ kind: 'heartbeat' }];
    case 'error':
      return [{ kind: 'error', detail: coinbaseError(msg) }];
    default:
      return [];
  }
}

/** Binance : `c` dernier prix, `o` prix d'il y a 24 h, `E` heure de l'événement en millisecondes. */
function binanceTicker(msg: Record<string, unknown>): CryptoTicker | null {
  const market = seriesOf('binance', msg.s);
  const last = num(msg.c);
  const time = num(msg.E);
  if (market === null || last === null || time === null) return null;
  return { market, last, change24hPct: changeSince(num(msg.o), last), time };
}

/** Le timeframe d'un intervalle de bougie Binance (`1m`, `1h`, …) ; `undefined` s'il n'est pas l'un des six du registre. */
function binanceTimeframe(interval: unknown): CryptoTimeframe | undefined {
  return CRYPTO_TIMEFRAMES.find((tf) => BINANCE_INTERVAL[tf] === interval);
}

/**
 * Binance : la bougie entière dans `k` (`t` ouverture en millisecondes, `o h l c`, `v` volume, `V` volume acheteur,
 * `i` intervalle), renvoyée à chaque mise à jour jusqu'à sa clôture ; `x` ne vaut vrai qu'à la clôture. Le symbole
 * est celui du message, pas celui de `k`.
 */
function binanceKline(msg: Record<string, unknown>): WsParsed | null {
  const k = msg.k;
  if (!isRecord(k)) return null;
  const series = seriesOf('binance', msg.s);
  const timeframe = binanceTimeframe(k.i);
  const bar = makeBar(seconds(num(k.t)), num(k.o), num(k.h), num(k.l), num(k.c), num(k.v));
  const buyVolume = num(k.V);
  if (series === null || timeframe === undefined || bar === null || buyVolume === null) return null;
  return { kind: 'kline', series, timeframe, bar: { ...bar, buyVolume }, final: k.x === true };
}

function parseBinance(msg: Record<string, unknown>): WsParsed[] {
  switch (msg.e) {
    case '24hrMiniTicker': {
      const ticker = binanceTicker(msg);
      return ticker ? [{ kind: 'ticker', ticker }] : [];
    }
    case 'kline': {
      const kline = binanceKline(msg);
      return kline ? [kline] : [];
    }
    default:
      return [];
  }
}

/** Bybit : `lastPrice` dernier prix, `price24hPcnt` variation sur 24 h en fraction (0,0061 vaut 0,61 %), `ts` en millisecondes. */
function bybitTicker(symbol: string, msg: Record<string, unknown>): CryptoTicker | null {
  const market = seriesOf('bybit', symbol);
  const data = isRecord(msg.data) ? msg.data : null;
  const last = data === null ? null : num(data.lastPrice);
  const time = num(msg.ts);
  if (market === null || data === null || last === null || time === null) return null;
  const fraction = num(data.price24hPcnt);
  return { market, last, change24hPct: fraction === null ? null : finiteOrNull(fraction * 100), time };
}

/** Bybit : `T` heure du trade en millisecondes, `p` prix, `v` quantité, `S` le côté du taker, qui est l'agresseur. */
function bybitTrade(market: CryptoSeriesId, row: unknown): CryptoTrade | null {
  if (!isRecord(row)) return null;
  const time = num(row.T);
  const price = num(row.p);
  const size = num(row.v);
  const aggressor = row.S === 'Buy' ? 'buy' : row.S === 'Sell' ? 'sell' : null;
  if (time === null || price === null || size === null || aggressor === null) return null;
  return { market, time, price, size, aggressor };
}

/** Un trade par élément de `data`, dans l'ordre ; l'élément invalide est écarté, ses voisins gardés. */
function bybitTrades(symbol: string, data: unknown): WsParsed[] {
  const market = seriesOf('bybit', symbol);
  if (market === null || !Array.isArray(data)) return [];
  const events: WsParsed[] = [];
  for (const row of data) {
    const trade = bybitTrade(market, row);
    if (trade) events.push({ kind: 'trade', trade });
  }
  return events;
}

/**
 * Bybit : `op` ou `ret_msg` valent `pong` en réponse au `ping` ; un message de données porte son `topic`
 * (`tickers.<symbole>`, `publicTrade.<symbole>`) ; les acquittements d'abonnement et tout autre topic ne donnent rien.
 */
function parseBybit(msg: Record<string, unknown>): WsParsed[] {
  if (msg.op === 'pong' || msg.ret_msg === 'pong') return [{ kind: 'heartbeat' }];
  const topic = msg.topic;
  if (typeof topic !== 'string') return [];
  const dot = topic.indexOf('.');
  if (dot < 0) return [];
  const channel = topic.slice(0, dot);
  const symbol = topic.slice(dot + 1);
  if (channel === 'tickers') {
    const ticker = bybitTicker(symbol, msg);
    return ticker ? [{ kind: 'ticker', ticker }] : [];
  }
  return channel === 'publicTrade' ? bybitTrades(symbol, msg.data) : [];
}

function readMessage(venue: CryptoVenue, msg: Record<string, unknown>): WsParsed[] {
  switch (venue) {
    case 'coinbase':
      return parseCoinbase(msg);
    case 'binance':
      return parseBinance(msg);
    case 'bybit':
      return parseBybit(msg);
    default:
      return [];
  }
}

/**
 * Lit un message de flux, le texte JSON tel que la socket le livre. Ne lève jamais : un texte illisible, coupé ou
 * qui n'est pas un objet, une venue ou un type de message inconnus, un symbole hors du registre, un côté qui n'est
 * pas celui de la venue, un nombre non fini (aussi bien `abc` que `1e999`) donnent `[{ kind: 'ignored' }]`, et une
 * ligne invalide d'un message qui en porte plusieurs est écartée sans gêner les autres. Jamais de tableau vide.
 * Les acquittements d'abonnement ne donnent rien ; `heartbeat` est la preuve de vie (le canal `heartbeat` de
 * Coinbase, le `pong` de Bybit). Une variation sur 24 h dont l'ouverture manque, est nulle ou déborde vaut `null`.
 */
export function parseWsMessage(venue: CryptoVenue, raw: string): WsParsed[] {
  try {
    const msg: unknown = JSON.parse(raw);
    const events = isRecord(msg) ? readMessage(venue, msg) : [];
    return events.length > 0 ? events : ignored();
  } catch {
    return ignored();
  }
}
