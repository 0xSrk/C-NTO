/**
 * Les alertes de l'onglet crypto, côté renderer seulement (`docs/ONGLET-CRYPTO.md` § 8) : le modèle et les unités du
 * niveau, les bandes d'hystérésis, la valeur qu'une alerte surveille, l'évaluateur de croisement, la règle « non évaluée »
 * et l'assainisseur de la ligne `crypto.alerts`. Rien ici ne lit d'horloge ni de réseau : l'appelant donne les valeurs et
 * l'heure, ce module dit s'il y a eu franchissement et si une alerte peut être évaluée.
 * Il n'est pas émis pour le process principal (absent de `electron/tsconfig.sources.json`, sans `.d.ts`) et n'importe
 * que `./markets` et `./temperature`.
 */
import { cryptoMarket, isChartableMarket, type CryptoMarketId, type CryptoTicker, type CryptoVenue, type VenueState } from './markets';
import type { TemperatureReading } from './temperature';

export type PriceAlertKind = 'price_above' | 'price_below';
export type TemperatureAlertKind =
  | 'funding_median_above'
  | 'funding_median_below'
  | 'liquidations_long_1h_above'
  | 'liquidations_short_1h_above'
  | 'breadth_above'
  | 'breadth_below';
export type CryptoAlertKind = PriceAlertKind | TemperatureAlertKind;

/**
 * Une alerte. `level` est dans l'unité affichée à l'écran :
 * - prix : la devise de cotation du marché (`85000` pour BTC-USD, `0.002163` pour ONEUSDT) ;
 * - funding : le pourcentage par intervalle de financement (`0.01` vaut 0,01 %), comparé à `median × 100` ;
 * - liquidations de l'heure : des dollars US ;
 * - largeur du spot : des points de pourcentage (`40` vaut 40 %), comparés à `upShare × 100`.
 * Une alerte de prix vise un marché affichable, une alerte de température vise `'temperature'`. L'état d'évaluation
 * (donnée périmée, voyant bloqué) se calcule à l'écran, il n'est jamais enregistré.
 */
export interface CryptoAlert {
  id: string;
  target: CryptoMarketId | 'temperature';
  kind: CryptoAlertKind;
  level: number;
  mode: 'once' | 'rearm';
  author: 'trader' | 'agent';
  state: 'armed' | 'triggered' | 'paused';
  /** Millisecondes. */
  createdAt: number;
  /** Millisecondes. */
  lastTriggeredAt?: number;
}

/** Le plafond des alertes enregistrées. */
export const ALERTS_MAX = 50;

/** Longueur maximale d'un identifiant d'alerte. */
const ID_MAX = 64;

/** Les huit genres d'alerte et le côté du niveau que chacun surveille. */
const DIRECTION: Record<CryptoAlertKind, 'above' | 'below'> = {
  price_above: 'above',
  price_below: 'below',
  funding_median_above: 'above',
  funding_median_below: 'below',
  liquidations_long_1h_above: 'above',
  liquidations_short_1h_above: 'above',
  breadth_above: 'above',
  breadth_below: 'below',
};

/** Les huit genres d'alerte, dans l'ordre du § 8 : ceux de prix, puis ceux de température. */
export const CRYPTO_ALERT_KINDS: readonly CryptoAlertKind[] = Object.keys(DIRECTION) as CryptoAlertKind[];

/** Bandes d'hystérésis (§ 8) : prix et liquidations en part du niveau, funding et largeur en points de l'unité du niveau. */
const PRICE_BAND = 0.001;
const FUNDING_BAND = 0.0005;
const LIQUIDATIONS_BAND = 0.05;
const BREADTH_BAND = 1;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Comme `db.ts` : une clé propre `__proto__` ou `constructor` fait écarter l'entrée, jamais copier. */
const hasUnsafeKey = (rec: object): boolean => Object.prototype.hasOwnProperty.call(rec, '__proto__') || Object.prototype.hasOwnProperty.call(rec, 'constructor');

function isAlertKind(v: unknown): v is CryptoAlertKind {
  return typeof v === 'string' && (CRYPTO_ALERT_KINDS as readonly string[]).includes(v);
}

function isPriceKind(kind: CryptoAlertKind): kind is PriceAlertKind {
  return kind === 'price_above' || kind === 'price_below';
}

/** Le côté du niveau que le genre surveille : le prix, le funding ou la largeur monte au-dessus, ou tombe en dessous. */
export function alertDirection(kind: CryptoAlertKind): 'above' | 'below' {
  return DIRECTION[kind];
}

