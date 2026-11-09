/**
 * Couverture du calendrier officiel (SEC2.2).
 *
 * Le rapport emploi (NFP) et l'inflation (CPI) viennent du BLS. Sa page refuse le desk (HTTP 403) : le desk ne connaît
 * que les dates de l'instantané embarqué, publiées jusqu'à la fin de l'année de sa génération. Passé la dernière, ni le
 * blackout du Copieur ni la garde « catalyseur » de l'agent ne voyaient plus ces publications, sans que rien ne le dise.
 *
 * Ce module dit quand le calendrier ne couvre plus (`coverageGaps`), et estime alors les dates par règle
 * (`coverageEstimates`) : des repères marqués `estimated`, lus par les gardes comme par le Calendrier. Le FOMC n'a pas
 * de règle : son trou se dit, il ne s'estime pas. Pur : aucune horloge, la journée de New York est donnée.
 */
import type { CalEvent } from '@/engine/calendar';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { addDays, nthWeekdayOfMonth, pad2, weekday } from '@/lib/time';

export type CoverageFamily = 'nfp' | 'cpi' | 'fomc';

/** Au-delà du plus long écart entre deux NFP ou deux CPI (cinq semaines, 35 jours) : le prochain devrait être connu. */
export const MONTHLY_MAX_GAP_DAYS = 40;
/** Huit réunions du FOMC par an, à six ou huit semaines d'écart. */
export const FOMC_MAX_GAP_DAYS = 60;
/** Jusqu'où les estimations vont : l'horizon de la synchro du calendrier (120 jours). */
export const ESTIMATE_HORIZON_DAYS = 120;
/**
 * Jours du mois où tombe le CPI. Les douze publications de 2026 de l'instantané embarqué vont du 10 au 14
 * (10, 10, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14) : un jour de marge après.
 */
export const CPI_DAY_RANGE = { from: 10, to: 15 } as const;
/** Deux publications d'une même famille sont à trois semaines au moins : une estimation plus proche de la dernière connue la doublerait. */
const SAME_RELEASE_DAYS = 14;

const MARKER: Record<CoverageFamily, string> = { nfp: ':nfp-', cpi: ':cpi-', fomc: ':fomc-' };

/** La famille d'une ligne officielle, lue de son identifiant (`bls:nfp-2026-12-04`, `bundle:fed:fomc-2027-01-27`). */
export function coverageFamily(row: Pick<CalendarEventRow, 'id'>): CoverageFamily | null {
  for (const family of ['nfp', 'cpi', 'fomc'] as const) if (row.id.includes(MARKER[family])) return family;
  return null;
}

function utcDay(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}

/** Jours de `from` à `to` (négatif si `to` précède). */
function daysApart(from: string, to: string): number {
  return Math.round(utcDay(to) - utcDay(from));
}

/** Un férié à date fixe se prend le vendredi s'il tombe un samedi, le lundi s'il tombe un dimanche. */
function observed(date: string): string {
  const day = weekday(date);
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

function federalHolidays(year: number): string[] {
  return [
    observed(`${year}-01-01`),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    nthWeekdayOfMonth(year, 5, 1, -1),
    observed(`${year}-06-19`),
    observed(`${year}-07-04`),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 10, 1, 2),
    observed(`${year}-11-11`),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observed(`${year}-12-25`),
  ];
}

/**
 * Jour férié fédéral américain, tel qu'il est observé : le BLS ne publie pas ces jours-là. Le Vendredi saint n'en est
 * pas un (le NFP du 3 avril 2026 y est tombé). Un Nouvel An tombant un samedi se prend le 31 décembre.
 */
export function usFederalHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  return federalHolidays(year).includes(date) || observed(`${year + 1}-01-01`) === date;
}

/**
 * Dates estimées du rapport emploi d'un mois de référence. Règle publiée par le BLS : le troisième vendredi après la fin
 * de la semaine de référence, celle qui contient le 12 du mois (du dimanche au samedi). Elle retrouve neuf des douze NFP
 * de 2026 de l'instantané embarqué. Deux écarts connus donnent deux dates au lieu d'une :
 * - un vendredi férié : le jeudi qui précède et le vendredi qui suit, le BLS a pratiqué les deux (règle au 3 juillet 2026,
 *   férié observé : publié le jeudi 2) ;
 * - un 2 ou un 3 janvier, au lendemain du Nouvel An : ce vendredi et le suivant (règle au 2 janvier 2026 : publié le 9).
 * Un report exceptionnel (11 février 2026 pour une règle au 6) ne se prévoit pas : l'estimation reste une estimation.
 */
