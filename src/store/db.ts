import Dexie, { type EntityTable } from 'dexie';
import type { BarSeries } from '@/engine/bars';
import type { IndicatorInstance } from '@/engine/indicators';
import type { Session, Trade } from '@/engine/types';
import { desk } from '@/lib/desk';

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CalendarEntry {
  id: string;
  date: string;
  kind: 'note' | 'event';
  title: string;
  /** Heure locale 'HH:mm' pour les événements personnels */
  time?: string;
  body?: string;
  createdAt: number;
  updatedAt: number;
}

/** Publication macro (Investing / FF) persistée pour historique. */
export interface MacroReleaseRow {
  id: string;
  date: string;
  timeET?: string;
  title: string;
  currency: string;
  impact: 1 | 2 | 3;
  forecast?: string;
  previous?: string;
  actual?: string;
  period?: string;
  source: 'investing' | 'forexfactory';
  at: string;
  syncedAt: number;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolCalls?: { id: string; name: string; args: string }[];
  createdAt: number;
}

export interface CopierAccount {
  id: string;
  name: string;
  role: 'maitre' | 'suiveur';
  firm?: string;
  planId?: string;
  ntAccount: string;
  enabled: boolean;
  /** multiplicateur de taille pour les suiveurs */
  sizing: { mode: 'fixe' | 'ratio' | 'risque'; value: number; maxContracts: number };
  symbolMap: 'identique' | 'NQ→MNQ' | 'MNQ→NQ';
  createdAt: number;
}

export interface BotBlueprint {
  id: string;
  name: string;
  instrument: 'NQ' | 'MNQ';
  account?: string;
  status: 'brouillon' | 'backtest' | 'papier' | 'verrouille';
  description: string;
  rules: { id: string; kind: 'condition' | 'action' | 'garde'; text: string }[];
  createdAt: number;
  updatedAt: number;
}

export interface ChartLayout {
  id: string;
  seriesId: string | null;
  indicators: IndicatorInstance[];
}

export interface ImportedExecution {
  key: string;
  account: string;
  executionId: string;
  sessionId: string;
  importedAt: number;
}

class CantoDb extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  trades!: EntityTable<Trade, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  calendar!: EntityTable<CalendarEntry, 'id'>;
  macroReleases!: EntityTable<MacroReleaseRow, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  agentMessages!: EntityTable<AgentMessage, 'id'>;
  barSeries!: EntityTable<BarSeries, 'id'>;
  copierAccounts!: EntityTable<CopierAccount, 'id'>;
  bots!: EntityTable<BotBlueprint, 'id'>;
  importedExecutions!: EntityTable<ImportedExecution, 'key'>;

  constructor() {
    super('canto');
    this.version(1).stores({
      sessions: 'id, date, account, source',
      trades: 'id, sessionId, exitTime, instrument',
      notes: 'id, title, updatedAt, *tags',
      calendar: 'id, date, kind',
      settings: 'key',
      agentMessages: 'id, conversationId, createdAt',
      barSeries: 'id, instrument, createdAt',
      copierAccounts: 'id, role',
      bots: 'id, status, updatedAt',
    });
    this.version(2).stores({
      sessions: 'id, date, account, source',
      trades: 'id, sessionId, exitTime, instrument',
      notes: 'id, title, updatedAt, *tags',
      calendar: 'id, date, kind',
      macroReleases: 'id, date, source, impact',
      settings: 'key',
      agentMessages: 'id, conversationId, createdAt',
      barSeries: 'id, instrument, createdAt',
      copierAccounts: 'id, role',
      bots: 'id, status, updatedAt',
    });
    this.version(3).stores({
      importedExecutions: 'key, account, sessionId',
    });
  }
}

export const db = new CantoDb();

// Une autre fenêtre met le schéma à niveau : on relâche la connexion pour ne pas bloquer.
db.on('versionchange', () => {
  db.close();
  window.location.reload();
});

