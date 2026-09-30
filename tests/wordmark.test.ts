/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONSTRUCTION, WORDMARK_APEX, WORDMARK_EDGE, WORDMARK_GLYPHS, WORDMARK_PATHS, Wordmark, whenAt } from '@/design/Wordmark';

// React : act() est attendu dans ce fichier.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(...all: Parameters<typeof Wordmark>[0][]) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(all.map((props, i) => createElement(Wordmark, { ...props, key: i }))));
  roots.push(root);
  hosts.push(host);
  return host;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const host of hosts) host.remove();
  roots = [];
  hosts = [];
});

/** Tracés de 3.2.1 : décalés de 16 u vers la droite, rondes sans débord. */
const OLD = ['M136 40 A48 48 0 1 0 136 120', 'M176 128 L224 32 L272 128', 'M304 128 L304 32', 'M416 32 L512 32', 'M560 32 A48 48'];

describe('logotype — géométrie', () => {
  it('est centré sur x 320, les rondes débordent de 1,5 u et la pointe du Λ de 2 u', () => {
    expect(WORDMARK_EDGE.left + WORDMARK_EDGE.right).toBe(640);
    expect(WORDMARK_EDGE.left).toBe(46.5);
    expect(WORDMARK_PATHS).toHaveLength(5);
    expect(WORDMARK_PATHS[0]).toContain('A49.5 49.5');
    expect(WORDMARK_PATHS[4]).toBe('M544 30.5 A49.5 49.5 0 1 1 544 129.5 A49.5 49.5 0 1 1 544 30.5');
    expect(WORDMARK_APEX).toEqual([208, 30]);
    expect(WORDMARK_PATHS[1]).toBe('M160 128 L208 30 L256 128');
  });

  it('le lanceur garde une copie exacte des tracés, et plus aucun ancien', () => {
    const html = readFileSync('electron/launcher.html', 'utf8');
    for (const d of WORDMARK_PATHS) expect(html.split(`d="${d}"`).length - 1, d).toBe(3);
    for (const d of OLD) expect(html).not.toContain(d);
  });

  it('chaque ancre s’allume au passage de la pointe : l’inverse de l’accélération est monotone', () => {
    expect(whenAt(0)).toBeCloseTo(0, 5);
    expect(whenAt(0.5)).toBeCloseTo(0.5, 5);
    expect(whenAt(1)).toBeCloseTo(1, 5);
    const samples = [0.1, 0.25, 0.303, 0.5, 0.697, 0.9].map(whenAt);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
  });
});

describe('logotype — au repos (barre de titre)', () => {
  it('une seule image nommée CΛNTO, sans grille ni LED', () => {
    const svg = mount({ width: 84 }).querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('CΛNTO');
    expect(svg.getAttribute('height')).toBe('21');
    expect(svg.querySelector('[data-part]')).toBeNull();
    expect(svg.querySelectorAll('path')).toHaveLength(10);
  });

  it('amorces au repos, trois guides et quatre ancres au survol', () => {
    const svg = mount({ width: 84, ticks: true, survol: true }).querySelector('svg')!;
    expect(svg.querySelectorAll('[data-part="amorces"] path')).toHaveLength(2);
    const survol = svg.querySelectorAll('[data-part="survol"]');
    expect(survol).toHaveLength(2);
    expect(survol[0]!.querySelectorAll('line')).toHaveLength(3);
    expect(survol[1]!.querySelectorAll('rect')).toHaveLength(4);
  });

  it('la barre de titre le porte à 84 px, hors de la zone de glisser, pour que le survol arrive', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    const css = readFileSync('src/app/shell.module.css', 'utf8');
    expect(shell).toContain('<Wordmark width={84} ticks survol />');
    const rule = css.slice(css.indexOf('.brandMark {'), css.indexOf('}', css.indexOf('.brandMark {')));
    expect(rule).toContain('-webkit-app-region: no-drag');
  });

  it('deux logotypes à l’écran n’échangent pas leurs filtres', () => {
    const ids = [...mount({ width: 84 }, { width: 420, animated: true }).querySelectorAll('filter')].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('logotype — construction (Boot)', () => {
  it('trace les cinq lettres, une pointe par lettre, et la LED de relais', () => {
    const svg = mount({ width: 420, animated: true, delay: 0.22 }).querySelector('svg')!;
    expect(svg.style.getPropertyValue('--wm-delay')).toBe('0.22s');
    expect(svg.querySelectorAll('path[pathLength="1"]')).toHaveLength(10);
    const led = svg.querySelector('[data-part="led"]')!;
    expect(led).not.toBeNull();
    expect(led.querySelector('rect')?.getAttribute('fill')).toBe('var(--gold)');
  });

  it('une ancre par extrémité, sauf à la pointe du Λ où se pose la LED', () => {
    const svg = mount({ width: 420, animated: true }).querySelector('svg')!;
    const total = WORDMARK_GLYPHS.reduce((n, glyph) => n + glyph.anchors.length, 0);
    expect(svg.querySelectorAll('rect').length - 1).toBe(total - 1);
    const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toEqual(['640 × 160 · 8 PX', 'Λ 208 · 30', 'T 448 · 128', 'O 593,5 · 80']);
  });

  it('la LED s’embrase quand le tracé du Λ passe sur sa pointe', () => {
    const svg = mount({ width: 420, animated: true }).querySelector('svg')!;
    const flare = svg.querySelector<SVGGElement>('[data-part="led"]')!.style.getPropertyValue('--f');
    const expected = CONSTRUCTION.draw0 + CONSTRUCTION.step + whenAt(0.5) * CONSTRUCTION.draw;
    expect(parseFloat(flare)).toBeCloseTo(expected, 2);
  });
});
