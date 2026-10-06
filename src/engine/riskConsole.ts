import { mulberry32 } from '@/lib/rng';
import { blockLengthOf } from './inference';
import { getInstrument, hasInstrument } from './instruments';
import { percentile } from './metrics';

export type RiskSource = 'stop' | 'saisi' | 'fixe' | 'absent';

export interface RiskInput {
  instrument: string;
  qty: number;
  entryPrice: number;
  pnl: number;
  stopPrice?: number;
  targetPrice?: number;
  risk?: number;
}

export interface TradeRisk {
  source: RiskSource;
  /** Risque en devise. Null si aucune source. */
  risk: number | null;
  /** Gain potentiel en devise, si un objectif initial est saisi. */
  potentialGain: number | null;
  /** Gain potentiel ÷ risque. */
  plannedRr: number | null;
  /** PnL après frais ÷ risque. */
  realizedR: number | null;
  /** Risque ÷ capital de risque. */
  lossPct: number | null;
  stopPoints: number | null;
  targetPoints: number | null;
}

function pointValueOf(instrument: string): number | null {
  if (!hasInstrument(instrument)) return null;
  const value = getInstrument(instrument).pointValue;
  return value > 0 ? value : null;
}

function cashDistance(points: number, pointValue: number, qty: number): number {
  return Math.abs(points) * pointValue * qty;
}

/**
 * Risque d'un trade. Priorité : stop initial, risque saisi, montant fixe par contrat.
 * Le gain potentiel n'existe que si l'objectif initial est saisi.
 */
export function tradeRisk(trade: RiskInput, riskPerContract = 0, riskCapital = 0): TradeRisk {
  const pointValue = pointValueOf(trade.instrument);
  const qty = trade.qty > 0 ? trade.qty : 0;
  const stopPoints = pointValue != null && trade.stopPrice != null && Number.isFinite(trade.stopPrice) && Number.isFinite(trade.entryPrice) ? Math.abs(trade.entryPrice - trade.stopPrice) : null;
  const targetPoints = pointValue != null && trade.targetPrice != null && Number.isFinite(trade.targetPrice) && Number.isFinite(trade.entryPrice) ? Math.abs(trade.targetPrice - trade.entryPrice) : null;
  let source: RiskSource = 'absent';
  let risk: number | null = null;
  if (stopPoints != null && stopPoints > 0 && pointValue != null && qty > 0) {
    source = 'stop';
    risk = cashDistance(stopPoints, pointValue, qty);
  } else if (trade.risk != null && trade.risk > 0) {
    source = 'saisi';
    risk = trade.risk;
  } else if (riskPerContract > 0 && qty > 0) {
    source = 'fixe';
    risk = riskPerContract * qty;
  }
  const potentialGain = targetPoints != null && targetPoints > 0 && pointValue != null && qty > 0 ? cashDistance(targetPoints, pointValue, qty) : null;
  const plannedRr = risk != null && risk > 0 && potentialGain != null ? potentialGain / risk : null;
  const realizedR = risk != null && risk > 0 && Number.isFinite(trade.pnl) ? trade.pnl / risk : null;
  const lossPct = risk != null && riskCapital > 0 ? risk / riskCapital : null;
  return { source, risk, potentialGain, plannedRr, realizedR, lossPct, stopPoints, targetPoints };
}

export const TRADE_LEVEL_KEYS = ['stopPrice', 'targetPrice'] as const;
export type TradeLevelKey = (typeof TRADE_LEVEL_KEYS)[number];
/** `format` : illisible ; `range` : hors de ]0 ; 1e6] ; `side` : du mauvais côté de l'entrée. */
export type TradeLevelIssue = 'format' | 'range' | 'side';

/** Plafond d'un prix au coffre (`CHECKS`). */
export const TRADE_LEVEL_MAX = 1e6;

/**
 * Prix saisi : chiffres, une virgule ou un point décimal, espaces de groupe tolérés (« 19 990,25 »).
 * Rien d'autre : ni exposant, ni deux séparateurs, ni lettres. NaN si illisible.
 */
