import { describe, expect, it } from 'vitest';
import { useI18n } from '@/i18n';
import { fmtPct, fmtPrice, fmtRatio } from '@/lib/format';

describe('fmtRatio (F-08)', () => {
  it('masque Infinity en tiret (pas de ∞ trompeur)', () => {
    useI18n.getState().setLocale('fr');
    expect(fmtRatio(Infinity)).toBe('—');
    expect(fmtRatio(-Infinity)).toBe('—');
    expect(fmtRatio(NaN)).toBe('—');
    expect(fmtRatio(null)).toBe('—');
    expect(fmtRatio(2.5)).toBe('2,50');
  });
});

describe('fmtPct / fmtPrice', () => {
  it('valeurs absentes et zéro signé', () => {
    useI18n.getState().setLocale('fr');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(-0)).toBe('0,0 %');
    expect(fmtPrice(NaN)).toBe('—');
    expect(fmtPrice(0.5)).toBe('0,50');
  });
});
