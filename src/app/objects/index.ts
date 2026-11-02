import { useMemo } from 'react';
import type { GlyphName } from '@/design/Micro';
import { TYPE_GLYPH } from '@/design/micro/meaning';
import type { CalEvent } from '@/engine/calendar';
import { getInstrument, hasInstrument } from '@/engine/instruments';
import { catalystSource, yearsSpanned } from '@/engine/macroMerge';
import { noteTradingDay, type EntityRef, type EntityType, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n, type Locale } from '@/i18n';
import { publicationInstant, strokeOf, type Stroke } from '@/lib/calendarMarks';
import { trEventTitle } from '@/lib/eventTitles';
import { fmtInt, fmtUsd } from '@/lib/format';
import { addDays, dateKeyLocal, dateTimeFormatter, ET_ZONE, etDateKey } from '@/lib/time';
import { useCrypto } from '@/store/crypto';
import type { Note } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import type { TabId } from '@/store/ui';
import { tabCopy, TABS } from '../tabs';

/**
 * L'index des objets du desk (OROS5.15, Système 5 « Fiche et Frise » ; repris de d1, corrigé par le juge Palantir) : ce
 * que Ctrl+J cherche. Construit dans le renderer, depuis les stores, sans réseau : les modules (le rail), les séances et
 * les trades du journal, les notes et les stratégies du coffre de notes, les catalyseurs de la source unique du Calendrier
 * (OROS5.13), les instruments et les comptes du journal et des liens de l'ontologie. Huit groupes, cinq résultats chacun ;
 * l'année se dit quand elle n'est pas l'année en cours, « ≈ » marque un estimé, le trait d'état ouvre la ligne ; le tri
 * suit la proximité de la date cherchée, ou d'aujourd'hui ; les catalyseurs sont bornés à la fenêtre de la fiche.
 *
 * La liste des commandes est fermée : chaque résultat ouvre un module ou la fiche d'un objet, rien d'autre. Rien ici
 * n'écrit : les stores ne sont que lus, par leurs données.
 */

/** Les huit groupes de l'omnibar, dans l'ordre de lecture. */
export const OMNI_GROUPS = ['module', 'session', 'trade', 'note', 'evenement', 'instrument', 'strategie', 'compte'] as const;
export type OmniGroup = (typeof OMNI_GROUPS)[number];

/** La liste fermée des commandes : naviguer seulement, vers un module ou vers la fiche d'un objet. */
export const OMNIBAR_COMMANDS = Object.freeze(['tab', 'object'] as const);
export type OmniCommand = (typeof OMNIBAR_COMMANDS)[number];
export type OmniTarget = { kind: 'tab'; tab: TabId } | { kind: 'object'; ref: EntityRef };

/** Le trait d'état d'une ligne, une classe de la table d'états (`src/design/etat.module.css`). */
export type EtatStroke = 'plein' | 'tirete' | 'pointille' | 'eteint';

/** Le trait d'une publication dans la table d'états : publiée pleine, prévue tiretée, au-delà de l'horizon pointillée. */
export const STROKE_ETAT: Readonly<Record<Stroke, EtatStroke>> = { publie: 'plein', prevu: 'tirete', horizon: 'pointille' };

export interface OmniItem {
  /** `${groupe}:${identifiant}` : unique dans l'index. */
  key: string;
  group: OmniGroup;
  glyph: GlyphName;
  title: string;
  meta?: string;
  /** Le signe d'un P&L : menthe ou braise. */
  tone?: 'pos' | 'neg';
  stroke: EtatStroke;
  /** La date de l'objet (`YYYY-MM-DD`) : le tri par proximité. */
  date?: string;
  /** L'instant de l'objet dans sa journée (ms) : deux objets du même jour se rangent dans l'ordre du temps. */
  at?: number;
  /** Le texte cherché, normalisé (sans accents, en minuscules). */
  hay: string;
  target: OmniTarget;
}

