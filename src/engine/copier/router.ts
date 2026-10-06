import type { OrderRequest, OrderSide } from '../execution/port';
import { evaluatePlan, planMargin, type PropPlan } from '../propfirm';
import type { Session, Trade } from '../types';
import { followerTarget, positionKey, splitMove } from './position';
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
  /**
   * Exposition copiée du maître sur l'instrument du fill, après le fill (voir `position.ts`).
   * Absente : le maître partait de zéro, l'exposition est le fill lui-même.
   */
  copied?: number;
  /** Positions déjà commandées par le copieur, `compte|instrument` → quantité signée. Absent : aucune. */
  commanded?: Record<string, number>;
  /** Positions réelles des suiveurs d'après le pont, `compte|instrument` → quantité signée. Absent : inconnues. */
  actual?: Record<string, number>;
  /** P&L latent des suiveurs d'après le pont, compte → USD. Absent : aucun. */
  unrealized?: Record<string, number>;
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
 * Le suiveur est amené à la cible de l'exposition copiée du maître : on envoie l'écart avec la position
 * déjà commandée, pas le fill. Ce qui réduit le risque (sortie, réduction, clôture avant retournement)
 * part toujours : ni budget de latence, ni fenêtre, ni blackout, ni marge prop, ni plafond du suiveur ne
 * peuvent laisser un suiveur en position quand le maître sort. La réduction est bornée par la position
 * réelle du suiveur quand le pont la connaît (jamais de position inverse), et découpée au plafond du pont.
 * Ce qui ouvre ou augmente passe par toutes les gardes. Un fill qui n'est pas celui du maître ne produit rien.
 */
export function routeFill(fill: MasterFill, topology: CopierTopology, context: RouteContext): RouteResult {
  if (fill.account !== topology.masterAccount) return { orders: [], refused: [] };
  // Jamais le maître lui-même : un ordre copié redeviendrait un fill du maître (boucle).
  const followers = topology.followers.filter((follower) => follower.account.startsWith('Sim') && follower.account !== topology.masterAccount);
  const refused: Refusal[] = [];
  const orders: OrderRequest[] = [];
  const signed = fill.side === 'buy' ? fill.qty : -fill.qty;
  const copied = context.copied ?? signed;
  const stale = context.now - fill.time > topology.latencyBudgetMs;
  const closed = !inCopyWindow(context.localMinutes, topology.windowStart, topology.windowEnd);
  const blackout = topology.newsBlackout && context.catalysts.some((row) => Number.isFinite(row.at) && Math.abs(fill.time - row.at) <= BLACKOUT_MS);
  const gate: RefusalReason | null = stale ? 'latency' : closed ? 'window' : blackout ? 'blackout' : null;
  const cap = Math.max(1, Math.floor(context.maxContractsPerOrder));
  const push = (follower: FollowerRule, instrument: string, delta: number) => {
    let left = Math.abs(delta);
    while (left > 0) {
      const qty = Math.min(left, cap);
      orders.push({ account: follower.account, instrument, side: delta > 0 ? 'buy' : 'sell', qty, type: 'market', tag: COPY_TAG });
      left -= qty;
    }
  };
  for (const follower of followers) {
    const goal = followerTarget(copied, fill.instrument, follower);
    if (goal.unmapped) {
      refused.push(refusal('instrument', follower, fill.instrument, fill.qty));
      continue;
    }
    const key = positionKey(follower.account, goal.instrument);
    const held = context.commanded?.[key] ?? 0;
    const move = splitMove(held, goal.target);
    if (move.reduce !== 0) {
      // Ne jamais réduire au-delà de ce que le suiveur détient réellement : pas de position inverse.
      const actual = context.actual?.[key];
      const room = actual === undefined ? Math.abs(move.reduce) : Math.sign(actual) === Math.sign(held) ? Math.abs(actual) : 0;
      const reduce = Math.sign(move.reduce) * Math.min(Math.abs(move.reduce), room);
      if (reduce !== 0) push(follower, goal.instrument, reduce);
    }
    if (move.open === 0) continue;
    const qty = Math.abs(move.open);
    if (gate) {
      refused.push(refusal(gate, follower, goal.instrument, qty));
      continue;
    }
    if (!Number.isInteger(goal.target) || !Number.isInteger(qty) || Math.abs(goal.target) > follower.sizing.maxContracts || qty > context.maxContractsPerOrder) {
      refused.push(refusal('cap', follower, goal.instrument, qty));
      continue;
    }
    const state = context.states.find((row) => row.account === follower.account);
    if (state?.plan) {
      // Même lecture que la garde de l'agent : la marge datée de la jauge K.04 (la marge de clôture sans
      // séance rejouée), diminuée d'un latent négatif du suiveur. Un latent positif ne relève rien.
      const replay = evaluatePlan(state.plan, state.sessions, state.trades, follower.account);
      const unrealized = context.unrealized?.[follower.account];
      const live = (planMargin(replay)?.margin ?? replay.buffer) + Math.min(0, typeof unrealized === 'number' && Number.isFinite(unrealized) ? unrealized : 0);
      const cushion = state.plan.maxDrawdown * topology.followerBufferFloor;
      if (replay.status === 'echec' || !(live >= cushion)) {
        refused.push(refusal('floor', follower, goal.instrument, qty));
        continue;
      }
    }
    push(follower, goal.instrument, move.open);
  }
  return { orders, refused };
}
