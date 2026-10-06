/**
 * Geste du siège nominatif (`docs/SIEGE-NOMINATIF.md` § 4 et 5) : des glyphes qui tombent ou émergent
 * un à un, en tournant sur les lettres du Lab avant de se poser. Tout est déterministe : pas de hasard,
 * le geste est le même à chaque fois.
 */

/** Le littéral du champ : ni traduit, ni mis en capitales. */
export const SEAT_PROMPT = '<insert code>';
export const SEAT_ALPHABET = ['S', 'I', 'Ξ', 'R', 'Λ', 'K'] as const;
/** Le curseur, ou le focus, reste 2 s sur les barres avant que le geste ne s'éveille. */
export const SEAT_DWELL_MS = 2000;
/** Pas de l'horloge du geste. */
export const SEAT_TICK_MS = 30;
/** Les barres se reforment avant que le nom n'en sorte. */
export const SEAT_REFORM_MS = 600;

export interface GlyphPlan {
  /** Écart entre deux glyphes voisins (ms). */
  stagger: number;
  /** Vie d'un glyphe, de son apparition à sa pose (ms). */
  spin: number;
  /** Durée de chaque lettre pendant qu'il tourne (ms). */
  frame: number;
  /** D'où part la vague : le début du mot, ou sa fin, côté barres. */
  from: 'start' | 'end';
  /** Irrégularité de l'écart, en part de `stagger` : 0 pour des dominos, plus pour un geste organique. */
  jitter: number;
  /** Durée totale au plus (ms) : un nom long resserre l'écart. */
  maxTotal: number;
}

/** Les barres se défont en domino : régulier, de gauche à droite. */
export const SEAT_DOMINO: GlyphPlan = { stagger: 85, spin: 340, frame: 85, from: 'start', jitter: 0, maxTotal: 1600 };
/** Le nom émerge des barres : lent, irrégulier, du dernier glyphe au premier. */
export const SEAT_EMERGE: GlyphPlan = { stagger: 340, spin: 1100, frame: 180, from: 'end', jitter: 0.35, maxTotal: 6000 };

export type GlyphPhase = 'wait' | 'turn' | 'set';
export interface Glyph {
  char: string;
  phase: GlyphPhase;
}

/** Écart propre au rang `k` de la vague, dans [-1, 1]. Un hachage entier : pas de `Math.random`. */
function wobble(k: number): number {
  const h = Math.imul(k + 1, 2654435761) >>> 0;
  return (h % 2001) / 1000 - 1;
}

/** Départ de chaque glyphe (ms), dans l'ordre du texte. L'ordre de la vague est toujours respecté. */
export function glyphDelays(count: number, plan: GlyphPlan): number[] {
  if (count <= 0) return [];
  const stagger = count > 1 ? Math.min(plan.stagger, Math.max(0, (plan.maxTotal - plan.spin) / (count - 1))) : 0;
  return Array.from({ length: count }, (_, i) => {
    const k = plan.from === 'start' ? i : count - 1 - i;
    const jitter = k === 0 ? 0 : wobble(k) * plan.jitter * stagger;
    return Math.max(0, Math.round(k * stagger + jitter));
  });
}

/** Durée du geste pour `count` glyphes : le dernier parti a fini de tourner. */
export function glyphsDuration(count: number, plan: GlyphPlan): number {
  const delays = glyphDelays(count, plan);
  return delays.length ? Math.max(...delays) + plan.spin : 0;
}

/**
 * État de chaque glyphe de `target` au temps `t` (ms) : en attente (invisible, sa place est gardée),
 * en train de tourner sur une lettre du Lab (index `(3i + 7k) mod 6` au pas `k`), ou posé.
 */
export function glyphsAt(target: string, t: number, plan: GlyphPlan): Glyph[] {
  const chars = [...target];
  const delays = glyphDelays(chars.length, plan);
  return chars.map((char, i) => {
    const local = t - delays[i]!;
    if (local < 0) return { char, phase: 'wait' };
    if (local >= plan.spin) return { char, phase: 'set' };
    const k = Math.floor(local / plan.frame);
    return { char: SEAT_ALPHABET[(i * 3 + k * 7) % SEAT_ALPHABET.length]!, phase: 'turn' };
  });
}
