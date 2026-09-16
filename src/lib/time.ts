export const ET_ZONE = 'America/New_York';

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

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/**
 * Journée de trading à partir d'un timestamp : la journée bascule à `boundaryHour`
 * (0 = date civile). Sans `zone`, l'heure locale du poste est utilisée ; avec `zone`
 * (ex. America/New_York pour la convention Globex 18:00 ET), l'heure murale de ce fuseau.
 */
export function tradingDayKey(ms: number, boundaryHour = 0, zone?: string): string {
  if (!zone) {
    const d = new Date(ms);
    if (boundaryHour > 0 && d.getHours() >= boundaryHour) d.setDate(d.getDate() + 1);
    return dateKeyLocal(d);
  }
  const p = zonedParts(ms, zone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (boundaryHour > 0 && p.hour >= boundaryHour) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKeyLocal(d);
}

/** 0 = dimanche … 6 = samedi */
export function weekday(key: string): number {
  return parseDateKey(key).getDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** n-ième (1-based) jour de semaine `dow` du mois ; n = -1 pour le dernier. Rabattu sur la dernière occurrence si le mois est trop court. */
export function nthWeekdayOfMonth(year: number, month1: number, dow: number, n: number): string {
  if (n > 0) {
    const first = new Date(year, month1 - 1, 1);
    const offset = (dow - first.getDay() + 7) % 7;
    let day = 1 + offset + (n - 1) * 7;
    const max = daysInMonth(year, month1);
    while (day > max) day -= 7;
    return `${year}-${pad2(month1)}-${pad2(day)}`;
  }
  const lastDay = daysInMonth(year, month1);
  const last = new Date(year, month1 - 1, lastDay);
  const offset = (last.getDay() - dow + 7) % 7;
  return `${year}-${pad2(month1)}-${pad2(lastDay - offset)}`;
}

/** Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - utcMs) / 60000;
}

/** Convertit une heure murale ('YYYY-MM-DD' + 'HH:mm') d'un fuseau donné en epoch ms UTC. */
export function zonedToUtc(dateKey: string, time: string, timeZone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  let offset = tzOffsetMinutes(guess, timeZone);
  let utc = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(utc, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    utc = guess - offset * 60000;
  }
  return utc;
}

export function formatTimeLocal(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSeconds ? `:${pad2(d.getSeconds())}` : ''}`;
}

export function formatDateFr(key: string, opts: { weekday?: boolean; short?: boolean } = {}): string {
  const d = parseDateKey(key);
  return d.toLocaleDateString('fr-FR', {
    weekday: opts.weekday ? (opts.short ? 'short' : 'long') : undefined,
    day: 'numeric',
    month: opts.short ? 'short' : 'long',
    year: 'numeric',
  });
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad2(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad2(m % 60)}m`;
  const d = Math.floor(h / 24);
  return `${d}j ${h % 24}h`;
}

/**
 * Parse une date/heure telle qu'exportée par NinjaTrader (culture du poste) :
 * "15/09/2026 15:31:02", "9/15/2026 3:31:02 PM", "2026-09-15 15:31:02", "15.09.2026 15:31",
 * "9/15/2026 3:31:02 p.m." (en-CA), "2026-09-15T13:31:02Z" (ISO avec fuseau).
 * `dayFirst` force l'ordre jour/mois si connu ; sinon détection heuristique.
 */
function applyAmPm(hour: number, marker?: string): number {
  if (!marker) return hour;
  const pm = /^p/i.test(marker);
  if (pm && hour < 12) return hour + 12;
  if (!pm && hour === 12) return 0;
  return hour;
}

export function parseFlexibleDateTime(raw: string, dayFirst?: boolean): number {
  const s = raw.trim();
  if (!s) return NaN;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp]\.?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0', ampm, tz] = iso;
    if (tz) {
      const t = Date.parse(`${y}-${pad2(+m)}-${pad2(+d)}T${pad2(applyAmPm(+hh, ampm))}:${mm}:${ss}${tz === 'Z' ? 'Z' : tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`}`);
      return Number.isNaN(t) ? NaN : t;
    }
    return new Date(+y, +m - 1, +d, applyAmPm(+hh, ampm), +mm, +ss).getTime();
  }
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?)?$/.exec(s);
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
  }
  const a = +m[1];
  const b = +m[2];
  let year = +m[3];
  if (year < 100) year += 2000;
  const hour = applyAmPm(+(m[4] ?? '0'), m[7]);
  const minute = +(m[5] ?? '0');
  const second = +(m[6] ?? '0');
  const useDayFirst = dayFirst ?? (a > 12 ? true : b > 12 ? false : !m[7]);
  const day = useDayFirst ? a : b;
  const month = useDayFirst ? b : a;
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN;
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/** Heuristique fichier : si une valeur a son premier champ > 12, l'ordre est jour/mois. */
export function detectDayFirst(samples: string[]): boolean | undefined {
  for (const s of samples) {
    const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}/.exec(s.trim());
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  if (samples.some((s) => /\b[ap]\.?m\.?\b/i.test(s))) return false;
  return undefined;
}
