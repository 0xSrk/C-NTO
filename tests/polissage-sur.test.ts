/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, StrictMode, useState } from 'react';
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
import { ShortcutHelp, useShortcutHelp } from '@/app/ShortcutHelp';
import { Modal } from '@/design/Modal';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import { spaced } from '@/lib/frise';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
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
  // POL2.2a : la sortie part de l'opacité où la surcouche en est (1 par défaut).
  expect(frames.map((rule) => `${rule.selector} { ${rule.body.trim()} }`), path).toEqual(['from { opacity: var(--leave-from, 1); }', 'to { opacity: 0; }']);
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
  useShortcutHelp.setState({ open: false });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  useUi.setState({ timeCursor: null, friseOpen: false, toasts: [] });
  useRegistre.setState({ open: false, kinds: [], origin: null });
  useShortcutHelp.setState({ open: false });
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
  it('POL2.2a une surcouche fermée en chemin part de l’opacité où elle en est ; rouverte pendant sa sortie, elle y reprend : ni éclair ni chute', async () => {
    const animations = stubAnimations();
    const real = window.getComputedStyle.bind(window);
    let opacity = '0.38';
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      return el.matches?.('[data-registre]') ? ({ opacity } as unknown as CSSStyleDeclaration) : style;
    });
    try {
      mount();
      const registre = () => [...host!.querySelectorAll<HTMLElement>('[data-registre]')];
      act(() => void openRegistre(null));
      // Fermé pendant son entrée, à 0,38 : la sortie part de 0,38, sur ce qui reste de chemin, jamais de 1.
      act(() => closeRegistre(false));
      expect(registre()).toHaveLength(1);
      expect(registre()[0]!.style.getPropertyValue('--leave-from')).toBe('0.38');
      // Rouvert pendant sa sortie, à 0,62 : l'entrée reprend à 0,62, jamais de 0.
      opacity = '0.62';
      act(() => void openRegistre(null));
      expect(registre()).toHaveLength(1);
      expect(registre()[0]!.style.getPropertyValue('--enter-from')).toBe('0.62');
      expect(registre()[0]!.style.getPropertyValue('--leave-from')).toBe('');
      act(() => closeRegistre(false));
      animations.finish();
      await settle();
      expect(registre()).toHaveLength(0);
      // Une ouverture et une fermeture franches ne posent rien : l'entrée part de 0, la sortie de 1, comme avant.
      opacity = '1';
      act(() => void openRegistre(null));
      expect(registre()[0]!.style.getPropertyValue('--enter-from')).toBe('');
      act(() => closeRegistre(false));
      expect(registre()[0]!.style.getPropertyValue('--leave-from')).toBe('');
    } finally {
      spy.mockRestore();
      animations.restore();
    }
    // Les feuilles : chaque entrée part de var(--enter-from, 0) sur la part de chemin qui reste, chaque sortie de
    // var(--leave-from, 1) de même ; les arrivées (1 et 0) ne changent pas, le repos non plus.
    for (const [path, enter, leave] of [
      ['src/app/frise.module.css', '.drawer', '.drawer[data-leaving]'],
      ['src/app/registre.module.css', '.drawer', '.drawer[data-leaving]'],
      ['src/app/objects/omnibar.module.css', '.veil', '.veil[data-leaving]'],
      ['src/design/modal.module.css', '.backdrop', '.backdrop[data-leaving]'],
    ] as const) {
      const rules = sheet(path);
      const frames = (selector: string) => {
        const name = /animation: ([\w-]+) var\(--t-med\) linear both/.exec(bodyOf(path, selector))?.[1];
        return rules.filter((rule) => rule.at.includes(`@keyframes ${name}`)).map((rule) => `${rule.selector} { ${rule.body.trim()} }`);
      };
      expect(frames(enter), path).toEqual(['from { opacity: var(--enter-from, 0); }', 'to { opacity: 1; }']);
      expect(bodyOf(path, enter), path).toMatch(/animation-duration: calc\(var\(--t-med\) \* \(1 - var\(--enter-from, 0\)\)\);/);
      expect(frames(leave), path).toEqual(['from { opacity: var(--leave-from, 1); }', 'to { opacity: 0; }']);
      expect(bodyOf(path, leave), path).toMatch(/animation-duration: calc\(var\(--t-med\) \* var\(--leave-from, 1\)\);/);
    }
  });
  it('POL2.3 la fenêtre entre par l’opacité, son voile avec elle, et sort de même : sa dernière image, inerte et muette, s’efface ; la répétition de StrictMode n’en laisse aucune', async () => {
    const animations = stubAnimations();
    try {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root!.render(createElement(StrictMode, null, createElement(ShortcutHelp))));
      const opener = document.getElementById('ligne') ?? host.appendChild(Object.assign(document.createElement('button'), { id: 'ligne' }));
      opener.focus();
      await act(async () => useShortcutHelp.setState({ open: true }));
      // Ouverte, rien d'autre qu'elle : les effets rejoués par StrictMode ne laissent aucune image.
      expect(document.querySelectorAll('[data-help]')).toHaveLength(1);
      expect(document.querySelector('[data-leaving]')).toBeNull();
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
      // Fermée : le focus revient à l'opener, le châssis n'y voit plus de dialogue ; sa dernière image s'efface.
      await act(async () => useShortcutHelp.setState({ open: false }));
      expect(document.activeElement).toBe(opener);
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
      const ghost = document.querySelector<HTMLElement>('[data-leaving]')!;
      expect(ghost).not.toBeNull();
      expect(ghost.parentElement).toBe(document.body);
      expect(ghost.querySelector('[data-help]')).not.toBeNull();
      expect(ghost.hasAttribute('inert')).toBe(true);
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.querySelector('[role="dialog"], [aria-modal], [id]')).toBeNull();
      animations.finish();
      await settle();
      expect(document.querySelector('[data-leaving]')).toBeNull();
      expect(document.querySelector('[data-help]')).toBeNull();
      // Une liste déroulante garde son choix, un champ ne garde ni son nom ni son identifiant dans l'image.
      let close!: () => void;
      function Pick() {
        const [shown, setShown] = useState(true);
        close = () => setShown(false);
        return shown
          ? createElement(Modal, {
              title: 'Choix',
              onClose: () => setShown(false),
              children: createElement('select', { value: 'b', onChange: () => undefined, name: 'choix', id: 'choix' }, createElement('option', { value: 'a' }, 'A'), createElement('option', { value: 'b' }, 'B')),
            })
          : null;
      }
      await act(async () => root!.render(createElement(Pick)));
      await act(async () => close());
      const image = document.querySelector<HTMLElement>('[data-leaving]')!;
      expect(image.querySelector('select')!.selectedIndex).toBe(1);
      expect(image.querySelector('[name], [id]')).toBeNull();
      animations.finish();
      await settle();
      expect(document.querySelector('[data-leaving]')).toBeNull();
    } finally {
      animations.restore();
    }
    const css = 'src/design/modal.module.css';
    const backdrop = bodyOf(css, '.backdrop');
    const name = /animation: ([\w-]+) var\(--t-med\) linear both/.exec(backdrop)?.[1];
    expect(name).toBeDefined();
    // POL2.2a : l'entrée part de l'opacité où la fenêtre en est (0 par défaut).
    expect(sheet(css).filter((rule) => rule.at.includes(`@keyframes ${name}`)).map((rule) => `${rule.selector} { ${rule.body.trim()} }`)).toEqual(['from { opacity: var(--enter-from, 0); }', 'to { opacity: 1; }']);
    // Rien sur la plaque : ni glissement, ni ombre ; la couleur du voile ne change pas.
    expect(bodyOf(css, '.modal')).not.toMatch(/animation|transform/);
    expect(backdrop).toMatch(/background: rgba\(0, 0, 0, 0\.72\)/);
    expectLeave(css, '.backdrop[data-leaving]');
    expect(sheet(css).some((rule) => rule.selector.split(',').map((part) => part.trim()).includes('.backdrop') && rule.at.some((head) => /prefers-reduced-motion: reduce/.test(head)) && /animation: none/.test(rule.body))).toBe(true);
  });
  it('POL2.3a la dernière image d’une fenêtre est bien la dernière : elle part de l’opacité où la fenêtre en est, et garde la lumière du bouton survolé ou au focus', async () => {
    const animations = stubAnimations();
    const { leaveInPlace } = await import('@/design/leaveInPlace');
    const real = window.getComputedStyle.bind(window);
    const lit = { color: 'rgb(245, 242, 234)', backgroundColor: 'rgba(245, 242, 234, 0.03)', borderTopColor: 'rgba(245, 242, 234, 0.4)', borderRightColor: 'rgba(245, 242, 234, 0.4)', borderBottomColor: 'rgba(245, 242, 234, 0.4)', borderLeftColor: 'rgba(245, 242, 234, 0.4)', boxShadow: '0 0 18px -6px rgba(245, 242, 234, 0.42)', textShadow: 'none', outlineColor: 'rgb(204, 176, 102)', outlineStyle: 'solid', outlineWidth: '1px', outlineOffset: '2px' };
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      if ((el as HTMLElement).dataset?.root !== undefined) return { opacity: '0.4' } as unknown as CSSStyleDeclaration;
      if ((el as HTMLElement).dataset?.close !== undefined) return lit as unknown as CSSStyleDeclaration;
      return real(el, pseudo);
    });
    try {
      const parent = document.createElement('div');
      document.body.append(parent);
      const node = document.createElement('div');
      node.dataset.root = '';
      const close = document.createElement('button');
      close.dataset.close = '';
      const other = document.createElement('button');
      node.append(close, other);
      parent.append(node);
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        if (selector === ':hover' || selector === ':focus-visible') return this === close;
        return matches.call(this, selector);
      });
      leaveInPlace(node);
      node.remove();
      await act(async () => void (await Promise.resolve()));
      const ghost = parent.querySelector<HTMLElement>('[data-leaving]')!;
      expect(ghost).not.toBeNull();
      // Fermée pendant son entrée, à 0,4 : sa dernière image part de 0,4, jamais de 1.
      expect(ghost.style.getPropertyValue('--leave-from')).toBe('0.4');
      // Le bouton survolé garde sa lumière dans l'image ; le voisin, éteint, n'en reçoit aucune.
      const [ghostClose, ghostOther] = [...ghost.querySelectorAll<HTMLElement>('button')];
      expect(ghostClose!.style.color).toBe(lit.color);
      expect(ghostClose!.style.boxShadow).toBe(lit.boxShadow);
      expect(ghostClose!.style.borderTopColor).toBe(lit.borderTopColor);
      expect(ghostClose!.style.outlineColor).toBe(lit.outlineColor);
      expect(ghostOther!.getAttribute('style')).toBeNull();
      parent.remove();
    } finally {
      vi.restoreAllMocks();
      spy.mockRestore();
      animations.restore();
    }
  });
  it('POL2.4 un message entre par l’opacité, rien ne bouge ; sa colonne garde ses places, sans transition qui courrait sous l’entrée d’un tiroir', () => {
    const css = 'src/app/shell.module.css';
    const toast = bodyOf(css, '.toast');
    const name = /animation: ([\w-]+) var\(--t-med\) linear backwards/.exec(toast)?.[1];
    expect(name).toBeDefined();
    expect(sheet(css).filter((rule) => rule.at.includes(`@keyframes ${name}`)).map((rule) => `${rule.selector} { ${rule.body.trim()} }`)).toEqual(['from { opacity: 0; }', 'to { opacity: 1; }']);
    expect(sheet(css).some((rule) => rule.selector === '.toast' && rule.at.some((head) => /prefers-reduced-motion: reduce/.test(head)) && /animation: none/.test(rule.body))).toBe(true);
    // Au banc, la colonne qui glissait pendant l'entrée du tiroir le laissait translucide une fois entré : elle ne glisse pas.
    const column = bodyOf(css, '.toasts');
    expect(column).not.toMatch(/transition/);
    // Les places de la colonne ne changent pas : 16 px, puis 64 + 16, puis 240 + 16 ; le filet du message d'erreur non plus.
    expect(column).toMatch(/bottom: 16px;/);
    expect(bodyOf(css, '.main[data-frise-open] .toasts')).toMatch(/^\s*bottom: 80px;\s*$/);
    expect(bodyOf(css, '.main[data-registre-open] .toasts')).toMatch(/^\s*bottom: 256px;\s*$/);
    expect(bodyOf(css, '.toast.error')).toMatch(/^\s*border-left: 2px solid var\(--signal\);\s*$/);
    // Rendu : le message paraît dans sa colonne, rien d'autre ne change.
    mount();
    act(() => useUi.getState().toast('Essai', 'ok'));
    const status = host!.querySelector<HTMLElement>('main [role="status"]')!;
    expect(status.children).toHaveLength(1);
    expect(status.textContent).toBe('Essai');
  });
  it('POL2.4a la colonne des messages ne redescend qu’une fois le tiroir parti : elle reste au-dessus de la frise ou du registre qui s’efface, sauf si l’autre tiroir s’ouvre', () => {
    const css = 'src/app/shell.module.css';
    const rules = sheet(css).filter((rule) => rule.at.length === 0 && /\.toasts\s*$/.test(rule.selector.split(',').at(-1)!.trim()));
    const bottomOf = (selector: string) => rules.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector))?.body.match(/bottom: (\d+px)/)?.[1];
    // Ouverts, comme avant ; en sortie, la colonne garde sa place, tant que l'autre tiroir ne s'ouvre pas à la place.
    expect(bottomOf('.main[data-frise-open] .toasts')).toBe('80px');
    expect(bottomOf('.main[data-registre-open] .toasts')).toBe('256px');
    expect(bottomOf('.main:not([data-registre-open]):has(~ .status [data-frise][data-leaving]) .toasts')).toBe('80px');
    expect(bottomOf('.main:not([data-frise-open]):has(~ .status [data-registre][data-leaving]) .toasts')).toBe('256px');
  });
  it('POL2.5 la lumière du survol et du choix monte avec douceur au registre et à l’omnibar : chaque propriété allumée a sa transition, aux durées de la maison', () => {
    const transitions = (path: string, selector: string) =>
      Object.fromEntries(
        (/(?:^|;)\s*transition:\s*([^;]+)/.exec(bodyOf(path, selector))?.[1] ?? '')
          .split(',')
          .map((part) => part.trim().split(/\s+/))
          .map(([prop, ...rest]) => [prop, rest.join(' ')]),
      );
    const registre = 'src/app/registre.module.css';
    const omnibarCss = 'src/app/objects/omnibar.module.css';
    // Le filet d'un bouton du tiroir, comme `.btn` : l'encre en 200 ms linéaire, le contour en 260 ms --ease-out.
    for (const selector of ['.kind', '.close']) expect(transitions(registre, selector), selector).toEqual({ color: '200ms linear', 'border-color': '260ms var(--ease-out)' });
    // Une ligne de liste, au pas de l'omnibar : le fond, le filet d'ivoire et l'encre de la ligne choisie, en 160 ms.
    expect(transitions(registre, '.row')).toEqual({ color: '160ms linear', 'background-color': '160ms linear', 'box-shadow': '160ms linear' });
    expect(transitions(omnibarCss, '.item')).toEqual({ 'background-color': '160ms linear', 'box-shadow': '160ms linear' });
    expect(transitions(omnibarCss, '.item b')).toEqual({ color: '160ms linear' });
    // Ce que le survol et le choix allument : rien d'autre, et rien de neuf.
    expect(bodyOf(registre, '.rowOn')).toMatch(/color: var\(--text-0\);\s*box-shadow: inset var\(--active-line\) 0 0 var\(--text-0\);\s*background-color: var\(--bg-2\);/);
    expect(bodyOf(omnibarCss, '.item.active')).toMatch(/background-color: var\(--bg-3\);\s*box-shadow: inset var\(--active-line\) 0 0 var\(--text-0\);/);
  });
  it('POL2.6 le curseur passe sur les heures de la frise sans les faire clignoter : celles que la tête recouvre restent montées et s’effacent à l’opacité ; l’axe lisible ne change pas', () => {
    vi.setSystemTime(zonedToUtc('2026-10-14', '09:40', ET_ZONE));
    mount();
    act(() => host!.querySelector<HTMLButtonElement>('[data-status="answer"]')!.click());
    const drawer = host!.querySelector<HTMLElement>('[data-frise]')!;
    const slider = drawer.querySelector<HTMLElement>('[role="slider"]')!;
    const hours = () => [...drawer.querySelectorAll<HTMLElement>('[data-axis-hour]')];
    const hour = (h: string) => hours().find((el) => el.textContent === h);
    // L'axe lisible est celui d'avant : les heures à 30 px au moins de la tête, puis espacées (`spaced`).
    const readable = () => {
      const head = parseFloat(drawer.querySelector<HTMLElement>('[class*="head"]:not([data-axis-hour])')!.style.left);
      const left = (el: HTMLElement) => parseFloat(el.style.left);
      const kept = spaced(hours().map((el) => ({ el, hour: Number(el.textContent) })).filter(({ el }) => Math.abs(left(el) - head) >= 30), ({ el }) => left(el));
      return kept.map(({ el }) => el.textContent);
    };
    const shown = () => hours().filter((el) => !el.hasAttribute('data-off')).map((el) => el.textContent);
    // 09:40 : « 10 », à 21 px de la tête, s'efface sous elle.
    const ten = hour('10');
    expect(ten).toBeDefined();
    expect(ten!.hasAttribute('data-off')).toBe(true);
    expect(shown()).toEqual(readable());
    // 10:40 : « 10 » revient, le même nœud, jamais démonté ; « 11 » passe sous la tête.
    press('ArrowRight', { shiftKey: true }, slider);
    expect(hour('10')).toBe(ten);
    expect(ten!.hasAttribute('data-off')).toBe(false);
    expect(hour('11')!.hasAttribute('data-off')).toBe(true);
    expect(shown()).toEqual(readable());
    const css = 'src/app/frise.module.css';
    expect(bodyOf(css, '.hour')).toMatch(/transition: opacity var\(--t-fast\) linear;/);
    expect(bodyOf(css, '.hour[data-off]')).toMatch(/^\s*opacity: 0;\s*$/);
  });
});
