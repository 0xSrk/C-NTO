/**
 * Réplication par position. Le copieur ne recopie pas chaque fill : il suit la part de la position du
 * maître ouverte pendant la réplication (« exposition copiée ») et amène chaque suiveur à la cible
 * correspondante. Une entrée en plusieurs fills ne multiplie pas la taille, une sortie ramène à zéro.
 */
import { applyMap } from './sizing';
import type { FollowerRule } from './types';

/** Position nette du maître sur un instrument, et la part ouverte pendant que la réplication était armée. */
export interface MasterExposure {
  pos: number;
  copied: number;
}

export const FLAT: MasterExposure = { pos: 0, copied: 0 };

const norm = (n: number) => (n === 0 ? 0 : n);

/**
 * Applique un fill du maître (`signed` : achat +, vente −). Armé, la part nouvelle est copiée ; désarmé,
 * elle ne l'est pas. Une réduction entame d'abord la part non copiée ; un retournement clôt l'ancienne
 * position et ouvre la nouvelle. Invariant : `copied` a le signe de `pos` et `|copied| ≤ |pos|`.
 */
export function applyMasterFill(prev: MasterExposure, signed: number, armed: boolean): MasterExposure {
  const pos = prev.pos + signed;
  if (prev.pos !== 0 && pos !== 0 && Math.sign(pos) !== Math.sign(prev.pos)) return { pos, copied: armed ? pos : 0 };
  if (Math.abs(pos) > Math.abs(prev.pos)) return { pos, copied: norm(armed ? prev.copied + (pos - prev.pos) : prev.copied) };
  return { pos: norm(pos), copied: norm(Math.sign(pos) * Math.min(Math.abs(prev.copied), Math.abs(pos))) };
}

/** Recale l'exposition sur la position réelle du maître (armement) : la part copiée ne dépasse jamais la position. */
export function rebaseExposure(prev: MasterExposure, actualPos: number): MasterExposure {
  if (actualPos === 0 || Math.sign(actualPos) !== Math.sign(prev.copied)) return { pos: norm(actualPos), copied: 0 };
  return { pos: actualPos, copied: Math.sign(actualPos) * Math.min(Math.abs(prev.copied), Math.abs(actualPos)) };
}

/**
 * Position cible du suiveur pour une exposition copiée du maître. `ratio` : arrondi de l'exposition
 * (carte micro / standard appliquée) ; `fixe` et `risque` : la taille choisie, par position et non par fill.
 * Une taille non entière passe telle quelle : le routeur la refuse.
 */
export function followerTarget(copied: number, instrument: string, follower: FollowerRule): { instrument: string; target: number; unmapped: boolean } {
  const size = Math.abs(copied);
  const mapped = applyMap(instrument, size, follower.symbolMap);
  if (mapped.unmapped) return { instrument, target: 0, unmapped: true };
  if (size === 0) return { instrument: mapped.instrument, target: 0, unmapped: false };
  const value = follower.sizing.value;
  const qty = follower.sizing.mode === 'ratio' ? Math.round(mapped.qty * value) : follower.sizing.mode === 'risque' ? Math.max(1, Math.round(value)) : value;
  return { instrument: mapped.instrument, target: norm(Math.sign(copied) * qty), unmapped: false };
}

/**
 * Découpe un passage de `held` à `target` : `reduce` ramène vers zéro (réduit le risque), `open` ouvre
 * ou augmente. Un retournement donne les deux.
 */
export function splitMove(held: number, target: number): { reduce: number; open: number } {
  if (held === target) return { reduce: 0, open: 0 };
  if (held !== 0 && target !== 0 && Math.sign(held) !== Math.sign(target)) return { reduce: -held, open: target };
  if (Math.abs(target) < Math.abs(held)) return { reduce: target - held, open: 0 };
  return { reduce: 0, open: target - held };
}

export function positionKey(account: string, instrument: string): string {
  return `${account}|${instrument}`;
}
