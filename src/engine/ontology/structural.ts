import type { CalendarEventRow } from '@/engine/calendarEvents';
import { getInstrument, hasInstrument, resolveSymbol, tradingDayOf } from '@/engine/instruments';
import type { Session, Trade } from '@/engine/types';
import { parseNoteHeader, slugifyTitle } from './header';
import { linkId, type EntityRef, type Link, type Predicate } from './schema';
import { proseOf } from './text';

export interface OntologyNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export type OntologyEvent = Pick<CalendarEventRow, 'id' | 'date' | 'title' | 'impact' | 'instruments'>;

export interface StructuralInput {
  notes: readonly OntologyNote[];
  sessions: readonly Session[];
  trades: readonly Trade[];
  events: readonly OntologyEvent[];
  /** Symboles du registre reconnus dans le corps. Toute valeur vient de ce tableau, pas d'une constante. */
  instruments: readonly string[];
}

const TITLE_DATE = /^(\d{4}-\d{2}-\d{2})(?!\d)/;

/** Journée de trading portée par l'en-tête `date:`, sinon par un titre qui commence par `YYYY-MM-DD`. */
export function noteTradingDay(note: OntologyNote): string | null {
  const header = parseNoteHeader(note.body);
  if (header.date) return header.date;
  return TITLE_DATE.exec(note.title.trim())?.[1] ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Symboles du registre cités hors blocs de code.
 * `resolveSymbol` reconnaît la racine et le mois (`MNQ`, `NQZ6`, `MNQ 12-26`).
 * L'ordre longueur décroissante est celui de `resolveSymbol` : MNQ n'est pas lu comme NQ.
 */
export function mentionedSymbols(body: string, instruments: readonly string[]): string[] {
  const allowed = new Set(instruments.map((s) => s.toUpperCase()));
  if (allowed.size === 0) return [];
  const parts = proseOf(body)
    .split(/[^\p{L}\p{N}\-]+/u)
    .filter((p) => p.length > 0);
  const found = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i] ?? '';
    const one = resolveSymbol(token);
    if (one && allowed.has(one.symbol)) found.add(one.symbol);
    const next = parts[i + 1];
    if (!next) continue;
    const two = resolveSymbol(`${token} ${next}`);
    if (two && allowed.has(two.symbol)) found.add(two.symbol);
  }
  return [...found].sort();
}

/**
 * Nom de compte en limite de mot. En dessous de 3 caractères la casse est respectée :
 * un compte « a » ne doit pas happer l'article.
 */
export function mentionsAccount(prose: string, account: string): boolean {
  const name = account.trim();
  if (name.length < 2) return false;
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, name.length < 3 ? '' : 'i');
  return re.test(prose);
}

interface StrategyHit {
  id: string;
  alias: string;
}

function strategyIndex(notes: readonly OntologyNote[]): StrategyHit[] {
  const out: StrategyHit[] = [];
  for (const note of notes) {
    if (!note.tags.some((t) => t.toLowerCase() === 'strategie')) continue;
    const header = parseNoteHeader(note.body);
    const alias = (header.tag ?? slugifyTitle(note.title)).toLowerCase();
    if (!alias) continue;
    out.push({ id: note.id, alias });
  }
  return out;
}

function lowerTags(tags: readonly string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.toLowerCase());
}

function noteLike(ref: EntityRef): boolean {
  return ref.type === 'note' || ref.type === 'strategie';
}

function put(bag: Map<string, Link>, from: EntityRef, predicate: Predicate, to: EntityRef): void {
  if (from.type === to.type && from.id === to.id) return;
  if (from.id === to.id && noteLike(from) && noteLike(to)) return;
  const id = linkId(from, predicate, to);
  if (bag.has(id)) return;
  bag.set(id, { id, from, to, predicate, kind: 'structurel', by: 'moteur', createdAt: 0, updatedAt: 0 });
}

function eventCovers(instruments: readonly string[], symbol: string): boolean {
  if (instruments.length === 0) return true;
  const want = symbol.toUpperCase();
  return instruments.some((s) => s.toUpperCase() === want);
}

function eventCoversNote(instruments: readonly string[], mentioned: readonly string[]): boolean {
  if (instruments.length === 0 || mentioned.length === 0) return true;
  const set = new Set(mentioned.map((s) => s.toUpperCase()));
  return instruments.some((s) => set.has(s.toUpperCase()));
}

