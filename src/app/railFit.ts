/**
 * La place des portes au rail (OROS5.25, Système 5 « Fiche et Frise », décision 11 de l'ADMIN). Sous les neuf cartouches,
 * au-dessus des comptes connectés et du sceau : les portes se posent dans ce que le rail laisse libre, sans jamais faire
 * défiler les cartouches ni déplacer les comptes ou le sceau, qui restent au pied du rail. La pile des comptes prend sa
 * place avant elles (`accountsFit`, OROS5.51). Pur : les hauteurs sont mesurées par le châssis (ou recalculées des
 * feuilles par les tests).
 *
 * - `rows` : une ligne par porte (l'écrou C.070, le nom, l'état), puis le registre ;
 * - `line` : à l'étroit (1180 × 720 au zoom 100 %), une seule ligne d'écrous, chacun avec son trait, puis le registre ;
 * - `none` : sans place (720 px de haut avec la bande du kill switch, ou un zoom relevé), rien : la bande dit ce qui est
 *   fermé, et les cartouches gardent leur place.
 */

/** Une porte en ligne (l'écrou, le nom, l'état dessous) et l'écart entre deux. */
export const GATE_ROW_H = 30;
export const GATE_ROW_GAP = 2;
/** La ligne du registre, sous les portes. */
export const REGISTRY_ROW_H = 16;
/** La ligne d'écrous, à l'étroit, le registre au bout : la hauteur d'un écrou. */
export const GATE_LINE_H = 16;

/** Les quatre portes en lignes, puis le registre. */
export const GATE_ROWS_H = 4 * GATE_ROW_H + 4 * GATE_ROW_GAP + REGISTRY_ROW_H;

export type GatesMode = 'rows' | 'line' | 'none';

export interface RailSpace {
  /** Hauteur de contenu du rail (marges ôtées). */
  content: number;
  /** Hauteur naturelle de la nav : ses neuf cartouches, sans défiler. */
  nav: number;
  /** Hauteur du pied : le compte, le sceau et les langues. */
  foot: number;
  /** L'écart entre deux blocs du rail : les portes en ajoutent un. */
  gap: number;
}

/** Ce qui reste au rail entre la nav et le pied, l'écart d'aujourd'hui compté. */
export function railFree(space: RailSpace): number {
  return space.content - space.nav - space.foot - space.gap;
}

/** La forme des portes dans la place libre : en lignes, en une ligne d'écrous, ou rien. */
export function railFit(space: RailSpace): GatesMode {
  const free = railFree(space);
  if (free >= space.gap + GATE_ROWS_H) return 'rows';
  if (free >= space.gap + GATE_LINE_H) return 'line';
  return 'none';
}

/** Une ligne de compte connecté et l'écart entre deux (OROS5.51) : `.account` et `.accounts` de `shell.module.css`. */
export const ACCOUNT_ROW_H = 28;
export const ACCOUNT_ROW_GAP = 4;
/** La pile en montre toujours deux : à 1180 × 720 au zoom 100 %, deux comptes tiennent sans faire défiler les cartouches. */
export const ACCOUNT_ROWS_MIN = 2;

export interface AccountSpace {
  /** Hauteur de contenu du rail (marges ôtées). */
  content: number;
  /** Hauteur naturelle de la nav : ses neuf cartouches, sans défiler. */
  nav: number;
  /** L'écart entre deux blocs du rail. */
  gap: number;
  /** L'écart du pied, entre la pile et le sceau. */
  footGap: number;
  /** Le sceau et les langues. */
  signature: number;
}

/**
 * Les lignes que la pile des comptes connectés montre sans défiler (OROS5.51, décision de l'ADMIN, 2026-11-07) : ce que les
 * cartouches laissent au pied, la ligne d'écrous des portes réservée (au-delà de deux comptes, les portes gardent leur
 * ligne), et deux au moins. Plus de comptes connectés que de lignes : la pile défile d'une ligne à l'autre. Les portes se
 * posent ensuite dans ce qui reste (`railFit`).
 */
export function accountsFit(space: AccountSpace): number {
  const room = space.content - space.nav - space.gap - space.footGap - space.signature - (space.gap + GATE_LINE_H);
  return Math.max(ACCOUNT_ROWS_MIN, Math.floor((room + ACCOUNT_ROW_GAP) / (ACCOUNT_ROW_H + ACCOUNT_ROW_GAP)));
}
