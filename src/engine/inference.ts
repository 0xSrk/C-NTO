import { mulberry32 } from '@/lib/rng';
import { ET_ZONE, zonedWallClock } from '@/lib/time';
import { aggregateByDate, mean, percentile, tradeDay, weekdayOf } from './metrics';
import type { Session, Trade } from './types';

/** Tirages des tests de permutation et des intervalles par blocs. */
export const INFERENCE_DRAWS = 5_000;

export interface BlockBootstrapCi {
  /** Moyenne de la série observée. */
  center: number;
  low: number;
  high: number;
  blockLength: number;
  draws: number;
}

/** Longueur de bloc : arrondi de n^(1/3), au moins 1. */
export function blockLengthOf(n: number): number {
  if (n <= 1) return 1;
  return Math.max(1, Math.round(n ** (1 / 3)));
}

/**
 * Intervalle de confiance par bootstrap circulaire de blocs de journées.
 * Le centre est la moyenne de la série, pas celle des tirages.
 * Les valeurs non finies sont écartées (une case vide n'est pas un zéro).
 */
export function blockBootstrapCi(
  input: readonly number[],
  opts: { draws?: number; seed?: number; level?: number; blockLength?: number } = {},
): BlockBootstrapCi {
  const series = input.filter((x) => Number.isFinite(x));
  const draws = Math.max(1, Math.floor(opts.draws ?? INFERENCE_DRAWS));
  const level = opts.level ?? 0.9;
  const n = series.length;
  const center = mean(series);
  const blockLength = Math.max(1, Math.floor(opts.blockLength ?? blockLengthOf(n)));
  if (n === 0) return { center: 0, low: 0, high: 0, blockLength: 1, draws };
  const rand = mulberry32(opts.seed ?? 1);
  const means = new Array<number>(draws);
  const blocksNeeded = Math.ceil(n / blockLength);
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    let filled = 0;
    for (let b = 0; b < blocksNeeded && filled < n; b++) {
      const start = Math.floor(rand() * n);
      const take = Math.min(blockLength, n - filled);
      for (let j = 0; j < take; j++) sum += series[(start + j) % n] ?? 0;
      filled += take;
    }
    means[d] = sum / n;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    center,
    low: percentile(means, alpha),
    high: percentile(means, 1 - alpha),
    blockLength,
    draws,
  };
}

/**
 * p-valeurs de permutation de la moyenne de chaque groupe.
 * Une permutation des valeurs est partagée par tous les groupes (même hypothèse nulle).
 * p = (1 + dépassements) / (tirages + 1), bilatérale sur la valeur absolue.
 * `groups` contient les indices dans `values`.
 */
export function permutationPValues(
  values: readonly number[],
  groups: readonly (readonly number[])[],
  opts: { draws?: number; seed?: number } = {},
): number[] {
  const draws = Math.max(1, Math.floor(opts.draws ?? INFERENCE_DRAWS));
  const n = values.length;
  const observed = groups.map((group) => meanAt(values, group));
  const counts = groups.map(() => 0);
  if (n === 0) return groups.map(() => 1);
  const sample = values.slice();
  const rand = mulberry32(opts.seed ?? 1);
  for (let d = 0; d < draws; d++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = sample[i] ?? 0;
      sample[i] = sample[j] ?? 0;
      sample[j] = tmp;
    }
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      if (!group || group.length === 0) continue;
      const stat = meanAt(sample, group);
      if (Math.abs(stat) >= Math.abs(observed[g] ?? 0)) counts[g] = (counts[g] ?? 0) + 1;
    }
  }
  return groups.map((group, g) => (group.length === 0 ? 1 : (1 + (counts[g] ?? 0)) / (draws + 1)));
}

function meanAt(values: readonly number[], indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += values[i] ?? 0;
  return sum / indices.length;
}

/**
 * Benjamini-Hochberg : vrai si la p-valeur est retenue au taux `q`.
 * Le plus grand rang k tel que p_(k) ≤ k/m × q entraîne le rejet de tous les rangs ≤ k.
 */
