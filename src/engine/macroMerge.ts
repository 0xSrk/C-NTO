import type { CalEvent, EventCategory } from '@/engine/calendar';
import type { MacroReleaseRow } from '@/store/db';

/** Heuristique catégorie depuis le titre Investing / FF. */
export function categoryFromTitle(title: string): EventCategory {
  const t = title.toLowerCase();
  if (/fomc|federal funds|fed interest|powell|beige book|dot plot/.test(t)) return 'fed';
  if (/non.?farm|nfp|unemployment|jobless|payroll|employment|adp/.test(t)) return 'emploi';
  if (/cpi|ppi|pce|inflation|price index|core/.test(t)) return 'inflation';
  if (/gdp|ism|pmi|retail sales|industrial production|durable|housing|construction/.test(t)) return 'croissance';
  if (/confidence|sentiment|michigan|consumer/.test(t)) return 'sentiment';
  return 'croissance';
}

export function macroToCalEvent(r: MacroReleaseRow): CalEvent {
  const category = categoryFromTitle(r.title);
  const bits = [
    r.forecast != null ? `Attendu ${r.forecast}` : null,
    r.previous != null ? `Préc. ${r.previous}` : null,
    r.actual != null ? `Publié ${r.actual}` : null,
  ].filter(Boolean);
  return {
    id: r.id,
    date: r.date,
    timeET: r.timeET,
    title: r.title.replace(/^U\.S\.\s+/i, ''),
    category,
    impact: r.impact,
    description: bits.length ? bits.join(' · ') : 'Publication macro USD (fil Investing / FF).',
    estimated: false,
    forecast: r.forecast,
    previous: r.previous,
    actual: r.actual,
    period: r.period,
    source: r.source,
  };
}

/** Fusionne événements structurels Nasdaq + publications macro persistées (additif : un fetch ne déplace pas un FOMC bundled). */
export function mergeCalendarEvents(local: CalEvent[], macros: MacroReleaseRow[]): CalEvent[] {
  const live = macros.map(macroToCalEvent);
  const localIds = new Set(local.map((e) => e.id));
  const added = live.filter((e) => !localIds.has(e.id));
  return [...local, ...added].sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? ''));
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
