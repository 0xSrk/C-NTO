import type { CalEvent, EventCategory } from '@/engine/calendar';
import type { CalendarEventRow, CalendarSourceId } from '@/engine/calendarEvents';

/** Famille stable : deux sources qui parlent du même chiffre le même jour. */
export function familyKey(title: string): string {
  const t = title.toLowerCase();
  if (/nonfarm|nfp|employment situation|rapport emploi/.test(t)) return 'nfp';
  if (/\bcpi\b|consumer price|inflation cpi/.test(t)) return 'cpi';
  if (/\bppi\b|producer price|prix à la production/.test(t)) return 'ppi';
  if (/fomc|federal funds|interest rate|taux directeur|décision fomc|politique monétaire|governing council/.test(t)) return 'policy';
  if (/\bpce\b|personal income|outlays/.test(t)) return 'pce';
  if (/\bgdp\b|\bpib\b/.test(t)) return 'gdp';
  if (/jolts/.test(t)) return 'jolts';
  if (/jobless|claims|chômage hebdo/.test(t)) return 'claims';
  if (/eia|petroleum|stocks pétrole/.test(t)) return 'eia-oil';
  if (/adjudication|auction/.test(t)) return 'auction';
  return t.replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

const OFFICIAL_RANK: Record<string, number> = {
  bls: 0,
  bea: 1,
  fed: 2,
  ecb: 3,
  eia: 4,
  treasury: 5,
  cme: 6,
  fred: 7,
  user: 8,
  forexfactory: 9,
  /** Sous toute source vivante : un BLS direct remplace toujours sa copie embarquée. */
  bundle: 10,
};

/**
 * Fusion par clé stable. La source officielle garde la ligne, `actual` et `previous`.
 * Forex Factory ne crée pas d'événement : il ne peut remplir que `forecast`
 * sur une ligne officielle du même jour et de la même famille.
 */
export function mergeOfficialRows(rows: CalendarEventRow[]): CalendarEventRow[] {
  const groups = new Map<string, CalendarEventRow[]>();
  for (const row of rows) {
    const key = `${row.date}:${familyKey(row.title)}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }
  const out: CalendarEventRow[] = [];
  for (const group of groups.values()) {
    const official = group.filter((r) => r.sourceId !== 'forexfactory');
    if (!official.length) continue;
    official.sort((a, b) => (OFFICIAL_RANK[a.sourceId] ?? 50) - (OFFICIAL_RANK[b.sourceId] ?? 50));
    const base = { ...official[0]! };
    if (!base.forecast) {
      const forecast = group.find((r) => r.sourceId === 'forexfactory' && r.forecast)?.forecast;
      if (forecast) base.forecast = forecast;
    }
    out.push(base);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? '') || a.id.localeCompare(b.id));
}

const CATEGORY_OF: Record<CalendarEventRow['category'], EventCategory> = {
  emploi: 'emploi',
  inflation: 'inflation',
  croissance: 'croissance',
  'banque-centrale': 'banque-centrale',
  energie: 'energie',
  adjudication: 'adjudication',
  cme: 'cme',
  resultats: 'resultats',
  autre: 'croissance',
};

export function categoryFromTitle(title: string): EventCategory {
  const family = familyKey(title);
  if (family === 'policy') return 'banque-centrale';
  if (family === 'nfp' || family === 'jolts' || family === 'claims') return 'emploi';
  if (family === 'cpi' || family === 'ppi' || family === 'pce') return 'inflation';
  if (family === 'eia-oil') return 'energie';
  if (family === 'auction') return 'adjudication';
  if (/confidence|sentiment|michigan|consumer/.test(title.toLowerCase())) return 'sentiment';
  return 'croissance';
}

const SOURCE_NOTE: Partial<Record<CalendarSourceId, string>> = {
  bls: 'BLS',
  bea: 'BEA',
  fed: 'Réserve fédérale',
  ecb: 'BCE',
  cme: 'CME',
  eia: 'EIA',
  treasury: 'Trésor américain',
  fred: 'FRED',
  user: 'saisie',
  forexfactory: 'Forex Factory',
  bundle: 'Calendrier embarqué',
};

const BUNDLE_ORIGIN_LABEL: Record<string, string> = {
  bls: 'BLS',
  bea: 'BEA',
  fed: 'Fed',
  ecb: 'BCE',
  eia: 'EIA',
  treasury: 'Trésor',
};

/** Provenance affichée. L'instantané cite l'institution : « Calendrier embarqué · BLS ». */
export function eventProvenance(source?: string, origin?: string): string | null {
  if (!source || source === 'local') return null;
  if (source === 'bundle') {
    const who = origin ? BUNDLE_ORIGIN_LABEL[origin] : undefined;
    return who ? `Calendrier embarqué · ${who}` : 'Calendrier embarqué (2026)';
  }
  return source;
}

export function rowToCalEvent(r: CalendarEventRow): CalEvent {
  const bits = [
    r.forecast != null ? `Attendu ${r.forecast}` : null,
    r.previous != null ? `Préc. ${r.previous}` : null,
    r.actual != null ? `Publié ${r.actual}` : null,
  ].filter(Boolean);
  const who = eventProvenance(r.sourceId, r.origin) ?? SOURCE_NOTE[r.sourceId] ?? r.sourceId;
  return {
    id: r.id,
    date: r.date,
    timeET: r.timeET,
    title: r.title.replace(/^U\.S\.\s+/i, ''),
    category: CATEGORY_OF[r.category] ?? categoryFromTitle(r.title),
    impact: r.impact,
    description: bits.length ? bits.join(' · ') : `Publication ${who}.`,
    estimated: r.estimated,
    forecast: r.forecast,
    previous: r.previous,
    actual: r.actual,
    period: r.period,
    source: r.sourceId,
    origin: r.origin,
    instruments: r.instruments,
  };
}

function sameFamily(a: CalEvent, b: CalEvent): boolean {
  return a.date === b.date && (a.category === b.category || familyKey(a.title) === familyKey(b.title));
}

/** L'officiel remplace l'estimé local du même jour et de la même famille. */
export function mergeCalendarEvents(local: CalEvent[], rows: CalendarEventRow[]): CalEvent[] {
  const live = mergeOfficialRows(rows).map(rowToCalEvent);
  const kept = local.filter((ev) => {
    if (!ev.estimated) return true;
    return !live.some((row) => sameFamily(ev, row));
  });
  const ids = new Set(kept.map((e) => e.id));
  const added = live.filter((e) => !ids.has(e.id));
  return [...kept, ...added].sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? ''));
}

/** Surprise : actual vs forecast (numérique si possible). */
export function surpriseTone(actual?: string, forecast?: string): 'mint' | 'ember' | 'amber' | undefined {
  if (actual == null || forecast == null || actual === '' || forecast === '') return undefined;
  const a = Number(String(actual).replace(/[%KkMmBb,]/g, '').trim());
  const f = Number(String(forecast).replace(/[%KkMmBb,]/g, '').trim());
  if (!Number.isFinite(a) || !Number.isFinite(f)) return 'amber';
  if (a === f) return 'amber';
  return a > f ? 'mint' : 'ember';
}
