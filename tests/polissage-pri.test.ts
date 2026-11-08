import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules, type CssRule } from './helpers/cssRules';

const sheet = (path: string) => cssRules(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
/** La règle dont l'un des sélecteurs est `sel`, hors de tout bloc @ (ou dans le bloc dont l'en-tête répond à `at`). */
const find = (rules: CssRule[], sel: string, at?: RegExp) =>
  rules.find((r) => r.selector.split(',').map((p) => p.replace(/\s+/g, ' ').trim()).includes(sel) && (at ? r.at.some((h) => at.test(h)) : r.at.length === 0));
const REDUCED = /prefers-reduced-motion:\s*reduce/;
const UNIVERSAL = (selector: string) => selector.replace(/\s+/g, '').replace(/:global\(([^)]*)\)/g, '$1') === '*,*::before,*::after';

describe('POL4 primitives et jetons : mouvement réduit, encre des micrographies, primitives', () => {
  it('POL4.1 mouvement réduit : le repos d’emblée, sans délai ni cascade ; le mouvement plein garde ses écarts', () => {
    // tokens.css ramène les durées à 1 ms et ne change pas (décision 4, tests/etat-table.test.ts) ; les délais tombent
    // dans la feuille des primitives, chargée avec le châssis, par une règle aussi large.
    const durations = sheet('src/design/tokens.css').find((r) => r.at.some((h) => REDUCED.test(h)) && UNIVERSAL(r.selector));
    expect(durations?.body).toMatch(/animation-duration:\s*1ms\s*!important/);
    expect(durations?.body).toMatch(/transition-duration:\s*1ms\s*!important/);
    const delays = sheet('src/design/primitives.module.css').find((r) => r.at.some((h) => REDUCED.test(h)) && UNIVERSAL(r.selector));
    // Ni l'écart de 24 ms du menu Options, ni celui de 28 ms du classement d'Analyse, ni le délai du balayage de la
    // marque du siège ne survivent au mouvement réduit.
    expect(delays?.body).toMatch(/animation-delay:\s*0s\s*!important/);
    expect(delays?.body).toMatch(/transition-delay:\s*0s\s*!important/);
    expect(delays?.props.sort()).toEqual(['animation-delay', 'transition-delay']);
    // Le mouvement plein garde ses cascades, telles que DESIGN.md les décrit (Options : 300 ms, 24 ms d'écart).
    const menu = sheet('src/design/optionsMenu.module.css');
    expect(find(menu, ".menu[data-open='true'] .row")?.body).toMatch(/transition-delay:\s*calc\(var\(--i, 0\) \* 24ms\)/);
    expect(find(menu, ".menu[data-open='true']")?.body).toMatch(/transform 300ms var\(--ease-out\)/);
    expect(find(sheet('src/modules/metrique/metrique.module.css'), '.inkRow')?.body).toMatch(/animation-delay:\s*calc\(var\(--i, 0\) \* 28ms\)/);
  });
});
