import Dexie, { type EntityTable } from 'dexie';
import type { BarSeries } from '@/engine/bars';
import type { IndicatorInstance } from '@/engine/indicators';
import type { Session, Trade } from '@/engine/types';
import { buildVaultV2, parseVaultJson, stripSecrets } from '@/engine/vault';
import { tr } from '@/i18n';
import { desk } from '@/lib/desk';
import { withJournalLock } from './lock';
import { mergeRestoredSettings, pickRestorableSettings } from './settings';
import pkg from '../../package.json';

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

/** Sauvegarde coffre JSON v2. `includeHeavy` (défaut false) ajoute barres + messages agent. */
export async function exportVault(opts?: { includeHeavy?: boolean }): Promise<string> {
  const includeHeavy = opts?.includeHeavy === true;
  const [sessions, trades, notes, calendar, settings, copierAccounts, bots, macroReleases, barSeries, agentMessages] = await Promise.all([
    db.sessions.toArray(),
    db.trades.toArray(),
    db.notes.toArray(),
    db.calendar.toArray(),
    db.settings.toArray(),
    db.copierAccounts.toArray(),
    db.bots.toArray(),
    db.macroReleases.toArray(),
    includeHeavy ? db.barSeries.toArray() : Promise.resolve([]),
    includeHeavy ? db.agentMessages.toArray() : Promise.resolve([]),
  ]);
  const settingsObj = settings.find((row) => row.key === 'settings')?.value;
  return JSON.stringify(
    buildVaultV2({
      appVersion: pkg.version,
      sessions,
      trades,
      notes,
      calendarNotes: calendar,
      bots,
      copier: copierAccounts,
      settings: settingsObj,
      macroReleases,
      includeHeavy,
      barSeries: includeHeavy ? barSeries : undefined,
      agentMessages: includeHeavy ? agentMessages : undefined,
    }),
  );
}

const MAX_ROWS = 200_000;
const MAX_BARS = 200_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

type Check = (rec: Record<string, unknown>) => boolean;
const isStr = (v: unknown, max = Infinity): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v: unknown, maxLen = Infinity, maxItem = Infinity): v is string[] => Array.isArray(v) && v.length <= maxLen && v.every((s) => isStr(s, maxItem));
const isEnum = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);
const opt = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || check(v);
const isDate = (v: unknown): v is string => isStr(v, 10) && DATE_RE.test(v);

const INSTRUMENT_VALUES = ['NQ', 'MNQ'] as const;
const SESSION_SOURCES = ['ninjatrader', 'csv', 'manuel', 'demo'] as const;
const BOT_STATUSES = ['brouillon', 'backtest', 'papier', 'verrouille'] as const;
const RULE_KINDS = ['condition', 'action', 'garde'] as const;
const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
const MACRO_SOURCES = ['investing', 'forexfactory'] as const;
const SIZING_MODES = ['fixe', 'ratio', 'risque'] as const;
const SYMBOL_MAPS = ['identique', 'NQ→MNQ', 'MNQ→NQ'] as const;

export type SkippedRows = Record<string, number>;

/** Ne conserve que des objets simples, porteurs d'une clé chaîne et conformes à leur table. Les lignes invalides sont comptées, pas levées. */
function rows<T extends object>(input: unknown, key: 'id' | 'key', label: string, check: Check, skipped: SkippedRows): T[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error(tr(`Sauvegarde invalide : « ${label} » doit être une liste.`, `Invalid backup: “${label}” must be a list.`, `Copia inválida: « ${label} » debe ser una lista.`));
  if (input.length > MAX_ROWS) throw new Error(tr(`Sauvegarde invalide : « ${label} » dépasse ${MAX_ROWS} lignes.`, `Invalid backup: “${label}” exceeds ${MAX_ROWS} rows.`, `Copia inválida: « ${label} » supera ${MAX_ROWS} filas.`));
  const out: T[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of input) {
    if (!isRec(item)) {
      dropped++;
      continue;
    }
    const rec = item;
    const id = rec[key];
    if (typeof id !== 'string' || id.length === 0 || id.length > 200 || seen.has(id)) {
      dropped++;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(rec, '__proto__') || Object.prototype.hasOwnProperty.call(rec, 'constructor')) {
      dropped++;
      continue;
    }
    if (!check(rec)) {
      dropped++;
      continue;
    }
    seen.add(id);
    out.push(Object.assign({}, rec) as unknown as T);
  }
  if (dropped) skipped[label] = (skipped[label] ?? 0) + dropped;
  return out;
}

