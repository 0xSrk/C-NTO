import { describe, expect, it } from 'vitest';
import { expectancy, thresholdWinRate, tradeRisk } from '@/engine/riskConsole';

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
});
