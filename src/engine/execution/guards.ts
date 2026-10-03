/**
 * Décisions pures du chemin d'ordres. Mêmes codes que le pont :
 * `-32010` compte, `-32011` lien, `-32012` plafond, `-32013` tag.
 */

export const DEFAULT_MAX_CONTRACTS = 20;

export const GUARD = {
  ACCOUNT: -32010,
  LOST: -32011,
  QUANTITY: -32012,
  TAG: -32013,
} as const;

export type LinkState = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';

export interface GuardPolicy {
  extraAccounts: readonly string[];
  maxContractsPerOrder: number;
}

export interface GuardSnapshot {
  link: LinkState;
  /** Vrai après le kill switch, jusqu'au redémarrage du desk. */
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

export function accountAllowed(name: string, extraAccounts: readonly string[]): boolean {
  return name.startsWith('Sim') || extraAccounts.includes(name);
}

export function guardSubmit(order: GuardOrder, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision {
  if (!order.tag.trim()) return { ok: false, code: GUARD.TAG, message: 'tag obligatoire' };
  if (!accountAllowed(order.account, policy.extraAccounts)) {
    return { ok: false, code: GUARD.ACCOUNT, message: `compte non autorisé : ${order.account}` };
  }
  if (snap.ordersClosed || snap.link !== 'live') {
    return { ok: false, code: GUARD.LOST, message: snap.ordersClosed ? 'canal d’ordres fermé' : 'pont indisponible' };
  }
  if (order.quantity > policy.maxContractsPerOrder) {
    return { ok: false, code: GUARD.QUANTITY, message: `plafond ${policy.maxContractsPerOrder} contrats` };
  }
  return { ok: true };
}

export function guardAccountCommand(account: string, policy: GuardPolicy, snap: GuardSnapshot): GuardDecision {
  if (!accountAllowed(account, policy.extraAccounts)) {
    return { ok: false, code: GUARD.ACCOUNT, message: `compte non autorisé : ${account}` };
  }
  if (snap.ordersClosed || snap.link !== 'live') {
    return { ok: false, code: GUARD.LOST, message: snap.ordersClosed ? 'canal d’ordres fermé' : 'pont indisponible' };
  }
  return { ok: true };
}

/** Comptes connus que le kill switch doit aplatir (`Sim*` ou liste explicite). */
export function killSwitchAccounts(known: readonly string[], extraAccounts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of known) {
    if (accountAllowed(name, extraAccounts) && !out.includes(name)) out.push(name);
  }
  return out;
}