export function parsePriceInput(raw: string): number {
  const match = /^([+\-−]?)(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(raw.replace(/\s+/g, ''));
  if (!match) return Number.NaN;
  const value = Number((match[2] ?? '').replace(',', '.'));
  return match[1] === '-' || match[1] === '−' ? -value : value;
}

/**
 * Contrôle d'un stop ou d'un objectif initial : dans ]0 ; 1e6], et du bon côté de l'entrée.
 * Achat : stop < entrée < objectif. Vente : objectif < entrée < stop. Entrée inconnue : côté non jugé.
 */
export function tradeLevelIssue(key: TradeLevelKey, value: number, trade: { direction: 'long' | 'short'; entryPrice: number }): TradeLevelIssue | null {
  if (!Number.isFinite(value)) return 'format';
  if (!(value > 0) || value > TRADE_LEVEL_MAX) return 'range';
  if (!Number.isFinite(trade.entryPrice)) return null;
  const below = (key === 'stopPrice') === (trade.direction === 'long');
  return (below ? value < trade.entryPrice : value > trade.entryPrice) ? null : 'side';
}

/** Lecture d'une saisie de stop ou d'objectif. Vide : le champ est effacé (`value: null`). */
export function readTradeLevel(
  raw: string,
  key: TradeLevelKey,
  trade: { direction: 'long' | 'short'; entryPrice: number },
): { ok: true; value: number | null } | { ok: false; issue: TradeLevelIssue } {
  if (raw.trim() === '') return { ok: true, value: null };
  const value = parsePriceInput(raw);
  const issue = tradeLevelIssue(key, value, trade);
  return issue ? { ok: false, issue } : { ok: true, value };
}

/** Taux de réussite de seuil : 1 / (1 + R/R). */
export function thresholdWinRate(rewardRisk: number): number {
  if (!(rewardRisk > 0) || !Number.isFinite(rewardRisk)) return Number.NaN;
  return 1 / (1 + rewardRisk);
}

/** E = taux × gain moyen − (1 − taux) × perte moyenne. La perte moyenne est positive. */
export function expectancy(winRate: number, avgWin: number, avgLoss: number): number {
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

/** Espérance en R : taux × R/R − (1 − taux) × 1. */
export function expectancyR(winRate: number, rewardRisk: number): number {
  return winRate * rewardRisk - (1 - winRate);
}

/**
 * R/R réalisé : gain moyen ÷ |perte moyenne|, sur le PnL après frais. Les trades nuls ne comptent ni
 * comme gain ni comme perte, comme dans le taux de réussite de la matrice. NaN sans perte.
 */
export function realizedRewardRisk(trades: readonly { pnl: number }[]): number {
  let wins = 0;
  let gains = 0;
  let losses = 0;
  let lost = 0;
  for (const trade of trades) {
    if (!Number.isFinite(trade.pnl)) continue;
    if (trade.pnl > 0) {
      wins += 1;
      gains += trade.pnl;
    } else if (trade.pnl < 0) {
      losses += 1;
      lost += -trade.pnl;
    }
  }
  if (losses === 0) return Number.NaN;
  return (wins ? gains / wins : 0) / (lost / losses);
}

export interface RrMatrix {
  /** Taux de réussite de chaque ligne, dans l'ordre. */
  winRates: number[];
  /** R/R de chaque colonne. La dernière est le R/R réalisé, s'il est connu. */
  rewardRisks: number[];
  /** Espérance en R. */
  cells: number[][];
  /** Ligne et colonne du point réalisé. Null sans R/R réalisé : aucune colonne ne le porte. */
  realized: { row: number; col: number } | null;
}

/**
 * Matrice R-R. Lignes : taux réalisé, puis les écarts (en points de taux, 0,10 = 10 points),
 * puis la borne basse. Colonnes : 1 ; 1,5 ; 2 ; 2,5 ; 3 et le R/R réalisé (`realizedRewardRisk`).
 */
export function rrMatrix(winRate: number, realizedRr: number, offsets: readonly number[] = [0.1, -0.1, -0.15], winRateLow = winRate): RrMatrix {
  const winRates = [winRate, ...offsets.map((offset) => winRate + offset), winRateLow].map((rate) => Math.min(1, Math.max(0, rate)));
  const grid = [1, 1.5, 2, 2.5, 3];
  const known = Number.isFinite(realizedRr) && realizedRr > 0;
  const rewardRisks = known ? [...grid, realizedRr] : grid;
  const cells = winRates.map((rate) => rewardRisks.map((rr) => expectancyR(rate, rr)));
  return { winRates, rewardRisks, cells, realized: known ? { row: 0, col: rewardRisks.length - 1 } : null };
}

/**
 * Risque ajusté en points de pourcentage (1,5 = 1,5 %).
 * Sans les tables F20–F22, le recommandé est le risque de base.
 * Les ajustements sont des points de risque (négatifs). Plafonné par la perte % du trade
 * et par zéro. `provisional` rappelle que les tables ne sont pas encore celles de la console.
 */
export function adjustedRiskPoints(basePoints: number, adjustments: readonly number[] = [], lossPoints = Infinity): { points: number; provisional: true } {
  const raw = basePoints + adjustments.reduce((sum, item) => sum + item, 0);
  const capped = Math.min(raw, Number.isFinite(lossPoints) ? lossPoints : raw);
  return { points: Math.max(0, capped), provisional: true };
}

/** Notionnel = capital × risque ajusté ÷ perte %. Les deux risques sont en points de pourcentage. */
export function theoreticalNotional(capital: number, adjustedPoints: number, lossPoints: number): number {
  if (!(capital > 0) || !(lossPoints > 0) || !(adjustedPoints >= 0)) return 0;
  return (capital * adjustedPoints) / lossPoints;
}

/** Contrats théoriques, en unité du contrat dont `pointValue` est donné. Arrondi à l'inférieur fait par l'appelant. */
export function theoreticalContracts(capital: number, adjustedPoints: number, stopPoints: number, pointValue: number): number {
  if (!(capital > 0) || !(adjustedPoints >= 0) || !(stopPoints > 0) || !(pointValue > 0)) return 0;
  return (capital * (adjustedPoints / 100)) / (stopPoints * pointValue);
}

/** Équivalent micro, arrondi à l'inférieur. `ratio` 10 : 0,475 NQ → 4 MNQ. */
export function floorMicroContracts(standardContracts: number, ratio = 10): number {
  if (!(standardContracts > 0) || !(ratio > 0)) return 0;
  return Math.floor(standardContracts * ratio + 1e-9);
}

/** σ = cours × volatilité annuelle ÷ √(périodes par an). Jour 252, semaine 52, mois 12. */
export function horizonSigma(price: number, annualVol: number, periodsPerYear: number): number {
  if (!(price > 0) || !(annualVol > 0) || !(periodsPerYear > 0)) return Number.NaN;
  return (price * annualVol) / Math.sqrt(periodsPerYear);
}

/** Distance en σ. Null si σ n'est pas connu (pas de volatilité implicite, volCT à l'étape 4). */
export function sigmaDistance(points: number | null, sigma: number | null): number | null {
  if (points == null || sigma == null || !(sigma > 0) || !Number.isFinite(points)) return null;
  return Math.abs(points) / sigma;
}

/** Classes semi-ouvertes [0 ; 0,25) [0,25 ; 0,5) [0,5 ; 1) [1 ; ∞). */
export function sigmaBand(distance: number): '<0.25' | '0.25-0.5' | '0.5-1' | '>1' | null {
  if (!Number.isFinite(distance) || distance < 0) return null;
  if (distance < 0.25) return '<0.25';
  if (distance < 0.5) return '0.25-0.5';
  if (distance < 1) return '0.5-1';
  return '>1';
}

/** p^k. Gains : p = taux de réussite. Pertes : p = 1 − taux. */
export function bernoulliRun(probability: number, length: number): number {
  if (!(probability >= 0) || probability > 1 || !Number.isInteger(length) || length < 0) return Number.NaN;
  return probability ** length;
}

/** Plus longue série de pertes sur `trades` essais, `draws` trajectoires. */
export function longestLossStreak(trades: number, lossRate: number, draws = 20_000, seed = 1): { mean: number; p95: number } {
  const n = Math.max(0, Math.floor(trades));
  const runs = Math.max(1, Math.floor(draws));
  const rand = mulberry32(seed);
  const lengths = new Array<number>(runs);
  for (let draw = 0; draw < runs; draw++) {
    let current = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (rand() < lossRate) {
        current += 1;
        if (current > max) max = current;
      } else current = 0;
    }
    lengths[draw] = max;
  }
  lengths.sort((a, b) => a - b);
  let sum = 0;
  for (const value of lengths) sum += value;
  const index = Math.min(lengths.length - 1, Math.max(0, Math.ceil(0.95 * lengths.length) - 1));
  return { mean: lengths.length ? sum / lengths.length : 0, p95: lengths[index] ?? 0 };
}

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) x += (LANCZOS[i] ?? 0) / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-12) break;
  }
  return h;
}

