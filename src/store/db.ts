import Dexie, { type EntityTable } from 'dexie';
import type { BarSeries } from '@/engine/bars';
import type { IndicatorInstance } from '@/engine/indicators';
import type { Session, Trade } from '@/engine/types';

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

class CantoDb extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  trades!: EntityTable<Trade, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  calendar!: EntityTable<CalendarEntry, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  agentMessages!: EntityTable<AgentMessage, 'id'>;
  barSeries!: EntityTable<BarSeries, 'id'>;
  copierAccounts!: EntityTable<CopierAccount, 'id'>;
  bots!: EntityTable<BotBlueprint, 'id'>;

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
  }
}

export const db = new CantoDb();

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
  return JSON.stringify({ artefact: 'CΛNTO', version: 1, exportedAt: new Date().toISOString(), sessions, trades, notes, calendar, settings, copierAccounts, bots });
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

/** Ne conserve que des objets simples porteurs d'une clé chaîne : écarte prototypes et valeurs parasites. */
function rows<T extends object>(input: unknown, key: 'id' | 'key', label: string): T[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error(`Sauvegarde invalide : « ${label} » doit être une liste.`);
  if (input.length > MAX_ROWS) throw new Error(`Sauvegarde invalide : « ${label} » dépasse ${MAX_ROWS} lignes.`);
  const out: T[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec[key] !== 'string' || (rec[key] as string).length === 0 || (rec[key] as string).length > 200) continue;
    if ('__proto__' in rec || 'constructor' in rec) continue;
    out.push({ ...rec } as T);
  }
  return out;
}

export async function restoreVault(json: string): Promise<{ sessions: number; trades: number; notes: number }> {
  if (json.length > 400 * 1024 * 1024) throw new Error('Sauvegarde trop volumineuse.');
  let data: VaultFile;
  try {
    data = JSON.parse(json) as VaultFile;
  } catch {
    throw new Error('Fichier illisible : JSON invalide.');
  }
  if (!data || typeof data !== 'object' || data.artefact !== 'CΛNTO') throw new Error('Fichier non reconnu : sauvegarde CΛNTO attendue.');
  const sessions = rows<Session>(data.sessions, 'id', 'sessions');
  const trades = rows<Trade>(data.trades, 'id', 'trades');
  const notes = rows<Note>(data.notes, 'id', 'notes');
  const calendar = rows<CalendarEntry>(data.calendar, 'id', 'calendar');
  const settings = rows<Setting>(data.settings, 'key', 'settings');
  const copierAccounts = rows<CopierAccount>(data.copierAccounts, 'id', 'copierAccounts');
  const bots = rows<BotBlueprint>(data.bots, 'id', 'bots');
  await db.transaction('rw', [db.sessions, db.trades, db.notes, db.calendar, db.settings, db.copierAccounts, db.bots], async () => {
    if (sessions.length) await db.sessions.bulkPut(sessions);
    if (trades.length) await db.trades.bulkPut(trades);
    if (notes.length) await db.notes.bulkPut(notes);
    if (calendar.length) await db.calendar.bulkPut(calendar);
    if (settings.length) await db.settings.bulkPut(settings);
    if (copierAccounts.length) await db.copierAccounts.bulkPut(copierAccounts);
    if (bots.length) await db.bots.bulkPut(bots);
  });
  return { sessions: sessions.length, trades: trades.length, notes: notes.length };
}
