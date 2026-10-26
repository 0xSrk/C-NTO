/**
 * Code d'accolades du pied (`docs/DESIGN.md` § Châssis) : `{`, onze barres de largeurs variées, `}`. Les largeurs sont
 * tirées au hasard une fois par ouverture du desk ; leur somme est fixe, si bien que le code garde toujours la même
 * place (le geste du siège s'y règle) et que seul son dessin change. Ce n'est pas un code lisible : l'identité de
 * l'artefact, `SK-ART-002-{version}`, reste en clair et en Code 128 (`src/lib/code128.ts`).
 */

export const BRACE_BARS = 11;
/** Somme des largeurs des barres, en pixels : onze barres de 1 à 3 px. */
export const BRACE_BAR_SUM = 22;
export const BRACE_GAP = 2;
export const BRACE_HEIGHT = 10;
/** Largeur du dessin des barres, accolades non comprises. */
export const BRACE_WIDTH = BRACE_BAR_SUM + (BRACE_BARS - 1) * BRACE_GAP;

const MIN = 1;
const MAX = 3;
const SWAPS = 48;

/**
 * Onze largeurs de 1 à 3 px, de somme `BRACE_BAR_SUM` : on part de barres de 2 px et l'on déplace un pixel d'une barre
 * à une autre, au hasard. Jamais onze barres égales.
 */
export function braceBarWidths(random: () => number = Math.random): number[] {
  const widths = Array.from({ length: BRACE_BARS }, () => BRACE_BAR_SUM / BRACE_BARS);
  const pick = () => Math.min(BRACE_BARS - 1, Math.floor(random() * BRACE_BARS));
  for (let n = 0; n < SWAPS; n++) {
    const from = pick();
    const to = pick();
    if (from !== to && widths[from]! > MIN && widths[to]! < MAX) {
      widths[from]! -= 1;
      widths[to]! += 1;
    }
  }
  if (widths.every((w) => w === widths[0])) {
    widths[0] = MIN;
    widths[BRACE_BARS - 1] = MAX;
  }
  return widths;
}

/** Tracé SVG des barres, un rectangle par barre, `BRACE_GAP` px entre deux. */
export function braceBarsPath(widths: readonly number[], height = BRACE_HEIGHT): string {
  let x = 0;
  let d = '';
  for (const w of widths) {
    d += `M${x} 0h${w}v${height}h-${w}z`;
    x += w + BRACE_GAP;
  }
  return d;
}

let drawn: number[] | null = null;

/** Le dessin de cette ouverture du desk : tiré une fois, le même à chaque rendu jusqu'à la prochaine ouverture. */
export function sessionBraceBars(): number[] {
  drawn ??= braceBarWidths();
  return drawn;
}
