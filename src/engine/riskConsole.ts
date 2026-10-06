import { getInstrument, hasInstrument } from './instruments';

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

export interface RrMatrix {
  /** Taux de réussite de chaque ligne, dans l'ordre. */
  winRates: number[];
  /** R/R de chaque colonne. La dernière est le R/R réalisé. */
  rewardRisks: number[];
  /** Espérance en R. */
  cells: number[][];
  /** Ligne et colonne du point réalisé. */
  realized: { row: number; col: number };
}

/**
 * Matrice R-R. Lignes : taux réalisé, puis les écarts (en points de taux, 0,10 = 10 points),
 * puis la borne basse. Colonnes : 1 ; 1,5 ; 2 ; 2,5 ; 3 et le R/R réalisé.
 */
export function rrMatrix(winRate: number, realizedRr: number, offsets: readonly number[] = [0.1, -0.1, -0.15], winRateLow = winRate): RrMatrix {
  const winRates = [winRate, ...offsets.map((offset) => winRate + offset), winRateLow].map((rate) => Math.min(1, Math.max(0, rate)));
  const grid = [1, 1.5, 2, 2.5, 3];
  const rewardRisks = Number.isFinite(realizedRr) && realizedRr > 0 ? [...grid, realizedRr] : grid;
  const cells = winRates.map((rate) => rewardRisks.map((rr) => expectancyR(rate, rr)));
  return { winRates, rewardRisks, cells, realized: { row: 0, col: rewardRisks.length - 1 } };
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
