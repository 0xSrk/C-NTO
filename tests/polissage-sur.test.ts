/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { useKillLatch } from '@/app/killState';
import { closeRegistre, openRegistre, useRegistre } from '@/app/registre';
import { Shell } from '@/app/Shell';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import { useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * POL2 — le polissage des surcouches (frise, registre, omnibar, fenêtres, messages) : on polit la dynamique, comment on
 * arrive au repos et comment on en part ; le repos ne change pas.
 */

const session = (id: string, date: string, pnl: number, account = 'Apex-PA-50K'): Session => ({
  id,
  date,
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 1,
  pnl,
  grossProfit: Math.max(0, pnl),
  grossLoss: Math.min(0, pnl),
  commission: 4,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(inert = false): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Shell, { inert, children: createElement('div', null, createElement('button', { id: 'ligne' }, 'ligne')) })));
  return host;
}

/** Une touche, au clavier : sur l'élément qui a le focus (ou la cible donnée), comme le navigateur la livre. */
function press(key: string, opts: KeyboardEventInit = {}, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  act(() => void (target ?? document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}
const ctrl = (key: string, opts: KeyboardEventInit = {}) => press(key, { ctrlKey: true, ...opts });
const omnibar = () => document.querySelector<HTMLElement>('[data-omnibar]');
const input = () => omnibar()!.querySelector<HTMLInputElement>('input')!;
const options = () => [...omnibar()!.querySelectorAll<HTMLElement>('[role="option"]')];

function type(text: string) {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}


/** Une animation en cours, que le test termine à la main : jsdom n'a pas `getAnimations`, le banc mesure le reste. */
function stubAnimations(): { finish: () => void; restore: () => void } {
  let finish!: () => void;
  let finished = new Promise<void>((resolve) => (finish = resolve));
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: () => [{ playState: 'running', finished }] });
  return {
    finish: () => {
      finish();
      finished = new Promise<void>((resolve) => (finish = resolve));
    },
    restore: () => void delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations,
  };
}
/** L'animation finie, ce qui attend sa fin se joue. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
/** Les règles d'une feuille, et la règle hors de tout bloc @ d'un sélecteur. */
const sheet = (path: string) => cssRules(readFileSync(path, 'utf8'));
const bodyOf = (path: string, selector: string) => sheet(path).find((rule) => rule.selector === selector && rule.at.length === 0)?.body ?? '';
/** Une sortie de la maison : l'opacité de 1 à 0, en --t-med, linéaire ; sans pointeur ; mouvement réduit, aucune. */
function expectLeave(path: string, selector: string) {
  const rules = sheet(path);
  const body = bodyOf(path, selector);
  const name = /animation: ([\w-]+) var\(--t-med\) linear both/.exec(body)?.[1];
  expect(name, `${path} ${selector}`).toBeDefined();
  expect(body, `${path} ${selector}`).toMatch(/pointer-events: none/);
  const frames = rules.filter((rule) => rule.at.includes(`@keyframes ${name}`));
  expect(frames.map((rule) => `${rule.selector} { ${rule.body.trim()} }`), path).toEqual(['from { opacity: 1; }', 'to { opacity: 0; }']);
  expect(rules.some((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector) && rule.at.some((head) => /prefers-reduced-motion: reduce/.test(head)) && /animation: none/.test(rule.body)), `${path} ${selector}`).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse('2026-10-27T16:00:00Z'));
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique', timeCursor: null, friseOpen: false, toasts: [] });
  useRegistre.setState({ open: false, kinds: [], origin: null });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 15 } }, update: async () => undefined });
  useJournal.setState({ sessions: [], trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useCalendar.setState({ entries: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useBridge.setState({ nt: null });
  useKillLatch.setState({ engaged: false });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  useUi.setState({ timeCursor: null, friseOpen: false, toasts: [] });
  useRegistre.setState({ open: false, kinds: [], origin: null });
});

describe('POL2 · les surcouches : la frise, le registre, l’omnibar, les fenêtres et les messages', () => {
  it('POL2.1 omnibar : la ligne choisie au clavier revient en vue, celle qui ouvre un groupe ramène sa tête ; un objet rangé pendant le choix ne fait pas défiler la liste', () => {
    useJournal.setState({ sessions: [session('s-14', '2026-10-14', -247.62), session('s-20', '2026-10-20', 410)], trades: [] });
    const seen: Element[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element) {
        seen.push(this);
      },
    });
    try {
      mount();
      ctrl('j');
      type('apex'); // s-20, s-14 (Séances), puis le compte (Comptes)
      expect(options().map((o) => o.dataset.key)).toEqual(['session:s-20', 'session:s-14', 'compte:Apex-PA-50K']);
      seen.length = 0;
      press('ArrowDown');
      expect(seen.map((el) => el.id)).toContain('omni-1');
      // la ligne qui ouvre le groupe Comptes : sa tête revient avec elle
      press('ArrowDown');
      expect(seen.map((el) => el.id)).toContain('omni-2');
      expect(seen.at(-1)!.getAttribute('aria-hidden')).toBe('true');
      // un objet rangé pendant le choix (le pont vivant) ne ramène pas la liste sous la main
      seen.length = 0;
      act(() => useJournal.setState({ sessions: [...useJournal.getState().sessions, session('s-21', '2026-10-21', 5)] }));
      expect(options()).toHaveLength(4);
      expect(seen).toEqual([]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
  it('POL2.2 la frise, le registre et l’omnibar sortent comme ils sont entrés : montés, inertes, le temps de leur fondu ; rouverts, ils renaissent ; le châssis répond aussitôt', async () => {
    const animations = stubAnimations();
    try {
      mount();
      const answer = () => host!.querySelector<HTMLButtonElement>('[data-status="answer"]')!;
      const frise = () => [...host!.querySelectorAll<HTMLElement>('[data-frise]')];
      const registre = () => [...host!.querySelectorAll<HTMLElement>('[data-registre]')];
      // La frise : Échap, au présent, la replie et rend le focus à la réponse ; elle reste là, inerte, le temps de sa sortie.
      act(() => answer().click());
      press('Escape', {}, host!.querySelector<HTMLElement>('[role="slider"]')!);
      expect(answer().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(answer());
      expect(frise()).toHaveLength(1);
      expect(frise()[0]!.hasAttribute('data-leaving')).toBe(true);
      expect(frise()[0]!.hasAttribute('inert')).toBe(true);
      // F6 gagne la barre d'état sans s'arrêter au tiroir qui sort.
      document.getElementById('ligne')!.focus();
      press('F6');
      expect(document.activeElement!.closest('[data-chassis="status"]')).not.toBeNull();
      expect(document.activeElement!.closest('[inert]')).toBeNull();
      animations.finish();
      await settle();
      expect(frise()).toHaveLength(0);
      // Le registre : fermé, il sort ; rouvert pendant sa sortie, il renaît, entier et seul.
      act(() => void openRegistre(null));
      act(() => closeRegistre(false));
      expect(registre()).toHaveLength(1);
      expect(registre()[0]!.hasAttribute('data-leaving')).toBe(true);
      act(() => void openRegistre(null));
      expect(registre()).toHaveLength(1);
      expect(registre()[0]!.hasAttribute('data-leaving')).toBe(false);
      expect(registre()[0]!.hasAttribute('inert')).toBe(false);
      act(() => closeRegistre(false));
      animations.finish();
      await settle();
      expect(registre()).toHaveLength(0);
      // L'omnibar : en sortie, elle n'est plus un dialogue ; Ctrl+J la rouvre aussitôt, le focus au champ.
      const line = document.getElementById('ligne')!;
      line.focus();
      ctrl('j');
      press('Escape');
      expect(document.activeElement).toBe(line);
      expect(document.querySelector('[data-leaving] [data-omnibar]')).not.toBeNull();
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
      ctrl('j');
      expect(document.querySelectorAll('[data-omnibar]')).toHaveLength(1);
      expect(document.querySelector('[data-leaving]')).toBeNull();
      expect(document.activeElement).toBe(input());
    } finally {
      animations.restore();
    }
    expectLeave('src/app/frise.module.css', '.drawer[data-leaving]');
    expectLeave('src/app/registre.module.css', '.drawer[data-leaving]');
    expectLeave('src/app/objects/omnibar.module.css', '.veil[data-leaving]');
  });
});
