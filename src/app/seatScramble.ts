/** Geste du siège nominatif (`docs/SIEGE-NOMINATIF.md` § 4) : lettres qui tournent, puis se posent. */

/** Le littéral du champ : ni traduit, ni mis en capitales. */
export const SEAT_PROMPT = '<insert code>';
export const SEAT_ALPHABET = ['S', 'I', 'Ξ', 'R', 'Λ', 'K'] as const;
export const SEAT_STEPS = 6;
export const SEAT_STEP_MS = 70;

/**
 * Image du temps `step` pour `target` : à chaque position `i`, la lettre d'index `(3i + 7t) mod 6`.
 * Déterministe : le geste est le même à chaque fois. À partir de `SEAT_STEPS`, la cible elle-même.
 */
export function scrambleFrame(target: string, step: number): string {
  if (step >= SEAT_STEPS) return target;
  return [...target].map((_, i) => SEAT_ALPHABET[(i * 3 + step * 7) % SEAT_ALPHABET.length]).join('');
}

/** Ordre des temps : 0 → 5 pour révéler, 5 → 0 pour poser le nom. */
export function scrambleSteps(reverse: boolean): number[] {
  const steps = Array.from({ length: SEAT_STEPS }, (_, k) => k);
  return reverse ? steps.reverse() : steps;
}
