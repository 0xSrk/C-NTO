/**
 * La température du marché lue chez Binance (`docs/ONGLET-CRYPTO.md` § 6) : ce module transforme en lecture les
 * réponses déjà reçues, sans réseau ni horloge. Le funding médian des perps USDT et celui de BTC
 * (`/fapi/v1/premiumIndex`), la largeur du spot (`/api/v3/ticker/24hr`), la variation sur 24 h de l'open interest
 * de BTC et d'ETH (`/futures/data/openInterestHist`) et les liquidations de l'heure écoulée (flux
 * `!forceOrder@arr`, dans `LiquidationWindow`).
 * Partagé par le process principal, qui interroge Binance et tient la lecture (`electron/crypto-temperature.ts`),
 * et par le renderer, qui en reçoit le type (émis vers `dist-electron/crypto/temperature.js` par
 * `electron/tsconfig.sources.json`). Aucun import : ce module tourne des deux côtés, et le process principal le
 * compile seul. Les heures sont en millisecondes et viennent de l'appelant.
 * Un nombre d'exchange passe par `Number(...)` puis `Number.isFinite` : une ligne qui n'en tient pas un est
 * écartée, jamais propagée. Rien ne lève : une réponse illisible donne `null`, ou n'ajoute rien à la fenêtre.
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

/** Largeur de la fenêtre des liquidations, en millisecondes : une heure. */
const DEFAULT_WINDOW_MS = 3_600_000;
/** Avance qu'une liquidation peut avoir sur l'horloge de l'appelant, en millisecondes : celle de Binance et celle du poste ne coïncident qu'à quelques secondes près. */
const FUTURE_SKEW_MS = 60_000;
/** Le montant, en dollars US, au-delà duquel un message ne décrit pas une liquidation : une donnée corrompue ou forgée, pas un marché. */
const MAX_LIQUIDATION_USD = 1e12;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Un nombre d'exchange : `Number(...)` puis `Number.isFinite`. Ni `null`, ni booléen, ni tableau, ni chaîne vide ne passent pour 0. */
function num(v: unknown): number | null {
  if (typeof v !== 'number' && (typeof v !== 'string' || v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Un nombre d'exchange strictement positif : un zéro ou un négatif n'est ni un prix, ni une quantité, ni une heure, ni un open interest. */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

/** Le résultat d'un calcul sur des nombres d'exchange, ou `null` s'il déborde. */
const finiteOrNull = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** Vrai si la ligne porte un symbole en USDT (`BTCUSDT`) : ni contrat à livraison (`ETHUSDT_261225`), ni autre monnaie de cotation (`BTCUSDC`). */
function isUsdt(row: Record<string, unknown>): boolean {
  return typeof row.symbol === 'string' && row.symbol.endsWith('USDT');
}

/** La lecture d'un desk qui vient de s'ouvrir : aucune lecture, et des liquidations à zéro depuis `startedAt` (millisecondes). */
export function emptyReading(startedAt: number): TemperatureReading {
  return {
    funding: null,
    breadth: null,
    liquidations: { long: 0, short: 0, since: startedAt, at: startedAt, lowerBound: true },
    openInterest: null,
  };
}

/** La médiane de valeurs finies, moyenne des deux du milieu quand leur nombre est pair ; `null` sans valeur ou si la moyenne déborde. */
function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid];
  if (high === undefined) return null;
  if (sorted.length % 2 === 1) return high;
  const low = sorted[mid - 1];
  return low === undefined ? null : finiteOrNull((low + high) / 2);
}

/**
 * Le funding des perps USDT, d'après la réponse de `/fapi/v1/premiumIndex` (le JSON déjà décodé, une ligne par
 * contrat) : la médiane des `lastFundingRate`, moyenne des deux du milieu quand leur nombre est pair, et celui de
 * `BTCUSDT`, en fractions (0,0001 vaut 0,01 %). Seuls comptent les symboles qui finissent par `USDT` et dont le
 * taux est un nombre fini : un contrat à livraison, un symbole en USDC ou une cote sans taux (chaîne vide) est
 * écarté. `symbols` est le nombre de taux lus. Pas de taux lisible, ou réponse qui n'est pas une liste : `null`.
 */
export function fundingFromPremiumIndex(json: unknown, at: number): TemperatureReading['funding'] {
  if (!Array.isArray(json)) return null;
  const rates: number[] = [];
  let btc: number | null = null;
  for (const row of json) {
    if (!isRecord(row) || !isUsdt(row)) continue;
    const rate = num(row.lastFundingRate);
    if (rate === null) continue;
    rates.push(rate);
    if (row.symbol === 'BTCUSDT') btc = rate;
  }
  const mid = median(rates);
  return mid === null ? null : { median: mid, btc, symbols: rates.length, at };
}

/**
 * La largeur du spot, d'après la réponse de `/api/v3/ticker/24hr` (une ligne par paire) : la part, de 0 à 1, des paires
 * en USDT échangées sur 24 h (`count` positif, ce qui écarte les cotes retirées) dont `priceChangePercent` est
 * strictement positif. Une paire à 0 % est comptée sans être en hausse ; une dont la variation ou le nombre de trades
 * ne se lit pas est écartée, au lieu d'être comptée à la baisse. Aucune paire retenue, ou réponse qui n'est pas une
 * liste : `null`.
 */
export function breadthFromTickers(json: unknown, at: number): TemperatureReading['breadth'] {
  if (!Array.isArray(json)) return null;
  let pairs = 0;
  let up = 0;
  for (const row of json) {
    if (!isRecord(row) || !isUsdt(row)) continue;
    const trades = positive(row.count);
    const change = num(row.priceChangePercent);
    if (trades === null || change === null) continue;
    pairs += 1;
    if (change > 0) up += 1;
  }
  return pairs === 0 ? null : { upShare: up / pairs, pairs, at };
}

/**
 * La variation de l'open interest sur la période d'une réponse de `/futures/data/openInterestHist` : le
 * `sumOpenInterest` du dernier point sur celui du premier, moins 1 (0,024 vaut +2,4 %). Les points sont classés par
 * `timestamp` ; un point sans `timestamp` fini ou sans `sumOpenInterest` strictement positif est écarté. Moins de
 * deux points, ou réponse qui n'est pas une liste : `null`.
 */
export function oiChange(json: unknown): number | null {
  if (!Array.isArray(json)) return null;
  const points: { time: number; value: number }[] = [];
  for (const row of json) {
    if (!isRecord(row)) continue;
    const time = num(row.timestamp);
    const value = positive(row.sumOpenInterest);
    if (time !== null && value !== null) points.push({ time, value });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.time - b.time);
  const first = points[0];
  const last = points[points.length - 1];
  return first === undefined || last === undefined ? null : finiteOrNull(last.value / first.value - 1);
}

/** Une liquidation retenue par `LiquidationWindow`. */
interface Liquidation {
  /** Heure de l'ordre, en millisecondes. */
  time: number;
  /** Vrai pour une position longue liquidée, faux pour une courte. */
  long: boolean;
  /** Montant en dollars US. */
  usd: number;
}

/** Prix × quantité, si les deux sont strictement positifs et si leur produit est un nombre fini et positif. */
function notional(price: unknown, quantity: unknown): number | null {
  const p = positive(price);
  const q = positive(quantity);
  if (p === null || q === null) return null;
  const value = p * q;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * La liquidation d'un message du flux `!forceOrder@arr`, `{ e: 'forceOrder', E, o: { S, q, p, ap, z, T, … } }`, ou
 * `null` si le message n'en est pas une ou ne se tient pas. `S` dit le côté de l'ordre forcé : `SELL` liquide une
 * position longue, `BUY` une courte ; tout autre côté est écarté. Le montant est le prix moyen exécuté × la quantité
 * exécutée (`ap` × `z`) quand ils sont tous deux positifs, sinon le prix × la quantité de l'ordre (`p` × `q`). L'heure
 * est celle de l'ordre (`T`), à défaut celle de l'événement (`E`) : sans l'une ni l'autre, la liquidation ne peut
 * pas être placée dans la fenêtre. Un montant retenu de plus de `MAX_LIQUIDATION_USD` écarte la liquidation, sans retomber
 * sur `p` × `q` : une somme de montants bornés reste un nombre fini.
 */
function readLiquidation(raw: string): Liquidation | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (!isRecord(msg) || msg.e !== 'forceOrder' || !isRecord(msg.o)) return null;
    const order = msg.o;
    const long = order.S === 'SELL' ? true : order.S === 'BUY' ? false : null;
    const time = positive(order.T) ?? positive(msg.E);
    const usd = notional(order.ap, order.z) ?? notional(order.p, order.q);
    return long === null || time === null || usd === null || usd > MAX_LIQUIDATION_USD ? null : { time, long, usd };
  } catch {
    return null;
  }
}

