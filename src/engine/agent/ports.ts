import type { CalendarEventRow } from '../calendarEvents';
import type { DeskEventPage } from './events';
import type { BarSeries } from '../bars';
import type { CashBalance, FxRate, Pocket, Position } from '../portfolio/types';
import type { Session, Trade } from '../types';

export interface DeskNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  parentId?: string;
  ancre?: string;
  question?: string;
  /** `agent` : note écrite par un agent IA. Absent : le trader. */
  by?: 'agent';
}

export interface DeskCalendarEntry {
  date: string;
  time?: string;
  kind: string;
  title: string;
  body?: string;
}

/** Vue du pont NinjaTrader et du Copieur telle que le renderer la tient (lecture seule). */
export interface DeskBridgeView {
  nt: {
    link: string;
    addonVersion: string | null;
    heartbeatLatencyMs: number | null;
    ordersOpen: boolean;
    maxContractsPerOrder: number;
    accounts: { name: string; cashValue: number; realizedPnl: number; unrealizedPnl: number; positions: { instrument: string; quantity: number; avgPrice: number }[] }[];
  } | null;
  copier: { armed: boolean; routed: number; lastRefusal: { reason: string; account: string; instrument: string; qty: number } | null } | null;
}

/** Accès desk injecté — pas de stores dans `tools.ts`. */
export interface DeskPorts {
  sessions(): Session[];
  trades(): Trade[];
  startingBalance(): number;
  planId(): string;
  /** Compte suivi par le rejeu prop de l'écran Métrique ('' = tous les comptes). */
  planAccount(): string;
  updateSession(id: string, patch: { note?: string; tags?: string[] }): Promise<void>;
  notes(): DeskNote[];
  createNote(title: string, body: string, tags: string[]): Promise<{ id: string; title: string }>;
  branchNote(parentId: string, ancre: string, question: string): Promise<{ id: string; title: string } | null>;
  linkNotes(fromId: string, toId: string, predicate: string): Promise<{ id: string } | null>;
  calendarEntries(): DeskCalendarEntry[];
  /** Lignes des sources officielles synchronisées (BLS, BEA, Fed, ECB, EIA, Treasury, instantané). */
  officialEvents(): CalendarEventRow[];
  /** État en direct du pont et du Copieur. */
  bridge(): Promise<DeskBridgeView>;
  /** Poches, positions, liquidités, taux et devise de base du Portefeuille (chargés si besoin). */
  portfolio(): Promise<{ pockets: Pocket[]; positions: Position[]; cash: CashBalance[]; fx: FxRate[]; base: string }>;
  /** Séries de barres du desk (pont NinjaTrader, CSV, démo), chargées si besoin. */
  barSeries(): Promise<BarSeries[]>;
  /** Journal des événements du lancement en cours (fills, marge prop, catalyseurs, lien du pont). */
  events(opts: { cursor?: string; kinds?: readonly string[]; limit?: number }): DeskEventPage;
  /** Propose un ordre : le process principal garde, le fait confirmer par l'opérateur, puis le soumet. */
  proposeOrder(args: Record<string, unknown>): Promise<unknown>;
}

export const BODY_MAX = 20_000;
export const TAGS_MAX = 20;
export const TAG_LEN_MAX = 40;
export const MAX_CALLS_PER_ROUND = 8;
export const MAX_WRITES_PER_ROUND = 2;

export { ORCH_READ_METHODS, ORCH_WRITE_METHODS, orchMethodAllowed } from './catalog';

export const TITLE_MAX = 200;
export const ANCRE_MAX = 500;
export const QUESTION_MAX = 200;
export const SHORT_ARG_MAX = 64;
const SHORT_ARGS = ['query', 'id', 'date', 'from', 'to', 'planId', 'account', 'instrument', 'cursor'] as const;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Borne les arguments d'outil : corps/note ≤ 20 000, titre ≤ 200, identifiants/dates/requête ≤ 64,
 * tags ≤ 20 × 40. Avec `allowedKeys` (propriétés déclarées par l'outil), tout argument non déclaré est retiré.
 */
export function clampToolArgs(args: Record<string, unknown>, allowedKeys?: readonly string[]): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (allowedKeys && !allowedKeys.includes(k)) continue;
    out[k] = v;
  }
  if (typeof out.body === 'string' && out.body.length > BODY_MAX) return { ok: false, reason: 'args_too_large' };
  if (typeof out.note === 'string' && out.note.length > BODY_MAX) return { ok: false, reason: 'args_too_large' };
  if (typeof out.title === 'string' && out.title.length > TITLE_MAX) return { ok: false, reason: 'args_too_large' };
  if (typeof out.ancre === 'string' && out.ancre.length > ANCRE_MAX) return { ok: false, reason: 'args_too_large' };
  if (typeof out.question === 'string' && out.question.length > QUESTION_MAX) return { ok: false, reason: 'args_too_large' };
  for (const k of SHORT_ARGS) {
    const v = out[k];
    if (typeof v === 'string' && v.length > SHORT_ARG_MAX) return { ok: false, reason: 'args_too_large' };
  }
  if (Array.isArray(out.tags)) {
    if (out.tags.length > TAGS_MAX) return { ok: false, reason: 'args_too_large' };
    if (out.tags.some((t) => String(t).length > TAG_LEN_MAX)) return { ok: false, reason: 'args_too_large' };
  }
  return { ok: true, args: out };
}

export function takeToolCalls<T extends { name: string }>(calls: T[], kindOf: (name: string) => 'read' | 'write'): T[] {
  let writes = 0;
  const out: T[] = [];
  for (const c of calls.slice(0, MAX_CALLS_PER_ROUND)) {
    if (kindOf(c.name) === 'write') {
      if (writes >= MAX_WRITES_PER_ROUND) continue;
      writes++;
    }
    out.push(c);
  }
  return out;
}
