/**
 * Sceau d'ouverture — « DESK UNLOCKED ».
 * Trait carré, capitale alignée sur l'axe : même main que le logotype.
 * La graphie ne se traduit pas. C'est une marque, pas une phrase d'interface.
 */

export const UNLOCK_SEAL = 'DESK UNLOCKED';

/** Durée du tracé d'une lettre (s), la même courbe que le logotype. */
export const SEAL_DRAW_S = 0.7;

const STEP_S = 0.07;
const WORD_GAP_S = 0.28;
const START_S = 0.2;
const HOLD_S = 0.48;
const ADVANCE = 58;
const SPACE = 36;

/**
 * Une seule boîte : fûts x 8 et 48, capitale y 8, pied y 72, ceinture y 40.
 * Les rondes partagent l'ellipse 20 × 32. Le S est deux cercles de rayon 16, empilés.
 * L'axe du circuit passe à la ceinture du mot.
 */
const LETTER: Record<string, readonly string[]> = {
  D: ['M8 72 V8 H28 A20 32 0 0 1 28 72 H8'],
  E: ['M48 8 H8 V72 H48', 'M8 40 H36'],
  S: ['M44 18 C44 8 12 10 12 24 C12 36 22 40 28 40 C34 40 44 44 44 56 C44 70 12 72 12 62'],
  K: ['M8 8 V72', 'M8 40 L48 8', 'M8 40 L48 72'],
  U: ['M8 8 V40 A20 32 0 0 0 48 40 V8'],
  N: ['M8 72 V8', 'M8 8 L48 72', 'M48 72 V8'],
  L: ['M8 8 V72 H48'],
  O: ['M28 8 A20 32 0 1 1 28 72 A20 32 0 1 1 28 8'],
  C: ['M38.3 12.57 A20 32 0 1 0 38.3 67.43'],
};

export interface SealGlyph {
  ch: string;
  strokes: readonly string[];
  x: number;
  delay: number;
}

export interface SealLayout {
  glyphs: SealGlyph[];
  width: number;
  height: number;
}

function layout(): SealLayout {
  const glyphs: SealGlyph[] = [];
  let x = 0;
  let letter = 0;
  for (const ch of UNLOCK_SEAL) {
    if (ch === ' ') {
      x += SPACE;
      continue;
    }
    const strokes = LETTER[ch];
    if (!strokes) throw new Error('sceau incomplet');
    glyphs.push({
      ch,
      strokes,
      x,
      delay: START_S + letter * STEP_S + (letter >= 4 ? WORD_GAP_S : 0),
    });
    x += ADVANCE;
    letter += 1;
  }
  return { glyphs, width: x, height: 80 };
}

const SEAL = layout();

export function seal(): SealLayout {
  return SEAL;
}

/** Instant où le dernier trait est posé, plus une tenue, avant la couture. */
export function sealFormMs(): number {
  const last = SEAL.glyphs.reduce((max, glyph) => Math.max(max, glyph.delay), 0);
  return Math.round((last + SEAL_DRAW_S + HOLD_S) * 1000);
}
