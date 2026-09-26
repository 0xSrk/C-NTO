import { drawdownSeries } from '@/engine/metrics';
import type { PropPlan } from '@/engine/propfirm';
import { evaluatePlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import type { ConsolidatedPoint, PropDistance } from './types';

/** Distance aux seuils du plan, rejoués par `evaluatePlan`. L'alerte est à 25 % du drawdown maximal. */
export function propDistance(plan: PropPlan, sessions: readonly Session[], trades: readonly Trade[], account?: string): PropDistance {
  const ev = evaluatePlan(plan, [...sessions], [...trades], account);
  const last = ev.timeline[ev.timeline.length - 1];
  const used = last ? -Math.min(0, last.intradayLow) : 0;
  const toDrawdown = ev.buffer;
  return {
    toDrawdown,
    toDailyLoss: plan.dailyLossLimit === undefined ? null : plan.dailyLossLimit - used,
    toTarget: ev.remainingToTarget,
    daysTraded: ev.daysTraded,
    status: ev.status,
    alert: toDrawdown <= plan.maxDrawdown * 0.25,
  };
}

export interface RiskSummary {
  currentDrawdown: number;
  maxDrawdown: number;
  /** Journées sous le plus haut, jusqu'à la récupération. */
  maxDurationDays: number;
}

/**
 * Drawdown de la courbe consolidée via `drawdownSeries`.
 * Les incréments sont les variations d'équité, le solde de départ est la première valeur :
 * le pic et le creux sont ceux de la valeur nette, pas ceux du seul PnL de trading.
 */
export function riskFromEquity(series: readonly ConsolidatedPoint[]): RiskSummary {
  const first = series[0];
  if (!first) return { currentDrawdown: 0, maxDrawdown: 0, maxDurationDays: 0 };
  const points = series.map((p, i) => {
    const prev = i === 0 ? p.equity : (series[i - 1]?.equity ?? p.equity);
    return { t: Date.parse(`${p.date}T00:00:00Z`), pnl: i === 0 ? 0 : p.equity - prev };
  });
  const dd = drawdownSeries(points, first.equity);
  return { currentDrawdown: dd.currentDrawdown, maxDrawdown: dd.maxDrawdown, maxDurationDays: dd.maxDrawdownPeriods };
}
