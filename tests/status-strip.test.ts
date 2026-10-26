/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Barcode, BraceCode } from '@/design/primitives';
import { BRACE_BAR_SUM, BRACE_BARS, BRACE_GAP, BRACE_WIDTH, braceBarsPath, braceBarWidths, sessionBraceBars } from '@/lib/braceCode';
import { code128Widths } from '@/lib/code128';
import { APP_VERSION } from '@/lib/version';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Parameters<typeof Barcode>[0] = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Barcode, props)));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Largeurs relues sur le tracé : chaque `M x 0 h w` est une barre, les espaces se déduisent des abscisses. */
function widthsOf(d: string): number[] {
  const bars = [...d.matchAll(/M(\d+) 0h(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const out: number[] = [];
  bars.forEach(([x, w], i) => {
    const prev = bars[i - 1];
    if (prev) out.push(x - (prev[0] + prev[1]));
    out.push(w);
  });
  return out;
}

const css = readFileSync('src/app/shell.module.css', 'utf8');
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('OROS2.2 bande d’étiquette', () => {
  it('le code-barres du pied est un vrai Code 128 de l’artefact et de sa version, un module par pixel', () => {
    const svg = mount().querySelector('svg');
    expect(svg).not.toBeNull();
    const code = code128Widths(`SK-ART-002-${APP_VERSION}`);
    expect(widthsOf(svg!.querySelector('path')!.getAttribute('d')!).join('')).toBe(code.join(''));
    expect(Number(svg!.getAttribute('width'))).toBe(code.reduce((a, b) => a + b, 0));
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });

  it('un autre texte donne un autre code', () => {
    const d = mount({ value: 'SK-SIG-3' }).querySelector('path')!.getAttribute('d')!;
    expect(widthsOf(d).join('')).toBe(code128Widths('SK-SIG-3').join(''));
  });

});

describe('OROS3.13 la barre d’état au noir du châssis', () => {
  it('le noir de la barre de titre, les jetons du desk : ni ivoire, ni encre, l’or reste l’or', () => {
    const status = rule('.status');
    expect(status).toMatch(/background:\s*var\(--bg-0\)/);
    expect(status).toMatch(/color:\s*var\(--text-2\)/);
    expect(status).not.toMatch(/--ivory|--ink|--gold-ink|color-scheme/);
    expect(status).not.toMatch(/^\s*--[a-z0-9-]+:/m);
    expect(rule('.title')).toMatch(/background:\s*var\(--bg-0\)/);
  });
});

describe('OROS3.14 le code d’accolades du pied', () => {
  it('onze barres de 1 à 3 px, de somme fixe, jamais toutes égales, quel que soit le tirage', () => {
    let seed = 7;
    const lcg = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 300; run++) {
      const widths = braceBarWidths(lcg);
      expect(widths).toHaveLength(BRACE_BARS);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(BRACE_BAR_SUM);
      for (const w of widths) expect(w >= 1 && w <= 3, String(widths)).toBe(true);
      expect(new Set(widths).size).toBeGreaterThan(1);
    }
    // Tirages dégénérés : jamais onze barres égales, jamais une barre hors du rang.
    for (const fixed of [0, 0.5, 0.9999999]) {
      const widths = braceBarWidths(() => fixed);
      expect(new Set(widths).size, String(fixed)).toBeGreaterThan(1);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(BRACE_BAR_SUM);
    }
  });

  it('{ onze barres } : les accolades autour, un rectangle par barre, un dessin de largeur fixe, caché aux lecteurs d’écran', () => {
    const widths = [1, 3, 2, 1, 2, 3, 2, 1, 3, 2, 2];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(BraceCode, { widths })));
    const code = host.firstElementChild!;
    expect(code.getAttribute('aria-hidden')).toBe('true');
    expect(code.textContent).toBe('{}');
    expect(code.firstElementChild!.textContent).toBe('{');
    expect(code.lastElementChild!.textContent).toBe('}');
    const svg = code.querySelector('svg')!;
    expect(Number(svg.getAttribute('width'))).toBe(BRACE_WIDTH);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    const d = svg.querySelector('path')!.getAttribute('d')!;
    expect(d).toBe(braceBarsPath(widths));
    const bars = [...d.matchAll(/M(\d+) 0h(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(bars.map(([, w]) => w)).toEqual(widths);
    bars.slice(1).forEach(([x], i) => expect(x - bars[i]![0] - bars[i]![1]).toBe(BRACE_GAP));
    expect(bars.at(-1)![0] + bars.at(-1)![1]).toBe(BRACE_WIDTH);
  });

  it('un dessin par ouverture du desk : le même à chaque rendu, pour que le code ne saute pas sous le geste', () => {
    expect(sessionBraceBars()).toBe(sessionBraceBars());
  });

  it('le pied porte le code d’accolades sous le geste du siège, plus le Code 128 ; le geste se règle sur sa largeur', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    expect(shell).toMatch(/<SeatMark>\s*<BraceCode \/>\s*<\/SeatMark>/);
    expect(shell).not.toMatch(/<Barcode\b/);
    expect(BRACE_WIDTH).toBe(42);
    expect(readFileSync('src/app/seatMark.module.css', 'utf8')).toMatch(/width: calc\(42px \+ 2 \* \(1ch \+ 0\.08em\) \+ 6px\);/);
  });

  it('OROS3.15 le README et le journal 3.7.0 décrivent le pied livré : plus de bande ivoire', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).not.toMatch(/ivory (?:status|label) strip/i);
    expect(readme.match(/eleven-bar code between braces/g)).toHaveLength(2);
    expect(readFileSync('src/engine/changelog/changelog.json', 'utf8')).not.toMatch(/bande d’étiquette ivoire|ivory label strip|banda de etiqueta marfil/);
  });
});