export function benjaminiHochberg(pValues: readonly number[], q = 0.05): boolean[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues.map((p, i) => ({ p: Number.isFinite(p) ? p : 1, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  let cutoff = -1;
  for (let k = 0; k < m; k++) {
    const row = order[k];
    if (row && row.p <= ((k + 1) / m) * q) cutoff = k;
  }
  const reject = pValues.map(() => false);
  for (let k = 0; k <= cutoff; k++) {
    const row = order[k];
    if (row) reject[row.i] = true;
  }
  return reject;
}

/** deff = max(1, 1 + (m − 1) × ICC). */
export function designEffect(icc: number, clusterSize: number): number {
  if (!Number.isFinite(icc) || !Number.isFinite(clusterSize)) return 1;
  return Math.max(1, 1 + (clusterSize - 1) * icc);
}

/** Plus petit écart détectable : 2,8 × σ × √(1/n₁ + 1/n₂) × √deff. */
export function minimumDetectableEffect(sigma: number, n1: number, n2: number, icc = 0, clusterSize = 1): number {
  if (!(sigma >= 0) || !Number.isFinite(sigma) || !(n1 > 0) || !(n2 > 0)) return Number.NaN;
  return 2.8 * sigma * Math.sqrt(1 / n1 + 1 / n2) * Math.sqrt(designEffect(icc, clusterSize));
}

/**
 * ICC à un facteur. Les grappes vides sont ignorées.
 * m est la taille moyenne utilisée dans deff : (N − Σ n²/N) / (G − 1), sinon la moyenne simple.
 */
export function intraclassCorrelation(clusters: readonly (readonly number[])[]): { icc: number; meanClusterSize: number } {
  const groups = clusters.map((c) => c.filter((x) => Number.isFinite(x))).filter((c) => c.length > 0);
  const g = groups.length;
  if (g === 0) return { icc: 0, meanClusterSize: 1 };
  let n = 0;
  let sumSqN = 0;
  let total = 0;
  const means: number[] = [];
  for (const group of groups) {
    n += group.length;
    sumSqN += group.length * group.length;
    let s = 0;
    for (const x of group) s += x;
    total += s;
    means.push(s / group.length);
  }
  const grand = total / n;
  const meanClusterSize = g > 1 ? (n - sumSqN / n) / (g - 1) : n / g;
  if (g < 2 || n <= g) return { icc: 0, meanClusterSize: Math.max(1, meanClusterSize) };
  let ssw = 0;
  let ssb = 0;
  for (let i = 0; i < g; i++) {
    const group = groups[i] ?? [];
    const m = means[i] ?? 0;
    ssb += group.length * (m - grand) * (m - grand);
    for (const x of group) ssw += (x - m) * (x - m);
  }
  const msw = ssw / (n - g);
  const msb = ssb / (g - 1);
  const denom = msb + (meanClusterSize - 1) * msw;
  if (!(denom > 0)) return { icc: 0, meanClusterSize };
  return { icc: (msb - msw) / denom, meanClusterSize };
}

/**
 * Poids de rapprochement n / (n + k), k = variance intra ÷ variance inter.
 * Variance inter nulle : poids nul (tout se rapproche de la moyenne générale).
 */
export function shrinkageWeight(n: number, withinVar: number, betweenVar: number): number {
  if (!(n > 0) || !Number.isFinite(n)) return 0;
  if (!(betweenVar > 0) || !Number.isFinite(betweenVar)) return 0;
  if (!Number.isFinite(withinVar) || withinVar < 0) return 0;
  const k = withinVar / betweenVar;
  return n / (n + k);
}

export interface ShrinkGroup {
  n: number;
  mean: number;
  /** Variance intra du groupe. */
  variance: number;
}

export interface ShrunkMean {
  mean: number;
  weight: number;
  shrunk: number;
}

/**
 * Rapproche chaque moyenne de groupe vers la moyenne générale (pondérée par n).
 * Variance intra = variance poolée. Variance inter = variance des moyennes pondérée par n.
 */
export function shrinkTowardMean(groups: readonly ShrinkGroup[]): ShrunkMean[] {
  let nSum = 0;
  let meanSum = 0;
  let withinNum = 0;
  let withinDen = 0;
  for (const group of groups) {
    if (!(group.n > 0) || !Number.isFinite(group.mean)) continue;
    nSum += group.n;
    meanSum += group.n * group.mean;
    if (group.n > 1 && Number.isFinite(group.variance) && group.variance >= 0) {
      withinNum += (group.n - 1) * group.variance;
      withinDen += group.n - 1;
    }
  }
  const grand = nSum > 0 ? meanSum / nSum : 0;
  const within = withinDen > 0 ? withinNum / withinDen : 0;
  let betweenNum = 0;
  let usable = 0;
  for (const group of groups) {
    if (!(group.n > 0) || !Number.isFinite(group.mean)) continue;
    usable++;
    betweenNum += group.n * (group.mean - grand) * (group.mean - grand);
  }
  const between = usable > 1 && nSum > 0 ? betweenNum / nSum : 0;
  return groups.map((group) => {
    const weight = shrinkageWeight(group.n, Number.isFinite(group.variance) ? group.variance : within, between);
    return { mean: group.mean, weight, shrunk: weight * group.mean + (1 - weight) * grand };
  });
}

export const DURATION_LABELS = ['< 2m', '2–5m', '5–10m', '10–20m', '20–40m', '40–90m', '> 90m'] as const;
const DURATION_EDGES_MIN = [2, 5, 10, 20, 40, 90, Infinity];

/** Tranche de durée en position, mêmes bornes que le spectre de l'onglet C. */
export function durationLabel(entryTime: number, exitTime: number): (typeof DURATION_LABELS)[number] {
  const minutes = Math.max(0, exitTime - entryTime) / 60_000;
  const index = DURATION_EDGES_MIN.findIndex((edge) => minutes < edge);
  return DURATION_LABELS[index === -1 ? DURATION_LABELS.length - 1 : index] ?? '< 2m';
}

export type MarkerKind = 'slot' | 'duration' | 'strategy';

export interface MarkerCandidate {
  id: string;
  kind: MarkerKind;
  /** Indices dans la série triée par heure de sortie. */
  indices: number[];
}

export interface MarkerVerdict {
  id: string;
  kind: MarkerKind;
  count: number;
  mean: number;
  /** Moyenne sur la seconde moitié du journal. Null si le groupe n'y a aucun trade. */
  halfMean: number | null;
  /** Null sous le minimum de trades : le groupe n'entre pas dans la famille testée. */
  p: number | null;
  kept: boolean;
}

/** Trades finis, triés par sortie, et les trois familles de repères (créneau, durée, stratégie). */
export function analysisCandidates(trades: readonly Trade[], days?: ReadonlyMap<string, string>): { ordered: Trade[]; candidates: MarkerCandidate[] } {
  const ordered = trades.filter((t) => Number.isFinite(t.pnl)).sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id));
  const groups = new Map<string, { kind: MarkerKind; indices: number[] }>();
  const add = (id: string, kind: MarkerKind, index: number) => {
    const group = groups.get(id);
    if (group) group.indices.push(index);
    else groups.set(id, { kind, indices: [index] });
  };
  ordered.forEach((trade, index) => {
    const dow = weekdayOf(tradeDay(trade, days?.get(trade.sessionId)));
    const hour = zonedWallClock(trade.entryTime, ET_ZONE).hour;
    add(`slot:${dow}:${hour}`, 'slot', index);
    add(`duration:${durationLabel(trade.entryTime, trade.exitTime)}`, 'duration', index);
    add(`strategy:${trade.strategy ?? 'Sans stratégie'}`, 'strategy', index);
  });
  return {
    ordered,
    candidates: [...groups.entries()]
      .map(([id, group]) => ({ id, kind: group.kind, indices: group.indices }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Un repère est retenu s'il a assez de trades, si sa p-valeur de permutation corrigée
 * (Benjamini-Hochberg) passe sous `fdr`, et s'il garde son signe et au moins la moitié
 * de son ampleur sur la seconde moitié du journal (tri par heure de sortie).
 */
export function markerVerdicts(
  pnls: readonly number[],
  candidates: readonly MarkerCandidate[],
  opts: { minTrades?: number; fdr?: number; draws?: number; seed?: number } = {},
): MarkerVerdict[] {
  const minTrades = opts.minTrades ?? 30;
  const fdr = opts.fdr ?? 0.05;
  const split = Math.floor(pnls.length / 2);
  const eligible = candidates.filter((c) => c.indices.length >= minTrades);
  const pValues = eligible.length ? permutationPValues(pnls, eligible.map((c) => c.indices), opts) : [];
  const reject = benjaminiHochberg(pValues, fdr);
  const decision = new Map(eligible.map((c, i) => [c.id, { p: pValues[i] ?? 1, reject: reject[i] ?? false }]));
  return candidates.map((candidate) => {
    const meanPnl = meanAt(pnls, candidate.indices);
    const second = candidate.indices.filter((i) => i >= split);
    const halfMean = second.length ? meanAt(pnls, second) : null;
    const stat = decision.get(candidate.id);
    const persists =
      halfMean != null &&
      meanPnl !== 0 &&
      Math.sign(halfMean) === Math.sign(meanPnl) &&
      Math.abs(halfMean) + 1e-9 >= 0.5 * Math.abs(meanPnl);
    return {
      id: candidate.id,
      kind: candidate.kind,
      count: candidate.indices.length,
      mean: meanPnl,
      halfMean,
      p: stat?.p ?? null,
      kept: Boolean(stat?.reject) && persists,
    };
  });
}

/** Corrélation de Pearson. 0 si une série est constante ou trop courte. */
export function pearson(left: readonly number[], right: readonly number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += left[i] ?? 0;
    sy += right[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = (left[i] ?? 0) - mx;
    const vy = (right[i] ?? 0) - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (!(dx > 0) || !(dy > 0)) return 0;
  return num / Math.sqrt(dx * dy);
}

export interface Autocorr {
  lag: number;
  rho: number;
  /** Demi-largeur de la bande ± 1,96 / √n, n = longueur de la série. */
  band: number;
  outside: boolean;
}

/** Autocorrélation aux décalages demandés. Les valeurs non finies sont écartées. */
export function autocorrelations(input: readonly number[], lags: readonly number[] = [1, 2, 3, 4, 5]): Autocorr[] {
  const series = input.filter((x) => Number.isFinite(x));
  const n = series.length;
  const band = n > 0 ? 1.96 / Math.sqrt(n) : 0;
  return lags.map((lag) => {
    if (!Number.isInteger(lag) || lag <= 0 || n <= lag) return { lag, rho: 0, band, outside: false };
    const rho = pearson(series.slice(0, n - lag), series.slice(lag));
    return { lag, rho, band, outside: Math.abs(rho) > band };
  });
}

/** Taux de réussite par séance, dans l'ordre des dates. Une séance sans trade n'entre pas dans la série. */
export function sessionWinRateSeries(sessions: readonly Session[], trades: readonly Trade[]): number[] {
  const bySession = new Map<string, Trade[]>();
  for (const trade of trades) {
    if (!Number.isFinite(trade.pnl)) continue;
    const list = bySession.get(trade.sessionId);
    if (list) list.push(trade);
    else bySession.set(trade.sessionId, [trade]);
  }
  return [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .flatMap((session) => {
      const rows = bySession.get(session.id);
      if (!rows?.length) return [];
      return [rows.filter((row) => row.pnl > 0).length / rows.length];
    });
}

/** Résultat journalier : une valeur par date de séance. */
export function dailyResultSeries(sessions: readonly Session[]): number[] {
  return aggregateByDate([...sessions]).map((day) => day.pnl);
}
