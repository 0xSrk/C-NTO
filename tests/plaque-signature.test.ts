/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlaqueSignature } from '@/design/PlaqueSignature';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Parameters<typeof PlaqueSignature>[0] = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PlaqueSignature, props)));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('PlaqueSignature', () => {
  it('se présente comme une seule image nommée', () => {
    const el = mount();
    const img = el.querySelectorAll('[role="img"]');
    expect(img).toHaveLength(1);
    const plate = img.item(0);
    expect(plate.getAttribute('aria-label')).toBe('SIΞRRΛSKΛ — Artefact 002');
    for (const child of plate.children) expect(child.getAttribute('aria-hidden')).toBe('true');
  });

  it('porte le nom du Lab et le numéro, rien d’autre', () => {
    const parts = [...mount().querySelectorAll('span')].slice(0, 2).map((n) => n.textContent?.replace(/\s+/g, ' ').trim());
    expect(parts).toEqual(['SIΞRRΛSKΛ', 'ARTEFACT 002']);
    expect(mount().textContent).not.toMatch(/DEEP TECH|001 OS|®/);
  });

  it('pas de vis : repères de calage et micro-texte seulement', () => {
    const el = mount();
    expect(el.querySelectorAll('i')).toHaveLength(0);
    const spans = [...el.querySelectorAll('span')];
    expect(spans).toHaveLength(3);
    const micro = spans[2]?.textContent ?? '';
    expect(micro).toContain('SIΞRRΛSKΛ · ARTEFACT 002 · SRK—LAB');
  });

  it('le numéro d’artefact suit la propriété', () => {
    const el = mount({ artefact: '003' });
    expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('SIΞRRΛSKΛ — Artefact 003');
  });

  it('le rail ne garde aucune trace de l’ancienne signature', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    expect(shell).toContain('<PlaqueSignature');
    expect(shell).not.toMatch(/DEEP TECH LAB|001 OS|DotGrid/);
  });

  it('les ors restent confinés à la plaque', () => {
    const tokens = readFileSync('src/design/tokens.css', 'utf8');
    expect(tokens).not.toMatch(/--or[-:]/);
  });
});
