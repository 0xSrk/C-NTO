import { create } from 'zustand';
import type { GlyphName } from '@/design/Micro';
import { sameAccount } from '@/engine/accounts';
import { DESK_EVENT_KINDS, type DeskEventKind } from '@/engine/agent/catalog';
import { EVENT_LOG_MAX, EVENTS_PAGE_MAX, type DeskEvent, type DeskEventLog } from '@/engine/agent/events';
import type { CalEvent } from '@/engine/calendar';
import { resolveSymbol } from '@/engine/instruments';
import { familyKey } from '@/engine/macroMerge';
import type { EntityRef } from '@/engine/ontology';
import type { DisciplineFinding } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { tr } from '@/i18n';
import { cmeDay } from '@/lib/frise';
import { dateTimeFormatter, ET_ZONE } from '@/lib/time';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { findingWords } from './objects/SessionFiche';

/** Les écarts que le desk sait dire en mots (`findingWords`). */
const FINDING_KINDS: readonly DisciplineFinding['kind'][] = ['revenge_entry', 'size_up_after_loss', 'catalyst_window', 'over_max_trades', 'after_daily_limit', 'instrument_not_allowed'];

/**
 * Le registre du lancement (OROS5.38, Système 5 « Fiche et Frise » ; repris du prototype D · Porte, d4) : les événements
 * du desk que range `deskEventLog` — exécutions et ordres du pont, marge du plan suivi, perte du jour, catalyseurs proches,
 * lien du pont, propositions de l'agent, écarts de discipline, alertes crypto —, en mémoire seulement, 500 au plus
 * (décision 13). Ce module est pur, hors du tiroir qui l'affiche : la table genre → glyphe, les objets qu'un événement
 * touche (la section Activité de chaque fiche les filtre), et l'objet qu'une ligne ouvre. Rien n'y écrit.
 */

/**
 * Le glyphe de chaque genre, pris à la bibliothèque unique (OROS5.3). Aucun signe réservé du châssis (131, 12, 123, 27,
 * 124, 126, 141, 142) ne marque une ligne : le registre dit des données, pas des signaux (tests/registre.test.ts).
 */
export const KIND_GLYPH: Readonly<Record<DeskEventKind, GlyphName>> = {
  fill: 'trade', // C.035 : une exécution, de l'entrée à la sortie
  order: 'trade', // C.035 : un ordre au carnet, un trade qui se pose
  prop_buffer: 'margin', // C.140 : la marge avant le plancher
  catalyst: 'catalyst', // C.090 : le catalyseur sur l'axe du temps
  bridge_link: 'bridge', // C.001 : le pont NinjaTrader
  agent_order: 'proposal', // C.092 : la proposition de l'agent, de la garde au siège de l'opérateur
  daily_loss: 'traderRule', // C.109 : les règles du trader
  discipline: 'drift', // C.024 : un écart de discipline
  crypto_alert: 'crypto', // C.150 : l'emblème du module Crypto
};

/** Le genre d'un événement, en mots. */
export function kindLabel(kind: DeskEventKind): string {
  switch (kind) {
    case 'fill':
      return tr('Exécution', 'Fill', 'Ejecución');
    case 'order':
      return tr('Ordre', 'Order', 'Orden');
    case 'prop_buffer':
      return tr('Marge prop', 'Prop margin', 'Margen prop');
    case 'catalyst':
      return tr('Catalyseur', 'Catalyst', 'Catalizador');
    case 'bridge_link':
      return tr('Pont', 'Bridge', 'Puente');
    case 'agent_order':
      return tr('Proposition', 'Proposal', 'Propuesta');
    case 'daily_loss':
      return tr('Perte du jour', 'Day loss', 'Pérdida del día');
    case 'discipline':
      return tr('Écart', 'Breach', 'Desvío');
    case 'crypto_alert':
      return tr('Alerte crypto', 'Crypto alert', 'Alerta cripto');
  }
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE };

/** L'heure d'une ligne, à New York (décision 7 : l'ET pour la frise et les fiches). */
export function registreClock(ms: number): string {
  return dateTimeFormatter(CLOCK, 'en-GB').format(ms);
}