export function nfpEstimateDates(refYear: number, refMonth1: number): string[] {
  const twelfth = `${refYear}-${pad2(refMonth1)}-12`;
  const weekEnd = addDays(twelfth, 6 - weekday(twelfth));
  const friday = addDays(weekEnd, 20);
  if (usFederalHoliday(friday)) return [addDays(friday, -1), addDays(friday, 7)];
  const monthDay = friday.slice(5);
  if (monthDay === '01-02' || monthDay === '01-03') return [friday, addDays(friday, 7)];
  return [friday];
}

/** Jours où le CPI d'un mois peut tomber : les jours ouvrés de `CPI_DAY_RANGE`, fériés fédéraux exclus. */
export function cpiEstimateDates(year: number, month1: number): string[] {
  const out: string[] = [];
  for (let day = CPI_DAY_RANGE.from; day <= CPI_DAY_RANGE.to; day += 1) {
    const date = `${year}-${pad2(month1)}-${pad2(day)}`;
    const dow = weekday(date);
    if (dow === 0 || dow === 6 || usFederalHoliday(date)) continue;
    out.push(date);
  }
  return out;
}

export interface CoverageGap {
  family: CoverageFamily;
  /** La prochaine publication connue, aujourd'hui compris ; `null` : aucune. */
  next: string | null;
  /** La dernière publication connue, passée ou à venir ; `null` : aucune. */
  last: string | null;
}

function knownDates(rows: readonly CalendarEventRow[], family: CoverageFamily): string[] {
  return rows
    .filter((row) => coverageFamily(row) === family)
    .map((row) => row.date)
    .sort();
}

/**
 * Les familles que le calendrier officiel ne couvre plus à la journée `today` (New York) : le prochain NFP ou CPI connu
 * est à plus de `MONTHLY_MAX_GAP_DAYS`, le prochain FOMC à plus de `FOMC_MAX_GAP_DAYS`, ou il n'y en a aucun.
 */
export function coverageGaps(rows: readonly CalendarEventRow[], today: string): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const family of ['nfp', 'cpi', 'fomc'] as const) {
    const dates = knownDates(rows, family);
    const next = dates.find((date) => date >= today) ?? null;
    const limit = family === 'fomc' ? FOMC_MAX_GAP_DAYS : MONTHLY_MAX_GAP_DAYS;
    if (next !== null && daysApart(today, next) <= limit) continue;
    gaps.push({ family, next, last: dates[dates.length - 1] ?? null });
  }
  return gaps;
}

/** La note d'une date estimée par règle ; `src/lib/eventTitles.ts` la traduit. */
export const COVERAGE_ESTIMATE_NOTE =
  'Date estimée par règle : le calendrier officiel du BLS n’est pas connu du desk pour cette publication. Elle peut tomber un autre jour ; vérifier sur bls.gov.';

function estimate(family: 'nfp' | 'cpi', date: string): CalEvent {
  return family === 'nfp'
    ? { id: `ev_nfp-estime_${date}`, date, timeET: '08:30', title: 'Rapport emploi US (NFP)', category: 'emploi', impact: 3, estimated: true, source: 'local', description: COVERAGE_ESTIMATE_NOTE }
    : { id: `ev_cpi-estime_${date}`, date, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, estimated: true, source: 'local', description: COVERAGE_ESTIMATE_NOTE };
}

/**
 * Les NFP et CPI estimés par règle pour les familles que le calendrier ne couvre plus : de `today` à
 * `today + ESTIMATE_HORIZON_DAYS`, et seulement au-delà de la dernière publication connue (jamais un double d'une date
 * officielle). Vide quand le calendrier couvre. Triés par date.
 */
export function coverageEstimates(rows: readonly CalendarEventRow[], today: string): CalEvent[] {
  const end = addDays(today, ESTIMATE_HORIZON_DAYS);
  const out: CalEvent[] = [];
  for (const gap of coverageGaps(rows, today)) {
    if (gap.family === 'fomc') continue;
    const family = gap.family;
    const after = gap.last === null ? null : addDays(gap.last, SAME_RELEASE_DAYS);
    const keep = (date: string) => date >= today && date <= end && (after === null || date > after);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    // Du mois précédent (son NFP sort ce mois-ci) au mois de l'horizon.
    for (let i = -1; i <= Math.ceil(ESTIMATE_HORIZON_DAYS / 28) + 1; i += 1) {
      const index = year * 12 + (month - 1) + i;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      const dates = family === 'nfp' ? nfpEstimateDates(y, m) : cpiEstimateDates(y, m);
      for (const date of dates) if (keep(date)) out.push(estimate(family, date));
    }
  }
  const seen = new Set<string>();
  return out
    .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
