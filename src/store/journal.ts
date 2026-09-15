import { create } from 'zustand';
import { generateDemoJournal } from '@/engine/demo';
import { importTradesCsv, type ImportResult } from '@/engine/import/ninjatrader';
import { summarizeTrades } from '@/engine/metrics';
import { SESSION_CAPACITY, type Session, type Trade } from '@/engine/types';
import { uid } from '@/lib/id';
import { db } from './db';

interface JournalState {
  ready: boolean;
  sessions: Session[];
  trades: Trade[];
  load: () => Promise<void>;
  importCsv: (text: string, opts?: { boundaryHour?: number; riskPerContract?: number }) => Promise<ImportResult & { added: number; merged: number }>;
  loadDemo: () => Promise<number>;
  addManualSession: (input: { date: string; account?: string; pnl: number; tradeCount: number; note?: string; tags?: string[]; rating?: number }) => Promise<Session>;
  updateSession: (id: string, patch: Partial<Pick<Session, 'note' | 'tags' | 'rating' | 'account'>>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateTrade: (id: string, patch: Partial<Pick<Trade, 'tags' | 'risk' | 'strategy'>>) => Promise<void>;
  clearAll: () => Promise<void>;
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export const useJournal = create<JournalState>((set, get) => ({
  ready: false,
  sessions: [],
  trades: [],

  async load() {
    const [sessions, trades] = await Promise.all([db.sessions.toArray(), db.trades.toArray()]);
    set({ sessions: sortSessions(sessions), trades, ready: true });
  },

  async importCsv(text, opts = {}) {
    const result = importTradesCsv(text, { sessionBoundaryHour: opts.boundaryHour ?? 0, riskPerContract: opts.riskPerContract });
    if (result.sessions.length === 0) return { ...result, added: 0, merged: 0 };
    const { sessions: existing, trades: existingTrades } = get();
    // Fusion : une séance existante (même date + même compte) absorbe les nouveaux trades,
    // les doublons exacts (instrument, sens, heures, prix) sont ignorés.
    const byKey = new Map(existing.map((s) => [`${s.date}|${s.account ?? ''}`, s]));
    const fingerprint = (t: Trade) => `${t.instrument}|${t.direction}|${t.qty}|${t.entryTime}|${t.exitTime}|${t.entryPrice}|${t.exitPrice}`;
    const known = new Set(existingTrades.map(fingerprint));
    const toAddSessions: Session[] = [];
    const toPutSessions: Session[] = [];
    const toAddTrades: Trade[] = [];
    let merged = 0;
    let added = 0;
    for (const s of result.sessions) {
      const sTrades = result.trades.filter((t) => t.sessionId === s.id && !known.has(fingerprint(t)));
      if (sTrades.length === 0) continue;
      const target = byKey.get(`${s.date}|${s.account ?? ''}`);
      if (target) {
        for (const t of sTrades) t.sessionId = target.id;
        const all = [...existingTrades.filter((t) => t.sessionId === target.id), ...toAddTrades.filter((t) => t.sessionId === target.id), ...sTrades];
        toPutSessions.push({ ...target, ...summarizeTrades(all), updatedAt: Date.now() });
        merged++;
      } else {
        if (existing.length + toAddSessions.length >= SESSION_CAPACITY) {
          result.warnings.push(`Capacité atteinte (${SESSION_CAPACITY} séances) : certaines séances n'ont pas été ajoutées.`);
          break;
        }
        toAddSessions.push(s);
        added++;
      }
      toAddTrades.push(...sTrades);
      for (const t of sTrades) known.add(fingerprint(t));
    }
    await db.transaction('rw', [db.sessions, db.trades], async () => {
      if (toAddSessions.length) await db.sessions.bulkAdd(toAddSessions);
      if (toPutSessions.length) await db.sessions.bulkPut(toPutSessions);
      if (toAddTrades.length) await db.trades.bulkAdd(toAddTrades);
    });
    await get().load();
    return { ...result, added, merged };
  },

  async loadDemo() {
    const room = SESSION_CAPACITY - get().sessions.length;
    const count = Math.min(140, room);
    if (count <= 0) return 0;
    const { sessions, trades } = generateDemoJournal({ sessions: count });
    await db.transaction('rw', [db.sessions, db.trades], async () => {
      await db.sessions.bulkAdd(sessions);
      await db.trades.bulkAdd(trades);
    });
    await get().load();
    return sessions.length;
  },

  async addManualSession(input) {
    if (get().sessions.length >= SESSION_CAPACITY) throw new Error(`Capacité atteinte (${SESSION_CAPACITY} séances).`);
    const now = Date.now();
    const s: Session = {
      id: uid('s'),
      date: input.date,
      account: input.account || undefined,
      instruments: ['NQ'],
      source: 'manuel',
      tradeCount: input.tradeCount,
      pnl: input.pnl,
      grossProfit: Math.max(0, input.pnl),
      grossLoss: Math.min(0, input.pnl),
      commission: 0,
      tags: input.tags ?? [],
      note: input.note,
      rating: input.rating,
      createdAt: now,
      updatedAt: now,
    };
    await db.sessions.add(s);
    set({ sessions: sortSessions([...get().sessions, s]) });
    return s;
  },

  async updateSession(id, patch) {
    await db.sessions.update(id, { ...patch, updatedAt: Date.now() });
    set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)) });
  },

  async deleteSession(id) {
    await db.transaction('rw', [db.sessions, db.trades], async () => {
      await db.trades.where('sessionId').equals(id).delete();
      await db.sessions.delete(id);
    });
    set({ sessions: get().sessions.filter((s) => s.id !== id), trades: get().trades.filter((t) => t.sessionId !== id) });
  },

  async updateTrade(id, patch) {
    await db.trades.update(id, patch);
    set({ trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  },

  async clearAll() {
    await db.transaction('rw', [db.sessions, db.trades], async () => {
      await db.trades.clear();
      await db.sessions.clear();
    });
    set({ sessions: [], trades: [] });
  },
}));
