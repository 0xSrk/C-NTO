/**
 * Ligne de calendrier partagée par Dexie, le moteur et les adaptateurs.
 * Aucun import : le fichier reste pur.
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

/** Institution citée par une ligne `sourceId: 'bundle'`. */
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
  /** `${sourceId}:${stableKey}` */
  id: string;
  sourceId: CalendarSourceId;
  /** YYYY-MM-DD en America/New_York */
  date: string;
  /** HH:mm */
  timeET?: string;
  /** Instant ISO si connu */
  at?: string;
  title: string;
  category: CalendarCategory;
  impact: 1 | 2 | 3;
  currency?: string;
  /** Instruments du registre concernés. Vide = tous. */
  instruments: string[];
  previous?: string;
  actual?: string;
  /** Seulement si la source le fournit légitimement. */
  forecast?: string;
  period?: string;
  /** Vrai si la date est déduite, pas encore publiée par l'institution. */
  estimated: boolean;
  syncedAt: number;
  /** Présent quand la ligne vient de l'instantané embarqué. */
  origin?: CalendarOrigin;
}

export interface CalendarSourceStatus {
  sourceId: string;
  state: 'ok' | 'stale' | 'error';
  syncedAt?: number;
  detail?: string;
}
