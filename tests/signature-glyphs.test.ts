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
  });
});