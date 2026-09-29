/** Taux de réussite d'équilibre : `1 / (1 + payoff)`. Payoff nul ou non fini → pas de repère. */
export function breakevenWinRate(payoff: number): number | null {
  if (!Number.isFinite(payoff) || payoff <= 0) return null;
  return 1 / (1 + payoff);
}
