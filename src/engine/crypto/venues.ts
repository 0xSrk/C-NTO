/**
 * Historique des bougies des trois venues : les URLs REST à interroger, puis la lecture de leurs réponses.
 * Partagé par le process principal, qui fait les appels (`electron/crypto-feeds.ts`), et par le renderer
 * (émis vers `dist-electron/crypto/venues.js` par `electron/tsconfig.sources.json`). Il n'importe que
 * `./markets` : le process principal le compile sans alias ni `bars.ts`. Aucun réseau ici, seulement des
 * URLs et du JSON déjà reçu. Barres en secondes UTC. Un nombre d'exchange passe par `Number(...)` puis
 * `Number.isFinite` : une ligne qui n'en tient pas un est écartée, jamais propagée.
 */
import { cryptoMarket, isCryptoTimeframe, type CryptoBar, type CryptoSeriesId, type CryptoTimeframe, type CryptoVenue } from './markets';

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
