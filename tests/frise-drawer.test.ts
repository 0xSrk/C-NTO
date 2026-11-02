/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { useKillLatch } from '@/app/killState';
import { Shell } from '@/app/Shell';
import { matchShortcut, SHORTCUTS, type Chord, type ShortcutScope } from '@/app/shortcuts';
import e from '@/design/etat.module.css';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { cmeDay, daySpan, moveCursor, type CursorMove } from '@/lib/frise';
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
 * OROS5.24 — la frise se déplie en tiroir au-dessus de la barre d'état : quatre couloirs, l'axe à nuit comprimée, la ligne
 * « maintenant ». L'axe est un `role="slider"` qui lit le registre des raccourcis ; le curseur ne vit que dans Métrique et
 * le Calendrier ; rien ne répond sous le verrou ; Entrée ouvre la fiche de l'objet sous le curseur ; chaque marque tracée
 * prend son trait dans la table d'états.
 */

const et = (day: string, time: string) => zonedToUtc(day, time, ET_ZONE);
/** Mercredi 14 octobre 2026, 09:40 à New York : le CPI de 08:30 est passé, sa fenêtre ± 15 aussi. */
const DAY = '2026-10-14';
const NOW = et(DAY, '09:40');
const ETATS = ['plein', 'tirete', 'pointille', 'eteint'] as const;

const session = (id: string, date: string): Session => ({ id, date, account: 'Sim101', instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 1, pnl: 40, grossProfit: 40, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, entry: string, exit: string): Trade => ({ id, sessionId, instrument: 'MNQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: et(DAY, entry), exitTime: et(DAY, exit), entryPrice: 0, exitPrice: 0, pnl: 40, commission: 0 });

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(inert = false): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Shell, { inert, children: createElement('div', null, createElement('button', { id: 'ligne' }, 'ligne')) })));
  return host;
}
const answer = () => host!.querySelector<HTMLButtonElement>('[data-status="answer"]')!;
const drawer = () => host!.querySelector<HTMLElement>('[data-frise]');
const slider = () => host!.querySelector<HTMLElement>('[role="slider"]')!;
/** Une touche, livrée à l'axe ; rend vrai si un gestionnaire l'a prise. */
function press(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event.defaultPrevented;
}
const cursor = () => useUi.getState().timeCursor;
const open = () => act(() => answer().click());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique', timeCursor: null, friseOpen: false, toasts: [] });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 15 } }, update: async () => undefined });
  useJournal.setState({ sessions: [session('s14', DAY)], trades: [trade('t1', 's14', '10:00', '10:20')] });
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
  useUi.setState({ timeCursor: null, friseOpen: false });
});

