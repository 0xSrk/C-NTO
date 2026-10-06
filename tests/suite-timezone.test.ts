import { describe, expect, it } from 'vitest';

/**
 * La suite tourne en UTC quel que soit le fuseau du poste (`vitest.config.mts`) : la démo
 * (`dateKeyLocal`) et `drawdownSeries` lisent le fuseau du process.
 */
describe('fuseau de la suite', () => {
  it('UTC en hiver comme en été, même lancé depuis New York ou Paris', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(0);
    expect(new Date('2026-07-15T12:00:00Z').getTimezoneOffset()).toBe(0);
    expect(new Date(2026, 9, 1).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
