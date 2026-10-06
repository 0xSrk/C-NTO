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