const isBar = (b: unknown): boolean => isRec(b) && isNum(b.time) && isNum(b.open) && isNum(b.high) && isNum(b.low) && isNum(b.close) && isNum(b.volume);
const isRule = (r: unknown): boolean => isRec(r) && isStr(r.id, 200) && isEnum(r.kind, RULE_KINDS) && isStr(r.text, 500);
const isToolCall = (c: unknown): boolean => isRec(c) && isStr(c.id, 200) && isStr(c.name, 100) && isStr(c.args, 100_000);

const CHECKS: Record<string, Check> = {
  sessions: (r) =>
    isDate(r.date) &&
    opt(r.account, (v) => isStr(v, 64)) &&
    opt(r.tags, (v) => isStrArray(v, 50, 40)) &&
    opt(r.note, (v) => isStr(v, 20_000)) &&
    opt(r.rating, (v) => isInt(v, 1, 5)) &&
    opt(r.source, (v) => isEnum(v, SESSION_SOURCES)) &&
    opt(r.instruments, (v) => Array.isArray(v) && v.length <= 8 && v.every((x) => isEnum(x, INSTRUMENT_VALUES))) &&
    opt(r.executionIds, (v) => isStrArray(v, 10_000, 200)) &&
    opt(r.contractMonth, (v) => isStr(v, 16)),
  trades: (r) =>
    isStr(r.sessionId, 200) &&
    isEnum(r.direction, ['long', 'short'] as const) &&
    isEnum(r.instrument, INSTRUMENT_VALUES) &&
    isInt(r.qty, 1, 10_000) &&
    inRange(r.entryPrice, 0, 1e6) &&
    inRange(r.exitPrice, 0, 1e6) &&
    inRange(r.pnl, -1e7, 1e7) &&
    isNum(r.entryTime) &&
    isNum(r.exitTime) &&
    r.entryTime <= r.exitTime &&
    opt(r.commission, (v) => inRange(v, 0, 1e7)) &&
    opt(r.mae, isNum) &&
    opt(r.mfe, isNum) &&
    opt(r.risk, isNum) &&
    opt(r.account, (v) => isStr(v, 64)) &&
    opt(r.strategy, (v) => isStr(v, 200)) &&
    opt(r.entryName, (v) => isStr(v, 200)) &&
    opt(r.exitName, (v) => isStr(v, 200)) &&
    opt(r.tags, (v) => isStrArray(v, 50, 40)) &&
    opt(r.executionIds, (v) => isStrArray(v, 64, 200)) &&
    opt(r.orderIds, (v) => isStrArray(v, 64, 200)) &&
    opt(r.contractMonth, (v) => isStr(v, 16)),
  notes: (r) => isStr(r.title, 200) && isStr(r.body, 1_000_000) && isStrArray(r.tags, 100, 80) && isNum(r.updatedAt) && opt(r.createdAt, isNum) && opt(r.pinned, isBool),
  calendar: (r) => isDate(r.date) && isStr(r.title, 200) && isEnum(r.kind, ['note', 'event'] as const) && opt(r.time, (v) => isStr(v, 5) && TIME_RE.test(v)) && opt(r.body, (v) => isStr(v, 20_000)),
  settings: (r) => r.key !== 'settings' || isRec(r.value),
  copierAccounts: (r) =>
    isStr(r.name, 120) &&
    isEnum(r.role, ['maitre', 'suiveur'] as const) &&
    isStr(r.ntAccount, 64) &&
    isBool(r.enabled) &&
    isRec(r.sizing) &&
    isEnum(r.sizing.mode, SIZING_MODES) &&
    inRange(r.sizing.value, 0, 1e6) &&
    inRange(r.sizing.maxContracts, 0, 10_000) &&
    isEnum(r.symbolMap, SYMBOL_MAPS) &&
    opt(r.firm, (v) => isStr(v, 120)) &&
    opt(r.planId, (v) => isStr(v, 64)),
  bots: (r) =>
    isStr(r.name, 120) &&
    isEnum(r.status, BOT_STATUSES) &&
    isEnum(r.instrument, INSTRUMENT_VALUES) &&
    isStr(r.description, 20_000) &&
    Array.isArray(r.rules) &&
    r.rules.length <= 200 &&
    r.rules.every(isRule) &&
    isNum(r.updatedAt) &&
    opt(r.account, (v) => isStr(v, 64)),
  macroReleases: (r) =>
    isDate(r.date) &&
    isStr(r.title, 200) &&
    isStr(r.currency, 16) &&
    (r.impact === 1 || r.impact === 2 || r.impact === 3) &&
    isNum(r.syncedAt) &&
    isEnum(r.source, MACRO_SOURCES) &&
    isStr(r.at, 64) &&
    opt(r.timeET, (v) => isStr(v, 16)),
  barSeries: (r) =>
    isEnum(r.instrument, INSTRUMENT_VALUES) &&
    inRange(r.timeframe, 1, 100_000) &&
    isStr(r.label, 200) &&
    isEnum(r.source, ['demo', 'csv'] as const) &&
    isNum(r.createdAt) &&
    Array.isArray(r.bars) &&
    r.bars.length <= MAX_BARS &&
    r.bars.every(isBar),
  agentMessages: (r) =>
    isStr(r.conversationId, 200) &&
    isEnum(r.role, MESSAGE_ROLES) &&
    isStr(r.content, 200_000) &&
    isNum(r.createdAt) &&
    opt(r.toolName, (v) => isStr(v, 100)) &&
    opt(r.toolCalls, (v) => Array.isArray(v) && v.length <= 64 && v.every(isToolCall)),
};

