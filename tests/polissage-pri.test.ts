import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules, type CssRule } from './helpers/cssRules';

const sheet = (path: string) => cssRules(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
/** La règle dont l'un des sélecteurs est `sel`, hors de tout bloc @ (ou dans le bloc dont l'en-tête répond à `at`). */
const find = (rules: CssRule[], sel: string, at?: RegExp) =>
  rules.find((r) => r.selector.split(',').map((p) => p.replace(/\s+/g, ' ').trim()).includes(sel) && (at ? r.at.some((h) => at.test(h)) : r.at.length === 0));
/** La règle dont les sélecteurs sont exactement `sels`, hors de tout bloc @. */
const exact = (rules: CssRule[], ...sels: string[]) =>
  rules.find((r) => r.at.length === 0 && r.selector.split(',').map((p) => p.replace(/\s+/g, ' ').trim()).join(' | ') === sels.join(' | '));
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

  it('POL4.2 l’encre d’une micro suit la lumière de son hôte : son trait et son aplat s’interpolent, sauf la LED du menu Options', async () => {
    // --k n'est pas enregistrée : elle change d'un coup. Le trait et l'aplat qu'elle teint s'interpolent, au pas de la
    // couleur du desk (.btn : color 200ms linear), et rien d'autre ne s'anime — ni la place, ni la forme.
    const micro = sheet('src/design/micro.module.css');
    const ink = exact(micro, '.glyph > svg', '.glyph > svg *');
    expect(ink?.props).toEqual(['transition']);
    expect(ink?.body).toMatch(/transition:\s*fill 200ms linear,\s*stroke 200ms linear\s*;?\s*$/);
    // Chaque composant de la bibliothèque est un <svg> racine : la règle atteint l'emblème du rail, les glyphes de la
    // fiche et C.094 de A.04 et de B · Séances, comme tous les autres.
    const { COMPONENTS } = await import('@/design/micro/assets');
    const { DRAWN } = await import('@/design/micro/drawn');
    for (const [n, svg] of Object.entries({ ...COMPONENTS, ...DRAWN })) expect(svg.trimStart().startsWith('<svg'), `C.${n}`).toBe(true);
    // Le composant d'une option du menu porte la LED de l'état qui vit (cliquet OR) : son encre ne s'anime jamais.
    const menu = sheet('src/design/optionsMenu.module.css');
    const led = exact(menu, '.item .glyph > svg', '.item .glyph > svg *');
    expect(led?.body).toMatch(/transition:\s*none/);
  });

  it('POL4.3 M.003 : ce qui s’atténue porte sa transition, si bien qu’il sort et revient au même pas, et que les filets se croisent', () => {
    const css = sheet('src/design/instruments/instruments.module.css');
    // `.out` ne dit que l'atténuation (à sa place, à 35 %) : posée après `.hour`, une transition à elle remplaçait celle de
    // l'heure (le filet quitté tombait d'un coup) et quittait les barres et le compte avec la classe (retour sec).
    expect(find(css, '.out')?.props).toEqual(['opacity']);
    expect(find(css, '.out')?.body).toMatch(/opacity:\s*0\.35/);
    const opacity = (sel: string) => /transition:[^;]*\bopacity (var\(--t-med\)|220ms) linear/.exec(find(css, sel)?.body ?? '')?.[1];
    for (const sel of ['.hour', '.count', '.bars g']) expect(opacity(sel), sel).toBe('var(--t-med)');
    expect(find(css, '.hour')?.body).toMatch(/transition:[^;]*\bbox-shadow var\(--t-med\) linear/);
    expect(find(css, '.hour')?.body).toMatch(/transition:[^;]*\bcolor 200ms linear/);
  });

  it('POL4.4 une liste au focus garde son contour sous le pointeur : le survol ajoute sa lueur sans éteindre le focus', () => {
    const HOVER = /^@media\s*\(hover:\s*hover\)/;
    // Le focus (tokens.css, 0,1,1) pose le contour plein ; le survol (0,2,1) l'emportait et le ramenait à 40 % : la lumière
    // baissait sous le pointeur. tokens.css ne change pas (décision 4) : la règle vit avec les primitives.
    const tokens = sheet('src/design/tokens.css');
    expect(find(tokens, 'select:focus')?.body).toMatch(/border-color:\s*var\(--text-0\)/);
    expect(find(tokens, 'select:hover:not(:disabled)', HOVER)?.body).toMatch(/border-color:\s*color-mix\(in srgb, var\(--ivory\) 40%, transparent\)/);
    const source = readFileSync('src/design/primitives.module.css', 'utf8');
    const both = find(cssRules(source), ':global(select:focus:hover:not(:disabled))', HOVER);
    expect(both?.props).toEqual(['border-color']);
    expect(both?.body).toMatch(/border-color:\s*var\(--text-0\)/);
  });

  it('POL4.5 l’interrupteur : son libellé monte avec sa piste, à la couleur du desk', () => {
    const prim = sheet('src/design/primitives.module.css');
    // Le libellé change de ton au survol et à l'allumage ; sa piste monte en 240 ms : il les suit, comme .btn (200 ms).
    expect(find(prim, '.toggle:hover:not(:disabled)', /^@media\s*\(hover:\s*hover\)/)?.body).toMatch(/color:\s*var\(--text-1\)/);
    expect(find(prim, '.toggle.on')?.body).toMatch(/color:\s*var\(--text-0\)/);
    expect(find(prim, '.toggle')?.body).toMatch(/transition:\s*color 200ms linear\s*;/);
    expect(find(prim, '.toggleTrack')?.body).toMatch(/transition:\s*border-color 240ms var\(--ease-out\)/);
  });
});
