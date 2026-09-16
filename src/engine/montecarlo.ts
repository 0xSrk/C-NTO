import { mulberry32 } from '@/lib/rng';

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
  /** Enveloppe de trajectoires (p5 / p50 / p95) échantillonnée sur `envelopeSteps` pas */
  envelope: { steps: number[]; p5: number[]; p50: number[]; p95: number[] };
  /** Quelques trajectoires brutes pour le rendu (max 40), échantillonnées sur les mêmes pas */
  samples: number[][];
}

export const MAX_RUNS = 20_000;
export const MAX_HORIZON = 5_000;
/** Borne le travail total (runs × horizon) pour rester fluide sur le fil principal. */
export const MAX_WORK = 5_000_000;
const ENVELOPE_RUNS = 500;
const ENVELOPE_STEPS = 240;
const SAMPLE_PATHS = 40;

function typedPercentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values: Float64Array) {
  const sorted = values.slice().sort();
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) sum += sorted[i];
  return {
    p5: typedPercentile(sorted, 0.05),
    p25: typedPercentile(sorted, 0.25),
    p50: typedPercentile(sorted, 0.5),
    p75: typedPercentile(sorted, 0.75),
    p95: typedPercentile(sorted, 0.95),
    mean: sorted.length ? sum / sorted.length : 0,
  };
}

/** Indices de pas régulièrement espacés (le dernier inclus) pour l'enveloppe. */
function pickSteps(horizon: number, count: number): number[] {
  if (horizon <= count) return Array.from({ length: horizon }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(Math.round((k * (horizon - 1)) / (count - 1)));
  return [...new Set(out)];
}

/** Ajuste runs/horizon aux bornes et au budget de travail. */
export function clampMonteCarlo(runs: number, horizon: number): { runs: number; horizon: number } {
  const h = Math.max(1, Math.min(Math.floor(Number.isFinite(horizon) ? horizon : 1), MAX_HORIZON));
  let r = Math.max(100, Math.min(Math.floor(Number.isFinite(runs) ? runs : 100), MAX_RUNS));
  if (r * h > MAX_WORK) r = Math.max(100, Math.floor(MAX_WORK / h));
  return { runs: r, horizon: h };
}

/**
 * Bootstrap (tirage avec remise) d'une suite de PnL : quantifie la dispersion des
 * trajectoires possibles à partir de l'historique réel — sans hypothèse de distribution.
 * Mémoire bornée : l'enveloppe est estimée sur 500 trajectoires et 240 pas.
 */
export function monteCarlo(input: number[], opts: MonteCarloOptions = {}): MonteCarloResult | null {
  const pnls = input.filter(Number.isFinite);
  const n = pnls.length;
  if (n < 5) return null;
  const { runs, horizon } = clampMonteCarlo(opts.runs ?? 2000, opts.horizon ?? n);
  const rand = mulberry32(Number.isFinite(opts.seed) ? (opts.seed as number) : 1337);
  const ruin = Number.isFinite(opts.ruinDrawdown) ? (opts.ruinDrawdown as number) : undefined;
  const target = Number.isFinite(opts.target) ? (opts.target as number) : undefined;

  const finals = new Float64Array(runs);
  const maxDds = new Float64Array(runs);
  let ruined = 0;
  let reached = 0;
  const steps = pickSteps(horizon, ENVELOPE_STEPS);
  const stepIndex = new Int32Array(horizon).fill(-1);
  steps.forEach((s, k) => (stepIndex[s] = k));
  const envRuns = Math.min(runs, ENVELOPE_RUNS);
  const stepValues = steps.map(() => new Float64Array(envRuns));
  const sampleEvery = Math.max(1, Math.floor(runs / SAMPLE_PATHS));
  const samples: number[][] = [];

  for (let r = 0; r < runs; r++) {
    let eq = 0;
    let peak = 0;
    let maxDd = 0;
    let isRuined = false;
    let hitTarget = false;
    const keepEnvelope = r < envRuns;
    const path = r % sampleEvery === 0 && samples.length < SAMPLE_PATHS ? new Array<number>(steps.length) : null;
    for (let i = 0; i < horizon; i++) {
      eq += pnls[Math.floor(rand() * n)];
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDd) maxDd = dd;
      if (ruin !== undefined && !isRuined && !hitTarget && dd >= ruin) isRuined = true;
      if (target !== undefined && !hitTarget && !isRuined && eq >= target) hitTarget = true;
      const k = stepIndex[i];
      if (k >= 0) {
        if (keepEnvelope) stepValues[k][r] = eq;
        if (path) path[k] = eq;
      }
    }
    finals[r] = eq;
    maxDds[r] = maxDd;
    if (isRuined) ruined++;
    if (hitTarget) reached++;
    if (path) samples.push(path);
  }

  const envelope = { steps, p5: [] as number[], p50: [] as number[], p95: [] as number[] };
  for (const values of stepValues) {
    const sorted = values.sort();
    envelope.p5.push(typedPercentile(sorted, 0.05));
    envelope.p50.push(typedPercentile(sorted, 0.5));
    envelope.p95.push(typedPercentile(sorted, 0.95));
  }

  return {
    runs,
    horizon,
    finalPnl: summarize(finals),
    maxDrawdown: summarize(maxDds),
    ruinProbability: ruin !== undefined ? ruined / runs : null,
    targetProbability: target !== undefined ? reached / runs : null,
    envelope,
    samples,
  };
}
