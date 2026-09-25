import type { Session, Trade } from '../types';

export interface DeskNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
}

export interface DeskCalendarEntry {
  date: string;
  time?: string;
  kind: string;
  title: string;
  body?: string;
}

/** Accès desk injecté — pas de stores dans `tools.ts`. */
export interface DeskPorts {
  sessions(): Session[];
  trades(): Trade[];
  startingBalance(): number;
  planId(): string;
  updateSession(id: string, patch: { note?: string; tags?: string[] }): Promise<void>;
  notes(): DeskNote[];
  createNote(title: string, body: string, tags: string[]): Promise<{ id: string; title: string }>;
  calendarEntries(): DeskCalendarEntry[];
}

export const BODY_MAX = 20_000;
export const TAGS_MAX = 20;
export const TAG_LEN_MAX = 40;
export const MAX_CALLS_PER_ROUND = 8;
export const MAX_WRITES_PER_ROUND = 2;

export const ORCH_READ_METHODS = [
  'desk.auth',
  'desk.describe',
  'desk.ping',
  'desk_overview',
  'list_sessions',
  'get_session',
  'search_notes',
  'read_note',
  'calendar_events',
  'propfirm_status',
] as const;

export const ORCH_WRITE_METHODS = ['create_note', 'annotate_session'] as const;

export function orchMethodAllowed(method: string, allowWrites: boolean): boolean {
  const name = method.replace(/^tool\./, '');
  if ((ORCH_READ_METHODS as readonly string[]).includes(method) || (ORCH_READ_METHODS as readonly string[]).includes(name)) return true;
  if (allowWrites && (ORCH_WRITE_METHODS as readonly string[]).includes(name)) return true;
  return false;
}

export const TITLE_MAX = 200;
export const SHORT_ARG_MAX = 64;
const SHORT_ARGS = ['query', 'id', 'date', 'from', 'to', 'planId'] as const;
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
