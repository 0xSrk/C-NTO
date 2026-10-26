/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Seal, SEAL_HORIZON } from '@/design/Seal';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Parameters<typeof Seal>[0] = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Seal, props)));
  return host.querySelector('svg')!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS2.6 sceau Horizon vectorisé', () => {
  it('quatre groupes, dans l’ordre du master : anneaux, horizon, filaments, inscription ; à la couleur du texte', () => {
    const svg = mount();
    expect(svg.getAttribute('viewBox')).toBe('-404 -370 808 740');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect([...svg.querySelectorAll('g[data-part]')].map((g) => g.getAttribute('data-part'))).toEqual(['rings', 'horizon', 'filaments', 'inscription']);
    expect(svg.querySelectorAll('g[data-part="filaments"] path')).toHaveLength(12);
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,8}|rgb/i);
  });

  it('positif et négatif ne diffèrent que par l’horizon', () => {
    const pos = mount({ kind: 'positive' });
    const parts = (svg: SVGSVGElement) => Object.fromEntries([...svg.querySelectorAll('g[data-part]')].map((g) => [g.getAttribute('data-part'), g.innerHTML]));
    const a = parts(pos);
    act(() => root!.render(createElement(Seal, { kind: 'negative' })));
    const b = parts(host!.querySelector('svg')!);
    expect(a.horizon).not.toBe(b.horizon);
    for (const id of ['rings', 'filaments', 'inscription']) expect(a[id], id).toBe(b[id]);
  });

  it('se nomme une fois quand on le lui demande, sinon il se tait', () => {
    expect(mount().getAttribute('aria-hidden')).toBe('true');
    act(() => root!.render(createElement(Seal, { label: 'Sceau Horizon, SIΞRRΛSKΛ Lab' })));
    const named = host!.querySelector('svg')!;
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('Sceau Horizon, SIΞRRΛSKΛ Lab');
  });

  it('l’horizon passe à 48,27 % de la hauteur (y = −12,8) : c’est la ligne où le démarrage et le verrou s’alignent', () => {
    expect(SEAL_HORIZON).toBeCloseTo((370 - 12.8) / 740, 5);
  });
});
