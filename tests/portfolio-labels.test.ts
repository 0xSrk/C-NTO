import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeSnapshot, Pocket } from '@/engine/portfolio/types';
import { useI18n } from '@/i18n';
import { engineNote, sourceTag } from '@/modules/portefeuille/labels';

const pocket: Pocket = { id: 'p', name: 'Apex 50K', kind: 'propfirm', currency: 'USD', account: 'Apex-PA-50K', createdAt: 0 } as Pocket;
const snap: BridgeSnapshot = { account: 'Apex-PA-50K', cashValue: 50_000, unrealizedPnl: 0, positions: [], at: 1_000 };

describe('R1 le Portefeuille affiche ses sources et les motifs du moteur dans la langue du desk', () => {
  afterEach(() => useI18n.setState({ locale: 'fr' }));

  it('source de chaque valorisation', () => {
    useI18n.setState({ locale: 'en' });
    expect(sourceTag(pocket, { mark: 'saisi' }, [], 0)).toBe('ENTERED');
    expect(sourceTag(pocket, { mark: 'journal' }, [], 0)).toBe('JOURNAL');
    expect(sourceTag(pocket, { mark: 'prix de revient' }, [], 0)).toBe('PRICE');
    expect(sourceTag(pocket, { mark: 'pont' }, [snap], 13_000)).toBe('BRIDGE · 12 S');
    expect(sourceTag(pocket, { mark: 'pont' }, [], 0)).toBe('BRIDGE');
    useI18n.setState({ locale: 'fr' });
    expect(sourceTag(pocket, { mark: 'saisi' }, [], 0)).toBe('SAISIE');
    useI18n.setState({ locale: 'es' });
    expect(sourceTag(pocket, { mark: 'pont' }, [], 0)).toBe('PUENTE');
  });

  it('notes et motifs du moteur, restés en français pour les outils de l’agent', () => {
    useI18n.setState({ locale: 'en' });
    expect(engineNote('pont hors ligne')).toBe('bridge offline');
    expect(engineNote('taux EUR/USD manquant')).toBe('EUR/USD rate missing');
    expect(engineNote('plan manquant')).toBe('plan missing');
    expect(engineNote('devise invalide')).toBe('invalid currency');
    expect(engineNote('autre chose')).toBe('autre chose');
    useI18n.setState({ locale: 'es' });
    expect(engineNote('pont hors ligne')).toBe('puente fuera de línea');
    useI18n.setState({ locale: 'fr' });
    expect(engineNote('taux EUR/USD manquant')).toBe('taux EUR/USD manquant');
  });
});
