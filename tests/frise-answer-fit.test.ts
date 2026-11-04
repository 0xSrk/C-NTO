/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/cssRules';

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { FriseAnswer } from '@/app/FriseAnswer';

/**
 * OROS5.47e — sous Electron, à 1600 × 1000 en espagnol, la réponse du temps coupait sa forme longue en ellipse
 * (« 9 h 15 · 10:30 Inventarios de petróleo E… », « Pérdida del día alcanzada · latente incl… ») : les seuils de la barre
 * d'état ne lisent que la largeur, pas la langue. Quand la forme longue déborde, la réponse prend sa forme courte, et
 * reprend la longue quand la place revient.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let room = 300;
let wanted = 420;
let root: Root | null = null;
let host: HTMLElement | null = null;
const observers: ResizeObserverCallback[] = [];
/** Ce que chaque observateur vivant observe (OROS5.47m) : un observateur déconnecté n'observe plus rien. */
const watched = new Map<ResizeObserverCallback, Set<Element>>();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).dataset.status === 'answer' ? room : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (el.dataset.status !== 'answer') return 0;
      return el.dataset.fit === 'short' ? Math.min(room, 180) : wanted;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push(cb);
        watched.set(cb, new Set());
      }
      observe(target: Element) {
        watched.get(this.cb)?.add(target);
      }
      disconnect() {
        watched.delete(this.cb);
      }
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  observers.length = 0;
  watched.clear();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
});

const answer = () => host!.querySelector<HTMLElement>('[data-status="answer"]')!;
const resize = () => act(() => observers.forEach((cb) => cb([], {} as ResizeObserver)));
/** Seuls les observateurs vivants de `target` sont appelés : la boîte de `target` a changé, et elle seule (OROS5.47m). */
const resizeOf = (target: Element) => act(() => [...watched].filter(([, targets]) => targets.has(target)).forEach(([cb]) => cb([], {} as ResizeObserver)));

describe('OROS5.47e · la réponse du temps ne se coupe jamais', () => {
  it('trop longue pour sa place, elle prend sa forme courte ; la place revenue, la longue', () => {
    room = 300;
    wanted = 420;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(FriseAnswer)));
    expect(answer().dataset.fit).toBe('short');
    // La place grandit, sans suffire : la forme courte reste.
    room = 400;
    resize();
    expect(answer().dataset.fit).toBe('short');
    // Elle suffit : la forme longue revient.
    room = 430;
    resize();
    expect(answer().dataset.fit).toBeUndefined();
  });

  it('OROS5.47j la forme courte, plus étroite que la longue, revient à la longue quand la ligne rend la place', () => {
    // Un rendu réel : la réponse est un élément flexible sans croissance (`flex: 0 1 auto`) ; sa boîte suit sa forme, et la
    // forme courte reste plus étroite que la longue, quelle que soit la place que la ligne lui laisse.
    room = 300;
    wanted = 420;
    const SHORT = 180;
    const width = (el: HTMLElement) => Math.min(room, el.dataset.fit === 'short' ? SHORT : wanted);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { const el = this as HTMLElement; return el.dataset.status === 'answer' ? width(el) : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { const el = this as HTMLElement; return el.dataset.status !== 'answer' ? 0 : el.dataset.fit === 'short' ? SHORT : wanted; } });
    const rect = (right: number) => ({ left: 0, right, top: 0, bottom: 28, width: right, height: 28, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.status === 'answer' ? rect(width(this)) : this === host ? rect(room) : rect(0);
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(FriseAnswer)));
    expect(answer().dataset.fit).toBe('short');
    expect(answer().clientWidth).toBe(SHORT);
    // La ligne rend de la place, sans suffire : la forme courte reste. Seule la boîte de la ligne change : seuls ses
    // observateurs sont appelés, comme dans un rendu réel (OROS5.47m).
    expect(answer().parentElement).toBe(host);
    room = 400;
    resizeOf(host);
    expect(answer().dataset.fit).toBe('short');
    // Elle suffit : la forme longue revient, bien que la boîte de la forme courte n'ait pas grandi.
    room = 430;
    resizeOf(host);
    expect(answer().dataset.fit).toBeUndefined();
    spy.mockRestore();
  });

  it('assez de place : la forme longue, sans attribut ; la feuille échange les deux formes sur data-fit', () => {
    room = 500;
    wanted = 420;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(FriseAnswer)));
    expect(answer().dataset.fit).toBeUndefined();
    const rules = cssRules(readFileSync('src/app/shell.module.css', 'utf8'));
    expect(rules.find((r) => r.selector === ".answer[data-fit='short'] .answerLong")?.body).toMatch(/display: none/);
    expect(rules.find((r) => r.selector === ".answer[data-fit='short'] .answerShort")?.body).toMatch(/display: inline/);
  });
});
