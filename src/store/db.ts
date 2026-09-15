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

export async function restoreVault(json: string): Promise<{ sessions: number; trades: number; notes: number }> {
  const data = JSON.parse(json) as VaultFile;
  if (data.artefact !== 'CΛNTO') throw new Error('Fichier non reconnu : sauvegarde CΛNTO attendue.');
  await db.transaction('rw', [db.sessions, db.trades, db.notes, db.calendar, db.settings, db.copierAccounts, db.bots], async () => {
    if (data.sessions) await db.sessions.bulkPut(data.sessions);
    if (data.trades) await db.trades.bulkPut(data.trades);
    if (data.notes) await db.notes.bulkPut(data.notes);
    if (data.calendar) await db.calendar.bulkPut(data.calendar);
    if (data.settings) await db.settings.bulkPut(data.settings);
    if (data.copierAccounts) await db.copierAccounts.bulkPut(data.copierAccounts);
    if (data.bots) await db.bots.bulkPut(data.bots);
  });
  return { sessions: data.sessions?.length ?? 0, trades: data.trades?.length ?? 0, notes: data.notes?.length ?? 0 };
}
