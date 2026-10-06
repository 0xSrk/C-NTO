/**
 * Séance en cours, en tête de Métrique. Pur : le pont `live` seulement.
 * Le bloc se lit sur le compte suivi (`planAccount`), comme `discipline_status` et l'événement `daily_loss` :
 * la perte du jour et sa limite à l'écran sont celles que l'agent et l'alerte voient. Le filtre de compte de
 * Métrique reste celui du journal.
 * La fraîcheur est celle du portefeuille (`bridgeIsFresh`, 60 s) : 10 s est frais, 10 min ne l'est pas.
 */

import { dayLoss, dailyLimit, tradingDayNow, type TraderRules } from '@/engine/discipline';
import { bridgeIsFresh } from '@/engine/portfolio/fx';
import type { PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';

export interface LiveAccount {
  name: string;
  cashValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: { instrument: string; quantity: number; avgPrice: number }[];
}

export interface LiveSessionInput {
  link: string;
  now: number;
  accountsAt?: number | null;
  accounts: readonly LiveAccount[];
  /** Compte suivi (`planAccount`). Absent ou '' : tous les comptes du pont, comme `discipline_status`. */
  account?: string;
  sessions: readonly Session[];
  trades: readonly Trade[];
  rules: TraderRules;
  plan?: Pick<PropPlan, 'dailyLossLimit'> | null;
}

export interface LiveSessionView {
  /** Compte lu, `null` : tous les comptes. */
  account: string | null;
  realized: number;
  unrealized: number;
  balance: number;
  positions: { account: string; instrument: string; quantity: number }[];
  accountsAt: number | null;
  ageMs: number | null;
  fresh: boolean;
  loss: number;
  limit: { amount: number; source: 'trader' | 'plan' } | null;
  trades: number;
  maxTrades: number | null;
}

/** `null` tant que le pont n'est pas `live`. */
export function liveSession(input: LiveSessionInput): LiveSessionView | null {
  if (input.link !== 'live') return null;
  const account = input.account ?? '';
  const accounts = input.accounts.filter((row) => !account || row.name === account);
  const unrealized = accounts.reduce((sum, row) => sum + (Number.isFinite(row.unrealizedPnl) ? row.unrealizedPnl : 0), 0);
  const day = dayLoss({
    sessions: input.sessions,
    trades: input.trades,
    day: tradingDayNow(input.now),
    account,
    unrealized,
  });
  const limit = dailyLimit(input.rules, input.plan);
  const at = typeof input.accountsAt === 'number' && Number.isFinite(input.accountsAt) ? input.accountsAt : null;
  return {
    account: account || null,
    realized: accounts.reduce((sum, row) => sum + (Number.isFinite(row.realizedPnl) ? row.realizedPnl : 0), 0),
    unrealized,
    balance: accounts.reduce((sum, row) => sum + (Number.isFinite(row.cashValue) ? row.cashValue : 0), 0),
    positions: accounts.flatMap((row) => row.positions.filter((p) => p.quantity !== 0).map((p) => ({ account: row.name, instrument: p.instrument, quantity: p.quantity }))),
    accountsAt: at,
    ageMs: at === null ? null : Math.max(0, input.now - at),
    fresh: at !== null && bridgeIsFresh(at, input.now),
    loss: day.loss,
    limit: limit ? { amount: limit.amount, source: limit.source } : null,
    trades: day.trades,
    maxTrades: input.rules.maxTradesPerDay > 0 ? input.rules.maxTradesPerDay : null,
  };
}
