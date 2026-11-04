import { aggregateByDate } from '@/engine/metrics';
import { filterJournal, type MetricRange } from '@/engine/selection';
import type { Session, Trade } from '@/engine/types';

// La période, le filtre du journal et la puce Instrument vivent au moteur (OROS5.32) : la sélection est partagée avec
// « Autour de… », hors des modules. Ce module les rend sous leurs noms, et garde ce qui est propre aux onglets.
export { byInstrument, filterJournal, rangeFrom, selectJournal, shiftDateKey, type MetricRange } from '@/engine/selection';

/** Onglets qui lisent les filtres de l'en-tête comme un journal filtré (les Séances les lisent en atténuant, OROS5.32). */
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
