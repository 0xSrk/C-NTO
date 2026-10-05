/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrambleFrame, scrambleSteps, SEAT_ALPHABET, SEAT_PROMPT, SEAT_STEP_MS, SEAT_STEPS } from '@/app/seatScramble';

const LINE = 'SIEGE1.eyJhcnRlZmFjdCI6IjAwMiJ9.c2lnbmF0dXJl';
const ALL_STEPS_MS = SEAT_STEPS * SEAT_STEP_MS;

let root: Root | null = null;
let host: HTMLElement | null = null;

type Seat = { status: () => Promise<{ client: string } | null>; submit: (line: string) => Promise<{ ok: true; client: string } | { ok: false }> };

/** Monte le pied avec ou sans `canto.seat` ; `desk` est lu à l'import, d'où le rechargement des modules. */
async function mountSeat(seat: Seat | null, reduced = false) {
  (window as unknown as { canto?: unknown }).canto = seat ? { seat } : undefined;
  window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as never;
  vi.resetModules();
  const { SeatMark } = await import('@/app/SeatMark');
  const { useI18n } = await import('@/i18n');
  const { useUi } = await import('@/store/ui');
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement('span', { className: 'sigEnd' }, createElement(SeatMark, null, createElement('i', { 'data-bars': '' })), createElement('span', null, '[ SIΞRRΛSKΛ ]')));
  });
  return { el: host, useUi };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const button = () => host!.querySelector('button')!;
const field = () => host!.querySelector('input');

function typeInto(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  delete (window as unknown as { canto?: unknown }).canto;
});

