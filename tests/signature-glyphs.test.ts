/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SignatureGlyphs } from '@/design/SignatureGlyphs';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SignatureGlyphs)));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('signature, neuf glyphes', () => {
  it('trace S I Ξ R R Λ S K Λ, rien d’autre', () => {
    const el = mount();
    const paths = el.querySelectorAll('path');
    expect(paths).toHaveLength(9);
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toBe('');
    expect(el.querySelector('path')?.hasAttribute('pathLength')).toBe(false);
  });

  it('en formation, chaque glyphe a un tracé et un décalage', () => {
    act(() => root?.unmount());
    host?.remove();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(SignatureGlyphs, { draw: true, delay: 0.22 })));
    const svg = host.querySelector('svg')!;
    expect(svg.style.getPropertyValue('--form-delay')).toBe('0.22s');
    const paths = [...svg.querySelectorAll('path')];
    expect(paths).toHaveLength(9);
    expect(paths[0]?.style.getPropertyValue('--t')).toBe('0.00s');
    expect(paths[8]?.style.getPropertyValue('--t')).toBe('0.88s');
  });
});