/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { glyphDelays, glyphsAt, glyphsDuration, SEAT_ALPHABET, SEAT_DOMINO, SEAT_DWELL_MS, SEAT_EMERGE, SEAT_PROMPT, SEAT_REFORM_MS } from '@/app/seatGlyphs';

const LINE = 'SIEGE1.eyJhcnRlZmFjdCI6IjAwMiJ9.c2lnbmF0dXJl';
const PROMPT_MS = glyphsDuration([...SEAT_PROMPT].length, SEAT_DOMINO);

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
const hover = () => act(async () => void button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
const leave = () => act(async () => void button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
/** Le curseur reste 2 s sur les barres : le geste s'éveille. */
async function awaken() {
  await hover();
  await advance(SEAT_DWELL_MS);
}
/** Phase lue sur la classe de chaque glyphe (`wait`, `fall`, `rise`, `set`). */
const phases = (spans: Element[]) => spans.map((g) => (/wait/.test(g.className) ? 'wait' : /set/.test(g.className) ? 'set' : 'turn'));
const promptGlyphs = () => [...host!.querySelectorAll('[class*="prompt"] > span')];
const nameGlyphs = () => [...host!.querySelectorAll('[title] > [aria-hidden] > span')];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  delete (window as unknown as { canto?: unknown }).canto;
});

