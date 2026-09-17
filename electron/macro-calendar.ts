/**
 * Calendrier macro — Investing.com (principal) + Forex Factory (repli).
 * Fetch via Electron `net.fetch` (sans Referer cross-origin, sinon ERR_BLOCKED_BY_CLIENT).
 */

import { net } from 'electron';

export interface MacroRelease {
  id: string;
  /** YYYY-MM-DD en fuseau America/New_York */
  date: string;
  /** HH:mm ET */
  timeET?: string;
  title: string;
  currency: string;
  impact: 1 | 2 | 3;
  forecast?: string;
  previous?: string;
  actual?: string;
  period?: string;
  source: 'investing' | 'forexfactory';
  /** Instant ISO de publication */
  at: string;
}

const INVESTING =
  'https://endpoints.investing.com/pd-instruments/v1/calendars/economic/events/occurrences';
const FF_WEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function valStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return undefined;
}

function impactOf(raw: unknown): 1 | 2 | 3 {
  if (raw === 'high' || raw === 'High' || raw === 3) return 3;
  if (raw === 'medium' || raw === 'Medium' || raw === 2) return 2;
  return 1;
}

/** Formate un instant en date + heure ET. */
function etParts(iso: string): { date: string; timeET: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, timeET: `${parts.hour}:${parts.minute}` };
}

const FETCH_TIMEOUT_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text[0] === '<' || text === '403') throw new Error('Réponse non JSON');
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function parseInvesting(raw: unknown): MacroRelease[] {
  if (!raw || typeof raw !== 'object') return [];
  const body = raw as { events?: unknown[]; occurrences?: unknown[] };
  const meta = new Map<number, Record<string, unknown>>();
  for (const ev of body.events ?? []) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as Record<string, unknown>;
    const id = Number(e.event_id);
    if (Number.isFinite(id)) meta.set(id, e);
  }
  const out: MacroRelease[] = [];
  for (const occ of body.occurrences ?? []) {
    if (!occ || typeof occ !== 'object') continue;
    const o = occ as Record<string, unknown>;
    const eid = Number(o.event_id);
    const m = meta.get(eid);
    if (!m) continue;
    const currency = String(m.currency ?? '');
    const countryId = Number(m.country_id);
    if (currency !== 'USD' && countryId !== 5) continue;
    const at = String(o.occurrence_time ?? '');
    const parts = etParts(at);
    if (!parts) continue;
    const longName = String(m.long_name ?? '').trim();
    if (!longName) continue;
    const period = valStr(o.reference_period);
    const title = period ? `${longName} (${period})` : longName;
    const occId = o.occurrence_id ?? `${eid}_${at}`;
    out.push({
      id: `inv_${occId}`,
      date: parts.date,
      timeET: parts.timeET,
      title,
      currency: 'USD',
      impact: impactOf(m.importance),
      forecast: valStr(o.forecast),
      previous: valStr(o.previous),
      actual: valStr(o.actual),
      period,
      source: 'investing',
      at,
    });
  }
  return out;
}

function parseForexFactory(raw: unknown): MacroRelease[] {
  if (!Array.isArray(raw)) return [];
  const out: MacroRelease[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (String(r.country ?? '') !== 'USD') continue;
    const at = String(r.date ?? '');
    const parts = etParts(at);
    if (!parts) continue;
    const title = String(r.title ?? '').trim();
    if (!title) continue;
    // Le feed FF n'expose pas toujours `actual` ; on accepte le champ s'il apparaît.
    out.push({
      id: `ff_${parts.date}_${parts.timeET}_${title}`.replace(/\W+/g, '_').slice(0, 120),
      date: parts.date,
      timeET: parts.timeET,
      title,
      currency: 'USD',
      impact: impactOf(r.impact),
      forecast: valStr(r.forecast),
      previous: valStr(r.previous),
      actual: valStr(r.actual),
      source: 'forexfactory',
      at,
    });
  }
  return out;
}

export async function fetchMacroReleases(fromDate: string, toDate: string): Promise<{
  releases: MacroRelease[];
  source: 'investing' | 'forexfactory' | 'none';
  error?: string;
}> {
  const start = `${fromDate}T00:00:00.000Z`.replace(/:/g, '%3A');
  const end = `${toDate}T23:59:59.999Z`.replace(/:/g, '%3A');
  const investingUrl = `${INVESTING}?domain_id=1&limit=200&start_date=${start}&end_date=${end}`;

  try {
    const data = await getJson(investingUrl);
    const releases = parseInvesting(data).filter((r) => r.date >= fromDate && r.date <= toDate);
    if (releases.length) return { releases, source: 'investing' };
  } catch (e) {
    const investingErr = e instanceof Error ? e.message : 'Investing indisponible';
    try {
      const data = await getJson(FF_WEEK);
      const releases = parseForexFactory(data).filter((r) => r.date >= fromDate && r.date <= toDate);
      return {
        releases,
        source: releases.length ? 'forexfactory' : 'none',
        error: releases.length ? `Investing : ${investingErr} · repli Forex Factory` : investingErr,
      };
    } catch (e2) {
      return {
        releases: [],
        source: 'none',
        error: `${investingErr} · FF : ${e2 instanceof Error ? e2.message : 'échec'}`,
      };
    }
  }

  // Investing OK mais vide → tenter FF pour la semaine courante
  try {
    const data = await getJson(FF_WEEK);
    const releases = parseForexFactory(data).filter((r) => r.date >= fromDate && r.date <= toDate);
    return { releases, source: releases.length ? 'forexfactory' : 'none' };
  } catch {
    return { releases: [], source: 'none', error: 'Aucune donnée macro' };
  }
}
