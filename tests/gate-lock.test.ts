/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Gate } from '@/app/Gate';
import { SEAL_HORIZON } from '@/design/Seal';
import { GLYPH_ID } from '@/design/micro/assets';

// La phrase reste celle du moteur (tests/desk-gate.test.ts) ; ici, une doublure : seule « la phrase » ouvre.
vi.mock('@/engine/gate', () => ({ opens: vi.fn(async (phrase: string) => phrase === 'la phrase') }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Partial<Parameters<typeof Gate>[0]> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Gate, { onAdmit: () => undefined, onReveal: () => undefined, onOpen: () => undefined, ...props })));
  return host;
}

/** Saisie telle que React la lit : valeur native, puis événement `input`. */
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Entrée dans le champ : la soumission implicite du formulaire, puis la réponse du moteur. */
async function enter(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom n'anime pas : le refus secoue la fiche par l'API Web Animations.
  if (!('animate' in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => undefined });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const css = readFileSync('src/app/gate.module.css', 'utf8').replace(/\r\n/g, '\n');

describe('OROS2.8 le sceau ferme le verrou', () => {
  it('le sceau Horizon est posé, son horizon sur la ligne de l’écran', () => {
    const el = mount();
    const seal = el.querySelector<HTMLElement>('[data-part="seal"]');
    expect(seal).not.toBeNull();
    expect(seal!.querySelector('svg g[data-part="horizon"]')).not.toBeNull();
    expect(seal!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(seal!.style.getPropertyValue('--hz')).toBe(`${(SEAL_HORIZON * 100).toFixed(2)}%`);
    // le sceau est centré : il descend de 50 % − 48,27 % de sa hauteur pour poser son horizon sur la ligne
    expect(css).toMatch(/translateY\(calc\(50% - var\(--hz\)\)\)/);
    expect(el.querySelector('[data-part="horizon-line"]')).not.toBeNull();
    expect(css).toMatch(/\.horizon \{[^}]*top: 50%;/);
  });

  it('la fiche d’accès : la plaque ACCESS en haut à droite, une règle là où il y avait un code, Ouvrir chanfreiné', () => {
    const el = mount();
    const plate = el.querySelector<HTMLElement>('[data-part="access-plate"]');
    expect(plate).not.toBeNull();
    expect(plate!.querySelector('svg.mg-access')?.textContent).toContain('ACCESS: PENDING');
    expect(css).toMatch(/\.accessPlate \{[^}]*top: [^;]+;[^}]*right: [^;]+;/);
    const fiche = el.querySelector<HTMLFormElement>('form[data-part="fiche"]');
    expect(fiche).not.toBeNull();
    expect(fiche!.textContent).toContain('FICHE D’ACCÈS');
    expect(fiche!.textContent).toContain('SK-ART-002');
    // Aucun code-barres dans la fiche : chaque dessin est un composant de la planche, la règle tient la place du code.
    const drawings = [...fiche!.querySelectorAll('svg')];
    expect(drawings.length).toBeGreaterThan(0);
    for (const svg of drawings) expect(svg.getAttribute('class') ?? '').toMatch(/\bskg\b/);
    expect(fiche!.querySelector(`svg.skg-${GLYPH_ID.rule}`)).not.toBeNull();
    const open = fiche!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    // le nom du bouton, hors dessins muets (aria-hidden)
    const name = [...open.childNodes].filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent).join('').trim();
    expect(name).toBe('Ouvrir');
    expect(open.className).toMatch(/chamfer/);
    expect(open.querySelector(`svg.skg-${GLYPH_ID.arrowOpen}`)).not.toBeNull();
  });

  it('le verrou ne parle que par jetons : ni couleur en dur ni ancien rouge', () => {
    const colours = css.replace(/^.*mask-image:.*$/gm, '');
    expect(colours).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(colours).not.toMatch(/rgba\(\s*255|229,\s*38,\s*61|196,\s*30,\s*58/);
  });

  it('la phrase ouvre et Entrée valide : une phrase fausse est refusée, la bonne admet', async () => {
    const onAdmit = vi.fn();
    const el = mount({ onAdmit });
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const form = el.querySelector<HTMLFormElement>('form')!;
    const open = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(open.disabled).toBe(true);
    type(input, 'canto');
    expect(open.disabled).toBe(false);
    await enter(form);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Refusé');
    expect(input.value).toBe('');
    expect(onAdmit).not.toHaveBeenCalled();
    type(input, 'la phrase');
    await enter(form);
    expect(onAdmit).toHaveBeenCalledTimes(1);
  });
});