describe('geste du siège : glyphes déterministes', () => {
  it('domino : les glyphes partent un à un, du premier au dernier, à intervalle régulier', () => {
    const delays = glyphDelays(13, SEAT_DOMINO);
    expect(delays).toEqual(delays.map((_, i) => i * SEAT_DOMINO.stagger));
    expect(glyphsDuration(13, SEAT_DOMINO)).toBe(12 * SEAT_DOMINO.stagger + SEAT_DOMINO.spin);
  });

  it('émergence : du dernier glyphe (côté barres) au premier, plus lente et irrégulière, toujours la même', () => {
    const delays = glyphDelays(5, SEAT_EMERGE);
    expect(delays[4]).toBe(0);
    for (let i = 0; i < 4; i++) expect(delays[i]!).toBeGreaterThan(delays[i + 1]!);
    const gaps = delays.slice(0, 4).map((d, i) => d - delays[i + 1]!);
    expect(new Set(gaps).size).toBeGreaterThan(1);
    expect(glyphDelays(5, SEAT_EMERGE)).toEqual(delays);
    expect(SEAT_EMERGE.stagger).toBeGreaterThan(SEAT_DOMINO.stagger * 3);
    expect(SEAT_EMERGE.spin).toBeGreaterThan(SEAT_DOMINO.spin * 2);
    // Un nom de 24 caractères ne dépasse pas la durée prévue.
    expect(glyphsDuration(24, SEAT_EMERGE)).toBeLessThanOrEqual(SEAT_EMERGE.maxTotal);
  });

  it('chaque glyphe attend, tourne sur les lettres du Lab, puis se pose', () => {
    expect(glyphsAt('0xSrk', -1, SEAT_EMERGE).every((g) => g.phase === 'wait')).toBe(true);
    const mid = glyphsAt('0xSrk', 400, SEAT_EMERGE);
    expect(mid[4]!.phase).not.toBe('wait');
    expect(mid[0]!.phase).toBe('wait');
    for (const g of mid.filter((x) => x.phase === 'turn')) expect(SEAT_ALPHABET as readonly string[]).toContain(g.char);
    const end = glyphsAt('0xSrk', glyphsDuration(5, SEAT_EMERGE), SEAT_EMERGE);
    expect(end.every((g) => g.phase === 'set')).toBe(true);
    expect(end.map((g) => g.char).join('')).toBe('0xSrk');
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

  it('rien avant 2 s de survol : ni lettres, ni champ, même au clic', async () => {
    const { el } = await mountSeat({ status: async () => null, submit: vi.fn() });
    await hover();
    await advance(SEAT_DWELL_MS - 10);
    expect(el.querySelector('[data-bars]')).not.toBeNull();
    expect(promptGlyphs()).toHaveLength(0);
    await act(async () => void button().click());
    expect(field()).toBeNull();
    // Partir avant l'éveil remet le compte à zéro.
    await leave();
    await hover();
    await advance(SEAT_DWELL_MS - 10);
    expect(promptGlyphs()).toHaveLength(0);
  });

  it('après 2 s, les barres se défont en domino jusqu’à <insert code>, sans prendre le focus', async () => {
    const { el } = await mountSeat({ status: async () => null, submit: vi.fn() });
    await awaken();
    expect(button().className).toMatch(/armed/);
    await advance(4 * SEAT_DOMINO.stagger + 10);
    const early = phases(promptGlyphs());
    expect(early[0]).not.toBe('wait');
    expect(early.at(-1)).toBe('wait');
    // Le domino avance dans l'ordre : aucun glyphe parti après un glyphe encore en attente.
    expect(early.indexOf('wait')).toBeGreaterThan(0);
    expect(early.slice(early.indexOf('wait')).every((p) => p === 'wait')).toBe(true);
    await advance(PROMPT_MS);
    expect(phases(promptGlyphs()).every((p) => p === 'set')).toBe(true);
    expect(promptGlyphs().map((g) => g.textContent).join('')).toBe(SEAT_PROMPT);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await leave();
    expect(el.querySelector('[data-bars]')).not.toBeNull();
    expect(promptGlyphs()).toHaveLength(0);
  });

  it('au clavier, le focus tenu 2 s éveille aussi le geste', async () => {
    await mountSeat({ status: async () => null, submit: vi.fn() });
    await act(async () => button().focus());
    await advance(SEAT_DWELL_MS - 10);
    expect(promptGlyphs()).toHaveLength(0);
    await advance(10);
    expect(promptGlyphs().length).toBe([...SEAT_PROMPT].length);
  });

  it('mouvement réduit : après 2 s, le littéral paraît d’un coup ; le nom aussi', async () => {
    const submit = vi.fn(async () => ({ ok: true as const, client: '0xSrk' }));
    await mountSeat({ status: async () => null, submit }, true);
    await awaken();
    expect(phases(promptGlyphs()).every((p) => p === 'set')).toBe(true);
    await act(async () => void button().click());
    await act(async () => typeInto(field()!, LINE));
    await key(field()!, 'Enter');
    expect(phases(nameGlyphs()).every((p) => p === 'set')).toBe(true);
  });

  it('un code accepté affiche le nom signé avant les barres, jamais la ligne saisie', async () => {
    const submit = vi.fn(async () => ({ ok: true as const, client: '0xSrk' }));
    const { el } = await mountSeat({ status: async () => null, submit });
    await awaken();
    await act(async () => void button().click());
    const input = field()!;
    expect(input.getAttribute('aria-label')).toBe('Inscrire un siège');
    expect(document.activeElement).toBe(input);
    expect(el.textContent).toContain(SEAT_PROMPT);
    await act(async () => typeInto(input, LINE));
    await key(input, 'Enter');
    expect(submit).toHaveBeenCalledWith(LINE);
    // Les barres se reforment d'abord : le nom n'a pas encore paru.
    expect(phases(nameGlyphs()).every((p) => p === 'wait')).toBe(true);
    await advance(SEAT_REFORM_MS + 150);
    // Puis il sort des barres : le dernier glyphe d'abord, le premier encore caché.
    const rising = phases(nameGlyphs());
    expect(rising.at(-1)).not.toBe('wait');
    expect(rising[0]).toBe('wait');
    await advance(glyphsDuration(5, SEAT_EMERGE));
    expect(phases(nameGlyphs()).every((p) => p === 'set')).toBe(true);
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
    await awaken();
    await act(async () => void button().click());
    await act(async () => typeInto(field()!, 'Admin'));
    await key(field()!, 'Enter');
    await advance(SEAT_REFORM_MS);
    expect(el.querySelector('[title]')?.getAttribute('title')).toBe('Λ-Testeur');
    expect(el.textContent).not.toContain('Admin');
    expect(useUi.getState().toasts.map((t) => t.text)).toContain('Siège refusé');
    expect(el.querySelector('[data-bars]')).not.toBeNull();
  });

  it('Échap referme le champ et oublie le texte', async () => {
    const submit = vi.fn();
    const { el } = await mountSeat({ status: async () => null, submit });
    await awaken();
    await act(async () => void button().click());
    await act(async () => typeInto(field()!, 'SIEGE1.abc'));
    await key(field()!, 'Escape');
    expect(field()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await awaken();
    await act(async () => void button().click());
    expect(field()!.value).toBe('');
    expect(el.textContent).not.toContain('SIEGE1.abc');
  });
});

describe('garde du siège', () => {
  it('le pied enveloppe les barres, sans plaque ; couleurs du nom limitées au rouge du desk', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    // OROS2.11 : le losange strié de la planche précède le nom ; le pied n'enveloppe toujours que les barres.
    expect(shell).toMatch(/<SeatMark>\s*<BraceCode \/>\s*<\/SeatMark>\s*<span className=\{s\.stripName\}>\s*<Glyph name="lozenge" className=\{s\.lozenge\} \/>\s*\[ SIΞRRΛSKΛ \]\s*<\/span>/);
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
