import { blockLengthOf, minimumDetectableEffect, permutationPValues, shrinkTowardMean, type ShrinkGroup } from './inference';
import { cmeTradingDay, stddev, weekdayOf } from './metrics';
import { dayBlockedMeanCi } from './riskConsole';
import type { DayContext, VolBand, VolCycle } from './metricsContext';

export type ReadingVerdict = 'confirme' | 'non concluant' | 'renverse' | 'insuffisant';

export interface AxisRow {
  key: string;
  days: number;
  tradedDays: number;
  /** Null s'il n'y a aucune journée de ce type (une case vide n'est pas un zéro). */
  tradedShare: number | null;
  trades: number;
  /** Moyenne des points par contrat, rapprochée de la moyenne si le groupe est petit. */
  points: number | null;
  low: number | null;
  high: number | null;
  mde: number | null;
  verdict: ReadingVerdict;
}

export interface ReadingSample {
  date: string;
  exitTime: number;
  /** Points par contrat. Null : le trade n'entre pas dans la moyenne. */
  points: number | null;
  key: string | null;
}

const WEEKDAY_KEYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] as const;

export function weekdayKey(date: string): string {
  return WEEKDAY_KEYS[weekdayOf(date)] ?? 'dim';
}

/** Journées de cotation de l'intervalle, bornes incluses. */
export function tradingDaysBetween(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  const [y, m, d] = from.split('-').map(Number);
  let cursor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  for (let guard = 0; guard < 4000 && cursor.toISOString().slice(0, 10) <= to; guard++) {
    const date = cursor.toISOString().slice(0, 10);
    if (cmeTradingDay(date)) out.push(date);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const sd = stddev([...values]);
  return sd * sd;
}

/** L'écart à `center` garde-t-il son signe et au moins la moitié de son ampleur sur la seconde moitié du groupe ? */
function halfPersists(points: readonly number[], exitTimes: readonly number[], center: number): { same: boolean; flipped: boolean } {
  const order = points.map((value, index) => ({ value, time: exitTimes[index] ?? 0 })).sort((a, b) => a.time - b.time);
  if (order.length < 2) return { same: false, flipped: false };
  const mid = Math.floor(order.length / 2);
  const all = order.reduce((sum, row) => sum + row.value, 0) / order.length - center;
  const second = order.slice(mid);
  if (second.length === 0 || all === 0) return { same: false, flipped: false };
  const half = second.reduce((sum, row) => sum + row.value, 0) / second.length - center;
  if (Math.sign(half) !== Math.sign(all)) return { same: false, flipped: true };
  return { same: Math.abs(half) + 1e-9 >= 0.5 * Math.abs(all), flipped: false };
}

/** Journées distinctes sous lesquelles un groupe n'a pas de verdict : des trades d'une même journée ne sont pas indépendants. */
export const MIN_READING_DAYS = 30;

/**
 * Une ligne par valeur d'axe. Les groupes sans trade ne sont pas créés.
 * `calendar` donne, pour chaque journée, la valeur d'axe qui la classe. Pour un régime ou une bande,
 * c'est la fiche de la journée, déjà arrêtée à la clôture de la veille : aucun décalage de plus.
 * Verdict « insuffisant » sous `minDays` journées distinctes (30) ou sous `minTrades` trades.
 */
export function readAxis(
  samples: readonly ReadingSample[],
  calendar: readonly { date: string; key: string | null }[],
  opts: { minTrades?: number; minDays?: number; fdr?: number; draws?: number; seed?: number } = {},
): AxisRow[] {
  const minTrades = opts.minTrades ?? 30;
  const minDays = opts.minDays ?? MIN_READING_DAYS;
  const fdr = opts.fdr ?? 0.05;
  const draws = opts.draws ?? 2_000;
  const byKey = new Map<string, ReadingSample[]>();
  for (const sample of samples) {
    if (!sample.key) continue;
    const list = byKey.get(sample.key) ?? [];
    list.push(sample);
    byKey.set(sample.key, list);
  }
  const dayKeys = new Map<string, { days: number; traded: number }>();
  const tradedPairs = new Set(samples.filter((sample) => sample.key).map((sample) => `${sample.key}|${sample.date}`));
  for (const day of calendar) {
    if (!day.key) continue;
    const row = dayKeys.get(day.key) ?? { days: 0, traded: 0 };
    row.days += 1;
    if (tradedPairs.has(`${day.key}|${day.date}`)) row.traded += 1;
    dayKeys.set(day.key, row);
  }
  const keys = [...byKey.keys()].sort();
  const finiteOf = (list: readonly ReadingSample[]) => list.filter((sample) => sample.points != null && Number.isFinite(sample.points));
  const finiteSamples = samples.filter((sample) => sample.points != null && Number.isFinite(sample.points));
  const allPoints = finiteSamples.map((sample) => sample.points as number);
  const grand = allPoints.length ? allPoints.reduce((sum, value) => sum + value, 0) / allPoints.length : 0;
  const sigma = stddev(allPoints);
  const groups: ShrinkGroup[] = keys.map((key) => {
    const points = finiteOf(byKey.get(key) ?? []).map((sample) => sample.points as number);
    // Un trade seul n'a pas de variance intra : NaN fait prendre la variance poolée, au lieu d'un 0 qui lui donnerait le poids 1.
    return { n: points.length, mean: points.length ? points.reduce((sum, value) => sum + value, 0) / points.length : 0, variance: points.length < 2 ? Number.NaN : sampleVariance(points) };
  });
  const shrunk = shrinkTowardMean(groups);
  const eligibleIndex: number[] = [];
  const eligibleGroups: number[][] = [];
  keys.forEach((key, index) => {
    const points = finiteOf(byKey.get(key) ?? []);
    if (points.length < minTrades) return;
    eligibleIndex.push(index);
    eligibleGroups.push(points.map((sample) => finiteSamples.indexOf(sample)));
  });
  // Un groupe se juge contre la moyenne générale, pas contre zéro.
  const pValues = eligibleGroups.length ? permutationPValues(allPoints, eligibleGroups, { draws, seed: opts.seed ?? 1, centered: true }) : [];
  // Benjamini-Hochberg local, pour ne pas importer la fonction si les p sont déjà filtrées.
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  let cutoff = -1;
  for (let k = 0; k < order.length; k++) {
    if ((order[k]?.p ?? 1) <= ((k + 1) / order.length) * fdr) cutoff = k;
  }
  const significant = new Set(order.slice(0, cutoff + 1).map((row) => eligibleIndex[row.index]!));
  return keys.map((key, index) => {
    const list = byKey.get(key) ?? [];
    const finite = finiteOf(list);
    const points = finite.map((sample) => sample.points as number);
    const byDate = new Map<string, number[]>();
    for (const sample of finite) {
      const bucket = byDate.get(sample.date) ?? [];
      bucket.push(sample.points as number);
      byDate.set(sample.date, bucket);
    }
    const ci = points.length ? dayBlockedMeanCi([...byDate.values()], Math.min(draws, 1_000), opts.seed ?? 1) : null;
    const n2 = allPoints.length - points.length;
    const mde = points.length > 1 && n2 > 1 && sigma > 0 ? minimumDetectableEffect(sigma, points.length, n2) : null;
    const day = dayKeys.get(key);
    const half = halfPersists(points, finite.map((sample) => sample.exitTime), grand);
    let verdict: ReadingVerdict = 'non concluant';
    if (finite.length < minTrades || byDate.size < minDays) verdict = 'insuffisant';
    else if (significant.has(index) && half.flipped) verdict = 'renverse';
    else if (significant.has(index) && half.same) verdict = 'confirme';
    return {
      key,
      days: day?.days ?? 0,
      tradedDays: day?.traded ?? 0,
      tradedShare: day && day.days > 0 ? day.traded / day.days : null,
      trades: finite.length,
      points: finite.length ? (shrunk[index]?.shrunk ?? null) : null,
      low: ci?.low ?? null,
      high: ci?.high ?? null,
      mde,
      verdict,
    };
  });
}

export interface DecompositionTerm {
  days: number;
  tradedShare: number;
  tradesPerDay: number;
  contractsPerTrade: number;
  atr: number;
  pointValue: number;
  rAtr: number;
  /** Produit des facteurs : gain moyen par journée calendaire. */
  perDay: number;
}

/**
 * Gain par journée = part des jours tradés × trades par jour × contrats par trade × ATR × valeur du point × rAtr.
 * L'ATR est pondéré par les contrats, le rAtr par les contrats × ATR : le produit retrouve exactement le brut.
 */
function decomposeCounted(dayCount: number, tradedDays: number, rows: readonly { contracts: number; atr: number; points: number }[], pointValue: number): DecompositionTerm | null {
  if (!(dayCount > 0) || !(pointValue > 0) || tradedDays <= 0 || rows.length === 0) return null;
  let contracts = 0;
  let atrWeighted = 0;
  let rAtrWeighted = 0;
  for (const row of rows) {
    contracts += row.contracts;
    atrWeighted += row.atr * row.contracts;
    rAtrWeighted += row.points * row.contracts;
  }
  if (!(contracts > 0) || !(atrWeighted > 0)) return null;
  const atr = atrWeighted / contracts;
  const rAtr = rAtrWeighted / atrWeighted;
  const tradedShare = tradedDays / dayCount;
  const tradesPerDay = rows.length / tradedDays;
  const contractsPerTrade = contracts / rows.length;
  const perDay = tradedShare * tradesPerDay * contractsPerTrade * atr * pointValue * rAtr;
  return { days: dayCount, tradedShare, tradesPerDay, contractsPerTrade, atr, pointValue, rAtr, perDay };
}

/** Identité : le produit égale le brut moyen par journée. `tradedDates` sont les journées qui portent au moins un trade. */
export function decomposeExact(
  dayCount: number,
  tradedDates: readonly string[],
  rows: readonly { date: string; contracts: number; atr: number; points: number }[],
  pointValue: number,
): DecompositionTerm | null {
  const usable = rows.filter((row) => row.contracts > 0 && row.atr > 0 && Number.isFinite(row.points));
  const dates = new Set(usable.map((row) => row.date));
  return decomposeCounted(dayCount, dates.size || tradedDates.filter((date) => dates.has(date)).length, usable, pointValue);
}

export function inReleaseWindow(minute: number, eventMinute: number, before: number, after: number): boolean {
  return minute >= eventMinute - before && minute <= eventMinute + after;
}

export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

export interface ReleaseSample {
  points: number;
  treated: boolean;
}

/** Jours avec publication contre jours sans, même fenêtre horaire. */
export function labelRelease(
  trades: readonly { date: string; minute: number; points: number }[],
  events: readonly { date: string; minute: number }[],
  before: number,
  after: number,
): ReleaseSample[] {
  const clocks = [...new Set(events.map((event) => event.minute))];
  const out: ReleaseSample[] = [];
  for (const trade of trades) {
    if (!Number.isFinite(trade.points)) continue;
    const clock = clocks.find((minute) => inReleaseWindow(trade.minute, minute, before, after));
    if (clock == null) continue;
    const treated = events.some((event) => event.date === trade.date && inReleaseWindow(trade.minute, event.minute, before, after));
    out.push({ points: trade.points, treated });
  }
  return out;
}

export function releaseContrast(samples: readonly ReleaseSample[], opts: { draws?: number; seed?: number; fdr?: number } = {}): { diff: number | null; p: number | null; significant: boolean } {
  const treated = samples.filter((sample) => sample.treated);
  const control = samples.filter((sample) => !sample.treated);
  if (treated.length < 5 || control.length < 5) return { diff: null, p: null, significant: false };
  const diff = mean(treated.map((sample) => sample.points)) - mean(control.map((sample) => sample.points));
  const values = samples.map((sample) => sample.points);
  const group = samples.flatMap((sample, index) => (sample.treated ? [index] : []));
  const p = permutationPValues(values, [group], { draws: opts.draws ?? 1_000, seed: opts.seed ?? 1, centered: true })[0] ?? 1;
  return { diff, p, significant: p < (opts.fdr ?? 0.05) };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type DaySide = 'hausse' | 'baisse';

/** Hausse si la séance clôture au-dessus de son ouverture. Un plat n'est ni l'un ni l'autre. */
export function daySide(openToClose: number | undefined): DaySide | null {
  if (openToClose == null || !Number.isFinite(openToClose) || openToClose === 0) return null;
  return openToClose > 0 ? 'hausse' : 'baisse';
}

export interface SideSummary {
  count: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  range: number;
  highVsPrev: number | null;
  lowVsPrev: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function summarizeSide(days: readonly Pick<DayContext, 'openToClose' | 'dayRange' | 'highVsPrevClose' | 'lowVsPrevClose'>[]): SideSummary | null {
  const rows = days.filter((day) => day.openToClose != null && Number.isFinite(day.openToClose));
  if (rows.length === 0) return null;
  const moves = rows.map((day) => day.openToClose as number);
  const highs = rows.flatMap((day) => (day.highVsPrevClose != null && Number.isFinite(day.highVsPrevClose) ? [day.highVsPrevClose] : []));
  const lows = rows.flatMap((day) => (day.lowVsPrevClose != null && Number.isFinite(day.lowVsPrevClose) ? [day.lowVsPrevClose] : []));
  const ranges = rows.flatMap((day) => (day.dayRange != null && Number.isFinite(day.dayRange) ? [day.dayRange] : []));
  return {
    count: rows.length,
    mean: mean(moves),
    median: median(moves),
    std: stddev(moves),
    min: Math.min(...moves),
    max: Math.max(...moves),
    range: ranges.length ? mean(ranges) : 0,
    highVsPrev: highs.length ? mean(highs) : null,
    lowVsPrev: lows.length ? mean(lows) : null,
  };
}

export interface FrequencyClass {
  from: number;
  to: number;
  count: number;
  cumulative: number;
}

/** Classes semi-ouvertes [a ; b). Les valeurs non finies sont ignorées. */
export function semiOpenClasses(values: readonly number[], edges: readonly number[]): FrequencyClass[] {
  const finite = values.filter((value) => Number.isFinite(value));
  const classes: FrequencyClass[] = [];
  let acc = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i] ?? 0;
    const to = edges[i + 1] ?? Infinity;
    const count = finite.filter((value) => value >= from && value < to).length;
    acc += count;
    classes.push({ from, to, count, cumulative: finite.length ? acc / finite.length : 0 });
  }
  return classes;
}

export interface TailLoss {
  method: 'empirique' | 'gpd';
  quantile: number;
  expectedShortfall: number;
}

/** Niveau du seuil de la Pareto généralisée : la queue modélisée porte environ 10 % des journées. */
export const GPD_THRESHOLD_LEVEL = 0.1;

/**
 * VaR et ES empiriques. À partir de 500 journées, la VaR 5 % vient d'une Pareto généralisée ajustée
 * aux excès sous le quantile 10 %, puis extrapolée au niveau 5 %. L'ES reste empirique.
 */
export function tailLoss(pnls: readonly number[], level = 0.05): TailLoss | null {
  const sorted = pnls.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length < 250) return null;
  const empirical = quantileAt(sorted, level);
  const tail = sorted.filter((value) => value <= empirical.quantile);
  const expectedShortfall = tail.length ? mean(tail) : empirical.quantile;
  if (sorted.length < 500 || level !== 0.05) return { method: 'empirique', quantile: empirical.quantile, expectedShortfall };
  // Seuil au quantile 10 % : au seuil 5 %, il n'y aurait rien à extrapoler et la branche rendrait le quantile empirique.
  const gpd = gpdQuantile(sorted, quantileAt(sorted, GPD_THRESHOLD_LEVEL).quantile, level);
  return { method: 'gpd', quantile: gpd ?? empirical.quantile, expectedShortfall };
}

