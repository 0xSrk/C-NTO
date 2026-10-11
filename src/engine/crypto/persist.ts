/**
 * Ce que l'onglet crypto garde dans la table `settings`, côté renderer seulement (`docs/ONGLET-CRYPTO.md` § 8) : le
 * modèle d'un tracé et les assainisseurs des lignes `crypto.chart`, `crypto.watchlist` et `crypto.drawings` (celui de
 * `crypto.alerts` est dans `./alerts`). Le store les applique à la lecture, et le coffre à la restauration
 * (`SETTING_ROW_SANITIZERS` de `src/store/db.ts`).
 * Chacun rend `undefined` pour une valeur de la mauvaise forme, sinon une copie neuve où seul ce qui est valide reste :
 * une entrée invalide est écartée seule, les plafonds sont tenus, un id déjà vu n'est gardé qu'une fois. Aucun ne lève et
 * aucun ne modifie son entrée. Comme `db.ts`, une entrée qui porte `__proto__` ou `constructor` comme clé propre est
 * écartée, jamais copiée ; une chaîne trop longue rend l'entrée invalide, elle n'est pas tronquée.
 * Ce module n'est pas émis pour le process principal (absent de `electron/tsconfig.sources.json`, sans `.d.ts`).
 */
import type { IndicatorInstance } from '@/engine/indicators';
import { cryptoIndicatorById } from './indicators';
import { isChartableMarket, isCryptoTimeframe, type CryptoMarketId, type CryptoTimeframe } from './markets';

/**
 * Un tracé du chart, dans la devise de cotation du marché : un niveau (`price`) ou une zone (`from` < `to`). `label` fait
 * `LABEL_MAX` caractères au plus.
 */
export interface CryptoDrawing {
  id: string;
  market: CryptoMarketId;
  kind: 'level' | 'zone';
  price?: number;
  from?: number;
  to?: number;
  label?: string;
  author: 'trader' | 'agent';
  /** Millisecondes. */
  createdAt: number;
}

/** Le plafond des tracés enregistrés. */
export const DRAWINGS_MAX = 100;
/** Longueur maximale du label d'un tracé. */
export const LABEL_MAX = 40;

/** Le réglage du chart : marché, timeframe (minutes) et indicateurs. */
export interface CryptoChartSetting {
  market: CryptoMarketId;
  timeframe: CryptoTimeframe;
  indicators: IndicatorInstance[];
}

/** Longueur maximale d'un identifiant de tracé. */
const ID_MAX = 64;
/** Comme `chart.indicators` (`db.ts`) : 50 indicateurs au plus, 100 caractères au plus par id, definitionId et paramètre texte. */
export const INDICATORS_MAX = 50;
const INDICATOR_TEXT_MAX = 100;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Un prix de marché : fini et strictement positif. */
const isPrice = (v: unknown): v is number => isNum(v) && v > 0;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Comme `db.ts` : une clé propre `__proto__` ou `constructor` fait écarter l'entrée, jamais copier. */
const hasUnsafeKey = (rec: object): boolean => Object.prototype.hasOwnProperty.call(rec, '__proto__') || Object.prototype.hasOwnProperty.call(rec, 'constructor');
/** Une chaîne non vide de `max` caractères au plus. */
const isId = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Les entrées valides d'une liste, jusqu'à `max`, dans leur ordre ; une entrée invalide ou qui reprend un id déjà vu est
 * écartée, et le plafond se compte sur les entrées gardées.
 */
