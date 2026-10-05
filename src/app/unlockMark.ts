/**
 * « DESK UNLOCKED » — le mot ne se traduit pas.
 * Il s'écrit dans la police du desk. Ici, seulement le temps :
 * l'apparition, puis une tenue, avant la couture.
 */

export const UNLOCK_SEAL = 'DESK UNLOCKED';

/** Durée de l'apparition (s). */
export const SEAL_DRAW_S = 0.85;

const HOLD_S = 0.55;

/** Instant où le mot est posé, plus une tenue, avant la couture. */
export function sealFormMs(): number {
  return Math.round((SEAL_DRAW_S + HOLD_S) * 1000);
}