/**
 * La bande d'hystérésis du genre, dans l'unité du niveau : après une alerte, la valeur doit revenir de plus que la
 * bande de l'autre côté du niveau avant que l'alerte puisse se déclencher de nouveau.
 * Prix : 0,1 % du niveau, jamais une largeur fixe (ONE vaut 0,002163, BTC 82 528). Funding : 0,0005 point.
 * Liquidations : 5 % du niveau. Largeur : 1 point. Jamais négative : une bande négative réarmerait l'alerte avant le
 * franchissement.
 */
export function hysteresisBand(kind: CryptoAlertKind, level: number): number {
  switch (kind) {
    case 'price_above':
    case 'price_below':
      return Math.abs(level) * PRICE_BAND;
    case 'funding_median_above':
    case 'funding_median_below':
      return FUNDING_BAND;
    case 'liquidations_long_1h_above':
    case 'liquidations_short_1h_above':
      return Math.abs(level) * LIQUIDATIONS_BAND;
    case 'breadth_above':
    case 'breadth_below':
      return BREADTH_BAND;
  }
}

/** Un nombre fini, ou `null` : ni donnée absente, ni `NaN`, ni infini, ni autre type. */
function finite(v: unknown): number | null {
  return isNum(v) ? v : null;
}

/** Un nombre fini multiplié par `factor`, ou `null` si l'un ou l'autre n'est pas fini. */
function scaled(v: unknown, factor: number): number | null {
  const n = finite(v);
  return n === null ? null : finite(n * factor);
}

/**
 * La valeur que l'alerte surveille, dans l'unité de son niveau : le dernier prix du marché visé ; le funding médian en
 * pourcentage (`median × 100`) ; les liquidations longues ou courtes de l'heure en dollars ; la largeur du spot en
 * points de pourcentage (`upShare × 100`). `null` quand la donnée manque (ticker absent, relevé absent, lecture
 * absente) ou n'est pas un nombre fini : une alerte ne s'évalue jamais sur du `NaN`.
 */
export function alertValue(alert: CryptoAlert, data: { tickers: Partial<Record<CryptoMarketId, CryptoTicker>>; temperature: TemperatureReading | null }): number | null {
  switch (alert.kind) {
    case 'price_above':
    case 'price_below':
      return finite(isChartableMarket(alert.target) ? data.tickers[alert.target]?.last : undefined);
    case 'funding_median_above':
    case 'funding_median_below':
      return scaled(data.temperature?.funding?.median, 100);
    case 'liquidations_long_1h_above':
      return finite(data.temperature?.liquidations?.long);
    case 'liquidations_short_1h_above':
      return finite(data.temperature?.liquidations?.short);
    case 'breadth_above':
    case 'breadth_below':
      return scaled(data.temperature?.breadth?.upShare, 100);
  }
}

/**
 * Les décimales d'une valeur dans l'unité de l'alerte, celles de l'affichage (`alertLevelText`, `src/lib/cryptoAlertText.ts`) :
 * un prix à la précision de son marché, le funding à 4 décimales de pourcent, les liquidations au dollar, la largeur à une
 * décimale de point.
 */
export function alertValueDecimals(alert: Pick<CryptoAlert, 'target' | 'kind'>): number {
  switch (alert.kind) {
    case 'price_above':
    case 'price_below':
      return cryptoMarket(alert.target)?.precision ?? 2;
    case 'funding_median_above':
    case 'funding_median_below':
      return 4;
    case 'liquidations_long_1h_above':
    case 'liquidations_short_1h_above':
      return 0;
    case 'breadth_above':
    case 'breadth_below':
      return 1;
  }
}

/**
 * Une valeur arrondie aux décimales d'affichage de l'alerte (`alertValueDecimals`), sans le bruit des produits de flottants
 * (0,00011 × 100 = 0,011000000000000001) : c'est elle que l'événement `crypto_alert` porte à l'agent. `null` reste `null`, une
 * valeur non finie devient `null`, et un zéro négatif devient 0.
 */
export function roundAlertValue(alert: Pick<CryptoAlert, 'target' | 'kind'>, value: number | null): number | null {
  if (!isNum(value)) return null;
  const factor = 10 ** alertValueDecimals(alert);
  const rounded = Math.round(value * factor) / factor;
  return Number.isFinite(rounded) ? rounded + 0 : null;
}

/**
 * Âge au-delà duquel une lecture de température ne s'évalue plus : deux cadences du process principal
 * (`electron/crypto-temperature.ts`). Le funding est relevé toutes les 60 s, et les liquidations sont redatées au moins à
 * chaque relevé : 120 s. La largeur et l'open interest sont relevés toutes les 5 min : 10 min.
 */
export const FUNDING_STALE_MS = 120_000;
export const SLOW_STALE_MS = 600_000;

/** Les relevés dont une alerte de température dépend : un par famille de genres. */
export type AlertReading = 'funding' | 'liquidations' | 'breadth';

