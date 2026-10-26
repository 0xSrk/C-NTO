import { CATALYST_HORIZON_DAYS } from '@/engine/agent/tools';
import type { CalEvent } from '@/engine/calendar';
import { addDays, etDateKey, ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * Calendrier, Système 4.0 : le trait dit l'état d'une publication, la forme dit son impact — aucune couleur dépensée,
 * l'or et le rouge restent aux signaux du desk. Pur : l'instant `now` est passé, les dates sont celles de New York.
 */

/** Plein : publié ou passé (en service) · tireté : prévu dans la fenêtre · pointillé : au-delà de l'horizon. */
export type Stroke = 'publie' | 'prevu' | 'horizon';

export const STROKES: readonly Stroke[] = ['publie', 'prevu', 'horizon'];

/** Dernier jour de la fenêtre (date de New York) : aujourd'hui plus l'horizon des catalyseurs du desk. */
export function horizonEnd(now: number, days = CATALYST_HORIZON_DAYS): string {
  return addDays(etDateKey(now), days);
}

/** Instant de la publication ; une journée entière (sans heure) commence à minuit, heure de New York. */
function instant(e: Pick<CalEvent, 'date' | 'timeET'>): number {
  return zonedToUtc(e.date, e.timeET ?? '00:00', ET_ZONE);
}

/** Le trait d'une publication à l'instant `now`. Un résultat publié reste plein, quelle que soit sa date. */
export function strokeOf(e: Pick<CalEvent, 'date' | 'timeET' | 'actual'>, now: number, days = CATALYST_HORIZON_DAYS): Stroke {
  if (e.actual != null && e.actual !== '') return 'publie';
  if (instant(e) <= now) return 'publie';
  return e.date > horizonEnd(now, days) ? 'horizon' : 'prevu';
}

/** Barres de l'impact : trois, de hauteur croissante (px), allumées jusqu'au niveau. */
export function impactBars(level: number): { height: number; on: boolean }[] {
  return [1, 2, 3].map((k) => ({ height: 4 + k * 2.5, on: k <= level }));
}
