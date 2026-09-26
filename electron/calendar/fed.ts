/**
 * Federal Reserve Board — calendrier FOMC.
 *
 * URL vérifiée le 2026-09-26 : https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * HTTP 200, HTML. Pas d'ICS. Blocs `.fomc-meeting` : mois, plage de jours (« 27-28 », « 30-1 »,
 * « 16-17* »), lien Statement, et « (Released Month DD, YYYY) » pour les minutes déjà publiées.
 * Un « notation vote » n'est pas une décision.
 *
 * La page ne donne pas l'heure. Le communiqué de décision est publié à 14:00 ET
 * (heure déjà tenue par le desk et par les communiqués du Board). Les minutes n'ont
 * pas d'heure sur la page : `timeET` reste vide.
 * 2027 est listé comme indicatif (confirmé à la réunion précédente) → `estimated: true`.
 * 2024–2026 sont les dates publiées → `estimated: false`.
 */

import type { AppLocale } from '../locale';
import { inRange, isoDate, monthIndex, parseUsDate } from './dates';
import { calendarRow, type CalendarEventRow } from './types';

export const FED_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

/** Heure du communiqué, absente du HTML, établie par les publications du Board. */
const STATEMENT_TIME_ET = '14:00';

function decisionIso(year: number, monthLabel: string, dateText: string): string | null {
  const cleaned = dateText.replace(/\*/g, '').replace(/\([^)]*\)/g, '').trim();
  const m = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(cleaned);
  if (!m) return null;
  const startDay = Number(m[1]);
  const endDay = Number(m[2]);
  const names = monthLabel.split('/').map((s) => s.trim()).filter(Boolean);
  let monthName = names[0] ?? '';
  if (endDay < startDay && names.length > 1) monthName = names[1] ?? monthName;
  let month = monthIndex(monthName);
  if (!month) return null;
  let y = year;
  if (endDay < startDay && names.length === 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      y += 1;
    }
  }
  return isoDate(y, month, endDay);
}

/** Décisions (second jour) et minutes déjà datées « Released ». */
export function parseFedSchedule(html: string): CalendarEventRow[] {
  const marks = [...html.matchAll(/(\d{4}) FOMC Meetings/g)];
  const out: CalendarEventRow[] = [];
  for (let i = 0; i < marks.length; i++) {
    const year = Number(marks[i]?.[1]);
    const from = marks[i]?.index ?? 0;
    const to = marks[i + 1]?.index ?? html.length;
    const section = html.slice(from, to);
    const estimatedYear = year >= 2027;
    const chunks = section.split('fomc-meeting__month').slice(1);
    for (const chunk of chunks) {
      const monthLabel = /<strong>([^<]+)<\/strong>/.exec(chunk)?.[1]?.trim() ?? '';
      const dateText = /fomc-meeting__date[^>]*>([^<]+)</.exec(chunk)?.[1]?.trim() ?? '';
      if (!monthLabel || !dateText || /notation vote/i.test(dateText)) continue;
      const date = decisionIso(year, monthLabel, dateText);
      if (!date) continue;
      out.push(calendarRow('fed', `fomc-${date}`, {
        date,
        timeET: STATEMENT_TIME_ET,
        title: 'Décision FOMC · taux directeurs',
        category: 'banque-centrale',
        impact: 3,
        currency: 'USD',
        estimated: estimatedYear,
      }));
      const released = /\(Released ([^)]+)\)/.exec(chunk)?.[1];
      const minutes = released ? parseUsDate(released) : null;
      if (minutes) {
        out.push(calendarRow('fed', `minutes-${minutes}`, {
          date: minutes,
          title: 'Minutes du FOMC',
          category: 'banque-centrale',
          impact: 2,
          currency: 'USD',
          estimated: false,
        }));
      }
    }
  }
  return out;
}

export const fedAdapter = {
  sourceId: 'fed' as const,
  async fetch(range: { from: string; to: string }, ctx: { fetch: (input: string, init?: RequestInit) => Promise<Response>; locale: AppLocale }): Promise<CalendarEventRow[]> {
    const res = await ctx.fetch(FED_CALENDAR_URL, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`Fed HTTP ${res.status}`);
    return parseFedSchedule(await res.text()).filter((e) => inRange(e.date, range));
  },
};
