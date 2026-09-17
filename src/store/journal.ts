import { create } from 'zustand';
import { generateDemoJournal } from '@/engine/demo';
import { CSV_WORKER_MIN_LINES, csvLineCount, importCsvAuto, type ImportOptions, type ImportResult } from '@/engine/import';
import { listenWorker } from '@/lib/worker';
import { takeNewExecutionTrades } from '@/engine/import/identity';
import { summarizeTrades } from '@/engine/metrics';
import { SESSION_CAPACITY, type Session, type SessionSource, type Trade } from '@/engine/types';
import { uid } from '@/lib/id';
import { db } from './db';
import { useUi } from './ui';

interface JournalState {
  ready: boolean;
  sessions: Session[];
  trades: Trade[];
  load: () => Promise<void>;
  importCsv: (text: string, opts?: { boundaryHour?: number; riskPerContract?: number; source?: SessionSource }) => Promise<ImportResult & { added: number; merged: number; newTrades: number }>;
  loadDemo: () => Promise<number>;
  addManualSession: (input: { date: string; account?: string; pnl: number; tradeCount: number; note?: string; tags?: string[]; rating?: number }) => Promise<Session>;
  updateSession: (id: string, patch: Partial<Pick<Session, 'note' | 'tags' | 'rating' | 'account'>>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** Suppression en lot (trades inclus), une seule transaction. */
  deleteSessions: (ids: string[]) => Promise<void>;
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
    const importOpts: ImportOptions = { sessionBoundaryHour: opts.boundaryHour ?? 0, riskPerContract: opts.riskPerContract, source: opts.source };
    let result: ImportResult;
    if (typeof Worker !== 'undefined' && csvLineCount(text) > CSV_WORKER_MIN_LINES) {
      try {
        const worker = new Worker(new URL('../engine/import/csv.worker.ts', import.meta.url), { type: 'module' });
        const pending = listenWorker<ImportResult>(worker);
        worker.postMessage({ text, opts: importOpts });
        result = await pending;
      } catch {
        result = importCsvAuto(text, importOpts);
      }
    } else {
      result = importCsvAuto(text, importOpts);
    }
    if (result.sessions.length === 0) return { ...result, added: 0, merged: 0, newTrades: 0 };
    const { sessions: existing, trades: existingTrades } = get();
    // Fusion : une séance existante (même date + même compte) absorbe les nouveaux trades.
    // Exécutions : clé account+ID (ou hash de repli). Autres formats : empreinte prix/heures.
    const byKey = new Map(existing.map((s) => [`${s.date}|${s.account ?? ''}`, s]));
    const fingerprint = (t: Trade) => `${t.instrument}|${t.direction}|${t.qty}|${t.entryTime}|${t.exitTime}|${t.entryPrice}|${t.exitPrice}`;
    const knownIds = new Set(existingTrades.map((t) => t.id));
    const incoming: Trade[] = [];
    const incomingKeys = new Map<Trade, string[]>();
    if (result.format === 'ninjatrader-executions') {
      const knownExec = new Set((await db.importedExecutions.toArray()).map((row) => row.key));
      const picked = takeNewExecutionTrades(result.trades, result.tradeExecutionKeys ?? [], knownExec);
      for (let i = 0; i < picked.trades.length; i++) {
        const t = picked.trades[i]!;
        incoming.push(t);
        incomingKeys.set(t, picked.tradeKeys[i] ?? []);
      }
    } else {
      const known = new Set(existingTrades.map(fingerprint));
      for (const t of result.trades) {
        if (known.has(fingerprint(t)) || knownIds.has(t.id)) continue;
        known.add(fingerprint(t));
        incoming.push(t);
      }
    }
    const incomingBySession = new Map<string, Trade[]>();
    for (const t of incoming) {
      if (knownIds.has(t.id)) continue;
      const arr = incomingBySession.get(t.sessionId);
      if (arr) arr.push(t);
      else incomingBySession.set(t.sessionId, [t]);
    }
    const existingBySession = new Map<string, Trade[]>();
    for (const t of existingTrades) {
      const arr = existingBySession.get(t.sessionId);
      if (arr) arr.push(t);
      else existingBySession.set(t.sessionId, [t]);
    }
    const toAddSessions: Session[] = [];
    const toPutSessions: Session[] = [];
    const toAddTrades: Trade[] = [];
    let merged = 0;
    let added = 0;
    for (const s of result.sessions) {
      const sTrades = incomingBySession.get(s.id);
      if (!sTrades || sTrades.length === 0) continue;
      const target = byKey.get(`${s.date}|${s.account ?? ''}`);
      if (target) {
        for (const t of sTrades) t.sessionId = target.id;
        const all = [...(existingBySession.get(target.id) ?? []), ...sTrades];
        existingBySession.set(target.id, all);
        toPutSessions.push({ ...target, ...summarizeTrades(all), updatedAt: Date.now() });
        merged++;
      } else {
        if (existing.length + toAddSessions.length >= SESSION_CAPACITY) {
          result.warnings.push(`Capacité atteinte (${SESSION_CAPACITY} séances) : certaines séances n'ont pas été ajoutées. Exportez le coffre (Métrique › Sauvegarde) avant d'importer davantage.`);
          break;
        }
        toAddSessions.push(s);
        byKey.set(`${s.date}|${s.account ?? ''}`, s);
        existingBySession.set(s.id, sTrades);
        added++;
      }
      toAddTrades.push(...sTrades);
    }
    if (toAddTrades.length) {
      const importedAt = Date.now();
      const execRows = toAddTrades.flatMap((t) =>
        (incomingKeys.get(t) ?? []).map((key) => ({
          key,
          account: t.account ?? '',
          executionId: key.includes('\0') ? key.slice(key.indexOf('\0') + 1) : key,
          sessionId: t.sessionId,
          importedAt,
        })),
      );
      await db.transaction('rw', [db.sessions, db.trades, db.importedExecutions], async () => {
        if (toAddSessions.length) await db.sessions.bulkAdd(toAddSessions);
        if (toPutSessions.length) await db.sessions.bulkPut(toPutSessions);
        await db.trades.bulkAdd(toAddTrades);
        if (execRows.length) await db.importedExecutions.bulkPut(execRows);
      });
      await get().load();
    }
    return { ...result, added, merged, newTrades: toAddTrades.length };
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
    if (get().sessions.length >= SESSION_CAPACITY) {
      useUi.getState().toast(`Capacité atteinte (${SESSION_CAPACITY} séances) : ajout manuel refusé.`, 'warn');
      throw new Error(`Capacité atteinte (${SESSION_CAPACITY} séances).`);
    }
    if (get().sessions.some((s) => s.date === input.date && (s.account ?? '') === (input.account?.trim() ?? ''))) {
      throw new Error('Une séance existe déjà pour cette date et ce compte : éditez-la depuis la liste.');
    }
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
    await get().deleteSessions([id]);
  },

  async deleteSessions(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    const idSet = new Set(unique);
    await db.transaction('rw', [db.sessions, db.trades, db.importedExecutions], async () => {
      await db.trades.where('sessionId').anyOf(unique).delete();
      await db.importedExecutions.where('sessionId').anyOf(unique).delete();
      await db.sessions.bulkDelete(unique);
    });
    set({
      sessions: get().sessions.filter((s) => !idSet.has(s.id)),
      trades: get().trades.filter((t) => !idSet.has(t.sessionId)),
    });
  },

  async updateTrade(id, patch) {
    await db.trades.update(id, patch);
    set({ trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  },

  async clearAll() {
    await db.transaction('rw', [db.sessions, db.trades, db.importedExecutions], async () => {
      await db.trades.clear();
      await db.sessions.clear();
      await db.importedExecutions.clear();
    });
    set({ sessions: [], trades: [] });
  },
}));
