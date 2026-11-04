import { CATALYST_HORIZON_DAYS } from '@/engine/agent/tools';
import type { CalEvent } from '@/engine/calendar';
import { horizonEnd, publicationInstant } from '@/lib/calendarMarks';

/**
 * Calendrier, Système 4.0 : le trait dit l'état d'une publication, la forme dit son impact — aucune couleur dépensée,
 * l'or et le rouge restent aux signaux du desk. Pur : l'instant `now` est passé, les dates sont celles de New York.
 * Système 4.1 : plus de plaque TIME ENGINE ; la séance, la synchro et les catalyseurs sont dits chacun une fois ailleurs.
 * Système 5 (OROS5.4) : les tables du trait et de l'impact vivent dans `src/lib/calendarMarks.ts`, que le châssis et le
 * design lisent sans importer un module ; elles se relisent ici pour leurs lecteurs d'avant. Restent au Calendrier
 * l'horizon de sa grille, « maintenant » dans le flux et la lentille.
 */
export { horizonEnd, impactBars, strokeOf, STROKES, type Stroke } from '@/lib/calendarMarks';

/** Premier jour, parmi `days` (triés), au-delà de l'horizon : il porte le glyphe de l'horizon. */
export function horizonDay(days: readonly string[], now: number, n = CATALYST_HORIZON_DAYS): string | null {
  const end = horizonEnd(now, n);
  return days.find((d) => d > end) ?? null;
}

/** Rang de « maintenant » parmi les publications du jour triées par heure : après celles déjà passées. */
export function nowIndex(events: readonly Pick<CalEvent, 'date' | 'timeET'>[], now: number): number {
  let i = 0;
  while (i < events.length && publicationInstant(events[i]!) <= now) i++;
  return i;
}

/** Tracé de « maintenant » : la lentille du sceau, épaisse au centre, effilée aux bouts (boîte 400 × 8). */
export const LENS_PATH = 'M0 4 C120 1.6 280 1.6 400 4 C280 6.4 120 6.4 0 4 Z';
