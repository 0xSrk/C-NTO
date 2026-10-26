/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARTOUCHES, COMPONENTS, GLYPH_ID, PLATES } from '@/design/micro/assets';
import { Cartouche, Glyph, Plate, Signal, bindSlots } from '@/design/Micro';

const HEX = /#[0-9a-f]{3,8}\b/i;

describe('OROS2.9 micrographies du Lab dans le desk', () => {
  it('chaque composant nommé vient de la planche des 150, encré en --k, sans couleur en dur', () => {
    for (const [name, n] of Object.entries(GLYPH_ID)) {
      expect(COMPONENTS[n], name).toMatch(/^<svg [^>]*fill="var\(--k\)"/);
      expect(n, name).toBeGreaterThanOrEqual(1);
      expect(n, name).toBeLessThanOrEqual(150);
    }
    for (const svg of [...Object.values(COMPONENTS), ...Object.values(PLATES).map((p) => p.svg), ...Object.values(CARTOUCHES)]) expect(svg).not.toMatch(HEX);
  });

  it('aucune cartouche ne porte de code : le seul Code 128 du desk reste en bas à droite', () => {
    for (const [id, svg] of Object.entries(CARTOUCHES)) expect(svg, id).not.toMatch(/real-code|data-code/);
  });

  it('une plaque lit un état : chaque emplacement est lié, un emplacement sans valeur se lit « — »', () => {
    expect(PLATES.equity.slots).toEqual(expect.arrayContaining(['cumul', 'dd', 'sessions', 'trades', 'win', 'pf']));
    const html = renderToStaticMarkup(createElement(Plate, { id: 'equity', values: { state: 'LIVE', cumul: '+10 198,84' } }));
    expect(html).toContain('+10 198,84');
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain('—');
    expect(html).toContain('aria-hidden="true"');
  });

  it('échappe ce qu’on lui donne à lire', () => {
    expect(bindSlots('<text>{{x}}</text>', { x: '<b>&' })).toBe('<text>&lt;b&gt;&amp;</text>');
  });

  it('la cartouche d’artefact porte la version et les plateformes, et se nomme quand on le lui demande', () => {
    const html = renderToStaticMarkup(createElement(Cartouche, { id: 'artefact', values: { build: 'v3.6.0 · DESK', runs: 'MACOS / WINDOWS / LINUX' }, label: 'SK-ART-002' }));
    expect(html).toContain('BUILD: v3.6.0 · DESK');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="SK-ART-002"');
  });

  it('le signal dit son niveau par le glyphe : orbite, rayonnement, cercle barré ; seul le niveau 3 est rouge', () => {
    const lv = (level: 1 | 2 | 3) => renderToStaticMarkup(createElement(Signal, { level }, 'texte'));
    expect(lv(1)).toContain(`skg-${GLYPH_ID.signal1}`);
    expect(lv(2)).toContain(`skg-${GLYPH_ID.signal2}`);
    expect(lv(3)).toContain(`skg-${GLYPH_ID.signal3}`);
    expect(lv(3)).toContain('sig-l3');
    expect(lv(1)).not.toContain('sig-l3');
    const prim = readFileSync('src/design/primitives.module.css', 'utf8');
    expect(prim).toMatch(/:global\(\.sig-l3\)\s*\{[^}]*--k:\s*var\(--signal\)/);
  });

  it('un glyphe muet se tait, un glyphe nommé se lit', () => {
    expect(renderToStaticMarkup(createElement(Glyph, { name: 'vault' }))).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(Glyph, { name: 'vault', label: 'Coffre' }))).toContain('aria-label="Coffre"');
  });
});