/**
 * Pourquoi une alerte armée n'est pas évaluée en ce moment, en code stable (l'écran et `crypto_alert_list` le disent en
 * clair) :
 * - `venue` : la venue de la donnée n'est pas en direct (prix : celle du marché, qui doit être `live`) ou, pour la température,
 *   Binance est `blocked` ou `stale` ;
 * - `no_price` : la venue est en direct mais aucun prix n'est arrivé ;
 * - `no_temperature` : aucune lecture de la température ;
 * - `no_reading` / `stale_reading` : le relevé dont le genre dépend manque, ou a plus de deux cadences.
 */
export type AlertIdleReason =
  | { code: 'venue'; venue: CryptoVenue; state: VenueState }
  | { code: 'no_price' }
  | { code: 'no_temperature' }
  | { code: 'no_reading'; source: AlertReading }
  | { code: 'stale_reading'; source: AlertReading };

export type AlertEvaluability = { ok: true } | { ok: false; reason: AlertIdleReason };

/** Les données dont l'évaluabilité dépend : l'état des venues, les derniers prix, la dernière lecture et l'heure (millisecondes). */
export interface EvaluabilityData {
  venues: Readonly<Record<CryptoVenue, VenueState>>;
  tickers: Partial<Record<CryptoMarketId, CryptoTicker>>;
  temperature: TemperatureReading | null;
  now: number;
}

/**
 * Binance porte chaque relevé de la température : `blocked` ou `stale`, aucun ne s'évalue ni ne se lit frais. La règle de
 * `alertEvaluability` et du `stale` de `crypto_temperature`.
 */
export function temperatureVenueDown(binance: VenueState | undefined): boolean {
  return binance === 'blocked' || binance === 'stale';
}

/** Le relevé dont dépend un genre de température, et son âge maximal. */
function readingOf(kind: CryptoAlertKind): { source: AlertReading; maxAge: number } {
  switch (kind) {
    case 'funding_median_above':
    case 'funding_median_below':
      return { source: 'funding', maxAge: FUNDING_STALE_MS };
    case 'breadth_above':
    case 'breadth_below':
      return { source: 'breadth', maxAge: SLOW_STALE_MS };
    default:
      // Les deux genres de liquidations (un genre de prix vise un marché et ne passe pas ici).
      return { source: 'liquidations', maxAge: FUNDING_STALE_MS };
  }
}

/**
 * Si une alerte armée peut être évaluée en ce moment : la seule règle « non évaluée », celle de l'écran (colonne de l'onglet),
 * de l'évaluateur du desk (donnée `fresh`) et de `crypto_alert_list`. L'appelant écarte lui-même une alerte qui n'est pas armée.
 * - Prix : la venue du marché visé doit être `live`, et un prix doit être arrivé.
 * - Température : Binance ne doit pas être `blocked` ni `stale` (c'est elle qui porte les relevés), une lecture doit exister, et
 *   le relevé du genre doit dater de moins de deux cadences (`FUNDING_STALE_MS`, `SLOW_STALE_MS`). Un relevé absent, ou dont
 *   l'heure n'est pas un nombre fini, est « absent », jamais « périmé ».
 * Aucune horloge ici : `now` vient de l'appelant.
 */
export function alertEvaluability(alert: CryptoAlert, data: EvaluabilityData): AlertEvaluability {
  const { target } = alert;
  if (isChartableMarket(target)) {
    const spec = cryptoMarket(target);
    const state = spec ? data.venues[spec.venue] : 'off';
    if (spec && state !== 'live') return { ok: false, reason: { code: 'venue', venue: spec.venue, state } };
    return data.tickers[target] ? { ok: true } : { ok: false, reason: { code: 'no_price' } };
  }
  const binance = data.venues.binance;
  if (temperatureVenueDown(binance)) return { ok: false, reason: { code: 'venue', venue: 'binance', state: binance } };
  const reading = data.temperature;
  if (!reading) return { ok: false, reason: { code: 'no_temperature' } };
  const { source, maxAge } = readingOf(alert.kind);
  const at = reading[source]?.at;
  if (!isNum(at)) return { ok: false, reason: { code: 'no_reading', source } };
  return data.now - at > maxAge ? { ok: false, reason: { code: 'stale_reading', source } } : { ok: true };
}

/**
 * Évaluateur de croisement d'un niveau, de la même sémantique que `ThresholdWatch` (`src/engine/agent/events.ts`) : le
 * premier pas pose le côté sans alerter ; un franchissement alerte une seule fois.
 * En direction `above`, `step` rend `true` quand la valeur était du côté « en dessous » et atteint le niveau
 * (`value >= level`) ; elle passe alors du côté « au-dessus » et n'en revient qu'une fois sous `level − band`. En
 * direction `below`, c'est le miroir : `value <= level` franchit, `value > level + band` réarme. Une valeur qui n'est
 * pas finie est ignorée : elle ne pose pas le côté et ne franchit rien.
 */
