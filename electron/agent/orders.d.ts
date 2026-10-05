/**
 * Types du module émis vers `dist-electron/agent/orders.js`.
 * L'implémentation est `src/engine/agent/orders.ts`.
 */
export const AGENT_ORDER_TAG: string;
export const AGENT_REASON_MAX: number;
export const AGENT_PROP_FLOOR: number;
export const AGENT_RATE_WINDOW_MS: number;
export type AgentOrderType = 'market' | 'limit' | 'stop';
export interface AgentOrderProposal {
  account: string;
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  type: AgentOrderType;
  limit?: number;
  stop?: number;
  reason: string;
}
export interface AgentOrderPolicy {
  enabled: boolean;
  maxQty: number;
  maxPosition: number;
  perMinute: number;
}
export const AGENT_ORDER_DEFAULTS: AgentOrderPolicy;
export const AGENT_ORDER_BOUNDS: { readonly maxQty: readonly [1, 50]; readonly maxPosition: readonly [1, 100]; readonly perMinute: readonly [1, 10] };
export const AGENT_ORDER_LIMITS: readonly ('maxQty' | 'maxPosition' | 'perMinute')[];
export const AGENT_ORDER_REFUSALS: readonly ['disabled', 'not_sim', 'busy', 'link', 'orders_closed', 'rate', 'quantity', 'position', 'prop_buffer'];
export type AgentOrderRefusal = (typeof AGENT_ORDER_REFUSALS)[number];
export interface AgentOrderSnapshot {
  now: number;
  link: string;
  ordersOpen: boolean;
  position: number;
  recent: readonly number[];
  busy: boolean;
  propShare: number | null;
}
export function parseProposal(raw: unknown): { ok: true; proposal: AgentOrderProposal } | { ok: false; detail: string };
export function coerceAgentPolicy(raw: unknown, enabled?: boolean): AgentOrderPolicy;
export function raisedLimits(current: AgentOrderPolicy, next: AgentOrderPolicy): ('maxQty' | 'maxPosition' | 'perMinute')[];
export function signedQty(p: Pick<AgentOrderProposal, 'side' | 'qty'>): number;
export function reducesRisk(position: number, resulting: number): boolean;
export function guardProposal(
  p: AgentOrderProposal,
  policy: AgentOrderPolicy,
  snap: AgentOrderSnapshot,
): { ok: true; resulting: number; reducing: boolean } | { ok: false; reason: AgentOrderRefusal; detail: string };
