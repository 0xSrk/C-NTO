import { evaluatePlan, findPlan, planMargin, type PropEvaluation, type PropPlan } from '@/engine/propfirm';
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
  | { kind: 'plan'; limit: number; margin: number; used: number; highWater: number; floor: number; lastLow: number; date: string; status: PropEvaluation['status'] }
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
    const ev = evaluatePlan(plan, [...input.history.sessions], [...input.history.trades], account);
    const margin = planMargin(ev);
    if (margin) return { kind: 'plan', limit: plan.maxDrawdown, ...margin, status: ev.status, used: Math.max(0, Math.min(1, 1 - margin.margin / plan.maxDrawdown)) };
  }
  const limit = plan?.maxDrawdown ?? null;
  const dd = input.maxDrawdown;
  const used = limit && limit > 0 ? Math.min(1, dd / limit) : dd > 0 ? Math.min(1, dd / (input.startingBalance || dd)) : 0;
  return { kind: 'clotures', limit, maxDrawdown: dd, used };
}

/** Part de la borne consommée à partir de laquelle la jauge K.04 passe en attention (signal de niveau 2). */
export const BORNE_WARN = 0.8;

/**
 * Signal de la jauge K.04, d'après la borne du plan suivi : 3 (critique) quand elle est franchie — marge épuisée,
 * compte invalidé, repli au-delà de la limite —, 2 (attention) dès `BORNE_WARN` consommés, 0 en deçà ou sans borne.
 */
export function borneSignal(gauge: DrawdownGauge): 0 | 2 | 3 {
  if (gauge.kind === 'plan') {
    if (gauge.margin <= 0 || gauge.status === 'echec') return 3;
    return gauge.used >= BORNE_WARN ? 2 : 0;
  }
  if (gauge.limit == null || !(gauge.limit > 0)) return 0;
  if (gauge.maxDrawdown >= gauge.limit) return 3;
  return gauge.maxDrawdown / gauge.limit >= BORNE_WARN ? 2 : 0;
}


/**
 * Lien entre le compte filtré et le plan suivi (Firme prop) : `suivre` propose de suivre le plan
 * pour ce compte, `suivi` le dit ; sans compte filtré, rien (le sélecteur des comptes s'en charge).
 */
export function planTracking(filtered: string | null, tracked: string): 'suivre' | 'suivi' | null {
  if (!filtered) return null;
  return tracked === filtered ? 'suivi' : 'suivre';
}
