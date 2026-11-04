import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

/**
 * OROS5.45h — suite du lot 3 : à 1180 × 720, zoom 100 %, sans fiche, la zone de travail fait 960 px (la fenêtre minimale
 * moins le rail de 220 px), sous le seuil de 1 100 px du Tableau de bord : A.01 prenait toute la largeur et la bande K
 * passait dessous, même sans fiche. Le seuil passe sous 960 px : sans fiche, A.01 et la bande K restent côte à côte ; la
 * fiche ouverte à 1180 × 720 (560 px) les empile toujours.
 */
const WINDOW_MIN = 1180;
const RAIL = 220;
const DRAWER = 400;
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

describe('OROS5.45h · le Tableau de bord ne s’empile qu’à l’étroit', () => {
  it('le seuil du conteneur main est sous la zone de travail sans fiche, au-dessus de celle de la fiche ouverte', () => {
    const rules = cssRules(read('src/modules/metrique/dashboard.module.css'));
    const stack = rules.filter((rule) => rule.selector.includes('.span7') && rule.at.some((head) => head.startsWith('@container main')));
    expect(stack).toHaveLength(1);
    const threshold = Number(/max-width:\s*(\d+)px/.exec(stack[0]!.at.find((head) => head.startsWith('@container main'))!)?.[1]);
    expect(threshold).toBeLessThan(WINDOW_MIN - RAIL);
    expect(threshold).toBeGreaterThanOrEqual(WINDOW_MIN - RAIL - DRAWER);
    expect(stack[0]!.body).toMatch(/grid-column: 1 \/ -1/);
    // le rail fait bien 220 px : la mesure du seuil suit le châssis
    expect(read('src/design/tokens.css')).toMatch(/--rail-w:\s*220px/);
  });
});
