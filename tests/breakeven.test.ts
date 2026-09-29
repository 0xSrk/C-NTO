import { describe, expect, it } from 'vitest';
import { breakevenWinRate } from '@/lib/breakeven';

describe('breakevenWinRate', () => {
  it('payoff 1 → 0,5', () => {
    expect(breakevenWinRate(1)).toBeCloseTo(0.5);
  });

  it('171,3 / 126 → environ 0,424', () => {
    expect(breakevenWinRate(171.3 / 126)).toBeCloseTo(0.424, 3);
  });

  it('payoff nul ou non fini → null', () => {
    expect(breakevenWinRate(0)).toBeNull();
    expect(breakevenWinRate(-1)).toBeNull();
    expect(breakevenWinRate(Number.POSITIVE_INFINITY)).toBeNull();
    expect(breakevenWinRate(Number.NaN)).toBeNull();
  });
});