/**
 * Autres lignes de la table `settings` acceptées depuis un coffre v1 : clés connues de l'app seulement,
 * chacune assainie (retourne `undefined` pour rejeter la ligne).
 */
const SETTING_ROW_SANITIZERS: Record<string, (v: unknown) => unknown> = {
  'agent.conversation': (v) => (isStr(v, 64) && v.length > 0 ? v : undefined),
  'chart.active': (v) => (v === null || isStr(v, 200) ? v : undefined),
  'chart.indicators': (v) => {
    if (!Array.isArray(v) || v.length > 50) return undefined;
    const ok = v.every((i) => isRec(i) && isStr(i.id, 100) && isStr(i.definitionId, 100) && isBool(i.visible) && isRec(i.params) && Object.values(i.params).every((p) => isNum(p) || isStr(p, 100)));
    return ok ? v.map((i) => ({ id: i.id, definitionId: i.definitionId, visible: i.visible, params: { ...i.params } })) : undefined;
  },
  'copier.config': (v) => {
    if (!isRec(v)) return undefined;
    const out: Record<string, unknown> = {};
    if (isBool(v.enabled)) out.enabled = v.enabled;
    if (inRange(v.latencyBudgetMs, 0, 60_000)) out.latencyBudgetMs = v.latencyBudgetMs;
    if (isBool(v.copyStops)) out.copyStops = v.copyStops;
    if (isBool(v.copyTargets)) out.copyTargets = v.copyTargets;
    if (isBool(v.newsBlackout)) out.newsBlackout = v.newsBlackout;
    if (isStr(v.windowStart, 5) && TIME_RE.test(v.windowStart)) out.windowStart = v.windowStart;
    if (isStr(v.windowEnd, 5) && TIME_RE.test(v.windowEnd)) out.windowEnd = v.windowEnd;
    if (inRange(v.followerBufferFloor, 0, 1)) out.followerBufferFloor = v.followerBufferFloor;
    if (isEnum(v.channel, ['stable', 'beta'] as const)) out.channel = v.channel;
    return out;
  },
};

