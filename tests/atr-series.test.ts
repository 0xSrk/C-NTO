import { describe, expect, it } from 'vitest';
import { atrSeries } from '@/engine/atr';
import type { Bar } from '@/engine/bars';
import { indicatorById } from '@/engine/indicators';

function bars(n: number): Bar[] {
  const out: Bar[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = open + ((i % 5) - 2) * 0.5;
    const high = Math.max(open, close) + 1 + (i % 3) * 0.25;
    const low = Math.min(open, close) - 0.75 - (i % 4) * 0.1;
    out.push({ time: 1_700_000_000 + i * 60, open, high, low, close, volume: 10 });
  }
  return out;
}

describe('ATR de Wilder', () => {
  it('égale l’indicateur atr sur les mêmes bougies', () => {
    const sample = bars(40);
    const pure = atrSeries(sample, 14);
    const indicator = indicatorById('atr')?.compute(sample, { period: 14 });
    const line = indicator?.lines[0]?.data ?? [];
    expect(pure.slice(0, 13).every((value) => value == null)).toBe(true);
    expect(pure[13]).toBeTypeOf('number');
    for (let i = 0; i < sample.length; i++) {
      const value = pure[i];
      const point = line.find((row) => row.time === sample[i]?.time);
      if (value == null) expect(point?.value).toBeUndefined();
      else expect(point?.value).toBe(value);
    }
  });
});