function quantileAt(sorted: readonly number[], level: number): { quantile: number } {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(level * sorted.length) - 1));
  return { quantile: sorted[index] ?? 0 };
}

/** Quantile de la loi originale au niveau `level` : excès sous `threshold` ajustés par les moments, puis extrapolés. */
function gpdQuantile(sortedAsc: readonly number[], threshold: number, level: number): number | null {
  const excesses = sortedAsc.filter((value) => value < threshold).map((value) => threshold - value);
  if (excesses.length < 10) return null;
  const mu = mean(excesses);
  const variance = sampleVariance(excesses);
  if (!(mu > 0) || !(variance > 0)) return null;
  const shape = 0.5 * (1 - (mu * mu) / variance);
  const scale = 0.5 * mu * (1 + (mu * mu) / variance);
  if (!(scale > 0)) return null;
  const rate = excesses.length / sortedAsc.length;
  if (!(level < rate)) return threshold;
  const survival = level / rate;
  if (Math.abs(shape) < 1e-6) return threshold - scale * Math.log(survival);
  const excess = (scale / shape) * (survival ** -shape - 1);
  return threshold - excess;
}

export function comparableSet(days: readonly DayContext[], cycle: VolCycle, band: VolBand): { hausse: SideSummary | null; baisse: SideSummary | null; upRate: number | null } {
  const same = days.filter((day) => day.volCycle === cycle && day.volBand === band);
  const up = same.filter((day) => daySide(day.openToClose) === 'hausse');
  const down = same.filter((day) => daySide(day.openToClose) === 'baisse');
  const sided = up.length + down.length;
  return { hausse: summarizeSide(up), baisse: summarizeSide(down), upRate: sided > 0 ? up.length / sided : null };
}

export { blockLengthOf };
