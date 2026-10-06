/**
 * Types des adaptateurs calendrier (process principal).
 * Même forme que `CalendarEventRow` dans `src/engine/calendarEvents.ts`.
 * Pas d'import croisé : le `tsc` Electron a `rootDir` = `electron/`.
 */

export type CalendarSourceId =
  | 'bls'
  | 'bea'
  | 'fed'
  | 'ecb'
  | 'cme'
  | 'eia'
  | 'treasury'
  | 'fred'
  | 'forexfactory'
  | 'user'
  | 'bundle';

export type CalendarOrigin = 'bls' | 'bea' | 'fed' | 'ecb' | 'eia' | 'treasury';

export type CalendarCategory =
  | 'emploi'
  | 'inflation'
  | 'croissance'
  | 'banque-centrale'
  | 'energie'
  | 'adjudication'
  | 'cme'
  | 'resultats'
  | 'autre';

export interface CalendarEventRow {
  id: string;
  sourceId: CalendarSourceId;
  date: string;
  timeET?: string;
  at?: string;
  title: string;
  category: CalendarCategory;
  impact: 1 | 2 | 3;
  currency?: string;
  instruments: string[];
  previous?: string;
  actual?: string;
  forecast?: string;
  period?: string;
  estimated: boolean;
  syncedAt: number;
  origin?: CalendarOrigin;
}

export interface CalendarSourceStatus {
  sourceId: string;
  state: 'ok' | 'stale' | 'error';
  syncedAt?: number;
  detail?: string;
}

export function calendarRow(
  sourceId: CalendarSourceId,
  stableKey: string,
  fields: Omit<CalendarEventRow, 'id' | 'sourceId' | 'syncedAt' | 'instruments'> & { instruments?: string[] },
): CalendarEventRow {
  return {
    instruments: fields.instruments ?? [],
    ...fields,
    id: `${sourceId}:${stableKey}`,
    sourceId,
    syncedAt: 0,
  };
}

/** Titre d'un événement venu d'une source externe : au plus 160 caractères. */
export const CALENDAR_TITLE_MAX = 160;
/** Autres champs texte : bornes de la relecture d'un coffre (`CHECKS.calendarEvents`, src/store/db.ts). */
const CALENDAR_FIELD_MAX = { timeET: 8, at: 64, currency: 16, previous: 64, actual: 64, forecast: 64, period: 80 } as const;
const CALENDAR_ID_MAX = 200;
/** Instruments d'une ligne : 32 au plus, 32 caractères chacun. */
const CALENDAR_INSTRUMENTS_MAX = 32;
const CALENDAR_INSTRUMENT_LEN = 32;

/**
 * Texte d'une source : contrôles et séparateurs de ligne → espace, formats (bidi, largeur nulle) retirés,
 * espaces resserrés, borné sans couper une paire de substitution.
 */
export function calendarText(v: string, max: number): string {
  const t = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
}

/**
 * Normalisation commune de toutes les lignes (adaptateurs, valeurs BLS et FRED, socle embarqué), appliquée
 * une fois par `runCalendarSync` : ces chaînes arrivent jusqu'au modèle (`calendar_events`, événement `catalyst`).
 */
export function boundCalendarRow(row: CalendarEventRow): CalendarEventRow {
  const out: CalendarEventRow = {
    ...row,
    id: calendarText(row.id, CALENDAR_ID_MAX),
    title: calendarText(typeof row.title === 'string' ? row.title : '', CALENDAR_TITLE_MAX),
    instruments: (Array.isArray(row.instruments) ? row.instruments : [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => calendarText(s, CALENDAR_INSTRUMENT_LEN))
      .filter(Boolean)
      .slice(0, CALENDAR_INSTRUMENTS_MAX),
  };
  for (const key of Object.keys(CALENDAR_FIELD_MAX) as (keyof typeof CALENDAR_FIELD_MAX)[]) {
    const v: unknown = row[key];
    if (v === undefined) continue;
    const t = typeof v === 'string' ? calendarText(v, CALENDAR_FIELD_MAX[key]) : '';
    if (t) out[key] = t;
    else delete out[key];
  }
  return out;
}
