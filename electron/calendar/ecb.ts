/**
 * Banque centrale européenne — réunions de politique monétaire.
 *
 * URL vérifiée le 2026-09-26 : https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
 * HTTP 200, HTML (liste `dt`/`dd`, dates DD/MM/YYYY). L'ICS `index.en.ics` a répondu 404.
 * Seul le jour 2 d'une réunion « monetary policy » suivi d'une conférence de presse est retenu.
 * La page ne publie pas d'heure : `timeET` reste vide (rien n'est inventé).
 * Conditions : politique d'usage des statistiques du SEBC (citation, pas de modification).
 */

import type { AppLocale } from '../locale';
import { inRange, isoDate } from './dates';
import { calendarRow, type CalendarEventRow } from './types';

export const ECB_CALENDAR_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';

export function parseEcbCalendar(html: string): CalendarEventRow[] {
  const out: CalendarEventRow[] = [];
  for (const m of html.matchAll(/<dt>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)) {
    const text = (m[4] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/monetary policy meeting/i.test(text) || !/day\s*2/i.test(text)) continue;
    const date = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (!date) continue;
    out.push(calendarRow('ecb', `gc-${date}`, {
      date,
      title: 'Décision de politique monétaire BCE',
      category: 'banque-centrale',
      impact: 3,
      currency: 'EUR',
      estimated: false,
    }));
  }
  return out;
}

export const ecbAdapter = {
  sourceId: 'ecb' as const,
  async fetch(range: { from: string; to: string }, ctx: { fetch: (input: string, init?: RequestInit) => Promise<Response>; locale: AppLocale }): Promise<CalendarEventRow[]> {
    const res = await ctx.fetch(ECB_CALENDAR_URL, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`BCE HTTP ${res.status}`);
    return parseEcbCalendar(await res.text()).filter((e) => inRange(e.date, range));
  },
};
