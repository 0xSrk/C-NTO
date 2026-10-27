/**
 * « DESK UNLOCKED » — le mot ne se traduit pas.
 * Il s'écrit dans la police du desk. Ici, seulement le temps de l'ouverture, qui part du sceau (4.1) :
 * le sceau glisse au centre de l'écran et se plie dans son horizon, le mot se lève de la ligne,
 * une tenue, puis la couture.
 */

export const UNLOCK_SEAL = 'DESK UNLOCKED';

/** Le sceau glisse au centre de l'écran (s). */
export const SEAL_GLIDE_S = 0.56;

/** Le sceau se plie dans son horizon : départ et durée (s). */
export const SEAL_FOLD_AT_S = 0.46;
export const SEAL_FOLD_S = 0.3;

/** Le mot se lève de la ligne quand le sceau s'y est presque replié (s). */
export const WORD_AT_S = 0.66;

/** Durée de l'apparition du mot (s). */
export const SEAL_DRAW_S = 0.7;

const HOLD_S = 0.28;

/** Instant où le mot est posé, plus une tenue, avant la couture. */
export function sealFormMs(): number {
  return Math.round((WORD_AT_S + SEAL_DRAW_S + HOLD_S) * 1000);
}
