import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

/**
 * OROS5.47d — sous Electron, la fiche ouverte sur le Copieur (AF3) : à 1180 × 720, la zone de travail n'a plus que 560 px,
 * et le Copieur gardait ses deux colonnes (le tableau, puis 360 px de filtres) : le tableau tombait à 90 px, ses tuiles
 * coupées, ses critères brisés lettre à lettre, et la ligne d'ajout débordait sous une barre de défilement. Sous 1000 px de
 * zone de travail, les filtres passent sous le tableau ; sous 700 px, le tableau tient sur deux colonnes ; aucune piste
 * `fr` ne prend la largeur minimale de son contenu.
 */
const rules = cssRules(readFileSync('src/modules/copieur/copieur.module.css', 'utf8').replace(/\r\n/g, '\n'));
const at = (selector: string, query: string) => rules.find((rule) => rule.selector === selector && rule.at.some((head) => head.replace(/\s+/g, ' ') === query))?.body ?? '';

describe('OROS5.47d · le Copieur à la largeur de la fiche ouverte', () => {
  it('sous 1000 px de zone de travail, une colonne ; sous 700 px, le tableau sur deux colonnes', () => {
    expect(at('.layout', '@container main (max-width: 1000px)')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(at('.layout', '@container main (max-width: 1000px)')).toMatch(/height: auto;/);
    expect(at('.col', '@container main (max-width: 1000px)')).toMatch(/overflow: visible;/);
    expect(at('.board', '@container main (max-width: 700px)')).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('aucune piste fr ne s’élargit à son contenu : chacune est minmax(0, …)', () => {
    const bare: string[] = [];
    for (const rule of rules) {
      for (const [, value] of rule.body.matchAll(/(?:^|;)\s*grid-template-columns:\s*([^;]+)/g)) {
        const tracks = value!.replace(/minmax\([^()]*\)|repeat\(\d+,\s*minmax\([^()]*\)\)/g, '');
        if (/\d*\.?\d+fr\b/.test(tracks)) bare.push(`${rule.selector} : ${value!.trim()}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
