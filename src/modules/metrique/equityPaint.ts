/**
 * Géométrie du dessin de la courbe d'équité, au trait du Lab : trame de points, pixel signature.
 * Pur (aucun canevas) : les séries de `equitySeries.ts` ne font que peindre ces formes.
 * Toutes les longueurs sont en pixels physiques (bitmap).
 */

export interface Pt {
  x: number;
  y: number;
}

/** Ordonnée de la ligne brisée en `x` (points triés par x), ou `null` hors de son étendue. */
export function curveAt(points: readonly Pt[], x: number): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || x < first.x || x > last.x) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid]?.x ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (b.x === a.x) return b.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

export interface Dot {
  x: number;
  y: number;
  /** Rayon en pixels physiques. */
  r: number;
  /** Proximité de la crête, 0 (loin) à 1 (contre la ligne) : fixe l'intensité. */
  k: number;
}

export interface TramePlan {
  /** Pas de la trame (px physiques). */
  pitch: number;
  /** Distance à la crête où le point atteint sa taille minimale (px physiques). */
  fade: number;
  rMin: number;
  rMax: number;
}

/**
 * Trame d'une aire entre la ligne et sa base : une grille fixe à l'écran (le motif ne glisse pas
 * avec les données, comme une trame d'imprimerie), des points qui grossissent contre la ligne et
 * se dissolvent vers la base. Rien ne déborde de l'aire, rien ne touche la ligne ni la base.
 */
export function trame(points: readonly Pt[], base: number, plan: TramePlan, clip: { left: number; right: number }): Dot[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || plan.pitch <= 0) return [];
  const dots: Dot[] = [];
  const from = Math.max(clip.left, first.x);
  const to = Math.min(clip.right, last.x);
  const x0 = Math.ceil(from / plan.pitch) * plan.pitch;
  for (let x = x0; x <= to; x += plan.pitch) {
    const edge = curveAt(points, x);
    if (edge === null || Math.abs(edge - base) < plan.pitch) continue;
    const down = edge < base;
    // La ligne garde un demi-pas de vide, la base aussi : la trame ne touche ni l'une ni l'autre.
    const start = down ? Math.ceil((edge + plan.pitch * 0.5) / plan.pitch) * plan.pitch : Math.floor(base / plan.pitch) * plan.pitch + plan.pitch;
    const end = down ? base - plan.pitch * 0.5 : edge - plan.pitch * 0.5;
    for (let y = start; y <= end; y += plan.pitch) {
      const d = Math.abs(y - edge);
      const k = Math.max(0, 1 - d / plan.fade);
      dots.push({ x, y, r: plan.rMin + (plan.rMax - plan.rMin) * k * k, k });
    }
  }
  return dots;
}

export interface Cell {
  x: number;
  y: number;
  size: number;
  /** Cœur blanc du pixel. */
  core: boolean;
  /** Opacité de la cellule : pleine au centre, plus douce sur l'anneau, éteinte aux coins. */
  alpha: number;
}

/**
 * Pixel signature du Lab : une matrice 5 × 5 de cellules rouges, cœur blanc, coins éteints.
 * Centrée sur (cx, cy), alignée sur la grille physique pour rester nette.
 */
export function signaturePixel(cx: number, cy: number, cell: number, gap: number): Cell[] {
  const size = Math.max(1, Math.round(cell));
  const step = size + Math.max(1, Math.round(gap));
  const span = step * 4 + size;
  const left = Math.round(cx - span / 2);
  const top = Math.round(cy - span / 2);
  const cells: Cell[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const ring = Math.max(Math.abs(row - 2), Math.abs(col - 2));
      const corner = Math.abs(row - 2) === 2 && Math.abs(col - 2) === 2;
      cells.push({ x: left + col * step, y: top + row * step, size, core: ring === 0, alpha: corner ? 0.22 : ring === 2 ? 0.5 : 1 });
    }
  }
  return cells;
}

/** Bord gauche d'une étiquette de largeur `width` posée près de `x` : à droite du repère, ou à gauche s'il n'y a pas la place. */
export function labelLeft(x: number, width: number, gap: number, right: number): number {
  return x + gap + width <= right ? x + gap : Math.max(0, x - gap - width);
}

