/**
 * Types du module émis vers `dist-electron/crypto/temperature.js`.
 * L'implémentation est `src/engine/crypto/temperature.ts`.
 */

/**
 * Les quatre lectures de la température, chacune avec l'heure de son relevé (millisecondes) ; `null` tant qu'une
 * lecture n'a pas eu lieu. Les liquidations sont toujours là : elles partent de zéro au lancement du desk.
 */
export interface TemperatureReading {
  /** Taux de financement des perps USDT, en fraction (0,0001 vaut 0,01 %) : la médiane, celui de BTCUSDT, le nombre de symboles lus. */
  funding: { median: number; btc: number | null; symbols: number; at: number } | null;
  /** Largeur du spot : la part, de 0 à 1, des paires USDT échangées qui ont monté sur 24 h, et leur nombre. */
  breadth: { upShare: number; pairs: number; at: number } | null;
  /** Liquidations de la fenêtre glissante, en dollars US, depuis `since`. Un minorant : `lowerBound` vaut toujours vrai. */
  liquidations: { long: number; short: number; since: number; at: number; lowerBound: true };
  /** Variation de l'open interest sur 24 h, en fraction, pour BTC et ETH. */
  openInterest: { btc: number | null; eth: number | null; at: number } | null;
}
/** La lecture d'un desk qui vient de s'ouvrir : aucune lecture, et des liquidations à zéro depuis `startedAt` (millisecondes). */
export function emptyReading(startedAt: number): TemperatureReading;
/**
 * Le funding des perps USDT d'après la réponse de `/fapi/v1/premiumIndex` (JSON décodé) : la médiane des
 * `lastFundingRate` (moyenne des deux du milieu si le nombre est pair) et celui de `BTCUSDT`, en fractions. Seuls
 * comptent les symboles qui finissent par `USDT` avec un taux fini. Pas de taux lisible, ou pas une liste : `null`.
 */
export function fundingFromPremiumIndex(json: unknown, at: number): TemperatureReading['funding'];
/**
 * La largeur du spot d'après la réponse de `/api/v3/ticker/24hr` : la part des paires en USDT échangées (`count`
 * positif) dont `priceChangePercent` est positif. Une paire illisible est écartée. Aucune paire, ou pas une liste : `null`.
 */
export function breadthFromTickers(json: unknown, at: number): TemperatureReading['breadth'];
/**
 * La variation de l'open interest d'après la réponse de `/futures/data/openInterestHist` : `sumOpenInterest` du
 * dernier point (par `timestamp`) sur celui du premier, moins 1. Moins de deux points lisibles, ou pas une liste : `null`.
 */
export function oiChange(json: unknown): number | null;
/**
 * Les liquidations de la dernière heure (ou de `windowMs`), en dollars US. `startedAt` : l'instant où la fenêtre commence
 * à écouter. `push` lit un message brut du flux `!forceOrder@arr` et ne lève jamais : un message illisible n'ajoute rien.
 * `totals(now)` rend les montants des liquidations longues (ordre `SELL`) et courtes (ordre `BUY`) des `windowMs`
 * écoulées, et `since = max(startedAt, now − windowMs)`. Un minorant : Binance ne pousse qu'une liquidation par symbole
 * et par seconde.
 */
export class LiquidationWindow {
  constructor(startedAt: number, windowMs?: number);
  push(raw: string): void;
  totals(now: number): { long: number; short: number; since: number };
}
