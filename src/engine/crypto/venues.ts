/**
 * Les trois venues vues du process principal : l'historique des bougies (les URLs REST à interroger, puis la
 * lecture de leurs réponses), les flux WebSocket (URLs, clés de flux, messages d'abonnement, lecture des
 * messages reçus) et les URLs Binance de la température du marché.
 * Partagé par le process principal, qui fait les appels (`electron/crypto-feeds.ts`), et par le renderer
 * (émis vers `dist-electron/crypto/venues.js` par `electron/tsconfig.sources.json`). Il n'importe que
 * `./markets` : le process principal le compile sans alias ni `bars.ts`. Aucun réseau ici, seulement des
 * URLs, des messages à envoyer et du JSON déjà reçu. Barres en secondes UTC, trades et tickers en
 * millisecondes. Un nombre d'exchange passe par `Number(...)` puis `Number.isFinite` : une ligne qui n'en
 * tient pas un est écartée, jamais propagée. Elle l'est aussi quand ses valeurs se contredisent : prix ou
 * quantité nuls ou négatifs, bougie dont le plus haut est sous le plus bas, volume acheteur hors du volume.
 * L'historique REST et les flux WebSocket appliquent les mêmes règles.
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

/** Bougies chargées au moins, quel que soit le timeframe : `historyTarget` en demande davantage en 1m et en 5m. */
export const HISTORY_BARS = 500;

/** Bougies que Coinbase rend au plus par appel : au-delà de 300 granularités d'écart, l'API répond 400. */
const COINBASE_PAGE = 300;

/** Bougies que Binance et Bybit rendent au plus par appel (`limit`). */
const KLINE_PAGE = 1000;