/**
 * Le zéro, tracé comme la lentille du sceau : deux cubiques de Bézier symétriques, épaisses au centre, effilées
 * jusqu'à rien aux deux bouts. `bulge` : écart des points de contrôle ; l'épaisseur au centre vaut 1,5 × `bulge`.
 */
export interface Lens {
  from: Pt;
  to: Pt;
  /** Points de contrôle de l'arc supérieur, de `from` vers `to`. */
  top: [Pt, Pt];
  /** Points de contrôle de l'arc inférieur, de `to` vers `from`. */
  bottom: [Pt, Pt];
}

export function lens(x0: number, x1: number, y: number, bulge: number): Lens {
  const w = x1 - x0;
  return {
    from: { x: x0, y },
    to: { x: x1, y },
    top: [
      { x: x0 + w * 0.3, y: y - bulge },
      { x: x0 + w * 0.7, y: y - bulge },
    ],
    bottom: [
      { x: x0 + w * 0.7, y: y + bulge },
      { x: x0 + w * 0.3, y: y + bulge },
    ],
  };
}

/** Pas sans trait sur la règle de séances. */
const NO_SESSION = -1;
/** Un appui toutes les `RULER_MAJOR` séances. */
export const RULER_MAJOR = 10;

/**
 * Règle de séances : pour chaque pas de la courbe, l'ordinal (1, 2, …) de la séance qu'il ouvre ; `-1` pour un pas qui
 * n'en ouvre pas (le départ, un trade de la même séance).
 */
export function sessionMarks(steps: readonly { date: string; origin?: true }[]): number[] {
  let ordinal = 0;
  let last: string | null = null;
  return steps.map((step) => {
    if (step.origin) return NO_SESSION;
    if (step.date === last) return NO_SESSION;
    last = step.date;
    ordinal += 1;
    return ordinal;
  });
}

/** Hauteur du trait de la règle pour un pas : `minor` par séance, `major` toutes les dix, 0 sans séance. */
export function rulerTick(mark: number, minor: number, major: number): number {
  if (mark <= 0) return 0;
  return mark % RULER_MAJOR === 0 ? major : minor;
}

/**
 * Connecteur d'un repère de la planche (⊕ plus haut, ⊗ creux) : un trait qui part du glyphe, finit sur un petit
 * cercle, puis l'étiquette. Mesures de la maquette (glyphe de 12, trait de 8 à 17, cercle à 19, texte à 26–27),
 * multipliées par `k` (rapport de pixels).
 */
export interface Leader {
  from: Pt;
  to: Pt;
  dot: Pt;
  /** Ancre du texte : centre bas (`center`), début (`left`) ou fin (`right`) de la ligne de base. */
  text: Pt;
  align: 'center' | 'left' | 'right';
}

export function leader(at: Pt, side: 'up' | 'right' | 'left', k: number): Leader {
  if (side === 'up') {
    return { from: { x: at.x, y: at.y - 8 * k }, to: { x: at.x, y: at.y - 17 * k }, dot: { x: at.x, y: at.y - 19 * k }, text: { x: at.x, y: at.y - 26 * k }, align: 'center' };
  }
  const dir = side === 'right' ? 1 : -1;
  return {
    from: { x: at.x + dir * 8 * k, y: at.y },
    to: { x: at.x + dir * 19 * k, y: at.y },
    dot: { x: at.x + dir * 21 * k, y: at.y },
    text: { x: at.x + dir * 27 * k, y: at.y },
    align: side === 'right' ? 'left' : 'right',
  };
}

/** Hachure à 45° d'un rectangle (la zone au-delà d'une borne) : segments déjà coupés au cadre, motif fixe à l'écran. */
export function hatch(x0: number, y0: number, x1: number, y1: number, pitch: number): [Pt, Pt][] {
  if (x1 - x0 <= 0 || y1 - y0 <= 0 || pitch <= 0) return [];
  const out: [Pt, Pt][] = [];
  // Droites x − y = c, sur une grille absolue : le motif ne glisse pas quand la borne monte ou descend.
  for (let c = Math.ceil((x0 - y1) / pitch) * pitch; c < x1 - y0; c += pitch) {
    const ax = Math.max(x0, c + y0);
    const bx = Math.min(x1, c + y1);
    if (bx - ax <= 0) continue;
    out.push([
      { x: ax, y: ax - c },
      { x: bx, y: bx - c },
    ]);
  }
  return out;
}
