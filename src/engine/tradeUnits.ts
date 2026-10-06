import { getInstrument, hasInstrument, standardCounterpart } from './instruments';
import type { Trade } from './types';

type TradeQty = Pick<Trade, 'pnl' | 'commission' | 'qty' | 'instrument'>;

/** Racine standard : MNQ → NQ. Un symbole inconnu reste tel quel. */
export function standardRoot(symbol: string): string {
  if (!hasInstrument(symbol)) return symbol;
  return standardCounterpart(symbol)?.symbol ?? getInstrument(symbol).symbol;
}

/** Quantité en équivalent du contrat standard (1 MNQ = 0,1 NQ). */
export function standardEquivalentQty(trade: Pick<Trade, 'qty' | 'instrument'>): number {
  if (!(trade.qty > 0) || !Number.isFinite(trade.qty)) return 0;
  if (!hasInstrument(trade.instrument)) return 0;
  const ratio = standardCounterpart(trade.instrument)?.ratio;
  return ratio && ratio > 0 ? trade.qty / ratio : trade.qty;
}

/**
 * Points par contrat : PnL avant frais ÷ (valeur du point × quantité).
 * Null si l'instrument ou la quantité ne permettent pas la conversion.
 */
export function pointsPerContract(trade: TradeQty): number | null {
  if (!Number.isFinite(trade.pnl) || !hasInstrument(trade.instrument) || !(trade.qty > 0)) return null;
  const spec = getInstrument(trade.instrument);
  if (!(spec.pointValue > 0)) return null;
  const gross = trade.pnl + (trade.commission || 0);
  if (!Number.isFinite(gross)) return null;
  return gross / (spec.pointValue * trade.qty);
}

export interface PointsAggregate {
  dollars: number;
  /** Moyenne pondérée par l'équivalent standard. Null si les racines se mélangent ou si rien n'est valorisé. */
  points: number | null;
  /** Somme des équivalents standard. Null si plusieurs racines. */
  standardEquivalent: number | null;
  root: string | null;
}

/** Motif de sortie lu dans le nom NinjaTrader. Absent ou non reconnu : autre. */
export type ExitReason = 'stop' | 'objectif' | 'manuel' | 'autre';

export function exitReasonOf(exitName?: string): ExitReason {
  const name = exitName?.trim().toLowerCase() ?? '';
  if (!name) return 'autre';
  if (name.includes('stop')) return 'stop';
  if (name.includes('target') || name.includes('objectif') || name.includes('profit') || name.includes('cible')) return 'objectif';
  if (name.includes('manual') || name.includes('manuel') || name.includes('close') || name.includes('flat')) return 'manuel';
  return 'autre';
}
export function aggregatePoints(trades: readonly TradeQty[]): PointsAggregate {
  let dollars = 0;
  let pointSum = 0;
  let pointWeight = 0;
  let equivalent = 0;
  let root: string | null = null;
  let mixed = false;
  for (const trade of trades) {
    if (!Number.isFinite(trade.pnl)) continue;
    dollars += trade.pnl;
    const next = hasInstrument(trade.instrument) ? standardRoot(trade.instrument) : null;
    if (next) {
      if (root == null) root = next;
      else if (root !== next) mixed = true;
    }
    const weight = standardEquivalentQty(trade);
    equivalent += weight;
    const points = pointsPerContract(trade);
    if (points == null || !(weight > 0)) continue;
    pointSum += points * weight;
    pointWeight += weight;
  }
  if (mixed) return { dollars, points: null, standardEquivalent: null, root: null };
  return {
    dollars,
    points: pointWeight > 0 ? pointSum / pointWeight : null,
    standardEquivalent: equivalent,
    root,
  };
}