/** Demande au navigateur de ne pas purger le coffre sous pression de stockage. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* non supporté */
  }
  return false;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

/** Sauvegarde complète du coffre (JSON) — réimportable via `restoreVault`. */
export async function exportVault(): Promise<string> {
  const [sessions, trades, notes, calendar, settings, copierAccounts, bots] = await Promise.all([
    db.sessions.toArray(),
    db.trades.toArray(),
    db.notes.toArray(),
    db.calendar.toArray(),
    db.settings.toArray(),
    db.copierAccounts.toArray(),
    db.bots.toArray(),
  ]);
  // La clé API (clair ou blob chiffré) ne quitte jamais le coffre local.
  const safeSettings = settings.map((row) => {
    if (row.key !== 'settings') return row;
    const value = row.value as { agent?: { apiKey?: string; apiKeyEncrypted?: string } };
    if (!value.agent) return row;
    const agent = { ...value.agent, apiKey: '' };
    delete agent.apiKeyEncrypted;
    return { key: row.key, value: { ...value, agent } };
  });
  return JSON.stringify({ artefact: 'CΛNTO', version: 1, exportedAt: new Date().toISOString(), sessions, trades, notes, calendar, settings: safeSettings, copierAccounts, bots });
}

interface VaultFile {
  artefact: string;
  version: number;
  sessions?: Session[];
  trades?: Trade[];
  notes?: Note[];
  calendar?: CalendarEntry[];
  settings?: Setting[];
  copierAccounts?: CopierAccount[];
  bots?: BotBlueprint[];
}

const MAX_ROWS = 200_000;

type Check = (rec: Record<string, unknown>) => boolean;
const isStr = (v: unknown) => typeof v === 'string';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown) => Array.isArray(v) && v.every(isStr);

/** Ne conserve que des objets simples, porteurs d'une clé chaîne et conformes à leur table. */
function rows<T extends object>(input: unknown, key: 'id' | 'key', label: string, check: Check = () => true): T[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error(`Sauvegarde invalide : « ${label} » doit être une liste.`);
  if (input.length > MAX_ROWS) throw new Error(`Sauvegarde invalide : « ${label} » dépasse ${MAX_ROWS} lignes.`);
  const out: T[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec[key] !== 'string' || (rec[key] as string).length === 0 || (rec[key] as string).length > 200) continue;
    if (Object.prototype.hasOwnProperty.call(rec, '__proto__') || Object.prototype.hasOwnProperty.call(rec, 'constructor')) continue;
    if (!check(rec)) continue;
    out.push(Object.assign({}, rec) as unknown as T);
  }
  return out;
}

const CHECKS: Record<string, Check> = {
  sessions: (r) => isStr(r.date) && /^\d{4}-\d{2}-\d{2}$/.test(r.date as string) && isNum(r.pnl) && isNum(r.tradeCount) && isStrArray(r.tags) && Array.isArray(r.instruments),
  trades: (r) => isStr(r.sessionId) && isNum(r.pnl) && isNum(r.entryTime) && isNum(r.exitTime) && isNum(r.qty) && (r.direction === 'long' || r.direction === 'short') && (r.instrument === 'NQ' || r.instrument === 'MNQ'),
  notes: (r) => isStr(r.title) && isStr(r.body) && isStrArray(r.tags) && isNum(r.updatedAt),
  calendar: (r) => isStr(r.date) && isStr(r.title) && (r.kind === 'note' || r.kind === 'event'),
  settings: (r) => r.key !== 'settings' || (typeof r.value === 'object' && r.value !== null),
  copierAccounts: (r) => isStr(r.name) && (r.role === 'maitre' || r.role === 'suiveur') && typeof r.sizing === 'object' && r.sizing !== null,
  bots: (r) => isStr(r.name) && Array.isArray(r.rules) && isNum(r.updatedAt),
};

