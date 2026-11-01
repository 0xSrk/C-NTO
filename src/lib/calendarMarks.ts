import { CATALYST_HORIZON_DAYS } from '@/engine/agent/tools';
import type { CalEvent } from '@/engine/calendar';
import { addDays, etDateKey, ET_ZONE, zonedToUtc } from './time';

/**
 * Les marques du temps d'une publication : le trait dit son état, la forme dit son impact (Système 4.0, légendes L.01 et
 * L.02). Tirées du Calendrier (OROS5.4) : le Calendrier, le châssis et le design les lisent ici sans importer un module.
 * Pur : l'instant `now` est passé, les dates sont celles de New York. Le trait suit la table d'états du desk
 * (`src/design/etat.module.css`).
 */

/** Plein : publié ou passé (en service) · tireté : prévu dans la fenêtre · pointillé : au-delà de l'horizon. */
export type Stroke = 'publie' | 'prevu' | 'horizon';

export const STROKES: readonly Stroke[] = ['publie', 'prevu', 'horizon'];

/** Dernier jour de la fenêtre (date de New York) : aujourd'hui plus l'horizon des catalyseurs du desk. */
export function horizonEnd(now: number, days = CATALYST_HORIZON_DAYS): string {
  return addDays(etDateKey(now), days);
}

/** Instant de la publication ; une journée entière (sans heure) commence à minuit, heure de New York. */
export function publicationInstant(e: Pick<CalEvent, 'date' | 'timeET'>): number {
  return zonedToUtc(e.date, e.timeET ?? '00:00', ET_ZONE);
}

/** Le trait d'une publication à l'instant `now`. Un résultat publié reste plein, quelle que soit sa date. */
export function strokeOf(e: Pick<CalEvent, 'date' | 'timeET' | 'actual'>, now: number, days = CATALYST_HORIZON_DAYS): Stroke {
  if (e.actual != null && e.actual !== '') return 'publie';
  if (publicationInstant(e) <= now) return 'publie';
  return e.date > horizonEnd(now, days) ? 'horizon' : 'prevu';
}

/** Barres de l'impact : trois, de hauteur croissante (px), allumées jusqu'au niveau. */
export function impactBars(level: number): { height: number; on: boolean }[] {
  return [1, 2, 3].map((k) => ({ height: 4 + k * 2.5, on: k <= level }));
}
