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
import { APP_VERSION } from '@/lib/version';

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

  it('les plaques du sceau lisent l’artefact : la version à droite sur l’horizon, l’état en bas à droite', () => {
    const el = mount();
    const seal = el.querySelector<HTMLElement>('[data-part="seal-plate"]');
    expect(seal).not.toBeNull();
    // dans la boîte du logotype : centrée sur l'horizon, comme le sceau
    expect(seal!.closest('[data-part="mark"]')).not.toBeNull();
    expect(seal!.querySelector('svg.mg-seal')?.textContent).toContain(`V.${APP_VERSION}`);
    const artefact = el.querySelector<HTMLElement>('[data-part="artefact-plate"]');
    expect(artefact).not.toBeNull();
    expect(artefact!.closest('[data-part="mark"]')).toBeNull();
    expect(artefact!.querySelector('svg.mg-artefact')?.textContent).toMatch(/SK-ART-002[\s\S]*LIVE/);
    expect(el.innerHTML).not.toContain('{{');
    // encre et papier par les jetons : l'ivoire sur la nuit
    expect(css).toMatch(/\.plateSeal \{[^}]*top: 50%;[^}]*transform: translateY\(-50%\);[^}]*--k: var\(--text-0\);[^}]*--p: var\(--bg-0\);/);
    expect(css).toMatch(/\.plateArtefact \{[^}]*bottom: [^;]+;[^}]*--k: var\(--text-1\);[^}]*--p: var\(--bg-0\);/);
  });
});
