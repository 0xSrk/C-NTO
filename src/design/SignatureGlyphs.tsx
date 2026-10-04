import s from './signatureGlyphs.module.css';

/**
 * Signature du Lab, neuf glyphes : S I Ξ R R Λ S K Λ.
 * Même main que le logotype — trait carré, capitale alignée — à l'échelle de la barre d'état.
 * Le nom typographié reste à côté ; ces tracés sont la marque, pas une seconde lecture.
 */

const CAP = 1.15;
const BASE = 12.85;
const MID = 7;

interface Glyph {
  ch: string;
  w: number;
  d: string;
}

const S = `M8.35 3.2 C8.35 1.05 1.45 0.95 1.45 4.2 C1.45 6.9 8.55 6 8.55 8.9 C8.55 11.9 1.45 11.15 1.45 ${BASE}`;
const I = `M1.1 ${CAP} V${BASE}`;
const XI = `M0.35 1.7 H8.85 M0.35 ${MID} H8.85 M0.35 12.3 H8.85`;
const R = `M1.1 ${BASE} V${CAP} H5.35 C8.2 ${CAP} 8.2 6.55 5.35 6.55 H1.1 M4.4 6.55 L8.25 ${BASE}`;
const LAMBDA = `M0.7 ${BASE} L4.6 ${CAP} L8.5 ${BASE}`;
const K = `M1.1 ${CAP} V${BASE} M1.1 ${MID} L8.15 ${CAP} M1.1 ${MID} L8.15 ${BASE}`;

/** Neuf glyphes, largeurs optiques : le I est un fût, les autres tiennent la même chasse. */
const GLYPHS: readonly Glyph[] = [
  { ch: 'S', w: 10, d: S },
  { ch: 'I', w: 2.2, d: I },
  { ch: 'Ξ', w: 9.2, d: XI },
  { ch: 'R', w: 9.4, d: R },
  { ch: 'R', w: 9.4, d: R },
  { ch: 'Λ', w: 9.2, d: LAMBDA },
  { ch: 'S', w: 10, d: S },
  { ch: 'K', w: 9.2, d: K },
  { ch: 'Λ', w: 9.2, d: LAMBDA },
];

const GAP = 3.15;

function layout() {
  let x = 0;
  const placed = GLYPHS.map((glyph) => {
    const at = x;
    x += glyph.w + GAP;
    return { ...glyph, x: at };
  });
  return { placed, width: x - GAP };
}

const MARK = layout();

export function SignatureGlyphs() {
  return (
    <svg className={s.mark} viewBox={`0 0 ${MARK.width} 14`} fill="none" aria-hidden>
      {MARK.placed.map((glyph, index) => (
        <path key={`${glyph.ch}-${index}`} d={glyph.d} transform={`translate(${glyph.x} 0)`} />
      ))}
    </svg>
  );
}
