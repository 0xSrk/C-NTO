/**
 * Types du module émis vers `dist-electron/crypto/venues.js`.
 * L'implémentation est `src/engine/crypto/venues.ts`.
 */
import type { CryptoBar, CryptoSeriesId, CryptoTicker, CryptoTimeframe, CryptoTrade, CryptoVenue } from './markets';

/** Bougies chargées au moins, quel que soit le timeframe : `historyTarget` en demande davantage en 1m et en 5m. */
export const HISTORY_BARS: 500;
/**
 * Le nombre de bougies à charger : au moins `HISTORY_BARS`, et assez pour remonter à 00:00 UTC de la veille de `nowSec`
 * (le VWAP et les niveaux du jour UTC ne calculent une journée que si la fenêtre chargée en couvre le début) : de 1 441 à
 * 2 880 en 1m, de 500 à 576 en 5m, 500 au-dessus. Il fixe les requêtes, pas la coupe : l'appelant garde les bougies dont
 * `time >= min(00:00 UTC de la veille, seau courant − (HISTORY_BARS − 1) × timeframe × 60)`, par l'heure et jamais par
 * le nombre (un seau qui bascule pendant la pagination rend une bougie de plus, et garder les `historyTarget` dernières
 * perdrait celle de 00:00 UTC de la veille). Une heure ou un timeframe qui ne définissent aucune fenêtre (NaN, infini,
 * timeframe nul) donnent `HISTORY_BARS`.
 */
export function historyTarget(timeframe: CryptoTimeframe, nowSec: number): number;
/**
 * Les URLs à interroger pour l'historique d'une série, et le regroupement à appliquer aux bougies lues : `aggregate`
 * bougies de `timeframe / aggregate` minutes font une bougie de `timeframe`. L'historique remonte à
 * `historyTarget(timeframe, nowSec)` bougies. Binance et Bybit : un appel jusqu'à 1 000 bougies, avec une bougie de marge
 * (`limit = min(1000, historyTarget + 1)`) dès que la fenêtre de 00:00 UTC de la veille au seau courant compte
 * `HISTORY_BARS` bougies ou plus (`needed >= HISTORY_BARS`, le 5m dès 17:35 UTC : un seau qui bascule pendant l'appel ne
 * fait pas perdre 00:00 UTC de la veille ; 15m et au-dessus, toujours `limit=500`), sinon des pages de 1 000, de la plus
 * ancienne à la plus récente (`startTime` chez Binance, `start` chez Bybit). L'appelant coupe par l'heure (voir
 * `historyTarget`). Coinbase : des pages de 300 bougies,
 * de la plus récente à la plus ancienne (`ceil(historyTarget / 300)` pages, deux au moins ; quatre en 4 h, qui ne suit pas
 * `historyTarget`). Série ou timeframe hors du registre, `nowSec` qui n'est pas une date : aucune URL.
 */
export function historyRequests(series: CryptoSeriesId, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number };
/**
 * Les bougies d'une réponse de venue (JSON décodé), par time croissant (secondes) et sans doublon. Une ligne courte,
 * non finie ou qui ne se tient pas est écartée : prix nul ou négatif, plus haut sous le plus bas, sous l'ouverture ou
 * sous la clôture, plus bas au-dessus, volume négatif, volume acheteur (Binance) hors de 0 et du volume. Les flux
 * WebSocket appliquent les mêmes règles aux bougies de `parseWsMessage`. Ne lève que pour Bybit, sur une réponse qui
 * n'est pas un succès : `retCode` absent, non numérique ou autre que 0, ou réponse qui n'est pas un objet (`Error(retMsg)`,
 * ou un texte de repli). L'appelant l'enveloppe d'un `try/catch`.
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
/**
 * Les liquidations de tous les perps USDT de Binance : un flux à part, pour la température du marché. Elles sont
 * servies sur la route `/market` de `fstream` : le chemin sans route (`/ws/`) n'envoie plus aucune trame.
 */
export const FORCE_ORDER_URL: 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
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
/**
 * Lit un message de flux, le texte JSON tel que la socket le livre. Ne lève jamais et ne rend jamais de tableau
 * vide : un texte illisible ou coupé, une venue ou un type inconnus, un symbole hors du registre, un côté qui n'est
 * pas celui de la venue, un nombre non fini, un prix ou une quantité nuls ou négatifs, une bougie qui ne se tient pas
 * (les règles de `parseCandles`), un horodatage Coinbase qui n'est pas de l'ISO 8601 en UTC terminé par `Z` donnent
 * `[{ kind: 'ignored' }]` ; un message de trades porte un trade par ligne valide. Les acquittements réussis ne
 * donnent rien ; une demande refusée (Coinbase `error`, Bybit `success: false`, Binance `error`) donne
 * `{ kind: 'error', detail }`, `detail` borné à 200 caractères. `heartbeat` est la preuve de vie.
 */
export function parseWsMessage(venue: CryptoVenue, raw: string): WsParsed[];