describe('OROS5.24 · la frise déplie son tiroir et tient le curseur au clavier', () => {
  it('la réponse déplie le tiroir, l’axe prend le focus ; le curseur se tire au clavier ; Présent et Échap rendent le présent, puis Échap replie', () => {
    mount();
    expect(drawer()).toBeNull();
    expect(answer().getAttribute('aria-expanded')).toBe('false');
    open();
    expect(drawer()).not.toBeNull();
    expect(answer().getAttribute('aria-expanded')).toBe('true');
    expect(answer().getAttribute('aria-controls')).toBe(drawer()!.id);
    expect(document.activeElement).toBe(slider());
    // le tiroir est un enfant de la barre d'état, hors de la zone de travail ; 64 px, quatre couloirs
    expect(drawer()!.closest('[data-chassis="status"]')).not.toBeNull();
    expect([...drawer()!.querySelectorAll('[data-lane]')].map((el) => (el as HTMLElement).dataset.lane)).toEqual(['session', 'catalyst', 'window', 'desk']);
    expect(readFileSync('src/app/frise.module.css', 'utf8')).toMatch(/\.drawer \{[^}]*height: 64px;/);
    // l'axe : un curseur de temps sur la journée CME, au présent
    const span = daySpan(cmeDay(NOW));
    expect(slider().getAttribute('aria-valuemin')).toBe(String(span.start));
    expect(slider().getAttribute('aria-valuemax')).toBe(String(span.end));
    expect(slider().getAttribute('aria-valuenow')).toBe(String(NOW));
    // ← → 5 min, Maj 1 h, Pg préc. / suiv. une journée ouvrée, Début / Fin : les pas du modèle, lus au registre
    let at = NOW;
    const steps: [KeyboardEventInit, CursorMove][] = [
      [{ key: 'ArrowLeft' }, 'left'],
      [{ key: 'ArrowRight', shiftKey: true }, 'hourRight'],
      [{ key: 'PageUp' }, 'dayBack'],
      [{ key: 'PageDown' }, 'dayForward'],
      [{ key: 'Home' }, 'home'],
      [{ key: 'End' }, 'end'],
      [{ key: 'ArrowRight' }, 'right'],
    ];
    for (const [init, move] of steps) {
      expect(press(slider(), init), move).toBe(true);
      at = moveCursor(at, move);
      expect(cursor(), move).toBe(at);
      expect(slider().getAttribute('aria-valuenow'), move).toBe(String(Math.round(at)));
    }
    // tiré : la réponse dit l'instant tenu, à l'or ; maintenant passe au graphite, le curseur prend l'or
    act(() => useUi.getState().setTimeCursor(et(DAY, '08:35')));
    expect(answer().querySelector('[class*="answerAt"]')!.textContent).toMatch(/14\.10 08:35/);
    expect(answer().dataset.answer).toBe('window');
    expect(drawer()!.querySelector('[data-cursor]')).not.toBeNull();
    expect(slider().getAttribute('aria-valuetext')).toMatch(/^mer 14\.10 · 08:35 ET · Fenêtre ± 15 · Inflation CPI jusqu’à 08:45/);
    // le bouton Présent
    act(() => drawer()!.querySelector<HTMLButtonElement>('[data-present]')!.click());
    expect(cursor()).toBeNull();
    expect(drawer()!.querySelector('[data-present]')).toBeNull();
    // Échap rend le présent, le tiroir reste ; au présent, Échap replie et rend le focus à la réponse
    press(slider(), { key: 'ArrowLeft' });
    expect(cursor()).not.toBeNull();
    expect(press(slider(), { key: 'Escape' })).toBe(true);
    expect(cursor()).toBeNull();
    expect(drawer()).not.toBeNull();
    expect(press(slider(), { key: 'Escape' })).toBe(true);
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(answer());
  });

  it('un changement d’onglet rend le présent : le curseur ne vit que dans Métrique et le Calendrier', () => {
    mount();
    open();
    press(slider(), { key: 'ArrowLeft' });
    expect(cursor()).toBe(moveCursor(NOW, 'left'));
    act(() => useUi.getState().setTab('calendrier'));
    expect(cursor()).toBe(moveCursor(NOW, 'left'));
    act(() => useUi.getState().setTab('visual'));
    expect(cursor()).toBeNull();
    // ailleurs, l'axe se lit au présent : il ne se tire pas
    expect(slider().getAttribute('aria-readonly')).toBe('true');
    press(slider(), { key: 'ArrowLeft' });
    expect(cursor()).toBeNull();
    act(() => useUi.getState().setTimeCursor(et(DAY, '08:00')));
    expect(cursor()).toBeNull();
    act(() => useUi.getState().setTab('metrique'));
    expect(slider().hasAttribute('aria-readonly')).toBe(false);
  });

  it('rien ne répond sous le verrou : ni la réponse, ni l’axe, ni Entrée', () => {
    mount(true);
    open();
    expect(drawer()).toBeNull();
    expect(useUi.getState().friseOpen).toBe(false);
    // déplié avant le verrou : l'axe ne bouge plus et n'ouvre rien
    act(() => useUi.setState({ friseOpen: true }));
    for (const key of ['ArrowLeft', 'PageUp', 'End', 'Enter', 'Escape']) press(slider(), { key });
    expect(cursor()).toBeNull();
    expect(useObjects.getState().open).toBeNull();
    expect(drawer()).not.toBeNull();
    act(() => slider().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40 })));
    expect(cursor()).toBeNull();
  });

  it('Entrée ouvre la fiche de l’objet sous le curseur : un trade, une publication, la séance de la journée', () => {
    mount();
    open();
    const enter = (time: string) => {
      act(() => useUi.getState().setTimeCursor(et(DAY, time)));
      act(() => slider().focus());
      expect(press(slider(), { key: 'Enter' }), time).toBe(true);
      return useObjects.getState().open;
    };
    expect(enter('10:05')).toEqual({ type: 'trade', id: 't1' });
    expect(host!.querySelector('aside[data-drawer="trade"]')).not.toBeNull();
    // la fiche rend le focus à l'axe d'où elle a été ouverte
    expect(useObjects.getState().origin).toBe(slider());
    expect(enter('08:35')).toEqual({ type: 'evenement', id: 'ev_cpi_2026-10-14' });
    expect(enter('15:00')).toEqual({ type: 'session', id: 's14' });
  });

  it('chaque marque tracée prend son trait dans la table d’états : passé plein, prévu tireté, journée fermée éteinte', () => {
    mount();
    open();
    const marks = () => [...drawer()!.querySelectorAll<SVGElement>('[data-mark]')];
    const etatOf = (el: Element) => ETATS.filter((etat) => el.classList.contains(e[etat]!));
    expect(marks().length).toBeGreaterThan(0);
    for (const mark of marks()) expect(etatOf(mark), `${mark.dataset.mark} ${mark.getAttribute('class')}`).toHaveLength(1);
    const of = (kind: string) => marks().filter((m) => m.dataset.mark === kind);
    // la séance coupée à maintenant : ce qui a eu lieu, plein ; ce qui reste, tireté
    const phases = of('phase');
    expect(phases.some((m) => etatOf(m)[0] === 'plein')).toBe(true);
    expect(phases.some((m) => etatOf(m)[0] === 'tirete')).toBe(true);
    // le CPI de 08:30 est publié (passé) : sa tige est pleine ; sa fenêtre ± 15 a eu lieu ; le trade aussi
    expect(of('catalyst').map((m) => etatOf(m)[0])).toEqual(['plein']);
    expect(of('window').map((m) => etatOf(m)[0])).toEqual(['plein']);
    expect(of('trade').map((m) => etatOf(m)[0])).toEqual(['plein']);
    // la veille, au présent du 13 : la fenêtre du CPI du lendemain est prévue, tiretée
    act(() => root!.unmount());
    vi.setSystemTime(et('2026-10-13', '15:00'));
    useUi.setState({ friseOpen: false });
    mount();
    open();
    act(() => useUi.getState().setTimeCursor(et(DAY, '08:00')));
    expect(of('window').map((m) => etatOf(m)[0])).toEqual(['tirete']);
    expect(of('catalyst').map((m) => etatOf(m)[0])).toEqual(['tirete']);
    // un samedi : la séance est fermée, éteinte
    act(() => useUi.getState().setTimeCursor(et('2026-10-17', '12:00')));
    expect(of('phase').map((m) => etatOf(m)[0])).toEqual(['eteint']);
    // la table d'états les dessine : un tracé SVG de la même classe, sans feuille parallèle
    const sheet = readFileSync('src/design/etat.module.css', 'utf8');
    for (const etat of ETATS) expect(sheet, etat).toMatch(new RegExp(`line\\.${etat},\\s*rect\\.${etat},\\s*path\\.${etat}`));
    expect(readFileSync('src/app/frise.module.css', 'utf8')).not.toMatch(/stroke-dasharray|dashed|dotted/);
  });

  it('l’axe lit le registre des raccourcis : chaque touche qu’il prend y figure, et chaque pas du curseur y est pris', () => {
    const source = readFileSync('src/app/Frise.tsx', 'utf8');
    expect(source).not.toMatch(/\.key\s*[!=]==|\.code\s*[!=]==|\.key\.toLowerCase\(\)|addEventListener\(\s*'keydown'/);
    expect(source).toMatch(/cursorMoveOf\(event\)/);
    expect(source).toMatch(/matchShortcut\('frise', event\)/);
    mount();
    const reset = () => {
      act(() => {
        useUi.setState({ tab: 'metrique', timeCursor: et(DAY, '09:00'), friseOpen: true });
        useObjects.setState(useObjects.getInitialState(), true);
      });
      act(() => slider().focus());
    };
    const keys: KeyboardEventInit[] = [
      ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('').map((key) => ({ key })),
      ...['Escape', 'Backspace', 'Enter', 'Tab', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', '?'].map((key) => ({ key, code: key })),
    ];
    const mods: KeyboardEventInit[] = [{}, { shiftKey: true }, { altKey: true }];
    const inScopes = (init: KeyboardEventInit, scopes: readonly ShortcutScope[]) => scopes.some((scope) => matchShortcut(scope, new KeyboardEvent('keydown', init)) !== null);
    for (const key of keys) {
      for (const mod of mods) {
        const init = { ...key, ...mod };
        reset();
        if (press(slider(), init)) expect(inScopes(init, ['frise', 'desk', 'zoom']), JSON.stringify(init)).toBe(true);
      }
    }
    const eventOf = (chord: Chord): KeyboardEventInit => ({ key: chord.key ?? '', shiftKey: chord.shift === true, altKey: chord.alt === true, ctrlKey: !!chord.mod });
    for (const shortcut of SHORTCUTS.filter((x) => x.scope === 'frise')) {
      for (const chord of shortcut.chords) {
        reset();
        expect(press(slider(), eventOf(chord)), `${shortcut.id} ${JSON.stringify(chord)}`).toBe(true);
      }
    }
  }, 60_000);
});
