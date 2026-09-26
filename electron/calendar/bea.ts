/**
 * Bureau of Economic Analysis — calendrier des publications.
 *
 * URL vérifiée le 2026-09-26 : https://www.bea.gov/news/schedule (HTML, HTTP 200).
 * Tableau `#release-schedule-table` : date (« September 30 »), heure (« 8:30 AM »), titre.
 * L'en-tête porte l'année (« Year 2026 »). Pas d'ICS.
 * Les valeurs passent par l'API BEA (UserID, `byok`) : sans clé, seules les dates sont lues.
 * https://apps.bea.gov/API/docs/index.htm
 */

import type { AppLocale } from '../locale';
import { htmlRows, inRange, parseClock, parseUsDate } from './dates';
import { calendarRow, type CalendarCategory, type CalendarEventRow } from './types';

export const BEA_SCHEDULE_URL = 'https://www.bea.gov/news/schedule';

function classify(title: string): { category: CalendarCategory; impact: 1 | 2 | 3 } {
  const t = title.toLowerCase();
  if (/pce|personal income|price/.test(t) && !/gdp/.test(t)) return { category: 'inflation', impact: 2 };
  if (/gdp/.test(t)) return { category: 'croissance', impact: /advance/.test(t) ? 3 : 2 };
  if (/trade|income|international/.test(t)) return { category: 'croissance', impact: 2 };
  return { category: 'croissance', impact: 1 };
}

/** Lignes du tableau BEA. « To Be Announced » est ignoré. */
export function parseBeaSchedule(html: string): CalendarEventRow[] {
  const year = Number(/Year\s+(\d{4})/i.exec(html)?.[1] ?? '');
  if (!Number.isFinite(year) || year < 2000) return [];
  const out: CalendarEventRow[] = [];
  for (const cells of htmlRows(html)) {
    const joined = cells.join(' ');
    if (/to be announced/i.test(joined)) continue;
    const dateCell = cells.find((c) => /[A-Za-z]+\.?\s+\d{1,2}/.test(c) && !/year\s+\d{4}/i.test(c)) ?? '';
    const dateToken = /([A-Za-z]+\.?\s+\d{1,2})/.exec(dateCell)?.[1] ?? '';
    const date = parseUsDate(dateToken, year);
    if (!date) continue;
    const timeET = parseClock(joined);
    const title = (cells[cells.length - 1] ?? '').replace(/\s+/g, ' ').trim();
    if (!title || /release$/i.test(title) || title.length < 8) continue;
    const kind = classify(title);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    out.push(calendarRow('bea', `${slug}-${date}`, {
      date,
      timeET,
      title,
      category: kind.category,
      impact: kind.impact,
      currency: 'USD',
      estimated: false,
    }));
  }
  return out;
}

export const beaAdapter = {
  sourceId: 'bea' as const,
  async fetch(range: { from: string; to: string }, ctx: { fetch: (input: string, init?: RequestInit) => Promise<Response>; locale: AppLocale; byok?: string }): Promise<CalendarEventRow[]> {
    const res = await ctx.fetch(BEA_SCHEDULE_URL, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`BEA HTTP ${res.status}`);
    return parseBeaSchedule(await res.text()).filter((e) => inRange(e.date, range));
  },
};
