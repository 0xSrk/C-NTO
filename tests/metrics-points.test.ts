import { describe, expect, it } from 'vitest';
import { aggregatePoints, pointsPerContract, standardEquivalentQty } from '@/engine/tradeUnits';

describe('points par contrat et équivalent standard', () => {
  it('convertit 2 MNQ à +60 $ en 15 points et 0,2 NQ', () => {
    const trade = { pnl: 60, commission: 0, qty: 2, instrument: 'MNQ' };
    expect(pointsPerContract(trade)).toBeCloseTo(15);
    expect(standardEquivalentQty(trade)).toBeCloseTo(0.2);
  });

  it('compte les points avant frais', () => {
    expect(pointsPerContract({ pnl: 56, commission: 4, qty: 2, instrument: 'MNQ' })).toBeCloseTo(15);
  });

  it('pondère NQ et MNQ sur la même racine', () => {
    const agg = aggregatePoints([
      { pnl: 200, commission: 0, qty: 1, instrument: 'NQ' },
      { pnl: 200, commission: 0, qty: 10, instrument: 'MNQ' },
    ]);
    expect(agg.dollars).toBe(400);
    expect(agg.points).toBeCloseTo(10);
    expect(agg.standardEquivalent).toBeCloseTo(2);
    expect(agg.root).toBe('NQ');
  });

  it('ne mélange pas les points de deux racines', () => {
    const agg = aggregatePoints([
      { pnl: 200, commission: 0, qty: 1, instrument: 'NQ' },
      { pnl: 500, commission: 0, qty: 1, instrument: 'ES' },
    ]);
    expect(agg.dollars).toBe(700);
    expect(agg.points).toBeNull();
    expect(agg.standardEquivalent).toBeNull();
    expect(agg.root).toBeNull();
  });

  it('ignore un instrument inconnu', () => {
    expect(pointsPerContract({ pnl: 10, commission: 0, qty: 1, instrument: 'ZZZ' })).toBeNull();
    expect(standardEquivalentQty({ qty: 2, instrument: 'ZZZ' })).toBe(0);
  });
});