/** La portée du registre, écrite : il ne garde que le lancement en cours, en mémoire, 500 au plus. */
export function registreScope(): string {
  return tr(`depuis l’ouverture · en mémoire · ${EVENT_LOG_MAX} au plus`, `since opening · in memory · ${EVENT_LOG_MAX} at most`, `desde la apertura · en memoria · ${EVENT_LOG_MAX} como máximo`);
}

/** Tout le registre, du plus ancien au plus récent, lu page à page par son curseur (`read`), sans rien en retirer. */
export function logEvents(log: Pick<DeskEventLog, 'read' | 'epoch'>): DeskEvent[] {
  const out: DeskEvent[] = [];
  let cursor = `${log.epoch}.0`;
  for (let i = 0; i < Math.ceil(EVENT_LOG_MAX / EVENTS_PAGE_MAX) + 1; i++) {
    const page = log.read({ cursor, limit: EVENTS_PAGE_MAX });
    out.push(...page.events);
    if (!page.more) break;
    cursor = page.cursor;
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** La racine d'un instrument du pont (« MNQ 12-26 » → MNQ), comme l'objet instrument de l'ontologie. */
export function instrumentKey(raw: string): string {
  const name = raw.trim();
  return name ? (resolveSymbol(name)?.symbol ?? name.toUpperCase()) : '';
}

/** L'instant d'un événement : celui que ses données datent (une exécution, une entrée), sinon celui où il a été rangé. */
export function eventInstant(ev: DeskEvent): number {
  const d = ev.data;
  for (const key of ['time', 'at'] as const) {
    const t = typeof d[key] === 'string' ? Date.parse(d[key] as string) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return ev.at;
}

/** La journée CME d'un événement : celle que ses données disent (`day`), sinon celle de son instant. */
export function eventDay(ev: DeskEvent): string {
  const day = str(ev.data.day);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : cmeDay(eventInstant(ev));
}

/** Le compte d'un événement, s'il en nomme un ; `null` pour « tous les comptes » ou un genre sans compte. */
export function eventAccount(ev: DeskEvent): string | null {
  return str(ev.data.account) || null;
}

/** L'instrument d'un événement, en racine du registre, s'il en nomme un. */
export function eventInstrument(ev: DeskEvent): string | null {
  return instrumentKey(str(ev.data.instrument)) || null;
}

/** Ce qu'un événement peut toucher, dans le journal et la source du catalyseur. */
export interface RegistreContext {
  sessions: readonly Session[];
  trades: readonly Trade[];
  catalysts: readonly CalEvent[];
}

/** Le compte tel que le journal l'écrit, quand il le connaît (la règle de la garde : `sameAccount`) ; sinon le nom reçu. */
function journalAccount(ctx: RegistreContext, account: string): string {
  return ctx.sessions.find((s) => s.account && sameAccount(s.account, account))?.account ?? account.trim();
}

/** La séance d'un compte un jour donné, au journal (la règle de la garde : `sameAccount`). */
function sessionOf(ctx: RegistreContext, account: string, day: string): Session | undefined {
  return ctx.sessions.find((s) => s.date === day && sameAccount(s.account ?? '', account));
}

/** Le catalyseur du desk qu'annonce un événement `catalyst` : même journée, même famille. */
function catalystOf(ctx: RegistreContext, ev: DeskEvent): CalEvent | undefined {
  const date = str(ev.data.date);
  const title = str(ev.data.title);
  if (!date || !title) return undefined;
  const family = familyKey(title);
  return ctx.catalysts.find((c) => c.date === date && familyKey(c.title) === family);
}

/** Une marge d'une seconde autour d'un trade : l'horodatage du pont et celui du journal ne tombent pas au même ms. */
const TRADE_SLACK_MS = 1_000;

/**
 * Un événement touche-t-il cet objet ? Le filtre de la section Activité, exact : le même compte (la règle de la garde),
 * le même instrument (sa racine), la même séance (le compte et la journée CME), le même trade (le compte, l'instrument et
 * un instant entre son entrée et sa sortie), le même catalyseur (la journée et la famille). Une note ou une stratégie
 * n'a pas d'événement du desk.
 */
export function eventTouches(ev: DeskEvent, ref: EntityRef, ctx: RegistreContext): boolean {
  const account = eventAccount(ev);
  const instrument = eventInstrument(ev);
  switch (ref.type) {
    case 'compte':
      return account !== null && sameAccount(account, ref.id);
    case 'instrument':
      return instrument !== null && instrument === instrumentKey(ref.id);
    case 'session': {
      const session = ctx.sessions.find((s) => s.id === ref.id);
      return !!session && account !== null && sameAccount(account, session.account ?? '') && eventDay(ev) === session.date;
    }
    case 'trade': {
      const trade = ctx.trades.find((t) => t.id === ref.id);
      if (!trade || account === null || instrument === null || !sameAccount(account, trade.account ?? '') || instrument !== instrumentKey(trade.instrument)) return false;
      const at = eventInstant(ev);
      return ev.kind !== 'prop_buffer' && ev.kind !== 'daily_loss' && at >= trade.entryTime - TRADE_SLACK_MS && at <= trade.exitTime + TRADE_SLACK_MS;
    }
    case 'evenement': {
      if (ev.kind !== 'catalyst') return false;
      const catalyst = ctx.catalysts.find((c) => c.id === ref.id);
      return !!catalyst && catalystOf(ctx, ev)?.id === catalyst.id;
    }
    case 'note':
    case 'strategie':
      return false;
  }
}

/** Les événements d'un objet, du plus récent au plus ancien : la section Activité de sa fiche. */
export function activityOf(ref: EntityRef, events: readonly DeskEvent[], ctx: RegistreContext): DeskEvent[] {
  return events.filter((ev) => eventTouches(ev, ref, ctx)).sort((a, b) => b.seq - a.seq);
}

/**
 * L'objet qu'une ligne du registre ouvre : la séance d'une exécution ou d'un écart (son compte, sa journée), sinon leur
 * compte ; le compte d'un ordre, d'une proposition, d'une marge ou d'une perte du jour ; le catalyseur annoncé. Le lien du
 * pont et une alerte crypto n'ont pas d'objet dans l'ontologie : leur ligne n'ouvre rien.
 */
export function eventTarget(ev: DeskEvent, ctx: RegistreContext): EntityRef | null {
  const account = eventAccount(ev);
  switch (ev.kind) {
    case 'fill':
    case 'discipline': {
      if (!account) return null;
      const session = sessionOf(ctx, account, eventDay(ev));
      return session ? { type: 'session', id: session.id } : { type: 'compte', id: journalAccount(ctx, account) };
    }
    case 'order':
    case 'agent_order':
    case 'prop_buffer':
    case 'daily_loss':
      return account ? { type: 'compte', id: journalAccount(ctx, account) } : null;
    case 'catalyst': {
      const catalyst = catalystOf(ctx, ev);
      return catalyst ? { type: 'evenement', id: catalyst.id } : null;
    }
    case 'bridge_link':
    case 'crypto_alert':
      return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Ce qu'une ligne dit, en mots : l'objet touché, puis ce qui s'est passé ; « — » quand le desk ne le sait pas. */
export function eventLine(ev: DeskEvent): { object: string; detail: string } {
  const d = ev.data;
  const pair = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(' · ') || '—';
  const side = (v: unknown) => (/sell/i.test(str(v)) ? tr('vente', 'sell', 'venta') : /buy/i.test(str(v)) ? tr('achat', 'buy', 'compra') : '—');
  switch (ev.kind) {
    case 'fill':
      return { object: pair(d.instrument, d.account), detail: `${side(d.action)} ${num(d.quantity) ?? '—'} @ ${num(d.price) ?? '—'}${str(d.entryExit) === 'Entry' ? ` · ${tr('entrée', 'entry', 'entrada')}` : str(d.entryExit) === 'Exit' ? ` · ${tr('sortie', 'exit', 'salida')}` : ''}` };
    case 'order':
      return { object: pair(d.instrument, d.account), detail: `${side(d.side)} ${num(d.qty) ?? '—'} · ${str(d.state) || '—'}${d.byAgent === true ? ` · ${tr('posé par l’agent', 'placed by the agent', 'puesta por el agente')}` : ''}` };
    case 'prop_buffer': {
      const share = num(d.remainingShare);
      return { object: str(d.account) || tr('tous les comptes', 'all accounts', 'todas las cuentas'), detail: share === null ? '—' : tr(`marge ${pct(share)} du drawdown maximal`, `margin ${pct(share)} of the max drawdown`, `margen ${pct(share)} del drawdown máximo`) };
    }
    case 'catalyst':
      return { object: str(d.title) || '—', detail: `${str(d.timeET) || '—'} ET${num(d.minutesBefore) !== null ? ` · ${tr(`annoncé ${num(d.minutesBefore)} min avant`, `announced ${num(d.minutesBefore)} min ahead`, `anunciado ${num(d.minutesBefore)} min antes`)}` : ''}` };
    case 'bridge_link':
      return { object: 'NinjaTrader 8', detail: `${str(d.from) || '—'} → ${str(d.to) || '—'}` };
    case 'agent_order': {
      const status = str(d.status);
      const outcome = status === 'sent' ? tr('envoyée', 'sent', 'enviada') : status === 'refused' ? tr('refusée par la garde', 'refused by the guard', 'rechazada por la guarda') : status === 'declined' ? tr('non envoyée', 'not sent', 'no enviada') : tr('en échec', 'failed', 'fallida');
      return { object: pair(d.instrument, d.account), detail: `${side(d.side)} ${num(d.qty) ?? '—'} · ${outcome}` };
    }
    case 'daily_loss': {
      const consumed = num(d.consumed);
      return { object: str(d.account) || tr('tous les comptes', 'all accounts', 'todas las cuentas'), detail: consumed === null ? '—' : tr(`${pct(consumed)} de la limite`, `${pct(consumed)} of the limit`, `${pct(consumed)} del límite`) };
    }
    case 'discipline': {
      const kind = str(d.finding) as DisciplineFinding['kind'];
      const detail = d.detail && typeof d.detail === 'object' ? (d.detail as DisciplineFinding['detail']) : {};
      return { object: pair(d.instrument, d.account), detail: FINDING_KINDS.includes(kind) ? findingWords({ kind, detail, instrument: str(d.instrument) }) : kind || '—' };
    }
    case 'crypto_alert':
      return { object: str(d.target) || '—', detail: str(d.kind) || '—' };
  }
}

/** Les genres présents, dans l'ordre du catalogue : les filtres du tiroir. */
export function presentKinds(events: readonly DeskEvent[]): DeskEventKind[] {
  return DESK_EVENT_KINDS.filter((kind) => events.some((ev) => ev.kind === kind));
}

/** Le tiroir du registre : ouvert ou non, les genres retenus (vide : tous), et l'élément qui l'a ouvert. En mémoire. */
interface RegistreState {
  open: boolean;
  kinds: readonly DeskEventKind[];
  origin: HTMLElement | null;
  toggleKind: (kind: DeskEventKind) => void;
}

export const useRegistre = create<RegistreState>((set, get) => ({
  open: false,
  kinds: [],
  origin: null,
  toggleKind: (kind) => {
    const kinds = get().kinds;
    set({ kinds: kinds.includes(kind) ? kinds.filter((k) => k !== kind) : DESK_EVENT_KINDS.filter((k) => k === kind || kinds.includes(k)) });
  },
}));

/** Ouvre le registre en tiroir bas ; Échap rendra le focus à `origin`. Le tiroir de la frise se replie. Rien sous le verrou. */
export function openRegistre(origin: HTMLElement | null = null): boolean {
  if (useObjects.getState().locked) return false;
  if (useUi.getState().friseOpen) useUi.getState().setFriseOpen(false);
  useRegistre.setState({ open: true, origin });
  return true;
}

/** Ferme le registre et rend le focus à ce qui l'a ouvert. */
export function closeRegistre(restoreFocus = true): void {
  const { open, origin } = useRegistre.getState();
  if (!open) return;
  useRegistre.setState({ open: false, origin: null });
  if (restoreFocus && origin?.isConnected) origin.focus();
}
