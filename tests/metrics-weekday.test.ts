import { describe, expect, it } from 'vitest';
import { computeTradeStats } from '@/engine/metrics';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import type { Trade } from '@/engine/types';

const trade = (entryTime: number): Trade =>
  ({ id: 't', sessionId: 's', instrument: 'NQ', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 60_000, entryPrice: 20_000, exitPrice: 20_005, pnl: 100, commission: 0 }) as Trade;

describe('ventilation par jour de semaine', () => {
  it('compte le jour d’entrée à New York, comme les heures, quel que soit le fuseau du poste', () => {
    // Lundi 21:30 ET = mardi 01:30 UTC = mardi 09:30 à Singapour.
    const mondayEvening = zonedToUtc('2026-09-14', '21:30', ET_ZONE);
    const stats = computeTradeStats([trade(mondayEvening)]);
    expect(stats.byWeekday.find((b) => b.count === 1)?.key).toBe('lun');
    expect(stats.byHour.find((b) => b.count === 1)?.key).toBe('21');
  });
});
