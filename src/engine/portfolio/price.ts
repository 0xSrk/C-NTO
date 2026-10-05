import { getInstrument, hasInstrument, resolveSymbol } from '@/engine/instruments';

/** Multiplicateur d'une position : saisi, sinon `pointValue` du registre, sinon 1. */
export function positionMultiplier(position: { symbol: string; multiplier?: number }): number {
  if (position.multiplier != null && Number.isFinite(position.multiplier)) return position.multiplier;
  if (hasInstrument(position.symbol)) return getInstrument(position.symbol).pointValue;
  return 1;
}

/**
 * Multiplicateur d'un instrument du pont. NinjaTrader nomme le contrat avec son mois (`NQ 12-26`) :
 * la racine est retrouvée par `resolveSymbol`, sans quoi le notionnel tomberait au point (× 1).
 */
export function instrumentMultiplier(symbol: string): number {
  if (hasInstrument(symbol)) return getInstrument(symbol).pointValue;
  const root = resolveSymbol(symbol)?.symbol;
  if (root && hasInstrument(root)) return getInstrument(root).pointValue;
  return 1;
}