function readList<T extends { id: string }>(items: readonly unknown[], max: number, read: (raw: unknown) => T | undefined): T[] {
  const out: T[] = [];
  const ids = new Set<string>();
  for (const raw of items) {
    if (out.length >= max) break;
    const item = read(raw);
    if (item === undefined || ids.has(item.id)) continue;
    ids.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Un indicateur du chart : la forme de `chart.indicators` (`db.ts`) avec un `definitionId` du catalogue crypto. Les
 * paramètres sont des nombres finis ou des chaînes de 100 caractères au plus ; l'instance rendue est neuve, paramètres compris.
 */
function readIndicator(raw: unknown): IndicatorInstance | undefined {
  if (!isRec(raw) || hasUnsafeKey(raw)) return undefined;
  const { id, definitionId, visible, params } = raw;
  if (!isId(id, INDICATOR_TEXT_MAX) || !isId(definitionId, INDICATOR_TEXT_MAX) || typeof visible !== 'boolean') return undefined;
  if (cryptoIndicatorById(definitionId) === undefined) return undefined;
  if (!isRec(params) || hasUnsafeKey(params)) return undefined;
  const copy: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!isNum(value) && !(typeof value === 'string' && value.length <= INDICATOR_TEXT_MAX)) return undefined;
    copy[key] = value;
  }
  return { id, definitionId, visible, params: copy };
}

/**
 * Assainit la ligne `crypto.chart` : `undefined` si la valeur n'est pas un objet, si son marché n'est pas affichable, si
 * son timeframe n'est pas l'un des six ou si ses indicateurs ne forment pas un tableau ; sinon un réglage neuf dont les
 * indicateurs invalides sont écartés. Le store retombe sur ses défauts quand elle rend `undefined`.
 */
export function sanitizeCryptoChart(v: unknown): CryptoChartSetting | undefined {
  try {
    if (!isRec(v) || hasUnsafeKey(v)) return undefined;
    const { market, timeframe, indicators } = v;
    if (!isChartableMarket(market) || !isCryptoTimeframe(timeframe) || !Array.isArray(indicators)) return undefined;
    return { market, timeframe, indicators: readList(indicators, INDICATORS_MAX, readIndicator) };
  } catch {
    return undefined;
  }
}

/**
 * Assainit la ligne `crypto.watchlist` : `undefined` pour une valeur qui n'est pas un tableau, sinon un tableau neuf des
 * seuls marchés affichables, dans l'ordre du trader, chacun une fois. Un marché hors registre, dont les deux sources du
 * CVD Binance, est retiré.
 */
export function sanitizeWatchlist(v: unknown): CryptoMarketId[] | undefined {
  try {
    if (!Array.isArray(v)) return undefined;
    const out: CryptoMarketId[] = [];
    for (const market of v) if (isChartableMarket(market) && !out.includes(market)) out.push(market);
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Un tracé lu dans une ligne enregistrée : un objet neuf aux seuls champs de son genre (le prix d'un niveau, les bornes
 * d'une zone, avec `from < to`), ou `undefined` s'il ne tient pas.
 */
function readDrawing(raw: unknown): CryptoDrawing | undefined {
  if (!isRec(raw) || hasUnsafeKey(raw)) return undefined;
  const { id, market, kind, price, from, to, label, author, createdAt } = raw;
  if (!isId(id, ID_MAX) || !isChartableMarket(market) || !isNum(createdAt)) return undefined;
  if (author !== 'trader' && author !== 'agent') return undefined;
  if (label !== undefined && (typeof label !== 'string' || label.length > LABEL_MAX)) return undefined;
  let drawing: CryptoDrawing;
  if (kind === 'level' && isPrice(price)) drawing = { id, market, kind, price, author, createdAt };
  else if (kind === 'zone' && isPrice(from) && isPrice(to) && from < to) drawing = { id, market, kind, from, to, author, createdAt };
  else return undefined;
  if (label !== undefined) drawing.label = label;
  return drawing;
}

/**
 * Assainit la ligne `crypto.drawings` : `undefined` pour une valeur qui n'est pas un tableau, sinon un tableau neuf des
 * tracés valides, au plus `DRAWINGS_MAX`. Un marché hors registre, une zone inversée ou un label de plus de `LABEL_MAX`
 * caractères écarte le tracé.
 */
export function sanitizeDrawings(v: unknown): CryptoDrawing[] | undefined {
  try {
    return Array.isArray(v) ? readList(v, DRAWINGS_MAX, readDrawing) : undefined;
  } catch {
    return undefined;
  }
}
