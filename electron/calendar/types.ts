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
  | 'user';

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