function coerceSessions(list: Session[]): Session[] {
  const now = Date.now();
  return list.map((s) => ({
    ...s,
    tags: Array.isArray(s.tags) ? s.tags : [],
    tradeCount: isNum(s.tradeCount) ? s.tradeCount : 0,
    pnl: isNum(s.pnl) ? s.pnl : 0,
    grossProfit: isNum(s.grossProfit) ? s.grossProfit : 0,
    grossLoss: isNum(s.grossLoss) ? s.grossLoss : 0,
    commission: isNum(s.commission) ? s.commission : 0,
    instruments: Array.isArray(s.instruments) ? s.instruments : [],
    source: s.source ?? 'csv',
    createdAt: isNum(s.createdAt) ? s.createdAt : now,
    updatedAt: isNum(s.updatedAt) ? s.updatedAt : now,
  }));
}

export interface PreparedVault {
  sessions: Session[];
  trades: Trade[];
  notes: Note[];
  calendar: CalendarEntry[];
  /** Réglages restaurables (allowlist appliquée), à fusionner sur les réglages courants. `null` si absent. */
  settingsPatch: Record<string, unknown> | null;
  /** Clé API en clair trouvée dans un coffre navigateur v1 (re-chiffrée à la restauration). */
  pendingApiKey: string | null;
  /** Autres lignes `settings` (clés connues seulement, assainies). */
  otherSettings: Setting[];
  copierAccounts: CopierAccount[];
  bots: BotBlueprint[];
  macroReleases: MacroReleaseRow[];
  barSeries: BarSeries[];
  agentMessages: AgentMessage[];
  skipped: SkippedRows;
}

/** Analyse et valide un coffre JSON sans toucher la base : chaque table est filtrée, les réglages passés à l'allowlist. */
export function prepareVaultRestore(json: string): PreparedVault {
  if (json.length > 400 * 1024 * 1024) throw new Error(tr('Sauvegarde trop volumineuse.', 'Backup too large.', 'Copia demasiado grande.'));
  const parsed = parseVaultJson(json);
  const skipped: SkippedRows = {};
  const sessions = coerceSessions(rows<Session>(parsed.sessions, 'id', 'sessions', CHECKS.sessions!, skipped));
  const trades = rows<Trade>(parsed.trades, 'id', 'trades', CHECKS.trades!, skipped);
  const notes = rows<Note>(parsed.notes, 'id', 'notes', CHECKS.notes!, skipped);
  const calendar = rows<CalendarEntry>(parsed.calendar, 'id', 'calendar', CHECKS.calendar!, skipped);
  // Réglages : allowlist stricte (jamais orchestrateur, dossier/chiffrement de sauvegarde, canal de mise à
  // jour, hôtes LLM ni secrets) ; une clé en clair issue d'un coffre navigateur v1 est reprise puis re-chiffrée.
  let pendingApiKey: string | null = null;
  let settingsPatch: Record<string, unknown> | null = null;
  const otherSettings: Setting[] = [];
  if (parsed.settingsIsObject) {
    settingsPatch = pickRestorableSettings(stripSecrets(parsed.settings));
  } else if (parsed.settings !== undefined && parsed.settings !== null) {
    for (const row of rows<Setting>(parsed.settings, 'key', 'settings', CHECKS.settings!, skipped)) {
      if (row.key === 'settings') {
        const value = row.value as Record<string, unknown>;
        const agent = value.agent;
        if (isRec(agent) && typeof agent.apiKey === 'string' && agent.apiKey.length > 0 && agent.apiKey.length <= 4096) pendingApiKey = agent.apiKey;
        settingsPatch = pickRestorableSettings(value);
        continue;
      }
      const sanitize = Object.prototype.hasOwnProperty.call(SETTING_ROW_SANITIZERS, row.key) ? SETTING_ROW_SANITIZERS[row.key] : undefined;
      const value = sanitize ? sanitize(row.value) : undefined;
      if (value === undefined) {
        skipped.settings = (skipped.settings ?? 0) + 1;
        continue;
      }
      otherSettings.push({ key: row.key, value });
    }
  }
  const copierAccounts = rows<CopierAccount>(parsed.copier, 'id', 'copierAccounts', CHECKS.copierAccounts!, skipped);
  const bots = rows<BotBlueprint>(parsed.bots, 'id', 'bots', CHECKS.bots!, skipped);
  const macroReleases = rows<MacroReleaseRow>(parsed.macroReleases, 'id', 'macroReleases', CHECKS.macroReleases!, skipped);
  const barSeries = rows<BarSeries>(parsed.barSeries, 'id', 'barSeries', CHECKS.barSeries!, skipped);
  const agentMessages = rows<AgentMessage>(parsed.agentMessages, 'id', 'agentMessages', CHECKS.agentMessages!, skipped);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const consistentTrades = trades.filter((t) => sessionIds.has(t.sessionId));
  if (consistentTrades.length !== trades.length) skipped.trades = (skipped.trades ?? 0) + (trades.length - consistentTrades.length);
  return { sessions, trades: consistentTrades, notes, calendar, settingsPatch, pendingApiKey, otherSettings, copierAccounts, bots, macroReleases, barSeries, agentMessages, skipped };
}

