import { describe, expect, it } from 'vitest';
import { cusum, rollingBands } from '@/engine/inference';
import { mean, stddev } from '@/engine/metrics';

describe('suivi de stabilité', () => {
  it('pose la bande ± 1,96 σ / √n sur la fenêtre', () => {
    const series = [1, 2, 3, 4];
    const last = rollingBands(series, 2).at(-1)!;
    const window = [3, 4];
    const se = stddev(window) / Math.sqrt(window.length);
    expect(last.mean).toBeCloseTo(mean(window));
    expect(last.low).toBeCloseTo(last.mean - 1.96 * se);
    expect(last.high).toBeCloseTo(last.mean + 1.96 * se);
  });

  it('alerte CUSUM quand une moitié s’écarte, pas sur une série constante', () => {
    expect(cusum([2, 2, 2, 2]).alert).toBe(false);
    const shift = cusum([...Array(30).fill(0), ...Array(30).fill(10)]);
    expect(shift.alert).toBe(true);
    expect(shift.crossedAt).not.toBeNull();
    expect(shift.sigma).toBeGreaterThan(0);
  });
});
