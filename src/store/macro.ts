import { create } from 'zustand';
import type { CalendarEventRow, CalendarSourceStatus } from '@/engine/calendarEvents';
import { tr } from '@/i18n';
import { desk } from '@/lib/desk';
import { addDays, dateKeyLocal } from '@/lib/time';
import { db } from './db';
import { scheduleOntologyRecompute } from './ontology-schedule';

/** Au lancement, on ne retélécharge pas si la dernière synchro a moins de 12 h. */
const LAUNCH_STALE_MS = 12 * 60 * 60 * 1000;
/** Puis toutes les 6 h. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

interface MacroState {
  ready: boolean;
  syncing: boolean;
  events: CalendarEventRow[];
  sources: CalendarSourceStatus[];
  lastError?: string;
  lastSyncedAt?: number;
  load: () => Promise<void>;
  /**
   * Tire les sources officielles. Sans `force`, un cache de moins de 12 h suffit
   * (lancement). Le bouton et l'intervalle de 6 h passent `force`.
   */
  sync: (from?: string, to?: string, force?: boolean) => Promise<void>;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export const useMacro = create<MacroState>((set, get) => ({
  ready: false,
  syncing: false,
  events: [],
  sources: [],
  async load() {
    const events = await db.calendarEvents.orderBy('date').reverse().toArray();
    const lastSyncedAt = events.reduce((m, r) => Math.max(m, r.syncedAt), 0) || undefined;
    set({ events, ready: true, lastSyncedAt });
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        void get().sync(undefined, undefined, true);
      }, REFRESH_MS);
    }
  },
  async sync(from, to, force) {
    if (get().syncing) return;
    const cachedAt = get().lastSyncedAt ?? get().events.reduce((m, r) => Math.max(m, r.syncedAt), 0);
    if (!force && cachedAt && Date.now() - cachedAt < LAUNCH_STALE_MS && get().events.length > 0) return;
    const today = dateKeyLocal(new Date());
    const fromDate = from ?? addDays(today, -45);
    const toDate = to ?? addDays(today, 120);
    if (!desk?.calendar?.fetchMacro) {
      set({
        syncing: false,
        lastError: tr('Synchro du calendrier disponible sous le shell CΛNTO uniquement.', 'Calendar sync is only available under the CΛNTO shell.', 'Sincronización del calendario disponible solo bajo el shell CΛNTO.'),
      });
      return;
    }
    set({ syncing: true, lastError: undefined });
    try {
      const payload = await desk.calendar.fetchMacro(fromDate, toDate);
      const now = Date.now();
      const incoming = (payload.events ?? []).map((row) => ({ ...row, syncedAt: row.syncedAt || now }));
      const touched = new Set(
        (payload.sources ?? [])
          .filter((s) => s.state === 'ok' || s.state === 'stale')
          .map((s) => s.sourceId),
      );
      await db.transaction('rw', db.calendarEvents, async () => {
        for (const sourceId of touched) {
          if (!incoming.some((row) => row.sourceId === sourceId)) continue;
          await db.calendarEvents.where('sourceId').equals(sourceId).delete();
        }
        const rows = incoming.filter((row) => touched.has(row.sourceId));
        if (rows.length) await db.calendarEvents.bulkPut(rows);
      });
      const events = await db.calendarEvents.orderBy('date').reverse().toArray();
      const failed = (payload.sources ?? []).filter((s) => s.state !== 'ok');
      const lastError = payload.error ?? (failed.length ? failed.map((s) => `${s.sourceId}${s.detail ? ` : ${s.detail}` : ''}`).join(' · ') : undefined);
      const syncedAt = (payload.sources ?? []).reduce((m, s) => Math.max(m, s.syncedAt ?? 0), 0) || now;
      set({
        events,
        sources: payload.sources ?? [],
        ready: true,
        syncing: false,
        lastError,
        lastSyncedAt: events.length ? Math.max(syncedAt, events.reduce((m, r) => Math.max(m, r.syncedAt), 0)) : cachedAt,
      });
      scheduleOntologyRecompute();
    } catch (e) {
      set({
        syncing: false,
        lastError: e instanceof Error ? e.message : 'Sync calendrier impossible',
      });
    }
  },
}));