/** Cinq résultats par groupe. */
export const OMNI_PER_GROUP = 5;
/** Les catalyseurs de la fiche et de l'omnibar : du début du journal à deux mois au-delà d'aujourd'hui. */
export const CATALYST_AHEAD_DAYS = 60;
/** Les catalyseurs que l'ontologie lie (`deriveStructuralLinks`) : impact 2 ou plus. */
export const CATALYST_INDEX_MIN_IMPACT = 2;

/* ─── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Le texte cherché : sans accents, en minuscules. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const yearOf = (now: number) => Number(etDateKey(now).slice(0, 4));

/** Le jour d'un objet dans la langue du desk : « 14.10 » en français et en espagnol, « 10/14 » en anglais. */
export function shortDay(date: string, locale: Locale = useI18n.getState().locale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [d, m] = [date.slice(8, 10), date.slice(5, 7)];
  return locale === 'en' ? `${m}/${d}` : `${d}.${m}`;
}

/** Le jour, avec son année quand elle n'est pas l'année en cours : « 14.10 », « 14.10.2027 », « 10/14/2027 ». */
export function dayWithYear(date: string, now: number, locale: Locale = useI18n.getState().locale): string {
  const day = shortDay(date, locale);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) === yearOf(now)) return day;
  return locale === 'en' ? `${day}/${date.slice(0, 4)}` : `${day}.${date.slice(0, 4)}`;
}

/**
 * Une date tapée (« 14.10 », « 14/10 », « 14.10.2026 », « 2026-10-14 ») en clé `YYYY-MM-DD` ; sans année, l'année donnée.
 * En anglais, « 10/14 » se lit mois puis jour. Rien d'autre n'est une date.
 */
export function parseDayQuery(query: string, year: number, locale: Locale = useI18n.getState().locale): string | null {
  const q = query.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const short = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(q);
  if (!short) return null;
  const [a, b] = [Number(short[1]), Number(short[2])];
  const y = short[3] ? (short[3].length === 2 ? 2000 + Number(short[3]) : Number(short[3])) : year;
  return locale === 'en' && q.includes('/') ? valid(y, a, b) : valid(y, b, a);
}

/** Jours entre deux clés `YYYY-MM-DD`, en valeur absolue. */
export function dayDistance(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000));
}

/** Les écritures d'une date qu'on peut taper : ISO, jour.mois, jour/mois, mois/jour, avec ou sans l'année. */
function dateHay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)];
  return `${date} ${d}.${m} ${d}/${m} ${m}/${d} ${d}.${m}.${y} ${d}/${m}/${y} ${m}/${d}/${y}`;
}

/** La fenêtre des catalyseurs : du début du journal (ou d'aujourd'hui) à `CATALYST_AHEAD_DAYS` jours au-delà d'aujourd'hui. */
export function catalystWindow(sessions: readonly Pick<Session, 'date'>[], today: string): { from: string; to: string } {
  const first = sessions.reduce<string | null>((min, x) => (min == null || x.date < min ? x.date : min), null);
  return { from: first != null && first < today ? first : today, to: addDays(today, CATALYST_AHEAD_DAYS) };
}

/** L'heure de New York d'un instant : « 09:38 ». Les fiches et la frise parlent en ET (décision 7). */
export function etClock(ms: number): string {
  return dateTimeFormatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE }, 'en-GB').format(ms);
}

/* ─── Les objets, nommés ─────────────────────────────────────────────────────────────────────────────────────── */

export type IndexNote = Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'by' | 'adoptedAt' | 'updatedAt'>;

/** Ce que lit l'index : les données des stores, rien d'autre. */
export interface IndexSources {
  sessions: readonly Session[];
  trades: readonly Trade[];
  notes: readonly IndexNote[];
  /** La source unique du catalyseur (OROS5.13), sur les années du journal et de la fenêtre. */
  catalysts: readonly CalEvent[];
  links: readonly Link[];
  /** Le module Crypto, éteint par défaut : sa ligne le dit au trait. */
  cryptoEnabled: boolean;
}

/** Une note de stratégie : son étiquette `strategie` en fait un objet de l'ontologie (`deriveStructuralLinks`). */
export function isStrategyNote(note: Pick<Note, 'tags'>): boolean {
  return note.tags.some((tag) => tag.toLowerCase() === 'strategie');
}

