import { create } from 'zustand';
import { desk } from '@/lib/desk';
import { addDays, dateKeyLocal } from '@/lib/time';
import { db, type MacroReleaseRow } from './db';

function etDateKey(iso: string): { date: string; timeET: string } | null {
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
    set({ releases, ready: true });
  },
  async sync(from, to) {
    if (get().syncing) return;
    const today = dateKeyLocal(new Date());
    const fromDate = from ?? addDays(today, -45);
    const toDate = to ?? addDays(today, 21);
    set({ syncing: true, lastError: undefined });
    try {
      let payload: {
        releases: Omit<MacroReleaseRow, 'syncedAt'>[];
        source: 'investing' | 'forexfactory' | 'none';
        error?: string;
      };
      if (desk?.calendar?.fetchMacro) {
        payload = await desk.calendar.fetchMacro(fromDate, toDate);
      } else {
        const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as {
          title: string;
          country: string;
          date: string;
          impact: string;
          forecast?: string;
          previous?: string;
          actual?: string;
        }[];
        const releases = rows
          .filter((r) => r.country === 'USD')
          .map((r) => {
            const parts = etDateKey(r.date);
            if (!parts) return null;
            return {
              id: `ff_${parts.date}_${parts.timeET}_${r.title}`.replace(/\W+/g, '_').slice(0, 120),
              date: parts.date,
              timeET: parts.timeET,
              title: r.title,
              currency: 'USD',
              impact: (r.impact === 'High' ? 3 : r.impact === 'Medium' ? 2 : 1) as 1 | 2 | 3,
              forecast: r.forecast || undefined,
              previous: r.previous || undefined,
              actual: r.actual || undefined,
              source: 'forexfactory' as const,
              at: r.date,
            };
          })
          .filter((r): r is NonNullable<typeof r> => !!r && r.date >= fromDate && r.date <= toDate);
        payload = { releases, source: releases.length ? 'forexfactory' : 'none' };
      }

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
        lastSource: 'none',
        lastError: e instanceof Error ? e.message : 'Sync macro impossible',
      });
    }
  },
}));
