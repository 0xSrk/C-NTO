import type { OrderRequest, OrderSide } from '../execution/port';
import { evaluatePlan, type PropPlan } from '../propfirm';
import type { Session, Trade } from '../types';
import { sizeFollower } from './sizing';
import type { CopierTopology, FollowerRule } from './types';

/** Tag d'ordre suiveur. Stable, sans secret. */
export const COPY_TAG = 'canto-cpy';
export const BLACKOUT_MS = 15 * 60 * 1000;

export type RefusalReason = 'latency' | 'window' | 'blackout' | 'floor' | 'cap' | 'instrument';

export interface Refusal {
  reason: RefusalReason;
  account: string;
  instrument: string;
  qty: number;
}

export interface MasterFill {
  account: string;
  instrument: string;
  side: OrderSide;
  qty: number;
  price: number;
  /** epoch millisecondes */
  time: number;
  executionId: string;
}

export interface FollowerState {
  account: string;
  plan: PropPlan | null;
  sessions: Session[];
  trades: Trade[];
}

export interface RouteContext {
  /** epoch ms au moment du routage — compare l'âge du fill au budget */
  now: number;
  /** Minutes depuis minuit, fuseau local de l'opérateur, sur l'heure du fill. */
  localMinutes: number;
  catalysts: { at: number }[];
  /** Plafond du pont, par ordre suiveur. */
  maxContractsPerOrder: number;
  states: FollowerState[];
}

export interface RouteResult {
  orders: OrderRequest[];
  refused: Refusal[];
}

function clockMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function inCopyWindow(localMinutes: number, start: string, end: string): boolean {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) return false;
  if (from <= to) return localMinutes >= from && localMinutes <= to;
  return localMinutes >= from || localMinutes <= to;
}

function refusal(reason: RefusalReason, follower: FollowerRule, instrument: string, qty: number): Refusal {
  return { reason, account: follower.account, instrument, qty };
}

/**
 * Fill maître → ordres suiveurs, ou refus motivés. Aucun effet.
 * Un fill qui n'est pas celui du maître unique ne produit rien.
 */
export function routeFill(fill: MasterFill, topology: CopierTopology, context: RouteContext): RouteResult {
  if (fill.account !== topology.masterAccount) return { orders: [], refused: [] };
  const followers = topology.followers.filter((follower) => follower.account.startsWith('Sim'));
  const refused: Refusal[] = [];
  const stale = context.now - fill.time > topology.latencyBudgetMs;
  const closed = !inCopyWindow(context.localMinutes, topology.windowStart, topology.windowEnd);
  const blackout = topology.newsBlackout && context.catalysts.some((row) => Number.isFinite(row.at) && Math.abs(fill.time - row.at) <= BLACKOUT_MS);
  if (stale || closed || blackout) {
    const reason: RefusalReason = stale ? 'latency' : closed ? 'window' : 'blackout';
    for (const follower of followers) refused.push(refusal(reason, follower, fill.instrument, fill.qty));
    return { orders: [], refused };
  }
  const orders: OrderRequest[] = [];
  for (const follower of followers) {
    const sized = sizeFollower({ qty: fill.qty, instrument: fill.instrument }, follower);
    if (sized.unmapped) {
      refused.push(refusal('instrument', follower, fill.instrument, fill.qty));
      continue;
    }
    if (!Number.isInteger(sized.qty) || sized.qty < 1 || sized.capped || sized.qty > context.maxContractsPerOrder) {
      refused.push(refusal('cap', follower, sized.instrument, sized.qty));
      continue;
    }
    const state = context.states.find((row) => row.account === follower.account);
    if (state?.plan) {
      const replay = evaluatePlan(state.plan, state.sessions, state.trades, follower.account);
      const cushion = state.plan.maxDrawdown * topology.followerBufferFloor;
      if (replay.status === 'echec' || !(replay.buffer >= cushion)) {
        refused.push(refusal('floor', follower, sized.instrument, sized.qty));
        continue;
      }
    }
    orders.push({
      account: follower.account,
      instrument: sized.instrument,
      side: fill.side,
      qty: sized.qty,
      type: 'market',
      tag: COPY_TAG,
    });
  }
  return { orders, refused };
}
