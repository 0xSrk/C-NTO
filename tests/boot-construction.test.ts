/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Boot } from '@/app/Boot';

// React : act() est attendu dans ce fichier.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Partial<Parameters<typeof Boot>[0]> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Boot, { steps: [], ready: false, onFinished: () => undefined, ...props })));
  return host;
}

beforeEach(() => {
  // jsdom n'a pas de canvas : le circuit se neutralise de lui-même.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Boot 3.2.2 — construction du logotype', () => {
  it('le logotype se construit et la ligne du Lab reprend le point rouge', () => {
    const el = mount();
    const svg = el.querySelector('svg[aria-label="CΛNTO"]')!;
    expect(svg.querySelector('[data-part="led"]')).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('420');
    const sous = [...el.querySelectorAll('p')].find((p) => p.textContent?.includes('SIΞRRΛSKΛ LAB'))!;
    expect(sous.textContent).toBe('SIΞRRΛSKΛ LABARTEFACT 002');
    expect(sous.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    expect(sous.style.getPropertyValue('--sous-delay')).toBe('1.92s');
  });

  it('depuis le lanceur, la LED attend un peu plus au centre et tout se décale d’autant', () => {
    window.history.replaceState(null, '', '/#from-launcher');
    const el = mount();
    expect(el.querySelector<SVGSVGElement>('svg[aria-label="CΛNTO"]')!.style.getPropertyValue('--wm-delay')).toBe('0.22s');
    const sous = [...el.querySelectorAll('p')].find((p) => p.textContent?.includes('SIΞRRΛSKΛ LAB'))!;
    expect(sous.style.getPropertyValue('--sous-delay')).toBe('2.02s');
  });

  it('l’ouverture attend la fin de la construction, même si tout est prêt', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const onReveal = vi.fn();
    mount({ ready: true, onReveal });
    act(() => vi.advanceTimersByTime(2400));
    expect(onReveal).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('le circuit ne dessine plus sa propre LED : c’est le logotype qui la porte', () => {
    const circuit = readFileSync('src/app/bootCircuit.ts', 'utf8');
    expect(circuit).not.toMatch(/ledFade/);
    expect(readFileSync('src/app/Boot.tsx', 'utf8')).not.toMatch(/<Sigil/);
  });
});
