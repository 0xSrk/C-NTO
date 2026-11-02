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

import { Shell } from '@/app/Shell';
import { GLYPH_ID } from '@/design/Micro';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';

/**
 * OROS5.17 — l'omnibar s'ouvre sur Ctrl+J, jamais sur Ctrl+K (voisin du kill switch Ctrl+Maj+K) : une superposition de
 * 500 px à 20 vh, le champ marqué de la cible (C.085), les résultats de l'index ; le pied ne dit que les touches. Sous le
 * verrou, rien ne répond. Elle ne fait que naviguer.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');

const session = (id: string, date: string, pnl: number): Session => ({
  id,
  date,
  account: 'Apex-PA-50K',
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

/** Une touche, au clavier : sur l'élément qui a le focus, comme le navigateur la livre. */
function press(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  act(() => void (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}
const ctrl = (key: string, opts: KeyboardEventInit = {}) => press(key, { ctrlKey: true, ...opts });
const omnibar = () => document.querySelector<HTMLElement>('[data-omnibar]');
const input = () => omnibar()!.querySelector<HTMLInputElement>('input')!;

function type(text: string) {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique' });
  useJournal.setState({ sessions: [session('s-14', '2026-10-14', -247.62), session('s-20', '2026-10-20', 410)], trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.17 l’omnibar sur Ctrl+J', () => {
  it('Ctrl+J ouvre : 500 px à 20 vh, le champ marqué C.085 prend le focus ; Échap ferme et rend le focus', () => {
    mount();
    const line = document.getElementById('ligne')!;
    line.focus();
    const event = ctrl('j');
    expect(event.defaultPrevented).toBe(true);
    const panel = omnibar()!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector(`svg.skg-${GLYPH_ID.target}`)).not.toBeNull();
    expect(document.activeElement).toBe(input());
    const css = cssRules(readFileSync('src/app/objects/omnibar.module.css', 'utf8'));
    const panelCss = css.find((rule) => rule.selector === '.panel')!.body;
    expect(panelCss).toMatch(/top: 20vh/);
    expect(panelCss).toMatch(/width: 500px/);
    expect(readFileSync('src/design/tokens.css', 'utf8')).not.toMatch(/--omnibar|500px/);
    // sans rien de tapé, les modules
    expect([...panel.querySelectorAll('[data-omni-group]')].map((g) => g.getAttribute('data-omni-group'))).toEqual(['module']);
    // le pied ne dit que les touches
    expect(panel.querySelector('[class*="foot"]')!.textContent).toBe('↑ ↓ choisir↵ ouvrirÉchap fermer');
    press('Escape');
    expect(omnibar()).toBeNull();
    expect(document.activeElement).toBe(line);
    // Ctrl+J une seconde fois ferme aussi
    ctrl('j');
    expect(omnibar()).not.toBeNull();
    ctrl('j');
    expect(omnibar()).toBeNull();
    expect(document.activeElement).toBe(line);
  });

  it('Ctrl+K ne fait rien, ni Ctrl+Maj+K : le kill switch appartient au process principal', () => {
    mount();
    const k = ctrl('k');
    expect(k.defaultPrevented).toBe(false);
    expect(omnibar()).toBeNull();
    const kill = ctrl('K', { shiftKey: true });
    expect(kill.defaultPrevented).toBe(false);
    expect(omnibar()).toBeNull();
    // Ctrl+Maj+J n'est pas Ctrl+J
    expect(ctrl('J', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(omnibar()).toBeNull();
  });

  it('sous le verrou, rien ne répond', () => {
    mount(true);
    expect(useObjects.getState().locked).toBe(true);
    const event = ctrl('j');
    expect(event.defaultPrevented).toBe(false);
    expect(omnibar()).toBeNull();
    expect(useObjects.getState().setOmnibar(true)).toBe(false);
    expect(omnibar()).toBeNull();
  });

  it('un dialogue ouvert garde la main ; un champ, non : Ctrl+J s’ouvre d’un champ', () => {
    mount();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    ctrl('j');
    expect(omnibar()).toBeNull();
    dialog.remove();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    ctrl('j');
    expect(omnibar()).not.toBeNull();
    press('Escape');
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('navigation seule : une séance ouvre sa fiche par un saut, un module s’ouvre ; ↑ ↓ choisissent', () => {
    const el = mount();
    const line = document.getElementById('ligne')!;
    line.focus();
    ctrl('j');
    type('14.10');
    const options = () => [...omnibar()!.querySelectorAll<HTMLElement>('[role="option"]')];
    // la séance du jour, puis le catalyseur du même jour (la source unique : le repère local du CPI, hors ligne)
    expect(options().map((o) => o.dataset.key)).toEqual(['session:s-14', 'evenement:ev_cpi_2026-10-14']);
    expect(options()[1]!.textContent).toContain('≈ Inflation CPI');
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    // l'année de l'objet se tait quand c'est l'année en cours ; le trait d'état ouvre la ligne
    expect(options()[0]!.textContent).toContain('14.10 · Apex-PA-50K');
    expect(options()[0]!.querySelector('[data-etat="plein"]')).not.toBeNull();
    press('Enter');
    expect(omnibar()).toBeNull();
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's-14' });
    expect(useObjects.getState().history).toHaveLength(1);
    // la fiche prend le focus ; Échap le rend à la ligne d'où l'omnibar s'est ouverte
    const drawer = el.querySelector<HTMLElement>('aside[data-drawer]')!;
    expect(document.activeElement).toBe(drawer);
    press('Escape');
    expect(document.activeElement).toBe(line);
    // un module
    ctrl('j');
    type('calen');
    expect(options().map((o) => o.dataset.key)).toEqual(['module:calendrier']);
    press('Enter');
    expect(useUi.getState().tab).toBe('calendrier');
    expect(omnibar()).toBeNull();
    // ↑ ↓ passent d'une ligne à l'autre, en boucle
    ctrl('j');
    type('apex');
    expect(options().map((o) => o.dataset.key)).toEqual(['session:s-20', 'session:s-14', 'compte:Apex-PA-50K']);
    press('ArrowDown');
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    press('ArrowUp');
    press('ArrowUp');
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true');
    press('Enter');
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: 'Apex-PA-50K' });
  });

  it('les objets d’un même jour se rangent dans l’ordre du temps', () => {
    const trade = (id: string, entry: string) => ({
      id,
      sessionId: 's-14',
      instrument: 'NQ',
      account: 'Apex-PA-50K',
      direction: 'long' as const,
      qty: 1,
      entryTime: Date.parse(entry),
      exitTime: Date.parse(entry) + 60_000,
      entryPrice: 1,
      exitPrice: 1,
      pnl: 0,
      commission: 0,
    });
    // l'ordre du coffre n'est pas celui du temps
    useJournal.setState({ trades: [trade('t-c', '2026-10-14T15:02:00Z'), trade('t-a', '2026-10-14T13:42:00Z'), trade('t-b', '2026-10-14T14:00:00Z')] });
    mount();
    ctrl('j');
    type('14.10 nq');
    const group = omnibar()!.querySelector('[data-omni-group="trade"]')!;
    expect([...group.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.key)).toEqual(['trade:t-a', 'trade:t-b', 'trade:t-c']);
  });

  it('les sources de l’omnibar ne font que naviguer : aucune méthode d’écriture d’un store, ni window.desk', () => {
    const src = readFileSync('src/app/objects/Omnibar.tsx', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bdesk\b|window\.canto|\bdb\b|localStorage|indexedDB|setState\(|getState\(/);
    // ce que l'omnibar lit des stores : l'état de l'omnibar et la langue ; ce qu'il appelle : naviguer
    const picked = [...code.matchAll(/\buse[A-Z]\w*\(\((\w+)\) => \1\.(\w+)\)/g)].map((m) => m[2]);
    expect([...new Set(picked)].sort()).toEqual(['locale', 'omnibar', 'openObject', 'setOmnibar', 'setTab']);
    // aucune autre méthode d'un store n'y est nommée
    expect(code).not.toMatch(/\.(add|update|remove|put|delete|bulk\w*|promote|reject|propose|enable|disable|load|sync|create|toggle\w*|set(?!Omnibar|Tab|Query|Active)\w+)\(/);
  });
});
