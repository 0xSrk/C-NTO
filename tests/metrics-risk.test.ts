import { describe, expect, it } from 'vitest';
import { adjustedRiskPoints, expectancy, expectancyR, floorMicroContracts, rrMatrix, theoreticalContracts, theoreticalNotional, thresholdWinRate, tradeRisk } from '@/engine/riskConsole';

describe('risque du trade', () => {
  it('achat de 2 MNQ, stop à 10 points, sortie à +60 $ : 40 $, +1,5 R, source stop', () => {
    const risk = tradeRisk(
      {
        instrument: 'MNQ',
        qty: 2,
        entryPrice: 20_000,
        stopPrice: 19_990,
        pnl: 60,
      },
      25,
      10_000,
    );
    expect(risk.source).toBe('stop');
    expect(risk.risk).toBeCloseTo(40);
    expect(risk.realizedR).toBeCloseTo(1.5);
    expect(risk.lossPct).toBeCloseTo(0.004);
    expect(risk.stopPoints).toBeCloseTo(10);
  });

  it('retombe sur le risque saisi, puis sur le montant fixe', () => {
    const entered = tradeRisk({ instrument: 'NQ', qty: 1, entryPrice: 20_000, pnl: 100, risk: 80 }, 25, 10_000);
    expect(entered.source).toBe('saisi');
    expect(entered.risk).toBe(80);
    const fixed = tradeRisk({ instrument: 'NQ', qty: 2, entryPrice: 20_000, pnl: -10 }, 25, 10_000);
    expect(fixed.source).toBe('fixe');
    expect(fixed.risk).toBe(50);
    expect(tradeRisk({ instrument: 'NQ', qty: 1, entryPrice: 20_000, pnl: 0 }).source).toBe('absent');
  });

  it('exemple de la console : R/R 2, espérance 875, seuil 33,3 %', () => {
    expect(1_250 / 625).toBe(2);
    expect(expectancy(0.8, 1_250, 625)).toBe(875);
    expect(thresholdWinRate(2)).toBeCloseTo(1 / 3);
  });

  it('matrice : 0,00 R à 40 % et 1,5 ; +0,50 R à 50 % et 2', () => {
    expect(expectancyR(0.4, 1.5)).toBeCloseTo(0);
    expect(expectancyR(0.5, 2)).toBeCloseTo(0.5);
    const matrix = rrMatrix(0.4, 1.5);
    const col = matrix.rewardRisks.indexOf(1.5);
    expect(matrix.cells[0]?.[col]).toBeCloseTo(0);
    expect(matrix.cells[0]?.[matrix.realized.col]).toBeCloseTo(0);
    expect(matrix.winRates[1]).toBeCloseTo(0.5);
    expect(matrix.winRates[2]).toBeCloseTo(0.3);
    expect(matrix.winRates[3]).toBeCloseTo(0.25);
  });

  it('risque ajusté provisoire 0,95 %, notionnel 1 520, 4 MNQ', () => {
    const adjusted = adjustedRiskPoints(1.5, [-0.4, -0.15], 6.25);
    expect(adjusted.points).toBeCloseTo(0.95);
    expect(adjusted.provisional).toBe(true);
    expect(theoreticalNotional(10_000, 0.95, 6.25)).toBeCloseTo(1_520);
    expect(theoreticalContracts(10_000, 0.95, 10, 20)).toBeCloseTo(0.475);
    expect(floorMicroContracts(0.475, 10)).toBe(4);
    expect(adjustedRiskPoints(1.5).points).toBeCloseTo(1.5);
    expect(adjustedRiskPoints(1.5, [-0.4, -0.15], 0.5).points).toBeCloseTo(0.5);
  });
});