export class CrossWatch {
  /** Vrai quand la valeur est du côté du franchissement ; `null` avant le premier pas. */
  private beyond: boolean | null = null;

  constructor(
    private readonly direction: 'above' | 'below',
    private readonly level: number,
    private readonly band: number,
  ) {}

  /** `true` quand ce pas franchit le niveau, `false` sinon. */
  step(value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const above = this.direction === 'above';
    const reached = above ? value >= this.level : value <= this.level;
    if (this.beyond === null) {
      this.beyond = reached;
      return false;
    }
    if (!this.beyond) {
      this.beyond = reached;
      return reached;
    }
    const released = above ? value < this.level - this.band : value > this.level + this.band;
    if (released) this.beyond = false;
    return false;
  }
}

/** Une alerte de prix vise un marché affichable, une alerte de température vise `'temperature'`. */
function targetFits(kind: CryptoAlertKind, target: unknown): target is CryptoAlert['target'] {
  return isPriceKind(kind) ? isChartableMarket(target) : target === 'temperature';
}

/**
 * Un niveau fini dans le domaine de son unité : un prix et des liquidations strictement positifs, une largeur de 0 à 100
 * points, un funding de n'importe quel signe. Hors de ce domaine, l'alerte ne pourrait jamais se déclencher.
 */
function levelFits(kind: CryptoAlertKind, level: unknown): level is number {
  if (!isNum(level)) return false;
  switch (kind) {
    case 'price_above':
    case 'price_below':
    case 'liquidations_long_1h_above':
    case 'liquidations_short_1h_above':
      return level > 0;
    case 'breadth_above':
    case 'breadth_below':
      return level >= 0 && level <= 100;
    case 'funding_median_above':
    case 'funding_median_below':
      return true;
  }
}

/**
 * Valide une alerte avant sa création. Le genre se juge d'abord, puis la cible (un marché affichable pour un prix,
 * `'temperature'` sinon), puis le niveau (fini, dans le domaine de son unité).
 */
export function validateAlert(input: Omit<CryptoAlert, 'id' | 'state' | 'createdAt'>): { ok: true } | { ok: false; reason: 'bad_target' | 'bad_kind' | 'bad_level' } {
  const { kind, target, level } = input;
  if (!isAlertKind(kind)) return { ok: false, reason: 'bad_kind' };
  if (!targetFits(kind, target)) return { ok: false, reason: 'bad_target' };
  if (!levelFits(kind, level)) return { ok: false, reason: 'bad_level' };
  return { ok: true };
}

/** Une alerte lue dans une ligne enregistrée : un objet neuf aux seuls champs du modèle, ou `undefined` si elle ne tient pas. */
function readAlert(raw: unknown): CryptoAlert | undefined {
  if (!isRec(raw) || hasUnsafeKey(raw)) return undefined;
  const { id, target, kind, level, mode, author, state, createdAt, lastTriggeredAt } = raw;
  if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return undefined;
  if (!isAlertKind(kind) || !targetFits(kind, target) || !levelFits(kind, level)) return undefined;
  if (mode !== 'once' && mode !== 'rearm') return undefined;
  if (author !== 'trader' && author !== 'agent') return undefined;
  if (state !== 'armed' && state !== 'triggered' && state !== 'paused') return undefined;
  if (!isNum(createdAt)) return undefined;
  if (lastTriggeredAt !== undefined && !isNum(lastTriggeredAt)) return undefined;
  const alert: CryptoAlert = { id, target, kind, level, mode, author, state, createdAt };
  if (lastTriggeredAt !== undefined) alert.lastTriggeredAt = lastTriggeredAt;
  return alert;
}

/**
 * Assainit la ligne `crypto.alerts` : `undefined` pour une valeur qui n'est pas un tableau (ou qui ne se lit pas),
 * sinon un tableau neuf des alertes valides. Une entrée invalide est écartée seule ; un id déjà vu aussi ; le plafond
 * de `ALERTS_MAX` se compte sur les alertes gardées. Ne lève pas, ne modifie pas son entrée.
 */
export function sanitizeAlerts(v: unknown): CryptoAlert[] | undefined {
  try {
    if (!Array.isArray(v)) return undefined;
    const out: CryptoAlert[] = [];
    const ids = new Set<string>();
    for (const raw of v) {
      if (out.length >= ALERTS_MAX) break;
      const alert = readAlert(raw);
      if (alert === undefined || ids.has(alert.id)) continue;
      ids.add(alert.id);
      out.push(alert);
    }
    return out;
  } catch {
    return undefined;
  }
}
