/**
 * Orchestrateur : un échec de source n'efface pas les autres.
 * Cache brut (ETag / Last-Modified) injecté par l'appelant. Hors ligne, le cache
 * est renvoyé avec l'état `stale`, sans exception.
 */

import type { AppLocale } from '../locale';
import { blsAdapter } from './bls';
import { beaAdapter } from './bea';
import { bundleAdapter, bundleCoverage, bundleYear } from './bundle';
import { cmeAdapter } from './cme';
import { ecbAdapter } from './ecb';
import { eiaAdapter } from './eia';
import { fedAdapter } from './fed';
import { applyFredPatch, fredAdapter, FRED_OBS_URL, parseFredObservations } from './fred';
import { treasuryAdapter } from './treasury';
import type { CalendarEventRow, CalendarSourceStatus } from './types';

export const CALENDAR_UA = 'CANTO-Desk/2.0 (calendar)';

/** Quota BLS déclaré dans `sources.ts` (500 / jour). */
const BLS_LIMIT = { requests: 500, perSeconds: 86_400 };
const blsHits: number[] = [];

export interface RawCacheEntry {
  url: string;
  body: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
}

export interface CacheStore {
  read(key: string): Promise<RawCacheEntry | null>;
  write(key: string, entry: RawCacheEntry): Promise<void>;
}

