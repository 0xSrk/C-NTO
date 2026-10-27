/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Boot } from '@/app/Boot';
import { SEAL_HORIZON } from '@/design/Seal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Boot, { steps: [], ready: false, onFinished: () => undefined })));
  return host;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const css = readFileSync('src/app/boot.module.css', 'utf8').replace(/\r\n/g, '\n');

describe('OROS2.7 la frappe du démarrage', () => {
  it('le sceau Horizon est frappé à gauche du logotype, son horizon posé sur l’axe', () => {
    const el = mount();
    const seal = el.querySelector<HTMLElement>('[data-part="seal"]');
    expect(seal).not.toBeNull();
    expect(seal!.querySelector('svg g[data-part="horizon"]')).not.toBeNull();
    expect(seal!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(seal!.style.getPropertyValue('--hz')).toBe(`${(SEAL_HORIZON * 100).toFixed(2)}%`);
    // le sceau et le logotype partagent la même boîte : l'axe du logotype (y 80) est la ligne d'horizon
    expect(seal!.closest('[data-part="mark"]')?.querySelector('svg[aria-label="CΛNTO"]')).not.toBeNull();
    expect(css).toMatch(/translateY\(calc\(-1 \* var\(--hz\)\)\)/);
  });

  it('mouvement réduit : le sceau est posé d’emblée, sans frappe', () => {
    expect(css).toMatch(/\.boot\.reduced \.sealw\s*\{[^}]*animation:\s*none/);
  });

  it('plus aucun rouge dans le démarrage : la couture porte la LED or', () => {
    expect(css).not.toMatch(/196,\s*30,\s*58|229,\s*38,\s*61/);
  });

  it('OROS4.9 le démarrage n’imprime plus de plaque : le sceau, le logotype et la ligne du Lab, seuls', () => {
    const el = mount();
    expect(el.querySelector('[data-part="seal-plate"]')).toBeNull();
    expect(el.querySelector('[data-part="artefact-plate"]')).toBeNull();
    expect(el.querySelector('svg[class*="mg-"]')).toBeNull();
    expect(css).not.toMatch(/\.plateSeal|\.plateArtefact|plate-stamp/);
    expect(el.querySelector('[data-part="mark"] [data-part="seal"]')).not.toBeNull();
  });
});
