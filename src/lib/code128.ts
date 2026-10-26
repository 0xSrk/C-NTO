/**
 * Code 128 (jeux B et C, bascule automatique) : un vrai code, lisible au téléphone, pour la bande
 * d'étiquette et la plaque d'artefact (Système 4.0, `docs/DESIGN.md` § 00 — Code → identité).
 * Pur : un texte entre, des largeurs de modules sortent. Aucune dépendance.
 */

/** Barre, espace, barre, espace, barre, espace pour les valeurs 0 à 105, puis l'arrêt (106, sept éléments). */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

function digitRun(text: string, at: number): number {
  let n = 0;
  while (at + n < text.length && text.charCodeAt(at + n) >= 48 && text.charCodeAt(at + n) <= 57) n++;
  return n;
}

/** Valeurs du symbole : départ, données, somme de contrôle, arrêt. ASCII imprimable (32 à 126) seulement. */
export function code128Values(text: string): number[] {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length !== 1 || code < 32 || code > 126) throw new Error(`Code 128 : caractère hors de l'ASCII imprimable (${JSON.stringify(ch)})`);
  }
  const out: number[] = [];
  let set: 'B' | 'C';
  // Départ en C seulement quand le texte s'ouvre sur une suite paire d'au moins quatre chiffres.
  const lead = digitRun(text, 0);
  if (lead >= 4 && lead % 2 === 0) {
    set = 'C';
    out.push(START_C);
  } else {
    set = 'B';
    out.push(START_B);
  }
  let i = 0;
  while (i < text.length) {
    const run = digitRun(text, i);
    // Bascule B → C pour six chiffres ou plus, ou quatre et plus qui ferment le texte.
    const worth = run >= 6 || (run >= 4 && i + run === text.length);
    if (set === 'B' && worth && run % 2 === 0) {
      out.push(CODE_C);
      set = 'C';
    } else if (set === 'B' && worth && run % 2 === 1 && run - 1 >= 4) {
      out.push(text.charCodeAt(i) - 32);
      i++;
      out.push(CODE_C);
      set = 'C';
      continue;
    }
    if (set === 'C') {
      if (run >= 2) {
        out.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      out.push(CODE_B);
      set = 'B';
    }
    out.push(text.charCodeAt(i) - 32);
    i++;
  }
  let sum = out[0] ?? 0;
  for (let k = 1; k < out.length; k++) sum += (out[k] ?? 0) * k;
  out.push(sum % 103, STOP);
  return out;
}

/** Largeurs des modules : barre, espace, barre… ; commence par une barre, finit par la dernière barre de l'arrêt. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((value) => [...(CODE128_PATTERNS[value] ?? '')].map(Number));
}

/** Tracé SVG des barres (un module = une unité), hauteur `height` ; `modules` est la largeur totale. */
export function code128Path(text: string, height = 10): { d: string; modules: number } {
  let x = 0;
  let d = '';
  code128Widths(text).forEach((width, k) => {
    if (k % 2 === 0) d += `M${x} 0h${width}v${height}h${-width}z`;
    x += width;
  });
  return { d, modules: x };
}
