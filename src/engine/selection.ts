import { ET_ZONE, zonedWallClock } from '@/lib/time';
import { summarizeTrades } from './metrics';
import type { Session, Trade } from './types';

/**
 * La sélection partagée (OROS5.32, Système 5 « Fiche et Frise ») : un compte, une période et un instrument, que portent
 * les puces de Métrique et celles d'« Autour de… ». Un module pur : la sélection ne fait que lire le journal ; ce qui en
 * sort reste en place, atténué (`OUT_OF_SELECTION`), et chaque panneau dit n / N.
 */

/** La période : sept, trente, quatre-vingt-dix jours, ou tout le journal. */
export type MetricRange = '7j' | '30j' | '90j' | 'tout';

export const METRIC_RANGES: readonly MetricRange[] = ['7j', '30j', '90j', 'tout'];

/** Ce qui sort de la sélection garde sa place, à 35 % : rien ne disparaît. */
export const OUT_OF_SELECTION = 0.35;

export interface Selection {
  /** `null` : tous les comptes. */
  account: string | null;
  range: MetricRange;
  /** La puce Instrument ; `null` : tous les instruments. */
  instrument: string | null;
  /**
   * La puce Heure (OROS5.35), posée depuis M.003 : l'heure d'entrée à New York, de 0 à 23, celle de `TradeStats.byHour` ;
   * `null` ou absente : toutes les heures.
   */
  hour?: number | null;
}

export function shiftDateKey(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Premier jour inclus, ou `null` pour tout le journal. `asOf` est un jour civil `YYYY-MM-DD`. */
export function rangeFrom(range: MetricRange, asOf: string): string | null {
  if (range === 'tout') return null;
  const back = range === '7j' ? -6 : range === '30j' ? -29 : -89;
  return shiftDateKey(asOf, back);
}

/** Filtre le journal avant les fonctions de statistiques existantes. */
export function filterJournal(sessions: readonly Session[], trades: readonly Trade[], range: MetricRange, asOf: string, account: string | null): { sessions: Session[]; trades: Trade[] } {
  const from = rangeFrom(range, asOf);
  const nextSessions = sessions.filter((row) => {
    if (account && (row.account ?? '') !== account) return false;
    if (from && row.date < from) return false;
    if (row.date > asOf) return false;
    return true;
  });
  const ids = new Set(nextSessions.map((row) => row.id));
  const nextTrades = trades.filter((row) => ids.has(row.sessionId));
  return { sessions: nextSessions, trades: nextTrades };
}

/**
 * La puce Instrument : la part du journal qui porte l'instrument. Ses trades, et chaque séance qui en compte au moins un,
 * réduite à cette part par le résumé du moteur (`summarizeTrades` : P&L, trades, commission, bruts). Une séance sans
 * trade au journal ne se partage pas : elle n'y entre, entière, que si l'instrument est le seul qu'elle porte.
 */
export function byInstrument(journal: { sessions: readonly Session[]; trades: readonly Trade[] }, symbol: string): { sessions: Session[]; trades: Trade[] } {
  const trades = journal.trades.filter((row) => row.instrument === symbol);
  const parts = new Map<string, Trade[]>();
  for (const row of trades) {
    const part = parts.get(row.sessionId);
    if (part) part.push(row);
    else parts.set(row.sessionId, [row]);
  }
  const traded = new Set(journal.trades.map((row) => row.sessionId));
  const sessions: Session[] = [];
  for (const row of journal.sessions) {
    const part = parts.get(row.id);
    if (part) sessions.push({ ...row, ...summarizeTrades(part) });
    else if (!traded.has(row.id) && row.instruments.length === 1 && row.instruments[0] === symbol) sessions.push(row);
  }
  return { sessions, trades };
}

/** L'heure d'entrée d'un trade à New York (0–23) : la clé de `TradeStats.byHour`, et celle de la puce Heure. */
export function entryHourET(trade: Pick<Trade, 'entryTime'>): number {
  return zonedWallClock(trade.entryTime, ET_ZONE).hour;
}

/**
 * La puce Heure : les trades entrés à cette heure de New York, et chaque séance qui en compte au moins un, réduite à cette
 * part par le résumé du moteur (`summarizeTrades`). Une séance sans trade au journal n'a pas d'heure : elle n'y entre pas.
 */
export function byEntryHour(journal: { sessions: readonly Session[]; trades: readonly Trade[] }, hour: number): { sessions: Session[]; trades: Trade[] } {
  const trades = journal.trades.filter((row) => Number.isFinite(row.entryTime) && entryHourET(row) === hour);
  const parts = new Map<string, Trade[]>();
  for (const row of trades) {
    const part = parts.get(row.sessionId);
    if (part) part.push(row);
    else parts.set(row.sessionId, [row]);
  }
  const sessions: Session[] = [];
  for (const row of journal.sessions) {
    const part = parts.get(row.id);
    if (part) sessions.push({ ...row, ...summarizeTrades(part) });
  }
  return { sessions, trades };
}

/** Les puces qui découpent un journal déjà borné au compte et à la période : l'instrument, puis l'heure. */
export function narrowJournal(journal: { sessions: readonly Session[]; trades: readonly Trade[] }, chips: Pick<Selection, 'instrument' | 'hour'>): { sessions: Session[]; trades: Trade[] } {
  const byChip = chips.instrument ? byInstrument(journal, chips.instrument) : { sessions: [...journal.sessions], trades: [...journal.trades] };
  return chips.hour != null ? byEntryHour(byChip, chips.hour) : byChip;
}

/** La sélection appliquée à un journal : le compte et la période (`filterJournal`), puis la puce Instrument (`byInstrument`) et la puce Heure (`byEntryHour`). */
export function selectJournal(sessions: readonly Session[], trades: readonly Trade[], selection: Selection, asOf: string): { sessions: Session[]; trades: Trade[] } {
  const scoped = filterJournal(sessions, trades, selection.range, asOf, selection.account);
  return selection.instrument || selection.hour != null ? narrowJournal(scoped, selection) : scoped;
}

/** Ce que la sélection garde d'un journal, par identifiant : le reste s'atténue, sans disparaître. */
export interface SelectionIndex {
  sessions: ReadonlySet<string>;
  trades: ReadonlySet<string>;
}

export function selectionIndex(sessions: readonly Session[], trades: readonly Trade[], selection: Selection, asOf: string): SelectionIndex {
  const kept = selectJournal(sessions, trades, selection, asOf);
  return { sessions: new Set(kept.sessions.map((row) => row.id)), trades: new Set(kept.trades.map((row) => row.id)) };
}

/** Les instruments d'un journal, triés : les valeurs que propose la puce Instrument. */
export function journalInstruments(sessions: readonly Session[], trades: readonly Trade[]): string[] {
  const out = new Set<string>();
  for (const row of trades) if (row.instrument) out.add(row.instrument);
  const traded = new Set(trades.map((row) => row.sessionId));
  for (const row of sessions) if (!traded.has(row.id) && row.instruments.length === 1 && row.instruments[0]) out.add(row.instruments[0]);
  return [...out].sort();
}

/** Les comptes d'un journal, triés : les valeurs que propose la puce Compte. */
export function journalAccounts(sessions: readonly Session[]): string[] {
  return [...new Set(sessions.map((row) => row.account).filter((name): name is string => !!name))].sort();
}