/** Le nom d'un type d'objet : « séance », « séances ». */
export function typeWord(type: EntityType, n = 1): string {
  const one = n === 1;
  switch (type) {
    case 'session':
      return one ? tr('séance', 'session', 'sesión') : tr('séances', 'sessions', 'sesiones');
    case 'trade':
      return one ? tr('trade', 'trade', 'trade') : tr('trades', 'trades', 'trades');
    case 'evenement':
      return one ? tr('catalyseur', 'catalyst', 'catalizador') : tr('catalyseurs', 'catalysts', 'catalizadores');
    case 'note':
      return one ? tr('note', 'note', 'nota') : tr('notes', 'notes', 'notas');
    case 'strategie':
      return one ? tr('stratégie', 'strategy', 'estrategia') : tr('stratégies', 'strategies', 'estrategias');
    case 'instrument':
      return one ? tr('instrument', 'instrument', 'instrumento') : tr('instruments', 'instruments', 'instrumentos');
    case 'compte':
      return one ? tr('compte', 'account', 'cuenta') : tr('comptes', 'accounts', 'cuentas');
  }
}

/** Le titre d'un groupe de l'omnibar. */
export function omniGroupTitle(group: OmniGroup): string {
  if (group === 'module') return tr('Modules', 'Modules', 'Módulos');
  const word = typeWord(group, 2);
  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

/** Le jour d'un trade : celui de sa séance, sinon celui de New York à l'entrée. */
function tradeDay(trade: Pick<Trade, 'sessionId' | 'entryTime'>, sessionDate: ReadonlyMap<string, string>): string {
  return sessionDate.get(trade.sessionId) ?? etDateKey(trade.entryTime);
}

/** « NQ L 2 · 14.10 09:38 ET » : l'instrument, le sens, la quantité, le jour et l'heure de New York. */
function tradeTitle(trade: Pick<Trade, 'instrument' | 'direction' | 'qty' | 'entryTime'>, day: string, now: number, locale: Locale): string {
  return `${trade.instrument} ${trade.direction === 'long' ? 'L' : 'S'} ${fmtInt(trade.qty)} · ${dayWithYear(day, now, locale)} ${etClock(trade.entryTime)} ET`;
}

/** « ≈ Inflation CPI » : le titre dans la langue du desk, « ≈ » devant un estimé (C.054). */
export function catalystTitle(event: Pick<CalEvent, 'title' | 'estimated'>): string {
  return `${event.estimated ? '≈ ' : ''}${trEventTitle(event.title)}`;
}

/** Le contexte qui nomme un objet : les données de l'index. */
export type NamingContext = Pick<IndexSources, 'sessions' | 'trades' | 'notes' | 'catalysts'>;

/**
 * Le nom d'un objet en clair, tel que l'omnibar, la fiche et le fil d'Ariane l'écrivent, dans la langue du desk :
 * « 14.10 · Apex-PA-50K », « ≈ Inflation CPI · 12.11 », « NQ L 2 · 14.10 09:38 ET ». `null` quand l'objet n'est plus au
 * coffre (un lien vers une séance supprimée).
 */
export function objectLabel(ref: EntityRef, ctx: NamingContext, now: number, locale: Locale = useI18n.getState().locale): string | null {
  switch (ref.type) {
    case 'session': {
      const session = ctx.sessions.find((x) => x.id === ref.id);
      return session ? `${dayWithYear(session.date, now, locale)} · ${session.account?.trim() || tr('sans compte', 'no account', 'sin cuenta')}` : null;
    }
    case 'trade': {
      const trade = ctx.trades.find((x) => x.id === ref.id);
      if (!trade) return null;
      const date = ctx.sessions.find((x) => x.id === trade.sessionId)?.date ?? etDateKey(trade.entryTime);
      return tradeTitle(trade, date, now, locale);
    }
    case 'note':
    case 'strategie': {
      const note = ctx.notes.find((x) => x.id === ref.id);
      return note ? note.title.trim() || tr('Sans titre', 'Untitled', 'Sin título') : null;
    }
    case 'evenement': {
      const event = ctx.catalysts.find((x) => x.id === ref.id);
      return event ? `${catalystTitle(event)} · ${dayWithYear(event.date, now, locale)}` : null;
    }
    case 'instrument':
    case 'compte':
      return ref.id.trim() || null;
  }
}

/* ─── L'index ───────────────────────────────────────────────────────────────────────────────────────────────── */

const signedUsd = (v: number) => fmtUsd(v, { cents: true, sign: true }).replace(/^-/, '−');
const toneOf = (v: number): OmniItem['tone'] => (v > 0 ? 'pos' : v < 0 ? 'neg' : undefined);

/** Le compte d'un nom : bords ôtés ; vide, pas de compte. */
const accountName = (name: string | undefined) => name?.trim() ?? '';

/**
 * L'index de tous les objets, dans la langue du desk à l'instant `now`. Chaque ligne ouvre un module ou la fiche de son
 * objet (`OMNIBAR_COMMANDS`) ; les catalyseurs sont ceux de la fenêtre (`catalystWindow`), d'impact 2 ou plus.
 */
export function buildObjectIndex(src: IndexSources, now: number, locale: Locale = useI18n.getState().locale): OmniItem[] {
  const items: OmniItem[] = [];
  const today = etDateKey(now);

  for (const tab of TABS) {
    const label = tabCopy(tab).label;
    items.push({
      key: `module:${tab.id}`,
      group: 'module',
      glyph: tab.id,
      title: label,
      meta: `Ctrl+${tab.index.slice(-1)}`,
      // Crypto est éteint tant qu'on ne l'active pas : le filet graphite le dit.
      stroke: tab.id === 'crypto' && !src.cryptoEnabled ? 'eteint' : 'plein',
      hay: normalize(`${label} ${tab.label} ${tab.id} ${tab.code} ${tab.index}`),
      target: { kind: 'tab', tab: tab.id },
    });
  }

  const sessionDate = new Map(src.sessions.map((x) => [x.id, x.date]));
  /** Les séances de chaque compte et de chaque instrument : leur nombre et la dernière date. */
  const accounts = new Map<string, { n: number; last?: string }>();
  const instruments = new Map<string, { n: number; last?: string }>();
  /** Un compte ou un instrument vu ; une date, celle d'une séance de plus. */
  const count = (bag: Map<string, { n: number; last?: string }>, key: string, date?: string) => {
    if (!key) return;
    const row = bag.get(key) ?? { n: 0 };
    if (date) {
      row.n += 1;
      if (!row.last || date > row.last) row.last = date;
    }
    bag.set(key, row);
  };

  for (const x of src.sessions) {
    const account = accountName(x.account);
    count(accounts, account, x.date);
    for (const symbol of new Set(x.instruments.map((s) => s.trim().toUpperCase()))) count(instruments, symbol, x.date);
    items.push({
      key: `session:${x.id}`,
      group: 'session',
      glyph: TYPE_GLYPH.session,
      title: `${dayWithYear(x.date, now, locale)} · ${account || tr('sans compte', 'no account', 'sin cuenta')}`,
      meta: signedUsd(x.pnl),
      tone: toneOf(x.pnl),
      stroke: 'plein',
      date: x.date,
      hay: normalize(`${dateHay(x.date)} ${account} ${x.tags.join(' ')} ${x.instruments.join(' ')}`),
      target: { kind: 'object', ref: { type: 'session', id: x.id } },
    });
  }

  for (const t of src.trades) {
    const day = tradeDay(t, sessionDate);
    const account = accountName(t.account);
    // Le compte et l'instrument d'un trade sont des objets, même sans séance ; seules les séances se comptent.
    count(accounts, account);
    count(instruments, t.instrument.trim().toUpperCase());
    items.push({
      key: `trade:${t.id}`,
      group: 'trade',
      glyph: TYPE_GLYPH.trade,
      title: tradeTitle(t, day, now, locale),
      meta: signedUsd(t.pnl),
      tone: toneOf(t.pnl),
      stroke: 'plein',
      date: day,
      at: t.entryTime,
      hay: normalize(`${dateHay(day)} ${t.instrument} ${t.direction} ${account} ${t.strategy ?? ''} ${(t.tags ?? []).join(' ')} ${etClock(t.entryTime)}`),
      target: { kind: 'object', ref: { type: 'trade', id: t.id } },
    });
  }

  /** Les séances qui appliquent chaque stratégie (liens `applique`) : leur nombre et la dernière date. */
  const applied = new Map<string, { n: number; last?: string }>();
  for (const link of src.links) {
    if (link.kind === 'rejete') continue;
    for (const ref of [link.from, link.to]) {
      if (ref.type === 'compte') count(accounts, ref.id.trim());
      if (ref.type === 'instrument') count(instruments, ref.id.trim().toUpperCase());
    }
    if (link.predicate === 'applique' && link.from.type === 'session' && link.to.type === 'strategie') count(applied, link.to.id, sessionDate.get(link.from.id));
  }

  for (const n of src.notes) {
    const date = noteTradingDay({ id: n.id, title: n.title, body: n.body, tags: n.tags }) ?? dateKeyLocal(new Date(n.updatedAt));
    const title = n.title.trim() || tr('Sans titre', 'Untitled', 'Sin título');
    const tags = n.tags.length ? n.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ') : undefined;
    items.push({
      key: `note:${n.id}`,
      group: 'note',
      glyph: TYPE_GLYPH.note,
      title,
      meta: tags ?? dayWithYear(date, now, locale),
      // Une note d'agent que le trader n'a pas adoptée est proposée : le halo tireté.
      stroke: n.by === 'agent' && n.adoptedAt == null ? 'tirete' : 'plein',
      date,
      hay: normalize(`${title} ${n.tags.join(' ')} ${dateHay(date)}`),
      target: { kind: 'object', ref: { type: 'note', id: n.id } },
    });
    if (isStrategyNote(n)) {
      const use = applied.get(n.id);
      items.push({
        key: `strategie:${n.id}`,
        group: 'strategie',
        glyph: TYPE_GLYPH.strategie,
        title,
        meta: `${fmtInt(use?.n ?? 0)} ${typeWord('session', use?.n ?? 0)}`,
        stroke: 'plein',
        date: use?.last,
        hay: normalize(`${title} ${n.tags.join(' ')}`),
        target: { kind: 'object', ref: { type: 'strategie', id: n.id } },
      });
    }
  }

  const span = catalystWindow(src.sessions, today);
  const seen = new Set<string>();
  for (const e of src.catalysts) {
    if (e.impact < CATALYST_INDEX_MIN_IMPACT || seen.has(e.id) || e.date < span.from || e.date > span.to) continue;
    seen.add(e.id);
    const title = catalystTitle(e);
    items.push({
      key: `evenement:${e.id}`,
      group: 'evenement',
      glyph: TYPE_GLYPH.evenement,
      title,
      meta: `${dayWithYear(e.date, now, locale)}${e.timeET ? ` · ${e.timeET} ET` : ''}`,
      stroke: STROKE_ETAT[strokeOf(e, now)],
      date: e.date,
      at: publicationInstant(e),
      hay: normalize(`${title} ${e.title} ${e.category} ${dateHay(e.date)}`),
      target: { kind: 'object', ref: { type: 'evenement', id: e.id } },
    });
  }

  for (const [symbol, use] of instruments) {
    const name = hasInstrument(symbol) ? getInstrument(symbol).name : '';
    items.push({
      key: `instrument:${symbol}`,
      group: 'instrument',
      glyph: TYPE_GLYPH.instrument,
      title: symbol,
      meta: name || undefined,
      stroke: 'plein',
      date: use.last,
      hay: normalize(`${symbol} ${name}`),
      target: { kind: 'object', ref: { type: 'instrument', id: symbol } },
    });
  }

  for (const [name, use] of accounts) {
    items.push({
      key: `compte:${name}`,
      group: 'compte',
      glyph: TYPE_GLYPH.compte,
      title: name,
      meta: `${fmtInt(use.n)} ${typeWord('session', use.n)}`,
      stroke: 'plein',
      date: use.last,
      hay: normalize(name),
      target: { kind: 'object', ref: { type: 'compte', id: name } },
    });
  }

  return items;
}

export interface OmniGroupResult {
  group: OmniGroup;
  /** Les cinq premiers. */
  items: OmniItem[];
  /** Le compte de tous ceux qui répondent. */
  total: number;
  /** Tous ceux qui répondent, dans l'ordre : ↑ ↓ y passent d'une fiche à l'autre. */
  hits: OmniItem[];
}

/**
 * La recherche : chaque mot doit répondre (accents et casse ignorés). Une date tapée (« 14.10 ») classe les objets datés
 * par proximité de ce jour, sinon d'aujourd'hui, ceux d'un même jour dans l'ordre du temps ; un objet sans date passe
 * après. Sans rien de tapé, les modules seuls.
 */
export function searchObjectIndex(index: readonly OmniItem[], query: string, now: number, locale: Locale = useI18n.getState().locale): OmniGroupResult[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const modules = index.filter((x) => x.group === 'module');
    return modules.length > 0 ? [{ group: 'module', items: modules, total: modules.length, hits: modules }] : [];
  }
  const asked = words.map((word) => parseDayQuery(word, yearOf(now), locale)).find((day): day is string => !!day) ?? etDateKey(now);
  const first = words[0]!;
  const rank = (a: OmniItem, b: OmniItem): number => {
    if (a.date && b.date) return dayDistance(a.date, asked) - dayDistance(b.date, asked) || b.date.localeCompare(a.date) || (a.at ?? 0) - (b.at ?? 0);
    if (a.date || b.date) return a.date ? -1 : 1;
    return Number(!normalize(a.title).startsWith(first)) - Number(!normalize(b.title).startsWith(first));
  };
  const out: OmniGroupResult[] = [];
  for (const group of OMNI_GROUPS) {
    const hits = index.filter((x) => x.group === group && words.every((word) => x.hay.includes(word))).sort(rank);
    if (hits.length > 0) out.push({ group, items: hits.slice(0, OMNI_PER_GROUP), total: hits.length, hits });
  }
  return out;
}

