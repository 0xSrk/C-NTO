import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  blockBootstrapCi,
  blockLengthOf,
  designEffect,
  intraclassCorrelation,
  minimumDetectableEffect,
  permutationPValues,
  shrinkTowardMean,
  shrinkageWeight,
} from '@/engine/inference';

describe('bootstrap par blocs', () => {
  it('centre la moyenne observée, et une série constante a un intervalle ponctuel', () => {
    const spread = blockBootstrapCi([0, 100], { draws: 200, seed: 1, blockLength: 1 });
    expect(spread.center).toBe(50);
    expect(spread.low).toBeLessThan(spread.center);
    expect(spread.high).toBeGreaterThan(spread.center);
    const flat = blockBootstrapCi([7, 7, 7, 7], { draws: 50, seed: 2 });
    expect(flat.center).toBe(7);
    expect(flat.low).toBe(7);
    expect(flat.high).toBe(7);
  });

  it('ignore les valeurs non finies et reste reproductible', () => {
    const a = blockBootstrapCi([1, Number.NaN, 3, 5], { draws: 100, seed: 4, level: 0.9 });
    const b = blockBootstrapCi([1, 3, 5], { draws: 100, seed: 4, level: 0.9 });
    expect(a).toEqual(b);
    expect(a.center).toBe(3);
    expect(blockLengthOf(8)).toBe(2);
    expect(a.blockLength).toBe(blockLengthOf(3));
  });

  it('série vide : centre et bornes à zéro', () => {
    expect(blockBootstrapCi([])).toEqual({ center: 0, low: 0, high: 0, blockLength: 1, draws: 5_000 });
  });
});

describe('permutation et Benjamini-Hochberg', () => {
  it('p = 1 quand toutes les valeurs sont égales, et reste sous la graine', () => {
    const flat = permutationPValues([4, 4, 4, 4], [[0, 1]], { draws: 100, seed: 1 });
    expect(flat).toEqual([1]);
    const values = [...Array(20).fill(0), ...Array(10).fill(5)];
    const group = Array.from({ length: 10 }, (_, i) => 20 + i);
    const once = permutationPValues(values, [group], { draws: 400, seed: 7 });
    const again = permutationPValues(values, [group], { draws: 400, seed: 7 });
    expect(once).toEqual(again);
    expect(once[0]!).toBeLessThan(0.05);
    expect(once[0]!).toBeGreaterThanOrEqual(1 / 401);
  });

  it('un groupe vide ne rejette rien', () => {
    expect(permutationPValues([1, 2, 3], [[]], { draws: 20, seed: 1 })).toEqual([1]);
  });

  it('retient les p-valeurs jusqu’au plus grand rang sous le seuil', () => {
    expect(benjaminiHochberg([0.001, 0.01, 0.03, 0.2], 0.05)).toEqual([true, true, true, false]);
    expect(benjaminiHochberg([0.2, 0.3], 0.05)).toEqual([false, false]);
    expect(benjaminiHochberg([0.04, 0.04], 0.05)).toEqual([true, true]);
    expect(benjaminiHochberg([])).toEqual([]);
    expect(benjaminiHochberg([Number.NaN, 0.001], 0.05)).toEqual([false, true]);
  });
});

describe('écart détectable et rapprochement', () => {
  it('calcule 2,8 × σ × √(1/n₁ + 1/n₂) × √deff', () => {
    const halves = 2.8 * 1.27 * Math.sqrt(1 / 235 + 1 / 235);
    const tenth = 2.8 * 1.27 * Math.sqrt(1 / 47 + 1 / 423);
    expect(minimumDetectableEffect(1.27, 235, 235)).toBeCloseTo(halves, 12);
    expect(minimumDetectableEffect(1.27, 47, 423)).toBeCloseTo(tenth, 12);
    expect(halves).toBeCloseTo(0.328, 3);
    expect(tenth).toBeCloseTo(0.547, 3);
    expect(designEffect(0.5, 3)).toBe(2);
    expect(minimumDetectableEffect(1.27, 235, 235, 0.5, 3)).toBeCloseTo(halves * Math.sqrt(2), 12);
    expect(designEffect(-0.2, 5)).toBe(1);
  });

  it('ICC = 1 quand les grappes sont constantes et distinctes', () => {
    const { icc, meanClusterSize } = intraclassCorrelation([
      [0, 0],
      [1, 1],
    ]);
    expect(icc).toBeCloseTo(1);
    expect(meanClusterSize).toBeCloseTo(2);
    expect(intraclassCorrelation([[], [Number.NaN]])).toEqual({ icc: 0, meanClusterSize: 1 });
  });

  it('rapproche un petit groupe plus qu’un grand, poids n / (n + k)', () => {
    expect(shrinkageWeight(10, 4, 2)).toBeCloseTo(10 / (10 + 2));
    expect(shrinkageWeight(10, 4, 0)).toBe(0);
    const shrunk = shrinkTowardMean([
      { n: 4, mean: 0, variance: 1 },
      { n: 40, mean: 10, variance: 1 },
    ]);
    const grand = (4 * 0 + 40 * 10) / 44;
    expect(shrunk[0]!.shrunk).toBeGreaterThan(0);
    expect(shrunk[0]!.shrunk).toBeLessThan(grand);
    expect(shrunk[0]!.weight).toBeLessThan(shrunk[1]!.weight);
    expect(shrunk[1]!.shrunk).toBeLessThan(10);
    expect(shrunk[1]!.shrunk).toBeGreaterThan(grand);
    const tied = shrinkTowardMean([
      { n: 5, mean: 3, variance: 1 },
      { n: 8, mean: 3, variance: 2 },
    ]);
    expect(tied[0]!.shrunk).toBeCloseTo(3);
    expect(tied[1]!.shrunk).toBeCloseTo(3);
  });
});
