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

// Le shell du desk, présent ou non selon le test : « Coller » et « Fermer CΛNTO » passent par lui.
const shell = vi.hoisted(() => ({ desk: undefined as undefined | { window: { close: () => void; paste?: () => void } } }));
vi.mock('@/lib/desk', () => ({
  get desk() {
    return shell.desk;
  },
  get isDesk() {
    return !!shell.desk;
  },
}));

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
  shell.desk = undefined;
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

  it('OROS4.6 la fiche d’accès, plus large et allégée : ni plaque en haut à droite, ni phrase dessous, ni ligne de classe ; Ouvrir chanfreiné', () => {
    const el = mount();
    expect(el.querySelector('[data-part="access-plate"]')).toBeNull();
    expect(el.querySelector('svg[class*="mg-access"]')).toBeNull();
    expect(el.textContent).not.toMatch(/reste sur ce poste|stays on this machine|ne quitte pas|never leaves|CLASSE|COFFRE/);
    // le repère de l'écran reste seul, en haut à gauche : plus d'état ni d'horloge en haut à droite
    expect(el.querySelector('[aria-hidden] b')).toBeNull();
    const fiche = el.querySelector<HTMLFormElement>('form[data-part="fiche"]');
    expect(fiche).not.toBeNull();
    expect(fiche!.textContent).toContain('FICHE D’ACCÈS');
    expect(fiche!.textContent).toContain('SK-ART-002');
    // ni code ni règle : seule la flèche d'ouverture dessine dans la fiche
    const drawings = [...fiche!.querySelectorAll('svg')];
    expect(drawings.map((svg) => svg.getAttribute('class'))).toEqual([expect.stringMatching(new RegExp(`\\bskg-${GLYPH_ID.arrowOpen}\\b`))]);
    const open = fiche!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const name = [...open.childNodes].filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent).join('').trim();
    expect(name).toBe('Ouvrir');
    expect(open.className).toMatch(/chamfer/);
    // l'état se lit au-dessus du champ ; le champ porte son libellé
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(el.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Phrase');
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Fermé');
    expect(css).toMatch(/\.fiche \{[^}]*width: min\(540px, 100%\);/);
  });

  it('OROS4.6 « Coller » : dans le desk, le process principal colle dans le champ qui a le focus', () => {
    const paste = vi.fn();
    shell.desk = { window: { close: vi.fn(), paste } };
    const el = mount();
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const button = el.querySelector<HTMLButtonElement>('button[data-part="paste"]')!;
    expect(button.textContent).toBe('Coller');
    expect(button.type).toBe('button');
    input.blur();
    act(() => button.click());
    expect(document.activeElement).toBe(input);
    expect(paste).toHaveBeenCalledTimes(1);
    // le clic ne prend pas le focus au champ
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('OROS4.6 « Coller » hors du desk : le presse-papiers du navigateur remplit le champ, sur une ligne', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => 'la phrase\n') } });
    const el = mount();
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      el.querySelector<HTMLButtonElement>('button[data-part="paste"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(input.value).toBe('la phrase');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('OROS4.6 « Fermer CΛNTO » : pour qui n’a pas la phrase, le desk se ferme ; hors du desk, rien à fermer', () => {
    const close = vi.fn();
    shell.desk = { window: { close } };
    const el = mount();
    const button = el.querySelector<HTMLButtonElement>('button[data-part="close-canto"]')!;
    expect(button.textContent).toBe('Fermer CΛNTO');
    act(() => button.click());
    expect(close).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    host?.remove();
    shell.desk = undefined;
    expect(mount().querySelector('button[data-part="close-canto"]')).toBeNull();
  });

  it('OROS4.6 l’ouverture part du sceau : la fiche se retire, le sceau glisse au centre et se plie dans son horizon, le mot se lève de la ligne', () => {
    const el = mount();
    const gate = el.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const name of ['--glide-s', '--fold-at', '--fold-s', '--word-at', '--draw']) expect(gate.style.getPropertyValue(name), name).toMatch(/^\d+(\.\d+)?s$/);
    expect(css).toMatch(/\.forming \.stack,\n\.opening \.stack \{[^}]*opacity: 0;/);
    expect(css).toMatch(/\.forming \.sealw,\n\.opening \.sealw \{[^}]*translate: var\(--glide, 0px\) 0;[^}]*scale: 1 0\.004;/);
    expect(css).toMatch(/\.sealw \{[^}]*transition:[^}]*translate var\(--glide-s[^}]*scale var\(--fold-s[^}]*var\(--fold-at/);
    expect(css).toMatch(/\.unlock \.live \{[^}]*animation: seal-settle var\(--draw[^;]*var\(--word-at/);
    // la ligne s'éclaire et sa LED d'or s'allume quand le sceau s'y plie
    expect(css).toMatch(/\.forming \.horizon::after \{\s*opacity: 1;/);
  });

  it('OROS4.6 le canal « Coller » : nommé au preload, gardé par trusted(e), seulement pour la fenêtre au premier plan ; la lecture du presse-papiers reste refusée au renderer', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(preload).toContain("paste: () => ipcRenderer.send('window:paste'),");
    const handler = main.slice(main.indexOf("ipcMain.on('window:paste'"), main.indexOf('});', main.indexOf("ipcMain.on('window:paste'")));
    expect(handler).toMatch(/if \(!trusted\(e\)\) return;/);
    expect(handler).toMatch(/if \(!w \|\| !w\.isFocused\(\)\) return;/);
    expect(handler).toMatch(/e\.sender\.paste\(\);/);
    expect(main).toContain("const PERMISSIONS_ALLOWED = new Set(['clipboard-sanitized-write']);");
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
