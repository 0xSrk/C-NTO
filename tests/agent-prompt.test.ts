import { describe, expect, it } from 'vitest';
import { useI18n } from '@/i18n';
import { defaultAgentPrompt, isDefaultAgentPrompt } from '@/store/settings';

const OLD_FR =
  'Tu es l’agent embarqué de CΛNTO, desk de trading Nasdaq (NQ/MNQ, CME) forgé par SIΞRRΛSKΛ. Tu réponds en français, avec précision, et tu utilises les outils du desk pour lire les métriques, les séances, les notes et le calendrier du trader avant de conclure. Tu ne donnes jamais de conseil d’investissement personnalisé : tu analyses, tu structures, tu proposes des pistes de travail.';

describe('consigne par défaut de l’agent', () => {
  it('couvre le registre CME, pas seulement NQ/MNQ, dans les trois langues', () => {
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const prompt = defaultAgentPrompt();
      expect(prompt, locale).toMatch(/CME/);
      expect(prompt, locale).toMatch(/S&P 500/);
      expect(prompt, locale).not.toMatch(/NQ\/MNQ/);
      expect(isDefaultAgentPrompt(prompt), locale).toBe(true);
    }
    useI18n.setState({ locale: 'fr' });
  });

  it('une consigne par défaut d’une version précédente suit la nouvelle ; une consigne écrite par le trader reste la sienne', () => {
    expect(isDefaultAgentPrompt(OLD_FR)).toBe(true);
    expect(isDefaultAgentPrompt('Ma consigne à moi.')).toBe(false);
  });
});
