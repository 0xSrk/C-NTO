import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

/**
 * OROS5.47l — la fiche ouverte sur Métrique (AF3) à 1180 × 720, zoom 100 % : la zone de travail n'a que 560 px, et la table
 * A.04 « Dernières séances », sans enveloppe, ses cellules sur une ligne, en demandait 604 ; toute la zone de travail
 * défilait à l'horizontale et la colonne Net USD passait sous le bord de la fiche. À l'étroit, ses cellules passent à la
 * ligne et se resserrent ; si elle reste plus large, elle défile dans sa carte, jamais la zone de travail.
 */
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const rules = cssRules(read('src/modules/metrique/dashboard.module.css'));
const at = (selector: string, query: string | null) =>
  rules.find((rule) => rule.selector === selector && (query === null ? rule.at.length === 0 : rule.at.some((head) => head.replace(/\s+/g, ' ') === query)))?.body ?? '';

describe('OROS5.47l · A.04 tient dans sa carte, la fiche ouverte', () => {
  it('la table défile dans son enveloppe, jamais la zone de travail', () => {
    const wrap = at('.tableScroll', null);
    expect(wrap).toMatch(/overflow-x: auto;/);
    expect(wrap).toMatch(/min-width: 0;/);
    const source = read('src/modules/metrique/Dashboard.tsx');
    const table = source.indexOf('<table className={s.table}>');
    expect(table).toBeGreaterThan(0);
    // l'enveloppe est le parent immédiat de la table de A.04, dans sa carte
    expect(source.slice(source.lastIndexOf('<div', table), table)).toMatch(/^<div className=\{s\.tableScroll\}>\s*$/);
    expect(source.slice(table, source.indexOf('</section>', table))).toMatch(/<\/table>\s*<\/div>\s*$/);
  });

  it('sous 700 px de zone de travail, ses cellules passent à la ligne et se resserrent', () => {
    const query = '@container main (max-width: 700px)';
    expect(at('.table td', query)).toMatch(/white-space: normal;/);
    expect(at('.table th,\n  .table td', query) || at('.table th, .table td', query)).toMatch(/padding: 8px 4px;/);
    // au large, rien ne change : une ligne par cellule
    expect(at('.table td', null)).toMatch(/white-space: nowrap;/);
  });
});
