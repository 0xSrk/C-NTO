/**
 * Appariement des comptes (OROS5.8). Le compte n'a pas de table : son nom est la clé. Une seule règle, celle du
 * process principal (`heldPosition`, `electron/agent-orders.ts`) : le nom exact d'abord, puis le nom replié, sans
 * tenir compte de la casse ni des espaces (`SimAPEX1` y désigne `SimApex1`). La garde du process principal garde sa
 * propre copie et ne change pas ; ce module la suit, tenu par un test sur la même table de cas.
 * Pur : aucun import.
 */

/** Le nom replié : espaces de bord retirés, espaces intérieurs réduits à un seul, minuscules. */
export function foldAccount(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Deux noms désignent le même compte : égaux, ou égaux une fois repliés. */
export function sameAccount(a: string, b: string): boolean {
  return a === b || foldAccount(a) === foldAccount(b);
}

/** Comment un nom a été reconnu : la provenance de la fiche Compte et des bornes le dit. */
export type AccountMatchKind = 'exact' | 'folded';

export interface AccountMatch {
  /** Le nom tel que la liste le porte (le pont, le journal). */
  name: string;
  by: AccountMatchKind;
}

/** Le compte de `names` que `wanted` désigne : le nom exact d'abord, puis le premier nom replié égal ; `null` sinon. */
export function matchAccount(names: readonly string[], wanted: string): AccountMatch | null {
  const exact = names.find((name) => name === wanted);
  if (exact !== undefined) return { name: exact, by: 'exact' };
  const folded = foldAccount(wanted);
  const near = names.find((name) => foldAccount(name) === folded);
  return near !== undefined ? { name: near, by: 'folded' } : null;
}
