/**
 * Bureau of Labor Statistics — calendrier de publication.
 *
 * Pages vérifiées le 2026-09-26 (rendu HTML) :
 * - https://www.bls.gov/schedule/news_release/empsit.htm — Employment Situation, 08:30 AM
 * - https://www.bls.gov/schedule/news_release/cpi.htm — CPI, 08:30 AM
 * Le même jour, curl (User-Agent CANTO-Desk) a reçu HTTP 403 sur ces pages, et
 * https://www.bls.gov/schedule/news_release/bls.ics a répondu Access Denied.
 * Le parseur lit un tableau à trois colonnes (mois de référence, date, heure),
 * dernier recours HTML, testé sur fixture.
 *
 * Valeurs : POST https://api.bls.gov/publicAPI/v2/timeseries/data/
 * Séries confirmées le 2026-09-26 sans clé (quota anonyme) :
 * - LNS14000000 taux de chômage (août 2026 = 4.1)
 * - CES0000000001 emplois non agricoles (août 2026 = 159075)
 * - CUUR0000SA0 CPI-U (août 2026 = 334.980)
 * La clé d'enregistrement (`byok`) est envoyée si elle est présente ; elle relève le quota.
 */

import type { AppLocale } from '../locale';
import { htmlRows, inRange, parseClock, parseUsDate } from './dates';
import { calendarRow, type CalendarEventRow } from './types';

export const BLS_EMPSIT_URL = 'https://www.bls.gov/schedule/news_release/empsit.htm';
export const BLS_CPI_URL = 'https://www.bls.gov/schedule/news_release/cpi.htm';
export const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

type ReleaseKind = 'empsit' | 'cpi';

const KIND: Record<ReleaseKind, { title: string; category: CalendarEventRow['category']; impact: 1 | 2 | 3; key: string }> = {
  empsit: { title: 'Rapport emploi US (NFP)', category: 'emploi', impact: 3, key: 'nfp' },
  cpi: { title: 'Inflation CPI', category: 'inflation', impact: 3, key: 'cpi' },
};

/** Tableau BLS : mois de référence, date de publication, heure. Dates publiées → estimated false. */
export function parseBlsSchedule(html: string, kind: ReleaseKind): CalendarEventRow[] {
  const meta = KIND[kind];
  const out: CalendarEventRow[] = [];
  for (const cells of htmlRows(html)) {
    if (cells.length < 3) continue;
    const period = cells[0] ?? '';
    const date = parseUsDate(cells[1] ?? '');
    const timeET = parseClock(cells[2] ?? '');
    if (!date || !timeET) continue;
    if (/reference month/i.test(period)) continue;
    out.push(calendarRow('bls', `${meta.key}-${date}`, {
      date,
      timeET,
      title: meta.title,
      category: meta.category,
      impact: meta.impact,
      currency: 'USD',
      period,
      estimated: false,
    }));
  }
  return out;
}

interface BlsPoint { year: string; period: string; periodName?: string; value: string }

/** Dernière valeur et la précédente, pour une série de la réponse API v2. */
export function blsSeriesPoints(raw: unknown, seriesId: string): { actual?: string; previous?: string; period?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const series = (raw as { Results?: { series?: { seriesID?: string; data?: BlsPoint[] }[] } }).Results?.series ?? [];
  const row = series.find((s) => s.seriesID === seriesId);
  const data = row?.data?.filter((p) => p.value && p.value !== '-');
  if (!data?.length) return null;
  const latest = data[0]!;
  const prev = data[1];
  const period = latest.periodName && latest.year ? `${latest.periodName} ${latest.year}` : undefined;
  return { actual: latest.value, previous: prev?.value, period };
}

/**
 * Pose actual/previous sur la publication dont le mois de référence correspond.
 * CES0000000001 prime pour le NFP (emplois) ; LNS14000000 (taux) seulement si le NFP n'a pas encore de valeur.
 * CUUR0000SA0 remplit le CPI.
 */
export function applyBlsValues(events: CalendarEventRow[], raw: unknown): CalendarEventRow[] {
  const payrolls = blsSeriesPoints(raw, 'CES0000000001');
  const unemployment = blsSeriesPoints(raw, 'LNS14000000');
  const cpi = blsSeriesPoints(raw, 'CUUR0000SA0');
  return events.map((ev) => {
    const fill = (point: { actual?: string; previous?: string; period?: string } | null) => {
      if (!point?.actual || !point.period || !ev.period) return ev;
      if (ev.period.toLowerCase() !== point.period.toLowerCase()) return ev;
      if (ev.actual) return ev;
      return { ...ev, actual: point.actual, previous: point.previous ?? ev.previous };
    };
    if (ev.id.includes(':nfp-')) {
      const next = fill(payrolls);
      return next.actual ? next : fill(unemployment);
    }
    if (ev.id.includes(':cpi-')) return fill(cpi);
    return ev;
  });
}

export interface AdapterFetchCtx {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  locale: AppLocale;
  byok?: string;
}

export const blsAdapter = {
  sourceId: 'bls' as const,
  async fetch(range: { from: string; to: string }, ctx: AdapterFetchCtx): Promise<CalendarEventRow[]> {
    const pages: { url: string; kind: ReleaseKind }[] = [
      { url: BLS_EMPSIT_URL, kind: 'empsit' },
      { url: BLS_CPI_URL, kind: 'cpi' },
    ];
    const events: CalendarEventRow[] = [];
    let any = false;
    for (const page of pages) {
      const res = await ctx.fetch(page.url, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
      const html = await res.text();
      events.push(...parseBlsSchedule(html, page.kind));
      any = true;
    }
    if (!any) throw new Error('BLS indisponible');
    let merged = events.filter((e) => inRange(e.date, range));
    try {
      const body: { seriesid: string[]; startyear: string; endyear: string; registrationkey?: string } = {
        seriesid: ['CES0000000001', 'CUUR0000SA0', 'LNS14000000'],
        startyear: range.from.slice(0, 4),
        endyear: range.to.slice(0, 4),
      };
      if (ctx.byok) body.registrationkey = ctx.byok;
      const res = await ctx.fetch(BLS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) merged = applyBlsValues(merged, JSON.parse(await res.text()) as unknown);
    } catch {
      /* les dates restent utilisables sans les valeurs */
    }
    return merged;
  },
};