describe('geste du siège : lettres déterministes', () => {
  it('six temps, lettre (3i + 7t) mod 6, puis la cible', () => {
    expect(scrambleFrame('abcd', 0)).toBe(['S', 'R', 'S', 'R'].join(''));
    expect(scrambleFrame('abcd', 1)).toBe(['I', 'Λ', 'I', 'Λ'].join(''));
    for (let t = 0; t < SEAT_STEPS; t++) expect([...scrambleFrame(SEAT_PROMPT, t)].every((c) => (SEAT_ALPHABET as readonly string[]).includes(c))).toBe(true);
    expect(scrambleFrame(SEAT_PROMPT, SEAT_STEPS)).toBe(SEAT_PROMPT);
    expect(scrambleFrame('0xSrk', 3)).toBe(scrambleFrame('0xSrk', 3));
    expect(scrambleSteps(false)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scrambleSteps(true)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});

describe('geste du siège dans le pied', () => {
  it('hors desk : les barres seules, ni bouton ni nom', async () => {
    const { el } = await mountSeat(null);
    expect(el.querySelector('[data-bars]')).not.toBeNull();
    expect(el.querySelector('button')).toBeNull();
    expect(el.textContent).toBe('[ SIΞRRΛSKΛ ]');
  });

  it('au repos : les barres dans un bouton nommé, sans littéral ni nom', async () => {
    const { el } = await mountSeat({ status: async () => null, submit: vi.fn() });
    expect(button().getAttribute('aria-label')).toBe('Inscrire un siège');
    expect(button().querySelector('[data-bars]')).not.toBeNull();
    expect(button().hasAttribute('title')).toBe(false);
    expect(el.textContent).not.toContain(SEAT_PROMPT);
    expect(el.textContent).toBe('[ SIΞRRΛSKΛ ]');
  });

  it('le survol révèle <insert code> sans prendre le focus ; le quitter rend les barres', async () => {
    const { el } = await mountSeat({ status: async () => null, submit: vi.fn() });
    await act(async () => void button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(el.querySelector('[data-bars]')).toBeNull();
    await advance(SEAT_STEP_MS);
    expect(el.textContent).not.toContain(SEAT_PROMPT);
    await advance(ALL_STEPS_MS);
    expect(el.textContent).toContain(SEAT_PROMPT);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await act(async () => void button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(el.querySelector('[data-bars]')).not.toBeNull();
    expect(el.textContent).not.toContain(SEAT_PROMPT);
  });

  it('mouvement réduit : le littéral apparaît sans tourner', async () => {
    const { el } = await mountSeat({ status: async () => null, submit: vi.fn() }, true);
    await act(async () => void button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(el.textContent).toContain(SEAT_PROMPT);
  });

  it('un code accepté affiche le nom signé avant les barres, jamais la ligne saisie', async () => {
    const submit = vi.fn(async () => ({ ok: true as const, client: '0xSrk' }));
    const { el } = await mountSeat({ status: async () => null, submit });
    await act(async () => void button().click());
    const input = field()!;
    expect(input.getAttribute('aria-label')).toBe('Inscrire un siège');
    expect(document.activeElement).toBe(input);
    expect(el.textContent).toContain(SEAT_PROMPT);
    await act(async () => typeInto(input, LINE));
    await key(input, 'Enter');
    expect(submit).toHaveBeenCalledWith(LINE);
    await advance(ALL_STEPS_MS);
    const name = el.querySelector('[title]')!;
    expect(name.getAttribute('title')).toBe('0xSrk');
    expect(name.textContent).toContain('0xSrk');
    // Ordre : nom, barres, [ SIΞRRΛSKΛ ].
    const sig = el.firstElementChild!;
    expect(sig.children[0]).toBe(name);
    expect(sig.children[1]!.querySelector('[data-bars]')).not.toBeNull();
    expect(sig.children[2]!.textContent).toBe('[ SIΞRRΛSKΛ ]');
    expect(el.innerHTML).not.toContain(LINE);
    expect(field()).toBeNull();
  });

  it('un code refusé garde le nom déjà affiché et le dit par un toast', async () => {
    const submit = vi.fn(async () => ({ ok: false as const }));
    const { el, useUi } = await mountSeat({ status: async () => ({ client: 'Λ-Testeur' }), submit });
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe('Λ-Testeur');
    await act(async () => void button().click());
    await act(async () => typeInto(field()!, 'Admin'));
    await key(field()!, 'Enter');
    await advance(ALL_STEPS_MS);
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe('Λ-Testeur');
    expect(el.textContent).not.toContain('Admin');
    expect(useUi.getState().toasts.map((t) => t.text)).toContain('Siège refusé');
    expect(el.querySelector('[data-bars]')).not.toBeNull();
  });

  it('Échap referme le champ et oublie le texte', async () => {
    const submit = vi.fn();
    const { el } = await mountSeat({ status: async () => null, submit });
    await act(async () => void button().click());
    await act(async () => typeInto(field()!, 'SIEGE1.abc'));
    await key(field()!, 'Escape');
    expect(field()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await act(async () => void button().click());
    expect(field()!.value).toBe('');
    expect(el.textContent).not.toContain('SIEGE1.abc');
  });
});

describe('garde du siège', () => {
  it('le pied enveloppe les barres, sans plaque ; couleurs du nom limitées au rouge du desk', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    expect(shell).toMatch(/<SeatMark>\s*<Barcode \/>\s*<\/SeatMark>\s*<span>\[ SIΞRRΛSKΛ \]<\/span>/);
    expect(shell).not.toContain('<PlaqueSignature');
    const css = readFileSync('src/app/seatMark.module.css', 'utf8');
    const colors = [...css.matchAll(/(?:^|\s)(?:color|text-shadow|caret-color):\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(colors.length).toBeGreaterThan(0);
    for (const value of colors) expect(value, value).toMatch(/^(?:var\(--gold\)|var\(--gold-line\)|CanvasText|none|inherit|0 0 6px var\(--gold\)|0 0 3px var\(--gold-line\))$/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|--or[-:]/i);
    // Le contenu du bouton change au survol : un clic ne doit jamais viser un nœud remplacé.
    expect(css).toMatch(/\.trigger > \* \{\s*pointer-events: none;/);
    expect(readFileSync('src/design/tokens.css', 'utf8')).not.toMatch(/--or[-:]/);
    expect(readFileSync('electron/launcher.html', 'utf8')).not.toMatch(/<input|<textarea|contenteditable/i);
  });
});
