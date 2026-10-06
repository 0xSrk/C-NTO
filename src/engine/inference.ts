import { mulberry32 } from '@/lib/rng';
import { mean, percentile } from './metrics';

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