/* ─── Les stores, lus ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Les catalyseurs de la source unique (OROS5.13), sur les années du journal, des notes et de la fenêtre : de quoi nommer
 * tout catalyseur qu'un lien vise, et borner l'omnibar à la fenêtre.
 */
export function useCatalysts(now: number): CalEvent[] {
  const rows = useMacro((m) => m.events);
  const sessions = useJournal((j) => j.sessions);
  const notes = useNotes((n) => n.notes);
  const today = etDateKey(now);
  // Les années comptent par leur suite (« 2025,2026,2027 ») : une séance de plus ne relance pas la fusion.
  const years = useMemo(() => {
    const dates = [today, addDays(today, CATALYST_AHEAD_DAYS), ...sessions.map((x) => x.date)];
    for (const note of notes) {
      const day = noteTradingDay(note);
      if (day) dates.push(day);
    }
    return yearsSpanned(dates).join(',');
  }, [today, sessions, notes]);
  return useMemo(() => catalystSource(rows, years.split(',').map(Number)), [rows, years]);
}

/** Ce que l'index lit dans les stores : leurs données seules. */
export function useIndexSources(now: number): IndexSources {
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const notes = useNotes((n) => n.notes);
  const links = useLinks((l) => l.links);
  const cryptoEnabled = useCrypto((c) => c.enabled);
  const catalysts = useCatalysts(now);
  return useMemo(() => ({ sessions, trades, notes, catalysts, links, cryptoEnabled }), [sessions, trades, notes, catalysts, links, cryptoEnabled]);
}

/** L'index de l'omnibar, à l'instant `now`, dans la langue du desk. */
export function useObjectIndex(now: number): OmniItem[] {
  const locale = useI18n((st) => st.locale);
  const sources = useIndexSources(now);
  return useMemo(() => buildObjectIndex(sources, now, locale), [sources, now, locale]);
}
