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

  it('exclut les trades nuls du taux après une série, comme le taux de base', () => {
    // Après une perte : un nul, un gain, un nul. Seul le gain compte : 1 sur 1, pas 1 sur 3.
    expect(rateAfterStreak([-1, 0, -1, 1, -1, 0], 1, 'loss')).toEqual({ count: 1, wins: 1, winRate: 1 });
    expect(rateAfterStreak([1, 0, 1, -1], 1, 'win')).toEqual({ count: 1, wins: 0, winRate: 0 });
    expect(rateAfterStreak([-1, 0], 1, 'loss')).toEqual({ count: 0, wins: 0, winRate: null });
    // Comportement gardé : un nul interrompt la série qui précède.
    expect(rateAfterStreak([-1, 0, -1, 1], 2, 'loss')).toEqual({ count: 0, wins: 0, winRate: null });
  });
});
