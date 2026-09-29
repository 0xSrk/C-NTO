import { findPlan } from '@/engine/propfirm';

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
