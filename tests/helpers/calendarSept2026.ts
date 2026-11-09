import type { CalendarEventRow } from '@/engine/calendarEvents';

/**
 * NFP, CPI et FOMC tels que l'instantané embarqué les portait du 26 septembre au 9 novembre 2026 (desks 2.1.0 à
 * 3.10.0) : le BLS n'avait pas publié son calendrier 2027, et le dernier NFP connu du desk datait du 4 décembre 2026.
 * C'est l'état que la garde de couverture (SEC2.2) doit tenir. Il est figé ici : les tests de la garde ne dépendent pas
 * du fichier embarqué, que chaque régénération change (SEC2.8 y a ajouté le premier trimestre 2027 du BLS).
 */
export const SEPT_2026 = {
  nfp: ['2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-02', '2026-08-07', '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04'],
  cpi: ['2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14', '2026-11-10', '2026-12-10'],
  /** Les deux réunions de 2027 que la Fed annonçait déjà, marquées provisoires. */
  fomc: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17'],
} as const;

/** Ces lignes, telles que le process principal les rend de l'instantané (`materializeBundle`), triées par date. */
export function sept2026Rows(syncedAt = 1): CalendarEventRow[] {
  const bls = (key: 'nfp' | 'cpi', date: string): CalendarEventRow => ({
    id: `bundle:bls:${key}-${date}`,
    sourceId: 'bundle',
    origin: 'bls',
    date,
    timeET: '08:30',
    title: key === 'nfp' ? 'Rapport emploi US (NFP)' : 'Inflation CPI',
    category: key === 'nfp' ? 'emploi' : 'inflation',
    impact: 3,
    currency: 'USD',
    instruments: [],
    estimated: false,
    syncedAt,
  });
  const fomc = (date: string): CalendarEventRow => ({
    id: `bundle:fed:fomc-${date}`,
    sourceId: 'bundle',
    origin: 'fed',
    date,
    timeET: '14:00',
    title: 'Décision FOMC · taux directeurs',
    category: 'banque-centrale',
    impact: 3,
    currency: 'USD',
    instruments: [],
    estimated: date >= '2027',
    syncedAt,
  });
  return [...SEPT_2026.nfp.map((date) => bls('nfp', date)), ...SEPT_2026.cpi.map((date) => bls('cpi', date)), ...SEPT_2026.fomc.map(fomc)].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}
