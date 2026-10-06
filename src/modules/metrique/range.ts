import { aggregateByDate } from '@/engine/metrics';
import type { Session, Trade } from '@/engine/types';

export type MetricRange = '7j' | '30j' | '90j' | 'tout';

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

/** Onglets qui lisent les filtres de l'en-tête (les Séances ont les leurs). */
export type ScopedTab = 'bord' | 'analyse' | 'prop' | 'mc';

export interface TabScope {
  sessions: Session[];
  trades: Trade[];
  account: string | null;
  /** Filtres de l'en-tête que l'onglet n'applique pas, à dire dans l'en-tête. */
  ignores: ('periode' | 'compte')[];
  /** L'onglet exige un compte : sans lui, rien n'est calculé. */
  needsAccount: boolean;
}

/**
 * Journal vu par un onglet.
 * - Tableau de bord et Analyse : période et compte.
 * - Firme prop : compte seulement, jamais la période (le plancher dépend de tout l'historique du compte).
 * - Monte-Carlo : compte obligatoire (un échantillon ne mélange pas des comptes copiés), période au choix.
 */
export function scopeFor(tab: ScopedTab, sessions: readonly Session[], trades: readonly Trade[], range: MetricRange, asOf: string, account: string | null): TabScope {
  if (tab === 'prop') return { ...filterJournal(sessions, trades, 'tout', asOf, account), account, ignores: ['periode'], needsAccount: false };
  if (tab === 'mc' && !account) return { sessions: [], trades: [], account: null, ignores: [], needsAccount: true };
  return { ...filterJournal(sessions, trades, range, asOf, account), account, ignores: [], needsAccount: false };
}

/**
 * Échantillon du Monte-Carlo : un compte, une valeur par journée (séances du même jour réunies),
 * ou une par trade. L'horizon par défaut vaut donc le nombre de journées du compte, jamais
 * journées × comptes copiés.
 */
export function monteCarloSample(scope: Pick<TabScope, 'sessions' | 'trades'>, level: 'seances' | 'trades'): number[] {
  if (level === 'trades') return scope.trades.map((row) => row.pnl);
  return aggregateByDate(scope.sessions).map((row) => row.pnl);
}
