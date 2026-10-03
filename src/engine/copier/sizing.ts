import { knownRoot, microOf, splitRoot, standardOf } from './symbols';
import type { FollowerRule, SymbolMap } from './types';

export interface SizedOrder {
  qty: number;
  instrument: string;
  /** La carte micro/standard était demandée et la racine est inconnue. */
  unmapped: boolean;
  /** Le plafond du suiveur a réduit la taille. */
  capped: boolean;
}

function applyMap(instrument: string, qty: number, map: SymbolMap): { instrument: string; qty: number; unmapped: boolean } {
  if (map.mode === 'explicite') {
    return instrument === map.from ? { instrument: map.to, qty, unmapped: false } : { instrument, qty, unmapped: false };
  }
  if (map.mode === 'identique') return { instrument, qty, unmapped: false };
  const parts = splitRoot(instrument);
  if (!parts || !knownRoot(parts.root)) return { instrument, qty, unmapped: true };
  if (map.mode === 'micro') {
    const micro = microOf(parts.root);
    if (!micro) return { instrument, qty, unmapped: false };
    return { instrument: `${micro.symbol}${parts.rest}`, qty: qty * micro.ratio, unmapped: false };
  }
  const standard = standardOf(parts.root);
  if (!standard) return { instrument, qty, unmapped: false };
  return { instrument: `${standard.symbol}${parts.rest}`, qty: Math.floor(qty / standard.ratio), unmapped: false };
}

/** Taille répliquée pour l'aperçu du prototype : plafonnée, avec la note d'origine. */
export function replicatedQty(
  master: { qty: number; instrument: string },
  follower: { sizing: FollowerRule['sizing']; symbolMap: SymbolMap },
): { qty: number; instrument: string; note?: string } {
  const mapped = applyMap(master.instrument, master.qty, follower.symbolMap);
  let qty = mapped.unmapped ? master.qty : mapped.qty;
  const instrument = mapped.unmapped ? master.instrument : mapped.instrument;
  if (follower.sizing.mode === 'fixe') qty = follower.sizing.value;
  else if (follower.sizing.mode === 'ratio') qty = Math.round(qty * follower.sizing.value);
  else if (follower.sizing.mode === 'risque') qty = Math.max(1, Math.round(follower.sizing.value));
  const capped = Math.min(qty, follower.sizing.maxContracts);
  return {
    qty: capped,
    instrument,
    note: capped < qty ? `plafonné à ${follower.sizing.maxContracts}` : qty === 0 ? 'taille nulle' : undefined,
  };
}

/** Taille avant plafond. Le routeur refuse au lieu d'envoyer une taille réduite. */
export function sizeFollower(master: { qty: number; instrument: string }, follower: FollowerRule): SizedOrder {
  const mapped = applyMap(master.instrument, master.qty, follower.symbolMap);
  if (mapped.unmapped) return { qty: master.qty, instrument: master.instrument, unmapped: true, capped: false };
  let qty = mapped.qty;
  if (follower.sizing.mode === 'fixe') qty = follower.sizing.value;
  else if (follower.sizing.mode === 'ratio') qty = Math.round(qty * follower.sizing.value);
  else qty = Math.max(1, Math.round(follower.sizing.value));
  const capped = qty > follower.sizing.maxContracts;
  return { qty, instrument: mapped.instrument, unmapped: false, capped };
}
