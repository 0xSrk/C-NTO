import { create } from 'zustand';
import { tr } from '@/i18n';
import { desk } from '@/lib/desk';
import { addDays, dateKeyLocal } from '@/lib/time';
import { db, type MacroReleaseRow } from './db';

const CACHE_MS = 24 * 60 * 60 * 1000;

interface MacroState {
  ready: boolean;
  syncing: boolean;
  releases: MacroReleaseRow[];
  lastSource: 'investing' | 'forexfactory' | 'none' | null;
  lastError?: string;
  lastSyncedAt?: number;
  load: () => Promise<void>;
  /** Tire Investing (ou FF) pour la fenêtre [from, to] et fusionne dans le coffre. */
  sync: (from?: string, to?: string) => Promise<void>;
}

export const useMacro = create<MacroState>((set, get) => ({
  ready: false,
  syncing: false,
  releases: [],
  lastSource: null,
  async load() {
    const releases = await db.macroReleases.orderBy('date').reverse().toArray();
    const lastSyncedAt = releases.reduce((m, r) => Math.max(m, r.syncedAt), 0) || undefined;
    set({ releases, ready: true, lastSyncedAt });
  },
  async sync(from, to) {
    if (get().syncing) return;
    const cachedAt = get().lastSyncedAt ?? get().releases.reduce((m, r) => Math.max(m, r.syncedAt), 0);
    if (cachedAt && Date.now() - cachedAt < CACHE_MS && get().releases.length > 0) return;
    const today = dateKeyLocal(new Date());
    const fromDate = from ?? addDays(today, -45);
    const toDate = to ?? addDays(today, 21);
    // Le renderer ne sort jamais sur le réseau (CSP `connect-src 'self'`) : la synchro macro
    // passe par le process principal du shell, seul autorisé à joindre Investing / Forex Factory.
    if (!desk?.calendar?.fetchMacro) {
      set({
        syncing: false,
        lastSource: get().lastSource ?? 'none',
        lastError: tr('Synchro macro disponible sous le shell CΛNTO uniquement.', 'Macro sync is only available under the CΛNTO shell.', 'Sincronización macro disponible solo bajo el shell CΛNTO.'),
      });
      return;
    }
    set({ syncing: true, lastError: undefined });
    try {
      const payload = await desk.calendar.fetchMacro(fromDate, toDate);

      const now = Date.now();
      const rows: MacroReleaseRow[] = payload.releases.map((r) => ({ ...r, syncedAt: now }));
      if (rows.length) await db.macroReleases.bulkPut(rows);
      const releases = await db.macroReleases.orderBy('date').reverse().toArray();
      set({
        releases,
        ready: true,
        syncing: false,
        lastSource: payload.source,
        lastError: payload.error,
        lastSyncedAt: now,
      });
    } catch (e) {
      set({
        syncing: false,
        lastSource: get().lastSource ?? 'none',
        lastError: e instanceof Error ? e.message : 'Sync macro impossible',
      });
    }
  },
}));
