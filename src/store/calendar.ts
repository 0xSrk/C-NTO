import { create } from 'zustand';
import { uid } from '@/lib/id';
import { db, type CalendarEntry } from './db';

interface CalendarState {
  ready: boolean;
  entries: CalendarEntry[];
  load: () => Promise<void>;
  add: (input: Omit<CalendarEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CalendarEntry>;
  update: (id: string, patch: Partial<Pick<CalendarEntry, 'title' | 'body' | 'time'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Note libre unique par jour (créée à la volée) */
  setDayNote: (date: string, body: string) => Promise<void>;
}

export const useCalendar = create<CalendarState>((set, get) => ({
  ready: false,
  entries: [],
  async load() {
    const entries = await db.calendar.toArray();
    set({ entries, ready: true });
  },
  async add(input) {
    const now = Date.now();
    const e: CalendarEntry = { ...input, id: uid('c'), createdAt: now, updatedAt: now };
    await db.calendar.add(e);
    set({ entries: [...get().entries, e] });
    return e;
  },
  async update(id, patch) {
    await db.calendar.update(id, { ...patch, updatedAt: Date.now() });
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)) });
  },
  async remove(id) {
    await db.calendar.delete(id);
    set({ entries: get().entries.filter((e) => e.id !== id) });
  },
  async setDayNote(date, body) {
    const existing = get().entries.find((e) => e.date === date && e.kind === 'note');
    if (existing) {
      if (!body.trim()) return get().remove(existing.id);
      return get().update(existing.id, { body });
    }
    if (!body.trim()) return;
    await get().add({ date, kind: 'note', title: 'Note du jour', body });
  },
}));
