import { afterEach, describe, expect, it } from 'vitest';
import { fanMarks } from '@/design/charts/Fan';
import { useI18n } from '@/i18n';

describe('M5.11 les seuils de l’éventail Monte-Carlo suivent la langue du desk', () => {
  afterEach(() => useI18n.setState({ locale: 'fr' }));

  it('ruine et objectif en français, anglais et espagnol', () => {
    useI18n.setState({ locale: 'en' });
    expect(fanMarks()).toEqual({ ruin: 'ruin', target: 'target' });
    useI18n.setState({ locale: 'es' });
    expect(fanMarks()).toEqual({ ruin: 'ruina', target: 'objetivo' });
    useI18n.setState({ locale: 'fr' });
    expect(fanMarks()).toEqual({ ruin: 'ruine', target: 'objectif' });
  });
});
