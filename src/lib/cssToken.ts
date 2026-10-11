/**
 * Valeur d'un jeton de `tokens.css` (`--violet`, `--pos`, …), lue sur `:root`.
 * Le canevas d'un graphique ne lit pas `var(--x)` : il lui faut la couleur résolue.
 * Rend `fallback` quand le jeton est absent ou vide, ou hors d'un document.
 */
export function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
