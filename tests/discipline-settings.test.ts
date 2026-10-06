import { describe, expect, it } from 'vitest';
import { parseInstrumentList } from '@/engine/discipline';
import { useI18n } from '@/i18n';
import { disciplineNote } from '@/modules/metrique/SettingsModal';

describe('réglages de la discipline', () => {
  it('parseInstrumentList : racines du registre, sans doublon, le reste signalé', () => {
    expect(parseInstrumentList('mnq, MES; NQ 12-26\nBTC  es')).toEqual({ symbols: ['MNQ', 'MES', 'NQ', 'ES'], rejected: ['BTC'] });
    expect(parseInstrumentList('MNQ MES, MNQ')).toEqual({ symbols: ['MNQ', 'MES'], rejected: [] });
    expect(parseInstrumentList('NQZ6; 6e, M6E')).toEqual({ symbols: ['NQ', '6E', 'M6E'], rejected: [] });
    expect(parseInstrumentList('')).toEqual({ symbols: [], rejected: [] });
    expect(parseInstrumentList(' ,; \n')).toEqual({ symbols: [], rejected: [] });
    expect(parseInstrumentList('AAPL, TSLA AAPL')).toEqual({ symbols: [], rejected: ['AAPL', 'TSLA'] });
  });

  it('la section dit, dans les trois langues, que 0 est inactif et que l’agent ne trade jamais', () => {
    const expected = { fr: /à 0[\s\S]*inactive[\s\S]*ne trade jamais/, en: /set to 0[\s\S]*inactive[\s\S]*never trades/, es: /en 0[\s\S]*inactiva[\s\S]*nunca opera/ } as const;
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      expect(disciplineNote(), locale).toMatch(expected[locale]);
    }
    useI18n.setState({ locale: 'fr' });
  });
});
