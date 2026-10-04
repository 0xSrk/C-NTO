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
 * Boîte 4 → 52, capitale 8 → 72, axe y 40.
 * L'axe du circuit passe donc à la ceinture du mot.
 */
const LETTER: Record<string, readonly string[]> = {
  D: ['M4 72 V8 H28 A24 32 0 0 1 28 72 H4'],
  E: ['M52 8 H4 V72 H52', 'M4 40 H36'],
  S: ['M46 18 C46 8 8 8 8 22 C8 36 44 30 44 46 C44 62 8 56 8 70'],
  K: ['M4 8 V72', 'M4 40 L52 8', 'M4 40 L52 72'],
  U: ['M4 8 V44 A24 28 0 0 0 52 44 V8'],
  N: ['M4 72 V8 L52 72 V8'],
  L: ['M4 8 V72 H52'],
  O: ['M28 8 A24 32 0 1 1 28 72 A24 32 0 1 1 28 8'],
  C: ['M40.4 12.6 A24 32 0 1 0 40.4 67.4'],
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
