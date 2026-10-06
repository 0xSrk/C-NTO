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