/** Secondes d'un jour UTC. */
const DAY_SECONDS = 86400;

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
 * Le nombre de bougies à charger : au moins `HISTORY_BARS`, et assez pour remonter à 00:00 UTC de la veille de `nowSec`.
 * Le VWAP 00:00 UTC et les niveaux du jour UTC précédent ne calculent une journée que si la fenêtre chargée en couvre le
 * début (sa première bougie n'est pas plus tardive) : sans cela, ils restent vides la plupart du temps. Le début de la
 * fenêtre est un multiple de 86 400 s, donc une frontière de bougie pour chaque timeframe du registre. 500 bougies y
 * suffisent à partir de 15m ; il en faut de 289 à 576 en 5m et de 1 441 à 2 880 en 1m (de minuit à 23:59 UTC). Une heure
 * ou un timeframe qui ne définissent aucune fenêtre (NaN, infini, timeframe nul) donnent `HISTORY_BARS`.
 * Ce nombre fixe les requêtes, pas la coupe : l'appelant garde les bougies dont `time >= min(00:00 UTC de la veille,
 * seau courant − (HISTORY_BARS − 1) × timeframe × 60)`, par l'heure et jamais par le nombre. Un seau qui bascule pendant
 * la pagination (ou pendant l'appel unique, d'où sa marge d'une bougie) rend une bougie de plus, en fin de série :
 * garder les `historyTarget` dernières perdrait alors celle de 00:00 UTC de la veille.
 */
export function historyTarget(timeframe: CryptoTimeframe, nowSec: number): number {
  const needed = barsSinceDayBefore(timeframe, nowSec);
  return Number.isFinite(needed) ? Math.max(HISTORY_BARS, needed) : HISTORY_BARS;
}

/**
 * Les bougies de 00:00 UTC de la veille de `nowSec` jusqu'à celle qui contient `nowSec`, comprise (`needed`) ; non fini
 * quand l'heure ou le timeframe ne définissent aucune fenêtre.
 */
function barsSinceDayBefore(timeframe: CryptoTimeframe, nowSec: number): number {
  const windowStart = (Math.floor(nowSec / DAY_SECONDS) - 1) * DAY_SECONDS;
  return Math.floor((nowSec - windowStart) / (timeframe * 60)) + 1;
}

/**
 * Coinbase : `start` et `end` sont compris tous les deux (relevé le 9 octobre 2026). Une page couvre donc
 * 300 créneaux, soit `end - start = 299` granularités, et les pages se suivent en remontant, sans trou ni
 * recouvrement : `ceil(historyTarget / 300)` pages, deux au moins (en 1m, de cinq à dix). Coinbase n'a pas de bougie
 * de 4 h : quatre pages d'une heure, regroupées par quatre, soit 300 bougies de 4 h quel que soit `historyTarget`
 * (décision du registre).
 * La page la plus récente finit sur le dernier créneau du seau (de regroupement) qui contient `nowSec` : la
 * bougie entamée en fait partie, et la fenêtre commence sur une frontière de seau, jamais au milieu d'une 4 h.
 * Un `nowSec` qui n'est pas une date (NaN, infini, hors des bornes de `Date`) ne donne aucune URL.
 */
function coinbaseRequests(symbol: string, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number } {
  const { granularity, pages, aggregate } =
    timeframe === 240
      ? { granularity: 3600, pages: 4, aggregate: 4 }
      : { granularity: timeframe * 60, pages: Math.max(2, Math.ceil(historyTarget(timeframe, nowSec) / COINBASE_PAGE)), aggregate: 1 };
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
 * Binance et Bybit : `historyTarget` bougies. Jusqu'à 1 000, un appel (`root` suivi de `limit`) : les dernières bougies,
 * comme avant ; avec une bougie de marge, `limit = min(1000, historyTarget + 1)`, dès que la fenêtre de 00:00 UTC de la
 * veille au seau courant compte `HISTORY_BARS` bougies ou plus (`needed >= HISTORY_BARS` : le 5m dès 17:35 UTC). La
 * première bougie demandée est alors celle de 00:00 UTC de la veille, ou l'une après : si le seau bascule pendant l'appel,
 * la venue décale sa fenêtre d'une bougie, et la marge garde celle de 00:00 ; sans bascule, la bougie de marge tombe
 * avant et l'appelant l'écarte par l'heure. En dessous (moins de 500 bougies depuis 00:00 de la veille), les 500 dernières
 * commencent avant 00:00 de la veille : une bascule la garde, l'URL ne change pas (15m et au-dessus, toujours `limit=500`).
 * Au-delà de 1 000 (le 1m), des pages de 1 000 bougies en avançant, chacune lue depuis l'ouverture de sa
 * première bougie (`startParam` en millisecondes : `startTime` chez Binance, `start` chez Bybit). La première part de
 * `historyTarget - 1` bougies avant celle du seau qui contient `nowSec`, soit 00:00 UTC de la veille, chaque suivante
 * 1 000 bougies plus loin, sans trou ni recouvrement : la dernière couvre le seau courant, que la venue rend entamé.
 */
function klineRequests(root: string, startParam: 'startTime' | 'start', timeframe: CryptoTimeframe, nowSec: number): string[] {
  const target = historyTarget(timeframe, nowSec);
  if (target <= KLINE_PAGE) {
    const limit = barsSinceDayBefore(timeframe, nowSec) >= HISTORY_BARS ? Math.min(KLINE_PAGE, target + 1) : target;
    return [`${root}&limit=${limit}`];
  }
  const step = timeframe * 60;
  const first = Math.floor(nowSec / step) * step - (target - 1) * step;
  const urls: string[] = [];
  for (let page = 0; page * KLINE_PAGE < target; page++) urls.push(`${root}&${startParam}=${(first + page * KLINE_PAGE * step) * 1000}&limit=${KLINE_PAGE}`);
  return urls;
}

/**
 * Les URLs à interroger pour l'historique d'une série, et le regroupement que l'appelant doit appliquer aux
 * bougies lues : `aggregate` bougies de `timeframe / aggregate` minutes font une bougie de `timeframe`.
 * L'historique remonte à `historyTarget(timeframe, nowSec)` bougies, soit au moins `HISTORY_BARS` et, en 1m et 5m,
 * jusqu'à 00:00 UTC de la veille. Binance et Bybit : un appel jusqu'à 1 000 bougies (une de marge dès que la fenêtre
 * depuis 00:00 UTC de la veille compte `HISTORY_BARS` bougies), sinon des pages de 1 000 de la plus ancienne à la plus
 * récente, `aggregate` vaut 1. L'appelant coupe ce qu'il reçoit par l'heure (voir `historyTarget`). Coinbase : des
 * pages de 300 bougies, de la plus récente à la plus
 * ancienne (`ceil(historyTarget / 300)` pages, deux au moins ; quatre en 4 h, qui ne suit pas `historyTarget`). Série ou
 * timeframe hors du registre, ou `nowSec` qui n'est pas une date : aucune URL.
 */
export function historyRequests(series: CryptoSeriesId, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number } {
  const market = cryptoMarket(series);
  // Une heure qui n'est pas une date (NaN, infini, hors des bornes de `Date`) ne donne aucune URL, quelle que soit la venue.
  if (!market || !isCryptoTimeframe(timeframe) || iso(nowSec) === null) return none();
  const symbol = encodeURIComponent(market.symbol);
  switch (market.venue) {
    case 'binance':
      return { urls: klineRequests(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_INTERVAL[timeframe]}`, 'startTime', timeframe, nowSec), aggregate: 1 };
    case 'bybit':
      return { urls: klineRequests(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${BYBIT_INTERVAL[timeframe]}`, 'start', timeframe, nowSec), aggregate: 1 };
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

/** Un prix ou une quantité de trade : un nombre d'exchange (`num`) strictement positif. Un zéro ou un négatif est une ligne invalide. */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

const seconds = (ms: number | null): number | null => (ms === null ? null : ms / 1000);

/**
 * La bougie si elle se tient, sinon `null` et l'appelant écarte la ligne : quatre prix strictement positifs, le
 * plus bas sous l'ouverture et la clôture, le plus haut au-dessus, un volume positif ou nul et, quand la venue en
 * donne un (`buyVolume`, `null` s'il est illisible), un volume acheteur compris entre 0 et le volume. L'historique
 * REST et les bougies WebSocket de Binance passent tous par ici : une bougie écartée d'un côté l'est de l'autre.
 */
function makeBar(
  time: number | null,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
  volume: number | null,
  buyVolume?: number | null,
): CryptoBar | null {
  if (time === null || open === null || high === null || low === null || close === null || volume === null || buyVolume === null) return null;
  const pricesHold = Math.min(open, high, low, close) > 0 && low <= Math.min(open, close) && Math.max(open, close) <= high;
  const volumesHold = volume >= 0 && (buyVolume === undefined || (buyVolume >= 0 && buyVolume <= volume));
  if (!pricesHold || !volumesHold) return null;
  const bar = { time: Math.floor(time), open, high, low, close, volume };
  return buyVolume === undefined ? bar : { ...bar, buyVolume };
}

/** Coinbase : `[time (s), low, high, open, close, volume]`, des nombres. */
function coinbaseBar(row: unknown): CryptoBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  return makeBar(num(row[0]), num(row[3]), num(row[2]), num(row[1]), num(row[4]), num(row[5]));
}

/** Binance : `[openTime (ms), open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, …]`, des chaînes. */
function binanceBar(row: unknown): CryptoBar | null {
  if (!Array.isArray(row) || row.length < 10) return null;
  return makeBar(seconds(num(row[0])), num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]), num(row[9]));
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
 * courte, dont un nombre n'est pas fini ou qui ne se tient pas (prix nul ou négatif, plus haut sous le plus bas,
 * sous l'ouverture ou sous la clôture, plus bas au-dessus, volume négatif, volume acheteur hors de 0 et du volume)
 * est écartée ; Binance est la seule à porter `buyVolume`. Rien ne lève, hors le cas de Bybit : `retCode` autre
 * que 0 lève `Error(retMsg)`. Venue inconnue : aucune bougie.
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

/**
 * Les liquidations de tous les perps USDT de Binance : un flux à part, pour la température du marché. Elles sont
 * servies sur la route `/market` de `fstream` : le chemin sans route (`/ws/`) accepte la connexion mais n'envoie plus
 * aucune trame. Les trames restent des objets nus `{ e, E, o }`.
 */
export const FORCE_ORDER_URL = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
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
 * bougie Binance entière (`final` : elle est close), la preuve de vie de la socket, l'erreur de la venue (une erreur
 * Coinbase, une demande refusée chez Bybit ou Binance ; `detail` tient en 200 caractères), ou rien.
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

/** Longueur maximale du texte d'une erreur de venue : il vient du réseau et part dans un journal. */
const DETAIL_MAX = 200;

/** Le texte borné à `DETAIL_MAX` unités, sans laisser en bout la moitié haute d'une paire de substitution. */
function clip(text: string): string {
  if (text.length <= DETAIL_MAX) return text;
  const last = text.charCodeAt(DETAIL_MAX - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? DETAIL_MAX - 1 : DETAIL_MAX);
}

/** Le texte d'une erreur de venue : `text` s'il dit quelque chose, sinon `fallback` ; borné dans les deux cas. */
function errorDetail(text: unknown, fallback: string): string {
  return clip(typeof text === 'string' && text.trim() !== '' ? text : fallback);
}

/** La série du registre qui porte ce symbole natif sur cette venue, ou `null` : absent, mal typé ou hors registre. */
function seriesOf(venue: CryptoVenue, symbol: unknown): CryptoSeriesId | null {
  return typeof symbol === 'string' ? (cryptoMarket(`${venue}:${symbol}`)?.id ?? null) : null;
}

/** La variation depuis `open`, en pourcent ; `null` quand l'ouverture manque ou n'est pas positive, ou que le résultat déborde. */
function changeSince(open: number | null, last: number): number | null {
  return open !== null && open > 0 ? finiteOrNull((last / open - 1) * 100) : null;
}

/** Les horodatages de Coinbase : ISO 8601 en UTC, `2026-10-09T12:32:19.736799Z`, `Z` obligatoire, fraction de seconde facultative. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * L'horodatage de Coinbase en millisecondes ; `null` s'il n'a pas la forme ci-dessus ou si la date n'existe pas.
 * `Date.parse` lit bien d'autres chaînes (`1`, `2026`, `Oct 9 2026`, une heure sans `Z`, qu'il prend dans le fuseau du
 * poste) et reporte un 30 février au 2 mars ou `24:00:00` au lendemain : la date doit se relire telle qu'elle est écrite.
 */
function coinbaseTime(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_UTC.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19) ? ms : null;
}

function coinbaseTicker(msg: Record<string, unknown>): CryptoTicker | null {
  const market = seriesOf('coinbase', msg.product_id);
  const last = positive(msg.price);
  const time = coinbaseTime(msg.time);
  if (market === null || last === null || time === null) return null;
  return { market, last, change24hPct: changeSince(num(msg.open_24h), last), time };
}

/** Coinbase donne dans `side` le côté du maker : l'agresseur, qui a pris sa liquidité, est l'autre côté. */
function coinbaseTrade(msg: Record<string, unknown>): CryptoTrade | null {
  const market = seriesOf('coinbase', msg.product_id);
  const time = coinbaseTime(msg.time);
  const price = positive(msg.price);
  const size = positive(msg.size);
  const aggressor = msg.side === 'sell' ? 'buy' : msg.side === 'buy' ? 'sell' : null;
  if (market === null || time === null || price === null || size === null || aggressor === null) return null;
  return { market, time, price, size, aggressor };
}

/** Le texte de l'erreur de Coinbase : `message`, puis `reason` quand il y en a un ; jamais vide, jamais au-delà de `DETAIL_MAX`. */
function coinbaseError(msg: Record<string, unknown>): string {
  const parts = [msg.message, msg.reason].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  return errorDetail(parts.join(': '), 'coinbase: error');
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
  const last = positive(msg.c);
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
 * est celui du message, pas celui de `k`. La bougie passe par `makeBar`, comme une ligne de l'historique REST.
 */
function binanceKline(msg: Record<string, unknown>): WsParsed | null {
  const k = msg.k;
  if (!isRecord(k)) return null;
  const series = seriesOf('binance', msg.s);
  const timeframe = binanceTimeframe(k.i);
  const bar = makeBar(seconds(num(k.t)), num(k.o), num(k.h), num(k.l), num(k.c), num(k.v), num(k.V));
  if (series === null || timeframe === undefined || bar === null) return null;
  return { kind: 'kline', series, timeframe, bar, final: k.x === true };
}

/**
 * Binance répond à une demande refusée par `{ error: { code, msg }, id }` (sans `id` quand le JSON envoyé est illisible)
 * puis ferme la socket (1008) ; un acquittement `{ result, id }` et un nom de flux inconnu, que Binance accepte sans
 * rien dire, ne donnent rien.
 */
function parseBinance(msg: Record<string, unknown>): WsParsed[] {
  const error = msg.error;
  if (isRecord(error)) return [{ kind: 'error', detail: errorDetail(error.msg, 'binance: request rejected') }];
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
  const last = data === null ? null : positive(data.lastPrice);
  const time = num(msg.ts);
  if (market === null || data === null || last === null || time === null) return null;
  const fraction = num(data.price24hPcnt);
  return { market, last, change24hPct: fraction === null ? null : finiteOrNull(fraction * 100), time };
}

/** Bybit : `T` heure du trade en millisecondes, `p` prix, `v` quantité, `S` le côté du taker, qui est l'agresseur. */
function bybitTrade(market: CryptoSeriesId, row: unknown): CryptoTrade | null {
  if (!isRecord(row)) return null;
  const time = num(row.T);
  const price = positive(row.p);
  const size = positive(row.v);
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
 * Bybit : une demande refusée répond `{ success: false, ret_msg, op }`, une réussie `success: true` ; `op` ou `ret_msg`
 * valent `pong` en réponse au `ping` ; un message de données porte son `topic` (`tickers.<symbole>`,
 * `publicTrade.<symbole>`) ; les acquittements réussis et tout autre topic ne donnent rien.
 */
function parseBybit(msg: Record<string, unknown>): WsParsed[] {
  if (msg.success === false) return [{ kind: 'error', detail: errorDetail(msg.ret_msg, 'bybit: request rejected') }];
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
 * pas celui de la venue, un nombre non fini (aussi bien `abc` que `1e999`), un prix ou une quantité nuls ou négatifs,
 * une bougie qui ne se tient pas (les règles de `parseCandles`), un horodatage Coinbase qui n'est pas de l'ISO 8601
 * en UTC terminé par `Z` donnent `[{ kind: 'ignored' }]`, et une ligne invalide d'un message qui en porte plusieurs
 * est écartée sans gêner les autres. Jamais de tableau vide. Les acquittements réussis ne donnent rien ; une demande
 * refusée (Coinbase `error`, Bybit `success: false`, Binance `error`) donne `{ kind: 'error', detail }`, `detail`
 * borné à 200 caractères. `heartbeat` est la preuve de vie (le canal `heartbeat` de Coinbase, le `pong` de Bybit).
 * Une variation sur 24 h dont l'ouverture manque, est nulle ou négative, ou déborde vaut `null`.
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
