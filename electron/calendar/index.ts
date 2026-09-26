/**
 * Branchement Electron : cache disque sous userData, fetch via `net.fetch`.
 * Le renderer n'appelle jamais ces hôtes.
 */

import { app, net } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppLocale } from '../locale';
import { CALENDAR_ADAPTERS, runCalendarSync, type CacheStore, type CalendarSyncResult, type RawCacheEntry } from './sync';

function diskCache(dir: string): CacheStore {
  return {
    async read(key) {
      try {
        const text = await readFile(path.join(dir, `${key}.json`), 'utf8');
        const parsed = JSON.parse(text) as RawCacheEntry;
        if (!parsed || typeof parsed.body !== 'string' || typeof parsed.url !== 'string') return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async write(key, entry) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry), 'utf8');
    },
  };
}

export async function syncOfficialCalendar(
  range: { from: string; to: string },
  locale: AppLocale,
  hostOk: (url: string) => boolean,
  byok?: Partial<Record<string, string>>,
): Promise<CalendarSyncResult> {
  const dir = path.join(app.getPath('userData'), 'calendar-cache');
  return runCalendarSync({
    range,
    locale,
    fetchImpl: (url, init) => net.fetch(url, init),
    cache: diskCache(dir),
    now: Date.now(),
    hostOk,
    byok,
    adapters: CALENDAR_ADAPTERS,
  });
}
