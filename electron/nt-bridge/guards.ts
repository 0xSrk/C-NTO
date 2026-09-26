/**
 * Garde-fous du chemin d'ordres. Défauts : comptes `Sim*`, plafond 20 contrats,
 * coupe-circuit si le lien est `lost`, tag obligatoire. Le kill switch ferme
 * le canal jusqu'au redémarrage du process.
 */
import { ERR, type OrderSubmitParams } from './protocol';

export const DEFAULT_MAX_CONTRACTS = 20;

export type LinkState = 'absent' | 'connecting' | 'live' | 'stale' | 'lost';

export interface GuardPolicy {
  extraAccounts: string[];
  maxContractsPerOrder: number;
}

export interface GuardSnapshot {
  link: LinkState;
  /** Vrai après le kill switch, jusqu'au redémarrage du desk. */
  ordersClosed: boolean;
}

export type GuardRefusal = { ok: false; code: number; message: string };
export type GuardOk = { ok: true };

export function accountAllowed(name: string, extraAccounts: readonly string[]): boolean {
  return name.startsWith('Sim') || extraAccounts.includes(name);
}

export function guardSubmit(order: OrderSubmitParams, policy: GuardPolicy, snap: GuardSnapshot): GuardOk | GuardRefusal {
  if (!order.tag.trim()) return { ok: false, code: ERR.TAG, message: 'tag obligatoire' };
  if (!accountAllowed(order.account, policy.extraAccounts)) {
    return { ok: false, code: ERR.ACCOUNT, message: `compte non autorisé : ${order.account}` };
  }
  if (snap.ordersClosed || snap.link !== 'live') {
    return { ok: false, code: ERR.LOST, message: snap.ordersClosed ? 'canal d’ordres fermé' : 'pont indisponible' };
  }
  if (order.quantity > policy.maxContractsPerOrder) {
    return { ok: false, code: ERR.QUANTITY, message: `plafond ${policy.maxContractsPerOrder} contrats` };
  }
  return { ok: true };
}

export function guardAccountCommand(account: string, policy: GuardPolicy, snap: GuardSnapshot): GuardOk | GuardRefusal {
  if (!accountAllowed(account, policy.extraAccounts)) {
    return { ok: false, code: ERR.ACCOUNT, message: `compte non autorisé : ${account}` };
  }
  if (snap.ordersClosed || snap.link !== 'live') {
    return { ok: false, code: ERR.LOST, message: snap.ordersClosed ? 'canal d’ordres fermé' : 'pont indisponible' };
  }
  return { ok: true };
}

/** Comptes connus que le kill switch doit aplatir (Sim* ou liste explicite). */
export function killSwitchAccounts(known: readonly string[], extraAccounts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of known) {
    if (accountAllowed(name, extraAccounts) && !out.includes(name)) out.push(name);
  }
  return out;
}