/**
 * Les liquidations de la dernière heure (ou de `windowMs`), longues et courtes, en dollars US. Une instance par
 * lancement du desk : `startedAt` est l'instant où elle commence à écouter. `push` lit un message brut du flux
 * `!forceOrder@arr` (`readLiquidation`) ; un message illisible n'ajoute rien et ne lève pas.
 * C'est un minorant : Binance ne pousse, pour chaque symbole, que la dernière liquidation de chaque seconde, et la
 * fenêtre repart de zéro à chaque lancement. `totals(now)` compte les liquidations dont l'heure de l'ordre est au plus
 * `windowMs` avant `now`, bornes comprises, et rend avec elles `since = max(startedAt, now − windowMs)`, l'instant
 * depuis lequel la fenêtre écoute. Il ne change pas l'état : il répond de la même façon quel que soit l'ordre des questions.
 * La mémoire reste bornée sur plusieurs jours : une liquidation datée de plus de `windowMs` avant la plus récente reçue
 * est oubliée, ou refusée si elle arrive ainsi. Une liquidation datée d'avant `startedAt` mais reçue après lui est
 * comptée : l'horloge du poste peut avancer sur celle de Binance, et la perdre fausserait le minorant sans le dire.
 * Avec `now`, l'horloge de l'appelant (millisecondes), `push` écarte une liquidation datée de plus de 60 s après elle :
 * sans cette garde, une heure d'ordre lointaine ferait de « la plus récente » une borne que rien d'actuel n'atteint, et
 * la fenêtre refuserait toute liquidation jusqu'au prochain lancement. Sans `now`, ou avec une valeur qui n'est pas un
 * nombre fini, la garde ne s'applique pas. Une liquidation de plus de 1e12 dollars est toujours écartée (voir
 * `readLiquidation`) : aucun `Infinity` ne sort de `totals`.
 */
