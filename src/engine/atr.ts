import type { Bar } from './bars';

/** True range de Wilder. La première bougie n'a pas de clôture précédente : high − low. */
export function trueRanges(bars: readonly Pick<Bar, 'high' | 'low' | 'close'>[]): number[] {
  return bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const previousClose = bars[index - 1]?.close ?? bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
}

/**
 * ATR de Wilder. Null avant la fin de la première période.
 * Même suite que l'indicateur `atr` : la première valeur est la moyenne des vrais ranges,
 * puis chaque pas est `((précédent × (période − 1)) + vrai range) / période`.
 */
export function atrSeries(bars: readonly Pick<Bar, 'high' | 'low' | 'close'>[], period = 14): (number | null)[] {
  const ranges = trueRanges(bars);
  const out: (number | null)[] = new Array(bars.length).fill(null);
  const length = Math.floor(period);
  if (!(length >= 1)) return out;
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i] ?? 0;
    if (i < length) {
      seed += range;
      if (i === length - 1) {
        prev = seed / length;
        out[i] = prev;
      }
      continue;
    }
    prev = ((prev ?? 0) * (length - 1) + range) / length;
    out[i] = prev;
  }
  return out;
}