export async function restoreVault(json: string): Promise<{ sessions: number; trades: number; notes: number; apiKeyReencrypted: boolean }> {
  if (json.length > 400 * 1024 * 1024) throw new Error('Sauvegarde trop volumineuse.');
  let data: VaultFile;
  try {
    data = JSON.parse(json) as VaultFile;
  } catch {
    throw new Error('Fichier illisible : JSON invalide.');
  }
  if (!data || typeof data !== 'object' || data.artefact !== 'CΛNTO') throw new Error('Fichier non reconnu : sauvegarde CΛNTO attendue.');
  const sessions = rows<Session>(data.sessions, 'id', 'sessions', CHECKS.sessions);
  const trades = rows<Trade>(data.trades, 'id', 'trades', CHECKS.trades);
  const notes = rows<Note>(data.notes, 'id', 'notes', CHECKS.notes);
  const calendar = rows<CalendarEntry>(data.calendar, 'id', 'calendar', CHECKS.calendar);
  // Agent : on n'écrase pas URL/modèle/consigne, mais une clé en clair issue d'un coffre navigateur
  // est reprise puis re-chiffrée immédiatement sous le shell (safeStorage).
  let pendingApiKey: string | null = null;
  const settings = rows<Setting>(data.settings, 'key', 'settings', CHECKS.settings).map((row) => {
    if (row.key !== 'settings') return row;
    const value = { ...(row.value as Record<string, unknown>) };
    const agent = value.agent as { apiKey?: unknown } | undefined;
    if (agent && typeof agent.apiKey === 'string' && agent.apiKey.length > 0 && agent.apiKey.length <= 4096) {
      pendingApiKey = agent.apiKey;
    }
    delete value.agent;
    return { key: row.key, value };
  });
  const copierAccounts = rows<CopierAccount>(data.copierAccounts, 'id', 'copierAccounts', CHECKS.copierAccounts);
  const bots = rows<BotBlueprint>(data.bots, 'id', 'bots', CHECKS.bots);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const consistentTrades = trades.filter((t) => sessionIds.has(t.sessionId));
  let apiKeyReencrypted = false;
  await db.transaction('rw', [db.sessions, db.trades, db.notes, db.calendar, db.settings, db.copierAccounts, db.bots], async () => {
    if (sessions.length) {
      await db.sessions.clear();
      await db.trades.clear();
      await db.sessions.bulkPut(sessions);
      await db.trades.bulkPut(consistentTrades);
    }
    if (notes.length) {
      await db.notes.clear();
      await db.notes.bulkPut(notes);
    }
    if (calendar.length) {
      await db.calendar.clear();
      await db.calendar.bulkPut(calendar);
    }
    for (const row of settings) {
      if (row.key === 'settings') {
        const current = (await db.settings.get('settings'))?.value as Record<string, unknown> | undefined;
        await db.settings.put({ key: 'settings', value: { ...(current ?? {}), ...(row.value as Record<string, unknown>), agent: current?.agent } });
      } else await db.settings.put(row);
    }
    if (pendingApiKey) {
      const current = ((await db.settings.get('settings'))?.value as Record<string, unknown> | undefined) ?? {};
      const prevAgent = (current.agent as Record<string, unknown> | undefined) ?? {};
      const agentRest = { ...prevAgent };
      delete agentRest.apiKeyEncrypted;
      let agent: Record<string, unknown> = { ...agentRest, apiKey: pendingApiKey };
      if (desk?.secrets) {
        const payload = await desk.secrets.encrypt(pendingApiKey);
        if (payload) {
          agent = { ...agentRest, apiKey: '', apiKeyEncrypted: payload };
          apiKeyReencrypted = true;
        }
      }
      await db.settings.put({ key: 'settings', value: { ...current, agent } });
    }
    if (copierAccounts.length) {
      await db.copierAccounts.clear();
      await db.copierAccounts.bulkPut(copierAccounts);
    }
    if (bots.length) {
      await db.bots.clear();
      await db.bots.bulkPut(bots);
    }
  });
  return { sessions: sessions.length, trades: consistentTrades.length, notes: notes.length, apiKeyReencrypted };
}
