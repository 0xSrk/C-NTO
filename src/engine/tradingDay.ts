/**
 * La journée de trading, une seule définition pour tout le desk et pour le process principal (OROS5.48). La journée CME
 * bascule à 18:00, heure de New York : un instant du dimanche 18 h 30 compte pour le lundi. Le renderer la lit par
 * `src/lib/time.ts` (qui réexporte `tradingDayKey`) et `tradingDayNow` (`src/engine/discipline.ts`) ; le process principal
 * par `dist-electron/tradingDay.js` (`electron/tsconfig.sources.json`), pour fermer la journée de l'agent à la même
 * bascule que le desk (décision 15 de l'ADMIN, 2026-11-03).
 * Aucun import : ce module tourne dans le moteur et dans le process principal.
 */

export const ET_ZONE = 'America/New_York';
/** La bascule de la journée CME : 18:00 ET. */
export const CME_DAY_HOUR = 18;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' en heure locale. */
export function dateKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Formateur (mis en cache) donnant année/mois/jour/heure/minute/seconde dans un fuseau. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** L'heure murale d'un instant dans un fuseau. */
export function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** Vrai si l'heure murale est à ou après la bascule. 00:00 ne décale pas (date civile). */
function pastBoundary(hour: number, minute: number, boundaryHour: number, boundaryMinute: number): boolean {
  if (boundaryHour === 0 && boundaryMinute === 0) return false;
  return hour > boundaryHour || (hour === boundaryHour && minute >= boundaryMinute);
}

/**
 * Journée de trading à partir d'un timestamp : la journée bascule à `boundaryHour`:`minute`
 * (0:00 = date civile). Sans `zone`, l'heure locale du poste est utilisée ; avec `zone`
 * (ex. America/New_York pour la convention Globex 18:00 ET), l'heure murale de ce fuseau.
 * `minute` vaut 0 par défaut : les appels existants (`tradingDayKey(ms, 18, zone)`) ne changent pas.
 */
export function tradingDayKey(ms: number, boundaryHour = 0, zone?: string, minute = 0): string {
  const boundaryMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0;
  if (!zone) {
    const d = new Date(ms);
    if (pastBoundary(d.getHours(), d.getMinutes(), boundaryHour, boundaryMinute)) d.setDate(d.getDate() + 1);
    return dateKeyLocal(d);
  }
  const p = zonedParts(ms, zone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (pastBoundary(p.hour, p.minute, boundaryHour, boundaryMinute)) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Journée CME d'un instant (18 h → 17 h, heure de New York) : la date de séance du journal (`Session.date`). */
export function cmeTradingDay(ms: number): string {
  return tradingDayKey(ms, CME_DAY_HOUR, ET_ZONE);
}

/** L'heure de New York d'un instant, « hh:mm » sur 24 h : celle que la frise et les fiches écrivent (`etClock`). */
export function cmeClock(ms: number): string {
  const p = zonedParts(ms, ET_ZONE);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
