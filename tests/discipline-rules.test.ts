import { describe, expect, it } from 'vitest';
import { coerceTraderRules, DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { coerceSettings, DEFAULT_SETTINGS, mergeRestoredSettings, pickRestorableSettings, RESTORABLE_SETTING_KEYS } from '@/store/settings';

describe('règles chiffrées du trader', () => {
  it('par défaut, aucune règle active ; la fenêtre de revanche vaut 5 minutes', () => {
    expect(DEFAULT_TRADER_RULES).toEqual({ maxDailyLoss: 0, maxTradesPerDay: 0, catalystBlackoutMin: 0, allowedInstruments: [], revengeWindowMin: 5 });
    expect(DEFAULT_SETTINGS.traderRules).toEqual(DEFAULT_TRADER_RULES);
  });

  it('bornes : hors bornes ou mauvais type, la valeur précédente reste', () => {
    const base = { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 };
    expect(coerceTraderRules({ maxDailyLoss: 750 }, base).maxDailyLoss).toBe(750);
    expect(coerceTraderRules({ maxDailyLoss: -1 }, base).maxDailyLoss).toBe(500);
    expect(coerceTraderRules({ maxDailyLoss: 1_000_001 }, base).maxDailyLoss).toBe(500);
    expect(coerceTraderRules({ maxDailyLoss: '600' }, base).maxDailyLoss).toBe(500);
    expect(coerceTraderRules({ maxDailyLoss: Number.NaN }, base).maxDailyLoss).toBe(500);
    expect(coerceTraderRules({ maxTradesPerDay: 6 }, base).maxTradesPerDay).toBe(6);
    expect(coerceTraderRules({ maxTradesPerDay: 6.5 }, base).maxTradesPerDay).toBe(0);
    expect(coerceTraderRules({ maxTradesPerDay: 201 }, base).maxTradesPerDay).toBe(0);
    expect(coerceTraderRules({ catalystBlackoutMin: 10 }, base).catalystBlackoutMin).toBe(10);
    expect(coerceTraderRules({ catalystBlackoutMin: 121 }, base).catalystBlackoutMin).toBe(0);
    expect(coerceTraderRules({ revengeWindowMin: 0 }, base).revengeWindowMin).toBe(0);
    expect(coerceTraderRules({ revengeWindowMin: -5 }, base).revengeWindowMin).toBe(5);
    expect(coerceTraderRules('x', base)).toEqual(base);
    expect(coerceTraderRules(null, base)).toEqual(base);
  });

  it('instruments : racines du registre seulement, sans doublon', () => {
    const r = coerceTraderRules({ allowedInstruments: ['nq', 'MNQ 12-26', 'BTC', 'NQ', 42, '', 'x'.repeat(40), 'ES'] });
    expect(r.allowedInstruments).toEqual(['NQ', 'MNQ', 'ES']);
    expect(coerceTraderRules({ allowedInstruments: 'NQ' }, { ...DEFAULT_TRADER_RULES, allowedInstruments: ['ES'] }).allowedInstruments).toEqual(['ES']);
  });

  it('un coffre sans la clé rend les défauts ; une clé mal formée aussi', () => {
    expect(coerceSettings({ callsign: 'OP' }, DEFAULT_SETTINGS).traderRules).toEqual(DEFAULT_TRADER_RULES);
    expect(coerceSettings({ traderRules: [1, 2] }, DEFAULT_SETTINGS).traderRules).toEqual(DEFAULT_TRADER_RULES);
    expect(coerceSettings({ traderRules: { maxDailyLoss: 500 } }, DEFAULT_SETTINGS).traderRules).toEqual({ ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 });
  });

  it('la restauration d’un coffre garde la clé, bornée', () => {
    expect(RESTORABLE_SETTING_KEYS).toContain('traderRules');
    const rules = { maxDailyLoss: 500, maxTradesPerDay: 4, catalystBlackoutMin: 10, allowedInstruments: ['MNQ', 'BTC'], revengeWindowMin: 3 };
    expect(Object.keys(pickRestorableSettings({ traderRules: rules, orchestratorAllowWrite: true }))).toEqual(['traderRules']);
    const merged = mergeRestoredSettings(DEFAULT_SETTINGS, { traderRules: rules });
    expect(merged.traderRules).toEqual({ ...rules, allowedInstruments: ['MNQ'] });
    // Un coffre ancien, sans la clé, ne remet pas à zéro les règles du poste.
    expect(mergeRestoredSettings(merged, { callsign: 'OP' }).traderRules).toEqual(merged.traderRules);
  });
});
