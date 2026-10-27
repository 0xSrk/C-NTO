import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { tabCopy, TABS } from '@/app/tabs';
import { useI18n } from '@/i18n';

describe('rail', () => {
  it('ordonne les modules, ramène le copieur en 08 et ouvre Crypto en 09', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['metrique', 'visual', 'calendrier', 'note', 'portefeuille', 'agent', 'bot', 'copieur', 'crypto']);
    expect(TABS.map((tab) => tab.index)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09']);
    expect(TABS.find((tab) => tab.id === 'copieur')?.code).toBe('CPY');
    expect(TABS.find((tab) => tab.id === 'crypto')?.code).toBe('CRY');
  });

  it('le raccourci 5 mène à Portefeuille', () => {
    const digit = 5;
    expect(TABS[digit - 1]?.id).toBe('portefeuille');
    expect(TABS[4]?.index.slice(-1)).toBe('5');
  });

  it('le raccourci 9 mène à Crypto', () => {
    expect(TABS[8]?.id).toBe('crypto');
    expect(readFileSync('src/app/Shell.tsx', 'utf8')).toContain('/^Digit([1-9])$/');
  });
});

describe('onglet 09 · CRY', () => {
  afterEach(() => useI18n.getState().setLocale('fr'));

  it('OROS4.3 porte son libellé dans les trois langues, et plus aucune baseline', () => {
    const tab = TABS[8];
    if (!tab) throw new Error('onglet 09 absent du rail');
    const copy = (['fr', 'en', 'es'] as const).map((locale) => {
      useI18n.getState().setLocale(locale);
      return tabCopy(tab);
    });
    expect(copy).toEqual([{ label: 'Crypto' }, { label: 'Crypto' }, { label: 'Cripto' }]);
    for (const def of TABS) expect(Object.keys(def), def.id).not.toContain('tagline');
    expect(readFileSync('src/app/tabs.ts', 'utf8')).not.toMatch(/Ultimate journal|quantitative engine|Advanced chart|Journal quantitatif/);
  });
});
