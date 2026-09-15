import { mulberry32 } from '@/lib/rng';
import { percentile } from './metrics';

export interface MonteCarloOptions {
  runs?: number;
  /** Nombre de périodes simulées (défaut : longueur de l'échantillon) */
  horizon?: number;
  seed?: number;
  /** Seuil de drawdown ($) considéré comme « ruine » (ex. drawdown max d'un compte prop) */
  ruinDrawdown?: number;
  /** Objectif de profit ($) — probabilité de l'atteindre avant la ruine */
  target?: number;
}

export interface MonteCarloResult {
  runs: number;
  horizon: number;
  finalPnl: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  maxDrawdown: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  /** Probabilité de toucher `ruinDrawdown` avant la fin de l'horizon */
  ruinProbability: number | null;
  /** Probabilité d'atteindre `target` (avant ruine si défini) */
  targetProbability: number | null;
  /** Enveloppe de trajectoires (p5 / p50 / p95 à chaque pas) pour le graphique */
  envelope: { p5: number[]; p50: number[]; p95: number[] };
  /** Quelques trajectoires brutes pour le rendu (max 40) */
  samples: number[][];
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    mean: sorted.length ? sum / sorted.length : 0,
  };
}

/**
 * Bootstrap (tirage avec remise) d'une suite de PnL : quantifie la dispersion des
 * trajectoires possibles à partir de l'historique réel — sans hypothèse de distribution.
 */
export function monteCarlo(pnls: number[], opts: MonteCarloOptions = {}): MonteCarloResult | null {
  const n = pnls.length;
  if (n < 5) return null;
  const runs = Math.max(100, Math.min(opts.runs ?? 2000, 20000));
  const horizon = Math.max(1, Math.min(opts.horizon ?? n, 5000));
  const rand = mulberry32(opts.seed ?? 1337);
  const ruin = opts.ruinDrawdown;
  const target = opts.target;

  const finals: number[] = new Array(runs);
  const maxDds: number[] = new Array(runs);
  let ruined = 0;
  let reached = 0;
  const paths: Float64Array[] = [];
  const sampleCount = Math.min(40, runs);
  const keepEvery = Math.max(1, Math.floor(runs / sampleCount));
  const stepValues: Float64Array[] = Array.from({ length: horizon }, () => new Float64Array(runs));

  for (let r = 0; r < runs; r++) {
    let eq = 0;
    let peak = 0;
    let maxDd = 0;
    let isRuined = false;
    let hitTarget = false;
    const path = r % keepEvery === 0 ? new Float64Array(horizon) : null;
    for (let i = 0; i < horizon; i++) {
      eq += pnls[Math.floor(rand() * n)];
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDd) maxDd = dd;
      if (ruin !== undefined && !isRuined && !hitTarget && dd >= ruin) isRuined = true;
      if (target !== undefined && !hitTarget && !isRuined && eq >= target) hitTarget = true;
      stepValues[i][r] = eq;
      if (path) path[i] = eq;
    }
    finals[r] = eq;
    maxDds[r] = maxDd;
    if (isRuined) ruined++;
    if (hitTarget) reached++;
    if (path) paths.push(path);
  }

  const envelope = { p5: [] as number[], p50: [] as number[], p95: [] as number[] };
  for (let i = 0; i < horizon; i++) {
    const sorted = Array.from(stepValues[i]).sort((a, b) => a - b);
    envelope.p5.push(percentile(sorted, 0.05));
    envelope.p50.push(percentile(sorted, 0.5));
    envelope.p95.push(percentile(sorted, 0.95));
  }

  return {
    runs,
    horizon,
    finalPnl: summarize(finals),
    maxDrawdown: summarize(maxDds),
    ruinProbability: ruin !== undefined ? ruined / runs : null,
    targetProbability: target !== undefined ? reached / runs : null,
    envelope,
    samples: paths.slice(0, sampleCount).map((p) => Array.from(p)),
  };
}
