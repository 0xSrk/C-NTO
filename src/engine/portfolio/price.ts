import { getInstrument, hasInstrument } from '@/engine/instruments';

/** Multiplicateur d'une position : saisi, sinon `pointValue` du registre, sinon 1. */
export function positionMultiplier(position: { symbol: string; multiplier?: number }): number {
  if (position.multiplier != null && Number.isFinite(position.multiplier)) return position.multiplier;
  if (hasInstrument(position.symbol)) return getInstrument(position.symbol).pointValue;
  return 1;
}

export function instrumentMultiplier(symbol: string): number {
  if (hasInstrument(symbol)) return getInstrument(symbol).pointValue;
  return 1;
}
