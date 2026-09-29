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
