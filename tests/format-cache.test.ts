import { describe, expect, it } from 'vitest';
import { useI18n } from '@/i18n';
import { fixedFormatterForTest, fmtNum, fmtPct, fmtPrice, fmtRatio } from '@/lib/format';
import { dateTimeFormatter, formatDateFr } from '@/lib/time';

describe('caches Intl (F4)', () => {
  it('fmtPct / fmtRatio / fmtPrice : même sortie qu’avant, formateur réutilisé', () => {
    useI18n.getState().setLocale('fr');
    expect(fmtPct(0.5123)).toBe('51,2 %');
    expect(fmtPct(0.5123, 0)).toBe('51 %');
    expect(fmtRatio(2.5)).toBe('2,50');
    expect(fmtRatio(1 / 3, 1)).toBe('0,3');
    expect(fmtPrice(18250.25)).toBe('18 250,25');
    expect(fmtNum(3.14159, 3)).toBe('3,142');
    // Identité : deux appels à même précision rendent le même Intl.NumberFormat.
    expect(fixedFormatterForTest(2)).toBe(fixedFormatterForTest(2));
    expect(fixedFormatterForTest(1)).toBe(fixedFormatterForTest(1));
    expect(fixedFormatterForTest(1)).not.toBe(fixedFormatterForTest(2));
  });

  it('le cache suit la langue active', () => {
    useI18n.getState().setLocale('fr');
    const fr = fixedFormatterForTest(2);
    expect(fmtRatio(1234.5)).toBe('1 234,50');
    useI18n.getState().setLocale('en');
    expect(fmtRatio(1234.5)).toBe('1,234.50');
    expect(fmtPct(0.25, 1)).toBe('25.0 %');
    expect(fmtPrice(18250.25)).toBe('18,250.25');
    const en = fixedFormatterForTest(2);
    expect(en).not.toBe(fr);
    expect(en).toBe(fixedFormatterForTest(2));
    useI18n.getState().setLocale('fr');
    expect(fmtRatio(1234.5)).toBe('1 234,50');
  });

  it('dateTimeFormatter : même instance pour mêmes options et langue', () => {
    useI18n.getState().setLocale('fr');
    const a = dateTimeFormatter({ day: '2-digit', month: 'short' });
    const b = dateTimeFormatter({ day: '2-digit', month: 'short' });
    expect(a).toBe(b);
    expect(dateTimeFormatter({ day: '2-digit', month: 'long' })).not.toBe(a);
    expect(dateTimeFormatter({ day: '2-digit', month: 'short' }, 'en-US')).not.toBe(a);
    expect(a.resolvedOptions().locale.startsWith('fr')).toBe(true);
  });

  it('formatDateFr : sortie identique à toLocaleDateString', () => {
    useI18n.getState().setLocale('fr');
    const d = new Date(2026, 8, 15, 12);
    expect(formatDateFr('2026-09-15')).toBe(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }));
    expect(formatDateFr('2026-09-15', { weekday: true, short: true })).toBe(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    useI18n.getState().setLocale('en');
    expect(formatDateFr('2026-09-15', { weekday: true })).toBe(d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    useI18n.getState().setLocale('fr');
  });
});
