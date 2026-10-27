import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

const css = readFileSync('src/modules/copieur/copieur.module.css', 'utf8');
const body = (selector: string) => cssRules(css).find((rule) => rule.selector === selector)?.body ?? '';

describe('OROS4.16 les filtres de réplication gardent leurs champs alignés, dans chaque langue', () => {
  it('chaque champ partage les pistes de sa ligne (subgrid) : libellé, champ, aide ; le libellé se cale sur son champ', () => {
    expect(body('.formGrid')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    const field = body('.formGrid > label');
    expect(field).toMatch(/grid-row:\s*span 3/);
    expect(field).toMatch(/grid-template-rows:\s*subgrid/);
    // l'écart interne du champ est celui de la grille : aucune piste partagée n'a deux écarts
    expect(/row-gap:\s*(\d+)px/.exec(field)?.[1]).toBe(/gap:\s*(\d+)px/.exec(body('.formGrid'))?.[1]);
    expect(body('.formGrid > label > :first-child')).toMatch(/align-self:\s*end/);
  });

  it('la grille ne porte que des champs (Field rend un label) : rien ne s’y glisse sur une seule piste', () => {
    const source = readFileSync('src/modules/copieur/Copieur.tsx', 'utf8');
    const grid = /<div className=\{s\.formGrid\}>([\s\S]*?)\n {16}<\/div>/.exec(source)?.[1] ?? '';
    const children = [...grid.matchAll(/^ {18}<(\w+)/gm)].map((m) => m[1]);
    expect(children).toEqual(['Field', 'Field', 'Field', 'Field']);
  });
});