export interface RestoreSummary {
  sessions: number;
  trades: number;
  notes: number;
  apiKeyReencrypted: boolean;
  /** Lignes ignorées car invalides, toutes tables confondues. */
  skipped: number;
  skippedByTable: SkippedRows;
}

export function restoreVault(json: string): Promise<RestoreSummary> {
  const v = prepareVaultRestore(json);
  // Sous le verrou journal : aucun import CSV (pont ou manuel) ne s'intercale entre la lecture et l'écriture.
  return withJournalLock(async () => {
    let apiKeyReencrypted = false;
    await db.transaction(
      'rw',
      [db.sessions, db.trades, db.importedExecutions, db.notes, db.calendar, db.settings, db.copierAccounts, db.bots, db.macroReleases, db.barSeries, db.agentMessages],
      async () => {
        if (v.sessions.length) {
          await db.sessions.clear();
          await db.trades.clear();
          // Les exécutions « connues » se rapportent aux séances remplacées : sans purge, les trades
          // d'une sauvegarde plus ancienne ne seraient jamais ré-importés depuis le pont.
          await db.importedExecutions.clear();
          await db.sessions.bulkPut(v.sessions);
          await db.trades.bulkPut(v.trades);
        }
        if (v.notes.length) {
          await db.notes.clear();
          await db.notes.bulkPut(v.notes);
        }
        if (v.calendar.length) {
          await db.calendar.clear();
          await db.calendar.bulkPut(v.calendar);
        }
        if (v.settingsPatch) {
          const current = (await db.settings.get('settings'))?.value;
          await db.settings.put({ key: 'settings', value: mergeRestoredSettings(current, v.settingsPatch) });
        }
        for (const row of v.otherSettings) await db.settings.put(row);
        if (v.pendingApiKey) {
          const current = ((await db.settings.get('settings'))?.value as Record<string, unknown> | undefined) ?? {};
          const prevAgent = isRec(current.agent) ? current.agent : {};
          const agentRest = { ...prevAgent };
          delete agentRest.apiKeyEncrypted;
          let agent: Record<string, unknown> = { ...agentRest, apiKey: v.pendingApiKey };
          if (desk?.secrets) {
            const payload = await desk.secrets.encrypt(v.pendingApiKey);
            if (payload) {
              agent = { ...agentRest, apiKey: '', apiKeyEncrypted: payload };
              apiKeyReencrypted = true;
            } else {
              // Trousseau indisponible sous le shell : la clé en clair n'est pas écrite.
              agent = agentRest;
            }
          }
          await db.settings.put({ key: 'settings', value: { ...current, agent } });
        }
        if (v.copierAccounts.length) {
          await db.copierAccounts.clear();
          await db.copierAccounts.bulkPut(v.copierAccounts);
        }
        if (v.bots.length) {
          await db.bots.clear();
          await db.bots.bulkPut(v.bots);
        }
        if (v.macroReleases.length) {
          await db.macroReleases.clear();
          await db.macroReleases.bulkPut(v.macroReleases);
        }
        if (v.barSeries.length) {
          await db.barSeries.clear();
          await db.barSeries.bulkPut(v.barSeries);
        }
        if (v.agentMessages.length) {
          await db.agentMessages.clear();
          await db.agentMessages.bulkPut(v.agentMessages);
        }
      },
    );
    const skipped = Object.values(v.skipped).reduce((a, b) => a + b, 0);
    return { sessions: v.sessions.length, trades: v.trades.length, notes: v.notes.length, apiKeyReencrypted, skipped, skippedByTable: v.skipped };
  });
}
