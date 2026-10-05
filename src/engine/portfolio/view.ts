import { findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { exposure, type Exposure } from './exposure';
import type { BridgeSnapshot, CashBalance, Coeur, FxRate, Pocket, PocketValuation, Position } from './types';
import { consolidate, valuePocket } from './valuation';

/** Comptes du pont tels que le renderer les tient (`NtBridgeStatus`). */
export interface BridgeAccountsView {
  link: string;
  accounts: { name: string; cashValue: number; unrealizedPnl: number; positions: { instrument: string; quantity: number; avgPrice: number }[] }[];
}

/** Un instantané par compte, seulement si le pont est vivant. */
export function bridgeSnapshots(nt: BridgeAccountsView | null, now: number): BridgeSnapshot[] {
  if (!nt || nt.link !== 'live') return [];
  return nt.accounts.map((a) => ({ account: a.name, cashValue: a.cashValue, unrealizedPnl: a.unrealizedPnl, positions: a.positions, at: now }));
}

export interface PortfolioViewInput {
  pockets: readonly Pocket[];
  positions: Position[];
  cash: CashBalance[];
  fx: FxRate[];
  base: string;
  sessions: Session[];
  trades: Trade[];
  snapshots: readonly BridgeSnapshot[];
  now: number;
}

/** Valorisation par poche, valeur nette consolidée et exposition : la vue de l'écran Portefeuille. */
export function portfolioView(input: PortfolioViewInput): { valuations: PocketValuation[]; coeur: Coeur; exposure: Exposure } {
  const active = input.pockets.filter((p) => !p.archivedAt);
  const valuations = active.map((pocket) =>
    valuePocket(pocket, {
      now: input.now,
      sessions: input.sessions,
      trades: input.trades,
      plan: pocket.planId ? findPlan(pocket.planId) : undefined,
      bridgeSnapshot: input.snapshots.find((snap) => snap.account === (pocket.account ?? '')) ?? null,
      positions: input.positions,
      cash: input.cash,
      fx: input.fx,
      base: input.base,
    }),
  );
  const coeur = consolidate(valuations, input.base, input.now);
  const expo = exposure({ pockets: active, positions: input.positions, snapshots: input.snapshots, fx: input.fx, base: input.base, now: input.now, netValue: coeur.netValue });
  return { valuations, coeur, exposure: expo };
}
