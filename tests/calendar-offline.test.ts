import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blsAdapter, BLS_CPI_URL, BLS_EMPSIT_URL } from '../electron/calendar/bls';
import { cacheKeyFor, runCalendarSync, type RawCacheEntry } from '../electron/calendar/sync';

describe('calendrier hors ligne', () => {
  it('renvoie le cache et l’état périmé, sans exception', async () => {
    const html = readFileSync('tests/fixtures/calendar/bls-empsit.html', 'utf8');
    const cpi = readFileSync('tests/fixtures/calendar/bls-cpi.html', 'utf8');
    const store = new Map<string, RawCacheEntry>([
      [cacheKeyFor(BLS_EMPSIT_URL), { url: BLS_EMPSIT_URL, body: html, fetchedAt: 10 }],
      [cacheKeyFor(BLS_CPI_URL), { url: BLS_CPI_URL, body: cpi, fetchedAt: 10 }],
    ]);
    const result = await runCalendarSync({
      range: { from: '2026-01-01', to: '2026-12-31' },
      locale: 'fr',
      now: 1_000,
      hostOk: () => true,
      adapters: [blsAdapter],
      fetchImpl: async () => {
        throw new Error('réseau indisponible');
      },
      cache: {
        async read(key) {
          return store.get(key) ?? null;
        },
        async write() {
          throw new Error('écriture inattendue');
        },
      },
    });
    const bls = result.sources.find((s) => s.sourceId === 'bls');
    expect(bls?.state).toBe('stale');
    expect(result.events.length).toBeGreaterThan(10);
    expect(result.events.some((e) => e.date === '2026-02-11' && e.timeET === '08:30')).toBe(true);
    expect(result.events.every((e) => e.syncedAt === 1_000)).toBe(true);
  });
});
