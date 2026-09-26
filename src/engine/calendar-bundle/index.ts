/**
 * Instantané annuel du calendrier, importé statiquement.
 * Aucun accès disque, aucun réseau : le JSON fait partie du binaire.
 * `electron/calendar-bundle` est un lien vers ce dossier pour que le process
 * principal le compile sans sortir de son `rootDir`.
 */

import raw from './2026.json';

export const BUNDLE_ORIGINS = ['bls', 'bea', 'fed', 'ecb', 'eia', 'treasury'] as const;
export type BundleOrigin = (typeof BUNDLE_ORIGINS)[number];

const CATEGORIES = ['emploi', 'inflation', 'croissance', 'banque-centrale', 'energie', 'adjudication', 'cme', 'resultats', 'autre'] as const;
type BundleCategory = (typeof CATEGORIES)[number];

export interface BundleEvent {
  origin: BundleOrigin;
  /** Partie stable de l'identifiant d'origine (`nfp-2026-02-11`, CUSIP, …). */
  key: string;
  date: string;
  timeET?: string;
  at?: string;
  title: string;
  category: BundleCategory;
  impact: 1 | 2 | 3;
  currency?: string;
  instruments: string[];
  previous?: string;
  actual?: string;
  forecast?: string;
  period?: string;
  estimated: boolean;
}

export interface CalendarBundleFile {
  schemaVersion: 1;
  generatedAt: string;
  coverage: { from: string; to: string };
  attribution: { ecb: string };
  events: BundleEvent[];
}

export interface MaterializedBundleEvent {
  id: string;
  sourceId: 'bundle';
  origin: BundleOrigin;
  date: string;
  timeET?: string;
  at?: string;
  title: string;
  category: BundleCategory;
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isOrigin(value: unknown): value is BundleOrigin {
  return typeof value === 'string' && (BUNDLE_ORIGINS as readonly string[]).includes(value);
}

function isCategory(value: unknown): value is BundleCategory {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const calendarBundle = raw as CalendarBundleFile;

/** Fenêtre embarquée. Repli fixe si le fichier était illisible. */
export function bundleCoverage(): { from: string; to: string } {
  const from = calendarBundle.coverage?.from;
  const to = calendarBundle.coverage?.to;
  if (typeof from === 'string' && DATE_RE.test(from) && typeof to === 'string' && DATE_RE.test(to) && from <= to) {
    return { from, to };
  }
  return { from: '2026-01-01', to: '2027-03-31' };
}

export function bundleYear(): string {
  return bundleCoverage().from.slice(0, 4);
}

function normalize(rawEvent: unknown, syncedAt: number): MaterializedBundleEvent | null {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const event = rawEvent as Partial<BundleEvent>;
  if (!isOrigin(event.origin)) return null;
  if (typeof event.key !== 'string' || event.key.length === 0 || event.key.length > 120) return null;
  if (typeof event.date !== 'string' || !DATE_RE.test(event.date)) return null;
  if (typeof event.title !== 'string' || event.title.length === 0 || event.title.length > 300) return null;
  if (!isCategory(event.category)) return null;
  if (event.impact !== 1 && event.impact !== 2 && event.impact !== 3) return null;
  if (typeof event.estimated !== 'boolean') return null;
  const instruments = Array.isArray(event.instruments) ? event.instruments.filter((s): s is string => typeof s === 'string') : [];
  return {
    id: `bundle:${event.origin}:${event.key}`,
    sourceId: 'bundle',
    origin: event.origin,
    date: event.date,
    timeET: optString(event.timeET),
    at: optString(event.at),
    title: event.title,
    category: event.category,
    impact: event.impact,
    currency: optString(event.currency),
    instruments,
    previous: optString(event.previous),
    actual: optString(event.actual),
    forecast: optString(event.forecast),
    period: optString(event.period),
    estimated: event.estimated,
    syncedAt,
  };
}

/**
 * Événements de l'instantané dans la plage demandée.
 * Ne lève pas : une ligne illisible est ignorée.
 */
export function materializeBundle(range: { from: string; to: string }, syncedAt = 0): MaterializedBundleEvent[] {
  const events = Array.isArray(calendarBundle.events) ? calendarBundle.events : [];
  const out: MaterializedBundleEvent[] = [];
  for (const rawEvent of events) {
    const row = normalize(rawEvent, syncedAt);
    if (!row) continue;
    if (row.date < range.from || row.date > range.to) continue;
    out.push(row);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? '') || a.origin.localeCompare(b.origin) || a.id.localeCompare(b.id));
  return out;
}