/** I_x(a, b), fonction bêta incomplète régularisée. */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFront = Math.log(x) * a + Math.log(1 - x) * b - (logGamma(a) + logGamma(b) - logGamma(a + b));
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(logFront) * betaContinuedFraction(a, b, x)) / a;
  return 1 - (Math.exp(logFront) * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Quantile de la loi Bêta, par dichotomie. */
export function betaQuantile(probability: number, a: number, b: number): number {
  if (probability <= 0) return 0;
  if (probability >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedBeta(mid, a, b) < probability) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A posteriori Bêta(1, 1) : moyenne et intervalle central à 90 %. */
export function betaPosterior(wins: number, losses: number): { mean: number; low: number; high: number } {
  const a = 1 + wins;
  const b = 1 + losses;
  return { mean: a / (a + b), low: betaQuantile(0.05, a, b), high: betaQuantile(0.95, a, b) };
}

/** Taux de réussite des trades qui suivent exactement `streak` gains ou pertes. */
export function rateAfterStreak(pnls: readonly number[], streak: number, side: 'loss' | 'win'): { count: number; wins: number; winRate: number | null } {
  if (!Number.isInteger(streak) || streak < 1) return { count: 0, wins: 0, winRate: null };
  let count = 0;
  let wins = 0;
  for (let i = streak; i < pnls.length; i++) {
    let matched = true;
    for (let k = 1; k <= streak; k++) {
      const previous = pnls[i - k] ?? 0;
      const hit = side === 'loss' ? previous < 0 : previous > 0;
      if (!hit) {
        matched = false;
        break;
      }
    }
    const current = pnls[i];
    if (!matched || current == null || !Number.isFinite(current)) continue;
    count += 1;
    if (current > 0) wins += 1;
  }
  return { count, wins, winRate: count > 0 ? wins / count : null };
}

/** IC 90 % de la moyenne des trades, rééchantillonnée par blocs de journées. */
export function dayBlockedMeanCi(groups: readonly (readonly number[])[], draws = 2_000, seed = 1): { center: number; low: number; high: number } {
  const flat: number[] = [];
  for (const group of groups) for (const value of group) if (Number.isFinite(value)) flat.push(value);
  const center = flat.length ? flat.reduce((sum, value) => sum + value, 0) / flat.length : 0;
  const days = groups.filter((group) => group.some((value) => Number.isFinite(value)));
  if (days.length === 0) return { center: 0, low: 0, high: 0 };
  const rand = mulberry32(seed);
  const block = blockLengthOf(days.length);
  const means: number[] = [];
  for (let draw = 0; draw < draws; draw++) {
    let sum = 0;
    let count = 0;
    let filled = 0;
    while (filled < days.length) {
      const start = Math.floor(rand() * days.length);
      const take = Math.min(block, days.length - filled);
      for (let j = 0; j < take; j++) {
        const day = days[(start + j) % days.length] ?? [];
        for (const value of day) {
          if (!Number.isFinite(value)) continue;
          sum += value;
          count += 1;
        }
      }
      filled += take;
    }
    means.push(count > 0 ? sum / count : 0);
  }
  means.sort((a, b) => a - b);
  return { center, low: percentile(means, 0.05), high: percentile(means, 0.95) };
}