export class LiquidationWindow {
  private readonly startedAt: number;
  private readonly windowMs: number;
  /** Les liquidations retenues, dans l'ordre d'arrivée. */
  private readonly held: Liquidation[] = [];
  /** L'heure de la plus récente liquidation reçue : la mémoire se compte à partir d'elle. */
  private newest = Number.NEGATIVE_INFINITY;

  constructor(startedAt: number, windowMs = DEFAULT_WINDOW_MS) {
    this.startedAt = startedAt;
    this.windowMs = windowMs;
  }

  push(raw: string, now?: number): void {
    const event = readLiquidation(raw);
    if (event === null) return;
    if (typeof now === 'number' && Number.isFinite(now) && event.time - now > FUTURE_SKEW_MS) return;
    this.newest = Math.max(this.newest, event.time);
    const oldest = this.newest - this.windowMs;
    if (event.time < oldest) return;
    this.held.push(event);
    let expired = 0;
    for (const kept of this.held) {
      if (kept.time >= oldest) break;
      expired++;
    }
    if (expired > 0) this.held.splice(0, expired);
  }

  totals(now: number): { long: number; short: number; since: number } {
    const oldest = now - this.windowMs;
    let long = 0;
    let short = 0;
    for (const event of this.held) {
      if (event.time < oldest) continue;
      if (event.long) long += event.usd;
      else short += event.usd;
    }
    return { long, short, since: Math.max(this.startedAt, oldest) };
  }
}
