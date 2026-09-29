import { generateNasdaqEvents } from '@/engine/calendar';
import { calendarBundle } from '@/engine/calendar-bundle';

export interface CmeSession {
  /** Journée CME fermée, jusqu'à 18:00 ET. */
  closed: boolean;
  /** Minute de clôture anticipée depuis minuit ET, sinon null. */
  earlyCloseMinute: number | null;
}

const cache = new Map<number, Map<string, CmeSession>>();

/** Heure explicite, sinon 13:00 : c'est l'heure des autres séances écourtées du calendrier local. */
function earlyMinute(title: string): number | null {
  const clock = /cl[oô]ture\s+(\d{1,2})\s*[:h]\s*(\d{2})/i.exec(title);
  if (clock?.[1] && clock[2]) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  if (/séance écourtée|shortened session/i.test(title)) return 13 * 60;
  return null;
}

function closedTitle(title: string, category?: string): boolean {
  if (title.includes('CME fermé')) return true;
  return category === 'cme' && /ferm|closed/i.test(title);
}

function sessions(year: number): Map<string, CmeSession> {
  let map = cache.get(year);
  if (map) return map;
  map = new Map();
  const consider = (date: string, title: string, category?: string) => {
    if (!date.startsWith(String(year))) return;
    let row = map?.get(date);
    if (!row) {
      row = { closed: false, earlyCloseMinute: null };
      map?.set(date, row);
    }
    if (closedTitle(title, category)) {
      row.closed = true;
      return;
    }
    const minute = earlyMinute(title);
    if (minute == null) return;
    row.earlyCloseMinute = row.earlyCloseMinute == null ? minute : Math.min(row.earlyCloseMinute, minute);
  };
  for (const event of generateNasdaqEvents(year)) consider(event.date, event.title, event.category);
  const rows = Array.isArray(calendarBundle.events) ? calendarBundle.events : [];
  for (const event of rows) consider(event.date, event.title, event.category);
  cache.set(year, map);
  return map;
}

const NONE: CmeSession = { closed: false, earlyCloseMinute: null };

/** Journée fermée ou écourtée, d'après le calendrier local et l'instantané embarqué. */
export function cmeSession(dateKey: string): CmeSession {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isInteger(year) || year < 1970) return NONE;
  return sessions(year).get(dateKey) ?? NONE;
}

/** Vrai si l'instantané embarqué ou le calendrier local hors ligne marque la journée CME fermée. */
export function cmeClosedOn(dateKey: string): boolean {
  return cmeSession(dateKey).closed;
}
