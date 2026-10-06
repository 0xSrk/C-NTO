import { describe, expect, it } from 'vitest';
import { bernoulliRun, betaPosterior, longestLossStreak, rateAfterStreak } from '@/engine/riskConsole';

describe('séries et Bayes', () => {
  it('Bernoulli : 5 gains à 60 % valent 0,0778, 5 pertes 0,0102', () => {
    expect(bernoulliRun(0.6, 5)).toBeCloseTo(0.0778, 4);
    expect(bernoulliRun(0.4, 5)).toBeCloseTo(0.0102, 4);
  });

  it('plus longue série de pertes sur 100 trades à 50 % : moyenne ≈ 6, 95e rang 9', () => {
    const streak = longestLossStreak(100, 0.5);
    expect(streak.mean).toBeGreaterThan(5.8);
    expect(streak.mean).toBeLessThan(6.2);
    expect(streak.p95).toBe(9);
  });

  it('Bayes : 55 gains sur 100 → 0,549 et [0,468 ; 0,629]', () => {
    const posterior = betaPosterior(55, 45);
    expect(posterior.mean).toBeCloseTo(0.549, 3);
    expect(posterior.low).toBeCloseTo(0.468, 3);
    expect(posterior.high).toBeCloseTo(0.629, 3);
  });

  it('lit le taux après deux pertes consécutives', () => {
    const after = rateAfterStreak([-1, -1, 1, -1, -1, -1], 2, 'loss');
    expect(after.count).toBe(2);
    expect(after.wins).toBe(1);
    expect(after.winRate).toBeCloseTo(0.5);
  });
});
