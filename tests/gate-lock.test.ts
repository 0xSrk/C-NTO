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
import { SEAT_ALPHABET, SEAT_DOMINO } from '@/app/seatGlyphs';
import { ABRIDGE_GRACE_MS, reducedTimeline, unlockTimeline } from '@/app/unlockCircuit';
import { GLYPH_ID } from '@/design/micro/assets';

// La phrase reste celle du moteur (tests/desk-gate.test.ts) ; ici, une doublure : seule « la phrase » ouvre.
vi.mock('@/engine/gate', () => ({ opens: vi.fn(async (phrase: string) => phrase === 'la phrase') }));

// Le shell du desk, présent ou non selon le test : « Coller » et « Fermer CΛNTO » passent par lui.
const shell = vi.hoisted(() => ({ desk: undefined as undefined | { window: { close: () => void; paste?: () => Promise<boolean> | void; pasteClose?: () => void } } }));
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

/** Sous horloge simulée : avance jusqu'à `ms` après `start`, plus un pas de l'horloge du verrou (30 ms). */
function advanceTo(start: number, ms: number) {
  act(() => vi.advanceTimersByTime(Math.max(0, start + ms + 31 - performance.now())));
}

/** Sous horloge simulée : la soumission, puis la réponse du moteur (des microtâches). */
async function submitFake(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await vi.advanceTimersByTimeAsync(0);
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
  vi.useRealTimers();
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

  it('OROS4.18 l’ouverture se lit dans la feuille par étapes cumulées : la fiche s’efface, la ligne s’éclaire, le mot se déplie, le voile se lève', () => {
    const el = mount();
    const gate = el.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const name of ['--fold-at', '--word-at', '--draw', '--fade-s']) expect(gate.style.getPropertyValue(name), name).toMatch(/^\d+(\.\d+)?s$/);
    expect(gate.style.getPropertyValue('--spin')).toBe(`${SEAT_DOMINO.spin}ms`);
    // la phrase admise, la fiche s'efface autour de ses glyphes ; le sceau baisse en attendant la lumière
    expect(css).toMatch(/\.admitted \.heading,\n\.admitted \.fh,\n\.admitted \.fieldHead,\n\.admitted \.row,\n\.admitted \.paste \{[^}]*opacity: 0;/);
    expect(css).toMatch(/\.admitted \.fiche,\n\.admitted \.inputRow input \{[^}]*border-color: transparent;/);
    expect(css).toMatch(/\.admitted \.sealSvg \{[^}]*opacity: 0\.34;/);
    expect(css).toMatch(/\.charged \.sealSvg \{[^}]*opacity: 1;/);
    // le circuit mène le sceau à l'horloge de sa lumière : la feuille ne l'anime plus
    expect(css).toMatch(/\.sealw \{[^}]*transform: translateY\(calc\(50% - var\(--hz\)\)\);/);
    expect(css).not.toMatch(/\.sealw \{[^}]*transition/);
    expect(css).not.toMatch(/^\.gliding \.sealw/m);
    expect(css).toMatch(/\.gliding \.horizon \{[^}]*background-color: color-mix/);
    // le mot se déplie de la ligne, comme le sceau s'y est plié
    expect(css).toMatch(/\.unlock \.live \{[^}]*animation: word-unfold var\(--draw[^;]*var\(--word-at/);
    expect(css).toMatch(/@keyframes word-unfold \{\s*from \{[^}]*clip-path: inset\(50% 0 50% 0\);/);
    expect(css).toMatch(/\.spreading \.unlock \{\s*opacity: 1;/);
    // le voile se lève sur le desk : plus de couture ni de masque
    expect(css).toMatch(/\.revealing \{[^}]*background-color: transparent;/);
    expect(css).not.toMatch(/\.seam|mask-image|--axis|@property --gap/);
    // les glyphes gardent la place des points du champ masqué : même police, même chasse, même marge
    expect(css).toMatch(/\.glyphs \{[^}]*padding-left: 14px;[^}]*font-family: var\(--font-mono\);[^}]*font-size: 14px;/);
    expect(css).toMatch(/\.cell \{[^}]*width: 1ch;[^}]*margin-right: 0\.22em;/);
    expect(css).toMatch(/\.inputRow input \{[^}]*padding: 0 14px;[^}]*font-size: 14px;[^}]*letter-spacing: 0\.22em;/);
    expect(css).toMatch(/\.turn \{[^}]*animation: glyph-fall var\(--spin/);
  });

  it('OROS4.6 le canal « Coller » : nommé au preload, gardé par trusted(e), seulement pour la fenêtre au premier plan ; OROS4.28 juste après un geste réel ; la lecture du presse-papiers reste refusée au renderer', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(preload).toContain("paste: () => ipcRenderer.send('window:paste'),");
    const handler = main.slice(main.indexOf("ipcMain.on('window:paste'"), main.indexOf('});', main.indexOf("ipcMain.on('window:paste'")));
    expect(handler).toMatch(/if \(!trusted\(e\)\) return;/);
    expect(handler).toMatch(/if \(!w \|\| !w\.isFocused\(\)\) return;/);
    expect(handler).toMatch(/e\.sender\.paste\(\);/);
    // OROS4.28 juste après un geste réel de l'opérateur, vu par le process principal, et un collage par geste ; OROS4.36 le
    // garde vit dans electron/paste-gate.ts, éprouvé à l'horloge factice par tests/paste-gate.test.ts
    expect(handler).toMatch(/if \(!pasteGate\.allow\(e\.sender\.id\)\) return;\s*e\.sender\.paste\(\);/);
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

  it('OROS4.18 admise, la phrase se défait en glyphes au pas du code d’accolades ; il n’en reste que sa longueur', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const onAdmit = vi.fn();
    const onReveal = vi.fn();
    const onOpen = vi.fn();
    const el = mount({ onAdmit, onReveal, onOpen });
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    type(input, 'la phrase');
    await submitFake(el.querySelector<HTMLFormElement>('form')!);
    // le desk se monte dessous tout de suite ; l'horloge de l'ouverture part deux images plus tard, sur un fil libre
    expect(onAdmit).toHaveBeenCalledTimes(1);
    const gate = el.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(gate.className).not.toMatch(/admitted/);
    act(() => vi.advanceTimersByTime(40));
    const start = performance.now();
    expect(gate.className).toMatch(/admitted/);
    expect(input.value).toBe('');
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Ouvert');
    const row = el.querySelector<HTMLElement>('[data-part="unlock-glyphs"]')!;
    const cells = () => [...row.querySelectorAll<HTMLElement>('[data-phase]')];
    // une case par caractère, aucune ne dit la phrase : en attente, le point du champ masqué
    expect(cells()).toHaveLength([...'la phrase'].length);
    expect(row.textContent).not.toMatch(/[la phrse]/);
    advanceTo(start, 100);
    const tl = unlockTimeline(9);
    const phases = cells().map((c) => c.dataset.phase);
    // au pas du geste : 85 ms d'écart, 340 ms de vie, sur les lettres du Lab
    expect(phases.slice(0, 2)).toEqual(['turn', 'turn']);
    expect(phases.slice(3)).toEqual(Array(6).fill('wait'));
    for (const c of cells().filter((c) => c.dataset.phase === 'turn')) expect(SEAT_ALPHABET).toContain(c.textContent as (typeof SEAT_ALPHABET)[number]);
    for (const c of cells().filter((c) => c.dataset.phase === 'wait')) expect(c.textContent).toBe('•');
    advanceTo(start, tl.sets[0]!);
    expect(cells()[0]!.dataset.phase).toBe('set');
    expect(cells()[8]!.dataset.phase).toBe('wait');
    // les étapes se posent dans l'ordre, puis le voile se lève et le verrou s'en va
    advanceTo(start, tl.gold);
    expect(gate.className).toMatch(/charged/);
    expect(gate.className).not.toMatch(/gliding/);
    expect(cells().every((c) => c.dataset.phase === 'set')).toBe(true);
    advanceTo(start, tl.spread);
    expect(gate.className).toMatch(/gliding/);
    expect(gate.className).toMatch(/spreading/);
    expect(el.querySelector('[aria-label="Desk Unlocked"]')?.className).toMatch(/live/);
    expect(onReveal).not.toHaveBeenCalled();
    advanceTo(start, tl.reveal);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(gate.className).toMatch(/revealing/);
    expect(onOpen).not.toHaveBeenCalled();
    advanceTo(start, tl.end);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onAdmit).toHaveBeenCalledTimes(1);
  });

  it('OROS4.31 admise, la phrase quitte le champ tout de suite : les points de la rangée de glyphes la remplacent avant même le départ de l’horloge', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const el = mount();
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const form = el.querySelector<HTMLFormElement>('form')!;
    type(input, 'la phrase');
    await submitFake(form);
    // aucune image n'est encore passée : le champ est déjà vide, la fiche déjà fermée à la saisie
    expect(input.value).toBe('');
    expect(el.textContent).not.toContain('la phrase');
    expect(form.hasAttribute('inert')).toBe(true);
    // à la place des points du champ, ceux de la rangée de glyphes, en attente : il ne reste que la longueur
    const row = el.querySelector<HTMLElement>('[data-part="unlock-glyphs"]');
    expect(row).not.toBeNull();
    const cells = [...row!.querySelectorAll<HTMLElement>('[data-phase]')];
    expect(cells).toHaveLength([...'la phrase'].length);
    expect(cells.every((c) => c.dataset.phase === 'wait' && c.textContent === '•')).toBe(true);
    // l'horloge, elle, part deux images plus tard
    expect(el.querySelector('[role="dialog"]')!.className).not.toMatch(/admitted/);
  });

  it('OROS4.32 l’état du verrou se dit hors de la fiche : admise, la fiche devient inerte, et « Ouvert » s’annonce quand même', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const el = mount();
    const form = el.querySelector<HTMLFormElement>('form')!;
    const regions = el.querySelectorAll<HTMLElement>('[role="status"]');
    expect(regions).toHaveLength(1);
    const region = regions[0]!;
    // la région vivante n'est ni dans la fiche ni sous un parent inerte
    expect(region.closest('form')).toBeNull();
    expect(region.textContent).toBe('Fermé');
    // le mot visible de la fiche ne double pas l'annonce
    const word = form.querySelector<HTMLElement>('[class*="state"]:not([class*="stateLine"])')!;
    expect(word.textContent).toBe('Fermé');
    expect(word.getAttribute('aria-hidden')).toBe('true');
    expect(css).toMatch(/\.srOnly \{[^}]*clip: rect\(0 0 0 0\);[^}]*text-transform: none;/);
    type(el.querySelector<HTMLInputElement>('input[type="password"]')!, 'la phrase');
    await submitFake(form);
    expect(form.hasAttribute('inert')).toBe(true);
    expect(region.closest('[inert]')).toBeNull();
    expect(region.textContent).toBe('Ouvert');
  });

  it('OROS4.18 une touche ou un clic abrège : le voile se lève aussitôt sur le desk monté', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const onReveal = vi.fn();
    const onOpen = vi.fn();
    const el = mount({ onReveal, onOpen });
    type(el.querySelector<HTMLInputElement>('input[type="password"]')!, 'la phrase');
    await submitFake(el.querySelector<HTMLFormElement>('form')!);
    act(() => vi.advanceTimersByTime(ABRIDGE_GRACE_MS + 100));
    expect(onReveal).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    // tout est posé d'un coup : les glyphes en pastilles, le voile qui se lève
    expect([...el.querySelectorAll<HTMLElement>('[data-phase]')].every((c) => c.dataset.phase === 'set')).toBe(true);
    expect(el.querySelector('[role="dialog"]')!.className).toMatch(/revealing/);
    const tl = unlockTimeline(9);
    const pressed = performance.now();
    advanceTo(pressed, tl.end - tl.reveal - 60);
    expect(onOpen).not.toHaveBeenCalled();
    advanceTo(pressed, tl.end - tl.reveal);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // une seconde touche ne relance rien
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown'));
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('OROS4.33 le geste qui a ouvert n’abrège pas : ni le second clic d’un double-clic sur « Ouvrir », ni Entrée tenue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const onReveal = vi.fn();
    const el = mount({ onReveal });
    type(el.querySelector<HTMLInputElement>('input[type="password"]')!, 'la phrase');
    await submitFake(el.querySelector<HTMLFormElement>('form')!);
    const admittedAt = performance.now();
    // le second clic d'un double-clic, 120 puis 250 ms après le premier
    for (const ms of [120, 250]) {
      advanceTo(admittedAt, ms);
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerdown'));
      });
    }
    expect(onReveal).not.toHaveBeenCalled();
    // Entrée tenue : la répétition de la touche, même après le délai du geste
    advanceTo(admittedAt, ABRIDGE_GRACE_MS + 60);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
    });
    expect(onReveal).not.toHaveBeenCalled();
    expect(el.querySelector('[role="dialog"]')!.className).not.toMatch(/revealing/);
    // un geste neuf, lui, abrège
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('OROS4.37 la phrase admise, le verrou ferme le canal « Coller » du process principal, une fois', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const pasteClose = vi.fn();
    shell.desk = { window: { close: () => undefined, paste: async () => true, pasteClose } };
    const el = mount();
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const form = el.querySelector<HTMLFormElement>('form')!;
    // une phrase refusée ne le ferme pas : il faut pouvoir coller la bonne
    type(input, 'canto');
    await submitFake(form);
    expect(pasteClose).not.toHaveBeenCalled();
    type(input, 'la phrase');
    await submitFake(form);
    expect(pasteClose).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(600));
    expect(pasteClose).toHaveBeenCalledTimes(1);
  });

  it('OROS4.34 un collage qui répond après l’admission n’entre plus dans le champ', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    let release: (text: string) => void = () => undefined;
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    const el = mount();
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    // « Coller » : l'invite de permission du navigateur reste ouverte…
    act(() => el.querySelector<HTMLButtonElement>('button[data-part="paste"]')!.click());
    expect(readText).toHaveBeenCalledTimes(1);
    // … l'opérateur tape la phrase et valide…
    type(input, 'la phrase');
    await submitFake(el.querySelector<HTMLFormElement>('form')!);
    // … puis accepte l'invite : le presse-papiers ne revient pas dans la fiche fermée
    await act(async () => {
      release('presse-papiers-secret');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(input.value).toBe('');
    expect(el.innerHTML).not.toContain('presse-papiers-secret');
  });

  it('OROS4.18 mouvement réduit : ni glyphes ni circuit ; le mot paraît, puis le voile se lève', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }) });
    try {
      const onReveal = vi.fn();
      const onOpen = vi.fn();
      const el = mount({ onReveal, onOpen });
      type(el.querySelector<HTMLInputElement>('input[type="password"]')!, 'la phrase');
      await submitFake(el.querySelector<HTMLFormElement>('form')!);
      act(() => vi.advanceTimersByTime(40));
      expect(el.querySelector('[data-part="unlock-glyphs"]')).toBeNull();
      expect(el.querySelector('canvas')).toBeNull();
      expect(el.querySelector('[role="dialog"]')!.className).toMatch(/reduced/);
      const start = performance.now();
      const tl = reducedTimeline();
      advanceTo(start, tl.reveal - 40);
      expect(onReveal).not.toHaveBeenCalled();
      advanceTo(start, tl.reveal);
      expect(onReveal).toHaveBeenCalledTimes(1);
      advanceTo(start, tl.end);
      expect(onOpen).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
