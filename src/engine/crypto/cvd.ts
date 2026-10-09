/**
 * Le CVD du chart crypto, côté renderer seulement (`docs/ONGLET-CRYPTO.md` § 5). Le delta d'une bougie est
 * `2 × buyVolume − volume` (acheteurs moins vendeurs) ; le CVD en est la somme cumulée. Une bougie sans
 * `buyVolume` n'a pas de delta : l'historique de Coinbase et de Bybit n'en porte pas, et la bougie entamée à
 * l'ouverture du flux non plus. Le CVD de ces venues commence donc à la première bougie observée en entier.
 * Ce module n'importe que des types de `./markets`.
 */
import type { CryptoBar } from './markets';

/** Acheteurs moins vendeurs de la bougie, ou `null` quand elle n'a pas de volume acheteur fini. */
function delta(bar: CryptoBar): number | null {
  if (typeof bar.buyVolume !== 'number') return null;
  const value = 2 * bar.buyVolume - bar.volume;
  return Number.isFinite(value) ? value : null;
}

/**
 * Les points de la ligne CVD, un par bougie et dans l'ordre de la série : la somme cumulée des deltas pour une
 * bougie qui a un `buyVolume`, un blanc `{ time }` sinon. Les blancs sont toutes les bougies d'avant la première
 * qui a un `buyVolume`, et une éventuelle bougie sans `buyVolume` plus loin, qui ne change pas le cumul.
 * Un `buyVolume` de 0 compte : tout le volume de la bougie est vendeur.
 */
export function cvdPoints(bars: readonly CryptoBar[]): { time: number; value?: number }[] {
  let total = 0;
  return bars.map((bar): { time: number; value?: number } => {
    const change = delta(bar);
    if (change === null) return { time: bar.time };
    total += change;
    return { time: bar.time, value: total };
  });
}

/** Le `time` de la première bougie qui a un `buyVolume` : là où le CVD commence. `null` quand aucune n'en a. */
export function cvdAnchor(bars: readonly CryptoBar[]): number | null {
  return bars.find((bar) => delta(bar) !== null)?.time ?? null;
}
