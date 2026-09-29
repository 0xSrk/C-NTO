import { generateNasdaqEvents } from '@/engine/calendar';
import { calendarBundle } from '@/engine/calendar-bundle';

const cache = new Map<number, Set<string>>();

function closedDates(year: number): Set<string> {
  let set = cache.get(year);
  if (set) return set;
  set = new Set<string>();
  for (const event of generateNasdaqEvents(year)) {
    if (event.title.includes('CME fermé')) set.add(event.date);
  }
  const rows = Array.isArray(calendarBundle.events) ? calendarBundle.events : [];
  for (const event of rows) {
    if (event.category === 'cme' && /ferm|closed/i.test(event.title)) set.add(event.date);
  }
  cache.set(year, set);
  return set;
}

/** Vrai si l'instantané embarqué ou le calendrier local hors ligne marque la journée CME fermée. */
export function cmeClosedOn(dateKey: string): boolean {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isInteger(year) || year < 1970) return false;
  return closedDates(year).has(dateKey);
}
