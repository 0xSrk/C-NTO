/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Barcode } from '@/design/primitives';
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

  it('la barre d’état est imprimée : ivoire et encre, l’or y devient or d’encre', () => {
    const status = rule('.status');
    expect(status).toMatch(/background:\s*var\(--ivory\)/);
    expect(status).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(status).toMatch(/--gold:\s*var\(--gold-ink\)/);
    expect(status).toMatch(/--text-0:\s*var\(--ink\)/);
  });
});
