/**
 * Energy Information Administration — Weekly Petroleum Status Report.
 *
 * URL vérifiée le 2026-09-26 : https://www.eia.gov/petroleum/supply/weekly/schedule.php
 * HTTP 200. La page dit : fichiers principaux « after 10:30 a.m. eastern time on Wednesday »,
 * puis un tableau d'exceptions fériées (semaine, date de report, jour, heure, fête).
 * Les mercredis déduits de la règle hebdomadaire sont `estimated: true`.
 * Les dates du tableau d'exceptions sont publiées → `estimated: false`.
 * Instruments : CL et MCL.
 */

import type { AppLocale } from '../locale';
import { addDays, htmlRows, inRange, parseClock, parseUsDate, weekday } from './dates';
import { calendarRow, type CalendarEventRow } from './types';

export const EIA_SCHEDULE_URL = 'https://www.eia.gov/petroleum/supply/weekly/schedule.php';

const INSTRUMENTS = ['CL', 'MCL'];

function nextWednesdayOnOrAfter(iso: string): string {
  let d = iso;
  while (weekday(d) !== 3) d = addDays(d, 1);
  return d;
}

export function parseEiaSchedule(html: string, range: { from: string; to: string }): CalendarEventRow[] {
  const exceptions: CalendarEventRow[] = [];
  const suppressed = new Set<string>();
  for (const cells of htmlRows(html)) {
    if (cells.length < 4) continue;
    const weekEnding = parseUsDate(cells[0] ?? '');
    const release = parseUsDate(cells[1] ?? '');
    const timeET = parseClock(cells.slice(2).join(' '));
    if (!weekEnding || !release || !timeET) continue;
    const normal = nextWednesdayOnOrAfter(addDays(weekEnding, 1));
    if (normal !== release) suppressed.add(normal);
    exceptions.push(calendarRow('eia', `wpsr-${release}`, {
      date: release,
      timeET,
      title: 'Stocks pétrole EIA',
      category: 'energie',
      impact: 3,
      currency: 'USD',
      instruments: INSTRUMENTS,
      period: weekEnding,
      estimated: false,
    }));
  }

  const out = [...exceptions];
  if (/10:30\s*a\.?m\.?\s*eastern time on wednesday/i.test(html)) {
    let d = nextWednesdayOnOrAfter(range.from);
    for (; d <= range.to; d = addDays(d, 7)) {
      if (suppressed.has(d)) continue;
      if (exceptions.some((e) => e.date === d)) continue;
      out.push(calendarRow('eia', `wpsr-${d}`, {
        date: d,
        timeET: '10:30',
        title: 'Stocks pétrole EIA',
        category: 'energie',
        impact: 3,
        currency: 'USD',
        instruments: INSTRUMENTS,
        estimated: true,
      }));
    }
  }
  return out.filter((e) => inRange(e.date, range));
}

export const eiaAdapter = {
  sourceId: 'eia' as const,
  async fetch(range: { from: string; to: string }, ctx: { fetch: (input: string, init?: RequestInit) => Promise<Response>; locale: AppLocale }): Promise<CalendarEventRow[]> {
    const res = await ctx.fetch(EIA_SCHEDULE_URL, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
    return parseEiaSchedule(await res.text(), range);
  },
};
