import type { Trade } from '../types';

/**
 * Clé d'idempotence d'une exécution NT.
 * Si l'ID CSV n'est pas vide : account + NUL + executionId.
 * Sinon djb2 (hex 8) de account|instrument|timeIso|price|qty|action —
 * un seul algo, synchrone, déterministe (pas de SubtleCrypto).
 */
export function executionIdentityKey(input: {
  account: string;
  executionId: string;
  instrument: string;
  timeIso: string;
  price: number;
  qty: number;
  action: string;
}): string {
  const id = input.executionId.trim();
  if (id) return `${input.account}\0${id}`;
  return djb2Hex(`${input.account}|${input.instrument}|${input.timeIso}|${input.price}|${input.qty}|${input.action}`);
}

function djb2Hex(s: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function executionTimeIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Conserve les trades dont au moins une clé d'exécution n'a pas encore été importée. */
export function takeNewExecutionTrades(trades: Trade[], tradeKeys: string[][], knownKeys: ReadonlySet<string>): { trades: Trade[]; tradeKeys: string[][] } {
  const out: Trade[] = [];
  const outKeys: string[][] = [];
  for (let i = 0; i < trades.length; i++) {
    const tk = tradeKeys[i] ?? [];
    if (tk.length > 0 && tk.every((k) => knownKeys.has(k))) continue;
    out.push(trades[i]!);
    outKeys.push(tk);
  }
  return { trades: out, tradeKeys: outKeys };
}
