/**
 * Carte standard ↔ micro du registre (`instruments.ts`), sans importer
 * `@/lib/time` : ce module est aussi compilé pour le process principal.
 * Un test compare ces ratios à `microCounterpart`.
 */

export const CONTRACT_PAIRS: readonly { standard: string; micro: string; ratio: number }[] = [
  { standard: 'NQ', micro: 'MNQ', ratio: 10 },
  { standard: 'ES', micro: 'MES', ratio: 10 },
  { standard: 'RTY', micro: 'M2K', ratio: 10 },
  { standard: 'YM', micro: 'MYM', ratio: 10 },
  { standard: 'CL', micro: 'MCL', ratio: 10 },
  { standard: 'GC', micro: 'MGC', ratio: 10 },
  { standard: '6E', micro: 'M6E', ratio: 10 },
];

const BY_LENGTH = [...CONTRACT_PAIRS.flatMap((pair) => [pair.standard, pair.micro])].sort((a, b) => b.length - a.length || a.localeCompare(b));

export function microOf(root: string): { symbol: string; ratio: number } | null {
  const pair = CONTRACT_PAIRS.find((row) => row.standard === root);
  return pair ? { symbol: pair.micro, ratio: pair.ratio } : null;
}

export function standardOf(root: string): { symbol: string; ratio: number } | null {
  const pair = CONTRACT_PAIRS.find((row) => row.micro === root);
  return pair ? { symbol: pair.standard, ratio: pair.ratio } : null;
}

export function knownRoot(root: string): boolean {
  return CONTRACT_PAIRS.some((pair) => pair.standard === root || pair.micro === root);
}

/** `NQ 12-26` → racine `NQ` et reste ` 12-26`. Racine inconnue : `null`. */
export function splitRoot(instrument: string): { root: string; rest: string } | null {
  const trimmed = instrument.trim();
  const upper = trimmed.toUpperCase();
  for (const root of BY_LENGTH) {
    if (upper === root) return { root, rest: '' };
    if (upper.startsWith(`${root} `) || upper.startsWith(`${root}-`)) return { root, rest: trimmed.slice(root.length) };
  }
  return null;
}
