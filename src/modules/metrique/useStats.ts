import { useMemo } from 'react';
import { computeDailyStats, computeTradeStats } from '@/engine/metrics';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';

/** Statistiques agrégées du journal complet, mémorisées. Le rejeu prop firm peut être restreint à un compte. */
export function useStats() {
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const startingBalance = useSettings((s) => s.settings.startingBalance);
  const planId = useSettings((s) => s.settings.planId);
  const planAccount = useSettings((s) => s.settings.planAccount);

  const tradeStats = useMemo(() => computeTradeStats(trades), [trades]);
  const dailyStats = useMemo(() => computeDailyStats(sessions, startingBalance), [sessions, startingBalance]);
  const plan = useMemo(() => findPlan(planId), [planId]);
  const accounts = useMemo(() => [...new Set(sessions.map((s) => s.account ?? ''))].sort(), [sessions]);
  const planEval = useMemo(() => (plan ? evaluatePlan(plan, sessions, trades, planAccount || undefined) : null), [plan, sessions, trades, planAccount]);

  return { sessions, trades, tradeStats, dailyStats, plan, planEval, startingBalance, accounts, planAccount };
}
