/**
 * Types du module émis vers `dist-electron/execution/guards.js`.
 * L'implémentation est `src/engine/execution/guards.ts`.
 */
export const DEFAULT_MAX_CONTRACTS: number;
export const GUARD: { readonly ACCOUNT: -32010; readonly LOST: -32011; readonly QUANTITY: -32012; readonly TAG: -32013 };
export type LinkState = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
export interface GuardPolicy {
  extraAccounts: readonly string[];
  maxContractsPerOrder: number;
}
export interface GuardSnapshot {
  link: LinkState;
  ordersClosed: boolean;
}
export interface GuardOrder {
  account: string;
  quantity: number;
  tag: string;
}
export type GuardRefusal = { ok: false; code: number; message: string };
export type GuardOk = { ok: true };
export type GuardDecision = GuardOk | GuardRefusal;
export function accountAllowed(name: string, extraAccounts: readonly string[]): boolean;
export function guardSubmit(order: GuardOrder, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision;
export function guardAccountCommand(account: string, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision;
export function killSwitchAccounts(known: readonly string[], extraAccounts: readonly string[]): string[];
