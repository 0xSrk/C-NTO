/**
 * Garde-fous du chemin d'ordres. Les décisions sont dans le moteur
 * (`src/engine/execution/guards.ts`) ; ce fichier garde les signatures
 * et les réexporte. Le JavaScript du moteur est émis vers
 * `dist-electron/execution/guards.js` (`electron/tsconfig.sources.json`).
 */
import {
  DEFAULT_MAX_CONTRACTS,
  accountAllowed as accountAllowedPure,
  guardAccountCommand as guardAccountCommandPure,
  guardSubmit as guardSubmitPure,
  killSwitchAccounts as killSwitchAccountsPure,
  type GuardDecision,
  type GuardPolicy,
  type GuardSnapshot,
  type LinkState,
} from '../execution/guards';

export type { GuardDecision, GuardPolicy, GuardSnapshot, LinkState };
export { DEFAULT_MAX_CONTRACTS };

export function accountAllowed(name: string, extraAccounts: readonly string[]): boolean {
  return accountAllowedPure(name, extraAccounts);
}

export function guardSubmit(order: { account: string; quantity: number; tag: string }, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision {
  return guardSubmitPure(order, policy, snap);
}

export function guardAccountCommand(account: string, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision {
  return guardAccountCommandPure(account, policy, snap);
}

export function killSwitchAccounts(known: readonly string[], extraAccounts: readonly string[]): string[] {
  return killSwitchAccountsPure(known, extraAccounts);
}
