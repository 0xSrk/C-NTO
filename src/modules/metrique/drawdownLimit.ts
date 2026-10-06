import { evaluatePlan, findPlan, planMargin, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';

/**
 * Limite de drawdown affichée seulement si un seul compte prop, porteur d'un plan, est filtré.
 * « Tous les comptes » ou un compte sans plan → pas de limite inventée.
 */
export function metricDrawdownLimit(input: {
  selected: string | null;
  planId: string;
  planAccount: string;
}): number | null {
  if (!input.selected) return null;
  if (!input.planAccount || input.planAccount !== input.selected) return null;
  const plan = findPlan(input.planId);
  if (!plan) return null;
  return plan.maxDrawdown;
}

export type DrawdownGauge =
  | { kind: 'plan'; limit: number; margin: number; used: number; highWater: number; floor: number; lastLow: number }
  | { kind: 'clotures'; limit: number | null; maxDrawdown: number; used: number };

/**
 * Jauge de repli du tableau de bord.
 * - Plan suivi pour le compte filtré : la marge du rejeu `evaluatePlan` sur **tout** l'historique du
 *   compte, au plus-bas de la dernière séance (le plancher ne dépend pas de la période affichée).
 * - Sinon : le repli sur clôtures de la période affichée, dit comme tel.
 */
export function drawdownGauge(input: {
  plan: PropPlan | null;
  account: string | null;
  history: { sessions: readonly Session[]; trades: readonly Trade[] };
  maxDrawdown: number;
  startingBalance: number;
}): DrawdownGauge {
  const { plan, account } = input;
  if (plan && account && plan.maxDrawdown > 0) {
    const margin = planMargin(evaluatePlan(plan, [...input.history.sessions], [...input.history.trades], account));
    if (margin) return { kind: 'plan', limit: plan.maxDrawdown, ...margin, used: Math.max(0, Math.min(1, 1 - margin.margin / plan.maxDrawdown)) };
  }
  const limit = plan?.maxDrawdown ?? null;
  const dd = input.maxDrawdown;
  const used = limit && limit > 0 ? Math.min(1, dd / limit) : dd > 0 ? Math.min(1, dd / (input.startingBalance || dd)) : 0;
  return { kind: 'clotures', limit, maxDrawdown: dd, used };
}

