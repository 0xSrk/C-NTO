import type { OrderRequest, OrderSide } from '../execution/port';

export const COPY_TAG: string;
export const BLACKOUT_MS: number;
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
  time: number;
  executionId: string;
}
export interface FollowerState {
  account: string;
  plan: unknown;
  sessions: unknown[];
  trades: unknown[];
}
export interface CopierTopology {
  masterAccount: string;
  followers: { account: string; sizing: { mode: 'fixe' | 'ratio' | 'risque'; value: number; maxContracts: number }; symbolMap: { mode: string; from?: string; to?: string } }[];
  latencyBudgetMs: number;
  newsBlackout: boolean;
  windowStart: string;
  windowEnd: string;
  followerBufferFloor: number;
}
export interface RouteContext {
  now: number;
  localMinutes: number;
  catalysts: { at: number }[];
  maxContractsPerOrder: number;
  states: FollowerState[];
}
export interface RouteResult {
  orders: OrderRequest[];
  refused: Refusal[];
}
export function routeFill(fill: MasterFill, topology: CopierTopology, context: RouteContext): RouteResult;
