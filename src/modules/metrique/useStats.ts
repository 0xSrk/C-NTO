import { useMemo } from 'react';
import { computeDailyStats, computeTradeStats, type DailyStats, type TradeStats } from '@/engine/metrics';
import { evaluatePlan, findPlan, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';

/*
 * Caches au niveau module, clés faibles sur les tableaux du store : toutes les vues
 * (tableau de bord, analyse, prop firm, Monte-Carlo…) partagent le même résultat au lieu
 * de recalculer à chaque montage. Un nouveau tableau (import, édition) invalide naturellement.
 */
const tradeStatsCache = new WeakMap<Trade[], TradeStats>();
const dailyStatsCache = new WeakMap<Session[], Map<number, DailyStats>>();
// Clé sur l'objet plan (et non son id) : un plan utilisateur réédité garde son id mais change de règles.
const planEvalCache = new WeakMap<Session[], WeakMap<Trade[], WeakMap<PropPlan, Map<string, ReturnType<typeof evaluatePlan>>>>>();
const accountsCache = new WeakMap<Session[], string[]>();

export function cachedTradeStats(trades: Trade[]): TradeStats {
  let st = tradeStatsCache.get(trades);
  if (!st) {
    st = computeTradeStats(trades);
    tradeStatsCache.set(trades, st);
  }
  return st;
}

export function cachedDailyStats(sessions: Session[], startingBalance: number): DailyStats {
  let byBalance = dailyStatsCache.get(sessions);
  if (!byBalance) {
    byBalance = new Map();
    dailyStatsCache.set(sessions, byBalance);
  }
  let st = byBalance.get(startingBalance);
  if (!st) {
    st = computeDailyStats(sessions, startingBalance);
    byBalance.set(startingBalance, st);
  }
  return st;
}

export function cachedPlanEval(plan: PropPlan, sessions: Session[], trades: Trade[], account: string | undefined): ReturnType<typeof evaluatePlan> {
  let byTrades = planEvalCache.get(sessions);
  if (!byTrades) {
    byTrades = new WeakMap();
    planEvalCache.set(sessions, byTrades);
  }
  let byPlan = byTrades.get(trades);
  if (!byPlan) {
    byPlan = new WeakMap();
    byTrades.set(trades, byPlan);
  }
  let byAccount = byPlan.get(plan);
  if (!byAccount) {
    byAccount = new Map();
    byPlan.set(plan, byAccount);
  }
  const key = account ?? '';
  let ev = byAccount.get(key);
  if (!ev) {
    ev = evaluatePlan(plan, sessions, trades, account);
    byAccount.set(key, ev);
  }
  return ev;
}

function cachedAccounts(sessions: Session[]): string[] {
  let acc = accountsCache.get(sessions);
  if (!acc) {
    acc = [...new Set(sessions.map((s) => s.account ?? ''))].sort();
    accountsCache.set(sessions, acc);
  }
  return acc;
}

/** Statistiques agrégées du journal complet, mémorisées. Le rejeu prop firm peut être restreint à un compte. */
export function useStats() {
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const startingBalance = useSettings((s) => s.settings.startingBalance);
  const planId = useSettings((s) => s.settings.planId);
  const planAccount = useSettings((s) => s.settings.planAccount);

  const tradeStats = useMemo(() => cachedTradeStats(trades), [trades]);
  const dailyStats = useMemo(() => cachedDailyStats(sessions, startingBalance), [sessions, startingBalance]);
  const plan = useMemo(() => findPlan(planId), [planId]);
  const accounts = useMemo(() => cachedAccounts(sessions), [sessions]);
  const planEval = useMemo(() => (plan ? cachedPlanEval(plan, sessions, trades, planAccount || undefined) : null), [plan, sessions, trades, planAccount]);

  return { sessions, trades, tradeStats, dailyStats, plan, planEval, startingBalance, accounts, planAccount };
}
