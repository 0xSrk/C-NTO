import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blsAdapter, BLS_CPI_URL, BLS_EMPSIT_URL } from '../electron/calendar/bls';
import { cacheKeyFor, runCalendarSync, type RawCacheEntry } from '../electron/calendar/sync';
import { eventProvenance } from '@/engine/macroMerge';

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

  it('premier lancement sans cache : le socle embarqué, sources réseau périmées, jamais vide', async () => {
    const result = await runCalendarSync({
      range: { from: '2026-09-01', to: '2026-09-30' },
      locale: 'fr',
      now: 2_000,
      hostOk: () => true,
      fetchImpl: async () => {
        throw new Error('réseau indisponible');
      },
      cache: {
        async read() {
          return null;
        },
        async write() {
          throw new Error('écriture inattendue');
        },
      },
    });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => e.sourceId === 'bundle')).toBe(true);
    const nfp = result.events.find((e) => e.origin === 'bls' && e.category === 'emploi' && e.date === '2026-02-11');
    expect(nfp?.timeET).toBe('08:30');
    expect(eventProvenance(nfp?.sourceId, nfp?.origin)).toBe('Calendrier embarqué · BLS');
    expect(result.events.some((e) => e.origin === 'bls' && e.category === 'inflation' && e.date === '2026-09-11')).toBe(true);
    expect(result.events.some((e) => e.origin === 'fed' && e.date === '2026-09-16')).toBe(true);
    expect(result.events.some((e) => e.origin === 'eia' && e.date.startsWith('2026-09'))).toBe(true);
    for (const sourceId of ['bls', 'bea', 'fed', 'ecb', 'eia', 'treasury']) {
      const src = result.sources.find((s) => s.sourceId === sourceId);
      expect(src?.state, sourceId).toBe('stale');
      expect(src?.detail).toMatch(/instantané embarqué/);
    }
    expect(result.sources.find((s) => s.sourceId === 'bundle')?.state).toBe('ok');
    expect(result.sources.find((s) => s.sourceId === 'bundle')?.detail).toBe('2026');
    expect(result.sources.find((s) => s.sourceId === 'fred')?.state).toBe('error');
    expect(result.sources.find((s) => s.sourceId === 'cme')?.state).toBe('ok');
  });

  it('une source en cache écrase l’embarqué sur sa fenêtre et laisse le reste', async () => {
    const html = readFileSync('tests/fixtures/calendar/bls-empsit.html', 'utf8');
    const cpi = readFileSync('tests/fixtures/calendar/bls-cpi.html', 'utf8');
    const store = new Map<string, RawCacheEntry>([
      [cacheKeyFor(BLS_EMPSIT_URL), { url: BLS_EMPSIT_URL, body: html, fetchedAt: 10 }],
      [cacheKeyFor(BLS_CPI_URL), { url: BLS_CPI_URL, body: cpi, fetchedAt: 10 }],
    ]);
    const result = await runCalendarSync({
      range: { from: '2026-09-01', to: '2026-09-30' },
      locale: 'fr',
      now: 3_000,
      hostOk: () => true,
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
    expect(result.events.some((e) => e.sourceId === 'bls' && e.date === '2026-09-04')).toBe(true);
    expect(result.events.some((e) => e.sourceId === 'bundle' && e.origin === 'bls' && e.date === '2026-09-04')).toBe(false);
    expect(result.events.some((e) => e.sourceId === 'bundle' && e.origin === 'bls' && e.date === '2026-02-11')).toBe(true);
    expect(result.events.some((e) => e.sourceId === 'bundle' && e.origin === 'fed' && e.date === '2026-09-16')).toBe(true);
    expect(result.sources.find((s) => s.sourceId === 'bls')?.state).toBe('stale');
    expect(result.sources.find((s) => s.sourceId === 'fed')?.state).toBe('stale');
  });
});
