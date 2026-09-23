/** Le canevas n'est créé que lorsque le cadre a une taille réelle. */
export function chartHostReady(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width >= 8 && height >= 8;
}

/**
 * Hauteur demandée pour un pane secondaire.
 * Retourne null si le chart n'a pas encore de hauteur : lightweight-charts divise
 * alors par zéro et pose un facteur d'étirement infini, ce qui noircit la fenêtre.
 */
export function safePaneHeight(requested: number, chartHeight: number, paneCount: number): number | null {
  if (!Number.isFinite(requested) || !Number.isFinite(chartHeight) || !Number.isFinite(paneCount)) return null;
  if (chartHeight < 8 || paneCount < 2) return null;
  const min = 30;
  const max = chartHeight - min * (paneCount - 1);
  if (!(max >= min)) return null;
  return Math.min(max, Math.max(min, Math.round(requested)));
}
