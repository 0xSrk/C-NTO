/**
 * CME Group — jours fériés et expirations.
 *
 * URL tentée le 2026-09-26 : https://www.cmegroup.com/tools-information/holiday-calendar.html
 * HTTP 403. Conditions (licence données de marché) : redistributable false.
 * Aucun fetch en production. Les expirations et rollovers restent générés localement
 * dans `src/engine/calendar.ts`, une ligne par future du registre, `estimated: true`,
 * sur la règle du 3e vendredi déjà vérifiée pour les indices (AUDIT). Cette règle n'a
 * pas été reconfirmée pour l'énergie et les métaux : elle est marquée estimée partout.
 */

import type { CalendarEventRow } from './types';

export const CME_HOLIDAY_URL = 'https://www.cmegroup.com/tools-information/holiday-calendar.html';

/** Rien à lire : le corps 403 n'est pas un calendrier. */
export function parseCmeCalendar(_body: string): CalendarEventRow[] {
  return [];
}

export const cmeAdapter = {
  sourceId: 'cme' as const,
  async fetch(): Promise<CalendarEventRow[]> {
    return [];
  },
};
