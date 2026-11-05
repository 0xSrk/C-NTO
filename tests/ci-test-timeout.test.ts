import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OROS5.47s — un fichier de test qui ne se charge jamais (OROS5.47r) laissait le job « check » tourner jusqu'aux six
 * heures de GitHub, qui l'annulait sans échec : aucun signal rouge, et la PR passait pour en cours. L'étape `npm test`
 * est bornée : au-delà de 15 minutes elle échoue, sur chaque système, et la CI le dit.
 */
describe('OROS5.47s · npm test est borné dans la CI', () => {
  it('l’étape npm test du job check porte timeout-minutes, entre 5 et 30', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
    const step = /\n {6}- run: npm test\n((?: {8}[^\n]*\n)+)/.exec(ci)?.[1] ?? '';
    const minutes = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(step)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(30);
  });
});