/**
 * Liens déterministes. `createdAt` reste 0 : `reconcileStructural` horodate les liens neufs.
 * Les publications avant 18:00 ET partagent la date civile du calendrier et la journée Globex.
 */
export function deriveStructuralLinks(input: StructuralInput): Link[] {
  const bag = new Map<string, Link>();
  const sessionsByDate = new Map<string, Session[]>();
  for (const session of input.sessions) {
    const list = sessionsByDate.get(session.date);
    if (list) list.push(session);
    else sessionsByDate.set(session.date, [session]);
  }
  const eventsByDate = new Map<string, OntologyEvent[]>();
  for (const event of input.events) {
    if (event.impact < 2) continue;
    const list = eventsByDate.get(event.date);
    if (list) list.push(event);
    else eventsByDate.set(event.date, [event]);
  }
  const strategies = strategyIndex(input.notes);
  const byAlias = new Map<string, string[]>();
  for (const strategy of strategies) {
    const list = byAlias.get(strategy.alias);
    if (list) list.push(strategy.id);
    else byAlias.set(strategy.alias, [strategy.id]);
  }
  const accounts = [...new Set(input.sessions.map((s) => s.account?.trim() ?? '').filter((a) => a.length >= 2))];

  for (const note of input.notes) {
    const from: EntityRef = { type: 'note', id: note.id };
    const mentioned = mentionedSymbols(note.body, input.instruments);
    const day = noteTradingDay(note);
    if (day) {
      for (const session of sessionsByDate.get(day) ?? []) {
        put(bag, from, 'de-la-seance', { type: 'session', id: session.id });
      }
      for (const event of eventsByDate.get(day) ?? []) {
        if (!eventCoversNote(event.instruments, mentioned)) continue;
        put(bag, from, 'pendant', { type: 'evenement', id: event.id });
      }
    }
    for (const symbol of mentioned) put(bag, from, 'mentionne', { type: 'instrument', id: symbol });
    for (const tag of lowerTags(note.tags)) {
      for (const id of byAlias.get(tag) ?? []) put(bag, from, 'mentionne', { type: 'strategie', id });
    }
    if (accounts.length > 0) {
      const prose = proseOf(note.body);
      for (const account of accounts) {
        if (mentionsAccount(prose, account)) put(bag, from, 'mentionne', { type: 'compte', id: account });
      }
    }
  }

  for (const session of input.sessions) {
    for (const tag of lowerTags(session.tags)) {
      for (const id of byAlias.get(tag) ?? []) {
        put(bag, { type: 'session', id: session.id }, 'applique', { type: 'strategie', id });
      }
    }
  }

  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  for (const trade of input.trades) {
    const from: EntityRef = { type: 'trade', id: trade.id };
    const session = sessionById.get(trade.sessionId);
    let day: string | null = null;
    if (session) {
      put(bag, from, 'de-la-seance', { type: 'session', id: session.id });
      day = session.date;
    } else if (hasInstrument(trade.instrument)) {
      day = tradingDayOf(trade.exitTime, getInstrument(trade.instrument));
    }
    if (day) {
      for (const event of eventsByDate.get(day) ?? []) {
        if (!eventCovers(event.instruments, trade.instrument)) continue;
        put(bag, from, 'pendant', { type: 'evenement', id: event.id });
        if (session) put(bag, { type: 'session', id: session.id }, 'pendant', { type: 'evenement', id: event.id });
      }
    }
    for (const tag of lowerTags(trade.tags)) {
      for (const id of byAlias.get(tag) ?? []) put(bag, from, 'applique', { type: 'strategie', id });
    }
  }

  return [...bag.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ajoute les structurels manquants, retire ceux qui n'ont plus de base.
 * Ne modifie jamais un lien `affirme`, `hypothese` ou `rejete` — même identifiant compris.
 * Deux passages sur le même couple `(existant, dérivé)` donnent le même tableau.
 */
export function reconcileStructural(existing: readonly Link[], derived: readonly Link[], now = 0): Link[] {
  const derivedIds = new Set(derived.map((l) => l.id));
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const link of existing) {
    if (link.kind !== 'structurel') {
      out.push(link);
      seen.add(link.id);
      continue;
    }
    if (!derivedIds.has(link.id)) continue;
    out.push(link);
    seen.add(link.id);
  }
  for (const link of derived) {
    if (seen.has(link.id)) continue;
    out.push({ ...link, createdAt: now, updatedAt: now });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