export interface CalendarSyncResult {
  events: CalendarEventRow[];
  sources: CalendarSourceStatus[];
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface Runnable {
  sourceId: string;
  fetch(range: { from: string; to: string }, ctx: { fetch: FetchLike; locale: AppLocale; byok?: string }): Promise<CalendarEventRow[]>;
}

export const OFFICIAL_ADAPTERS: Runnable[] = [blsAdapter, beaAdapter, fedAdapter, ecbAdapter, eiaAdapter, treasuryAdapter, fredAdapter, cmeAdapter];

/** Le bundle est le socle : il passe avant toute source réseau. */
export const CALENDAR_ADAPTERS: Runnable[] = [bundleAdapter, ...OFFICIAL_ADAPTERS];

/**
 * La fenêtre demandée est élargie à toute la couverture embarquée.
 * Le store remplace toutes les lignes `bundle` à chaque synchro : une fenêtre
 * étroite effacerait le reste de l'année.
 */
function bundleRange(range: { from: string; to: string }): { from: string; to: string } {
  const cov = bundleCoverage();
  return {
    from: range.from < cov.from ? range.from : cov.from,
    to: range.to > cov.to ? range.to : cov.to,
  };
}

function withoutBundleOrigin(events: CalendarEventRow[], origin: string, range: { from: string; to: string }): CalendarEventRow[] {
  return events.filter((event) => event.sourceId !== 'bundle' || event.origin !== origin || event.date < range.from || event.date > range.to);
}

export function cacheKeyFor(url: string): string {
  return url.replace(/[^a-z0-9]+/gi, '_').slice(0, 140);
}

function blsAllowed(now: number): boolean {
  const windowMs = BLS_LIMIT.perSeconds * 1000;
  while (blsHits.length && now - blsHits[0]! > windowMs) blsHits.shift();
  if (blsHits.length >= BLS_LIMIT.requests) return false;
  blsHits.push(now);
  return true;
}

async function guardedFetch(url: string, init: RequestInit | undefined, opts: {
  fetchImpl: FetchLike;
  cache: CacheStore;
  now: number;
  hostOk: (url: string) => boolean;
  markStale: (detail: string) => void;
}): Promise<Response> {
  if (!opts.hostOk(url)) throw new Error('Hôte non autorisé');
  const key = cacheKeyFor(url);
  const cached = await opts.cache.read(key);
  if (url.includes('api.bls.gov') && !blsAllowed(opts.now)) {
    if (cached) {
      opts.markStale('quota BLS');
      return new Response(cached.body, { status: 200 });
    }
    throw new Error('quota BLS');
  }
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', CALENDAR_UA);
  if (cached?.etag) headers.set('If-None-Match', cached.etag);
  if (cached?.lastModified) headers.set('If-Modified-Since', cached.lastModified);
  try {
    const res = await opts.fetchImpl(url, { ...init, headers });
    if (res.status === 304 && cached) return new Response(cached.body, { status: 200 });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await opts.cache.write(key, {
      url,
      body,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      fetchedAt: opts.now,
    });
    return new Response(body, { status: 200 });
  } catch (err) {
    if (cached) {
      opts.markStale(err instanceof Error ? err.message : 'réseau indisponible');
      return new Response(cached.body, { status: 200 });
    }
    throw err;
  }
}

export async function runCalendarSync(opts: {
  range: { from: string; to: string };
  locale: AppLocale;
  fetchImpl: FetchLike;
  cache: CacheStore;
  now: number;
  hostOk: (url: string) => boolean;
  byok?: Partial<Record<string, string>>;
  adapters?: Runnable[];
}): Promise<CalendarSyncResult> {
  const requested = opts.adapters ?? CALENDAR_ADAPTERS;
  const adapters = [...requested.filter((adapter) => adapter.sourceId === 'bundle'), ...requested.filter((adapter) => adapter.sourceId !== 'bundle')];
  const events: CalendarEventRow[] = [];
  const sources: CalendarSourceStatus[] = [];
  let fredPatch: ReturnType<typeof parseFredObservations> = null;

  for (const adapter of adapters) {
    if (adapter.sourceId === 'bundle') {
      try {
        const rows = await adapter.fetch(bundleRange(opts.range), { fetch: opts.fetchImpl, locale: opts.locale });
        events.push(...rows.map((row) => ({ ...row, syncedAt: opts.now })));
      } catch {
        /* le socle ne bloque pas les sources réseau */
      }
      sources.push({ sourceId: 'bundle', state: 'ok', syncedAt: opts.now, detail: bundleYear() });
      continue;
    }
    if (adapter.sourceId === 'cme') {
      sources.push({
        sourceId: 'cme',
        state: 'ok',
        syncedAt: opts.now,
        detail: 'expirations locales estimées ; page fériés CME inaccessible (403 le 2026-09-26)',
      });
      continue;
    }
    let staleDetail = '';
    const fetch: FetchLike = (url, init) => guardedFetch(url, init, {
      fetchImpl: opts.fetchImpl,
      cache: opts.cache,
      now: opts.now,
      hostOk: opts.hostOk,
      markStale: (detail) => {
        staleDetail = detail;
      },
    });
    try {
      if (adapter.sourceId === 'fred') {
        const key = opts.byok?.fred;
        if (!key) {
          sources.push({ sourceId: 'fred', state: 'error', detail: 'clé FRED absente' });
          continue;
        }
        const url = `${FRED_OBS_URL}?series_id=PAYEMS&file_type=json&sort_order=desc&limit=2&api_key=${encodeURIComponent(key)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
        fredPatch = parseFredObservations(JSON.parse(await res.text()) as unknown, 'nfp');
        sources.push({ sourceId: 'fred', state: staleDetail ? 'stale' : 'ok', syncedAt: opts.now, detail: staleDetail || undefined });
        continue;
      }
      const rows = await adapter.fetch(opts.range, { fetch, locale: opts.locale, byok: opts.byok?.[adapter.sourceId] });
      const kept = withoutBundleOrigin(events, adapter.sourceId, opts.range);
      events.length = 0;
      events.push(...kept, ...rows.map((row) => ({ ...row, syncedAt: opts.now })));
      sources.push({
        sourceId: adapter.sourceId,
        state: staleDetail ? 'stale' : 'ok',
        syncedAt: opts.now,
        detail: staleDetail || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'échec';
      const covered = events.some((event) => event.sourceId === 'bundle' && event.origin === adapter.sourceId);
      sources.push({
        sourceId: adapter.sourceId,
        state: covered ? 'stale' : 'error',
        syncedAt: covered ? opts.now : undefined,
        detail: covered ? `${message} · instantané embarqué` : message,
      });
    }
  }

  const byId = new Map<string, CalendarEventRow>();
  for (const row of applyFredPatch(events, fredPatch)) byId.set(row.id, row);
  const merged = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? ''));
  return { events: merged, sources };
}
