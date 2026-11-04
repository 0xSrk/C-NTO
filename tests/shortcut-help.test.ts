/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

import { Shell } from '@/app/Shell';
import { useShortcutHelp } from '@/app/ShortcutHelp';
import { chordOfAccelerator, cursorMoveOf, HELP_SECTIONS, matchShortcut, SHORTCUTS, type Chord, type ShortcutScope } from '@/app/shortcuts';
import type { EntityRef } from '@/engine/ontology';
import type { Session } from '@/engine/types';
import { useI18n, type Locale } from '@/i18n';
import { moveCursor } from '@/lib/frise';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.18 — le clavier se découvre par « ? », tiré d'un registre unique (`src/app/shortcuts.ts`) que lisent les
 * gestionnaires et l'aide : chaque touche écoutée y figure, et chaque touche qu'il recense est écoutée. « ? » est ignoré
 * dans un champ et sous le verrou. Trois langues.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const S: EntityRef[] = ['s1', 's2', 's3'].map((id) => ({ type: 'session', id }));

const session = (id: string, date: string): Session => ({
  id,
  date,
  account: 'SimApex1',
  instruments: ['NQ'],
  source: 'csv',
  tradeCount: 0,
  pnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  commission: 0,
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
  act(() => root!.render(createElement(Shell, { inert, children: createElement('div', null, createElement('input', { id: 'champ' }), createElement('button', { id: 'ligne' }, 'ligne')) })));
  return host;
}

/** Une touche, livrée à un élément comme le navigateur la livre ; rend vrai si un gestionnaire l'a prise. */
function press(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event.defaultPrevented;
}

/** L'événement type d'une combinaison du registre. */
function eventOf(chord: Chord): KeyboardEventInit {
  return { key: chord.key ?? (chord.code ? chord.code.replace(/^Digit/, '') : ''), code: chord.code ?? '', ctrlKey: !!chord.mod, shiftKey: chord.shift === true, altKey: chord.alt === true };
}

/** Le balayage : des lettres, des chiffres, de la ponctuation, les touches nommées, sous six jeux de modificateurs. */
function sweep(): KeyboardEventInit[] {
  const keys: { key: string; code: string }[] = [
    ...'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => ({ key: l, code: `Key${l.toUpperCase()}` })),
    ...'0123456789'.split('').map((d) => ({ key: d, code: `Digit${d}` })),
    ...['?', '/', '=', '+', '-', ',', '.', ' '].map((key) => ({ key, code: '' })),
    ...['Escape', 'Backspace', 'Enter', 'Tab', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].map((key) => ({ key, code: key })),
    ...Array.from({ length: 12 }, (_, i) => ({ key: `F${i + 1}`, code: `F${i + 1}` })),
  ];
  const mods: KeyboardEventInit[] = [{}, { shiftKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { altKey: true }, { metaKey: true }];
  return keys.flatMap((k) => mods.map((m) => ({ ...k, ...m })));
}

const inScopes = (init: KeyboardEventInit, scopes: readonly ShortcutScope[]) => {
  const event = new KeyboardEvent('keydown', init);
  return scopes.some((scope) => matchShortcut(scope, event) !== null);
};
const chordsOf = (scope: ShortcutScope) => SHORTCUTS.filter((x) => x.scope === scope).flatMap((x) => x.chords.map((chord) => ({ id: x.id, chord })));

/** Une touche a changé l'état d'avant : un autre objet, plus de saut, l'omnibar, l'aide ou un autre onglet. */
function dirty(): boolean {
  const o = useObjects.getState();
  return o.open !== S[1] || o.history.length !== 1 || o.omnibar || useShortcutHelp.getState().open || useUi.getState().tab !== 'metrique';
}

/** L'état d'avant chaque touche : une fiche ouverte au milieu de sa liste, un saut à défaire, ni omnibar ni aide. */
function reset() {
  act(() => {
    useShortcutHelp.setState({ open: false });
    useObjects.setState({ omnibar: false, open: S[1]!, siblings: S, jumpedFrom: null, origin: null, history: [{ tab: 'metrique', view: null, open: S[0]!, jumpedFrom: null, siblings: S }] });
    useUi.setState({ tab: 'metrique' });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useShortcutHelp.setState({ open: false });
  useUi.setState({ tab: 'metrique', toasts: [] });
  useJournal.setState({ sessions: [session('s1', '2026-10-13'), session('s2', '2026-10-14'), session('s3', '2026-10-15')], trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  // Le zoom enregistre son réglage au coffre : une doublure, jsdom n'ayant pas d'IndexedDB.
  useSettings.setState({ update: async () => undefined });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useShortcutHelp.setState({ open: false });
  vi.useRealTimers();
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(relative('.', path).split(/[/\\]/).join('/'));
  }
  return out;
}

describe('OROS5.18 un registre unique des raccourcis, et l’aide « ? »', () => {
  it('chaque gestionnaire de touches lit le registre : aucune touche n’est comparée ailleurs', () => {
    // Les gestionnaires du desk : ils demandent au registre ce qu'une touche veut dire.
    const handlers = ['src/app/Shell.tsx', 'src/app/ZoomControls.tsx', 'src/app/objects/Omnibar.tsx', 'src/app/objects/Fiche.tsx', 'src/app/ShortcutHelp.tsx'];
    const raw = /\.key\s*[!=]==|\.code\s*[!=]==|\.key\.toLowerCase\(\)|\/\^Digit|\.exec\(e\.code\)/;
    for (const path of handlers) expect(readFileSync(path, 'utf8'), path).not.toMatch(raw);
    // Chaque écouteur de touches posé sur la fenêtre est un gestionnaire du registre, ou l'une des exceptions nommées.
    const windowKeys = walk('src').filter((path) => /addEventListener\(\s*'keydown'/.test(readFileSync(path, 'utf8')));
    const registry = new Set(['src/app/Shell.tsx', 'src/app/ZoomControls.tsx', 'src/modules/note/Note.tsx']);
    const exceptions: Record<string, string> = {
      'src/app/Boot.tsx': 'toute touche abrège le démarrage, avant le desk',
      'src/app/Gate.tsx': 'toute touche abrège l’ouverture du verrou, avant le desk',
      'src/design/Modal.tsx': 'une fenêtre : Échap la ferme, Tab reste dedans',
    };
    expect(windowKeys.sort()).toEqual([...registry, ...Object.keys(exceptions)].sort());
    for (const path of registry) expect(readFileSync(path, 'utf8'), path).toMatch(/matchShortcut\('(desk|zoom|note)', e\)/);
    // Note : son Ctrl+N passe par le registre ; le reste de ses touches est l'éditeur (Tab indente), pas un raccourci du desk.
    const note = readFileSync('src/modules/note/Note.tsx', 'utf8');
    const listener = note.slice(note.indexOf("window.addEventListener('keydown'") - 400, note.indexOf("window.addEventListener('keydown'"));
    expect(listener).toMatch(/matchShortcut\('note', e\)\?\.id === 'newNote'/);
    expect(listener).not.toMatch(/\.key\b/);
  });

  it('au châssis, chaque touche écoutée figure au registre, et réciproquement', () => {
    mount();
    const body = document.body;
    // une touche prise par un gestionnaire du châssis est au registre (le châssis et le zoom)
    for (const init of sweep()) {
      if (dirty()) reset();
      if (press(body, init)) expect(inScopes(init, ['desk', 'zoom']), JSON.stringify(init)).toBe(true);
    }
    // chaque combinaison du registre est prise
    for (const { id, chord } of [...chordsOf('desk'), ...chordsOf('zoom')]) {
      reset();
      expect(press(body, eventOf(chord)), `${id} ${JSON.stringify(chord)}`).toBe(true);
    }
    // le kill switch reste au process principal : le renderer ne le prend pas
    reset();
    expect(press(body, { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press(body, { key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false);
  }, 60_000);

  it('à l’omnibar et à la fiche, chaque touche écoutée figure au registre, et réciproquement', () => {
    const el = mount();
    // l'omnibar : ses touches, celles du châssis qui passent sous une fenêtre (les modules), le zoom
    const field = () => document.querySelector<HTMLInputElement>('[data-omnibar] input')!;
    const openOmnibar = () => {
      reset();
      act(() => void useObjects.getState().setOmnibar(true));
      act(() => field().focus());
    };
    openOmnibar();
    for (const init of sweep()) {
      if (dirty() || !document.querySelector('[data-omnibar]') || document.activeElement !== field()) openOmnibar();
      if (press(field(), init)) expect(inScopes(init, ['omnibar', 'desk', 'zoom']), JSON.stringify(init)).toBe(true);
    }
    for (const { id, chord } of chordsOf('omnibar')) {
      openOmnibar();
      expect(press(field(), eventOf(chord)), `${id} ${JSON.stringify(chord)}`).toBe(true);
    }
    // la fiche, quand elle a le focus : ↑ ↓, puis ce que le châssis écoute
    const drawer = () => el.querySelector<HTMLElement>('aside[data-drawer]')!;
    const focusDrawer = () => {
      reset();
      act(() => drawer().focus());
    };
    focusDrawer();
    for (const init of sweep()) {
      if (dirty() || document.activeElement !== drawer()) focusDrawer();
      if (press(drawer(), init)) expect(inScopes(init, ['fiche', 'desk', 'zoom']), JSON.stringify(init)).toBe(true);
    }
    for (const { id, chord } of chordsOf('fiche')) {
      focusDrawer();
      expect(press(drawer(), eventOf(chord)), `${id} ${JSON.stringify(chord)}`).toBe(true);
    }
    // ↑ rend la séance d'avant, ↓ celle d'après
    focusDrawer();
    press(drawer(), { key: 'ArrowUp' });
    expect(useObjects.getState().open).toEqual(S[0]);
  }, 60_000);

  it('le curseur de temps et Note lisent le même registre ; le kill switch y est en lecture seule', () => {
    // le curseur de temps (le tiroir de la frise le lira) : chaque pas du registre est un pas du modèle
    const at = Date.parse('2026-10-14T14:00:00Z');
    for (const { id, chord } of chordsOf('frise')) {
      const move = cursorMoveOf(new KeyboardEvent('keydown', eventOf(chord)));
      if (id === 'cursorPresent' || id === 'cursorOpen') expect(move, id).toBeNull();
      else expect(Number.isFinite(moveCursor(at, move!)), id).toBe(true);
    }
    expect(cursorMoveOf(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))).toBe('hourRight');
    expect(cursorMoveOf(new KeyboardEvent('keydown', { key: 'PageUp' }))).toBe('dayBack');
    expect(cursorMoveOf(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }))).toBeNull();
    // Note : Ctrl+N, Alt indifférent, jamais avec Maj
    expect(matchShortcut('note', new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))?.id).toBe('newNote');
    expect(matchShortcut('note', new KeyboardEvent('keydown', { key: 'N', metaKey: true, altKey: true }))?.id).toBe('newNote');
    expect(matchShortcut('note', new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true }))).toBeNull();
    // le kill switch : la combinaison même du process principal, et jamais une prise du renderer
    const main = readFileSync('electron/nt-bridge/index.ts', 'utf8');
    const accelerator = /KILL_SWITCH_SHORTCUT = '([^']+)'/.exec(main)![1]!;
    const kill = SHORTCUTS.find((x) => x.id === 'killSwitch')!;
    expect(kill.readOnly).toBe(true);
    expect(kill.chords).toEqual([chordOfAccelerator(accelerator)]);
    expect(kill.chords[0]).toEqual({ key: 'k', mod: true, shift: true, alt: false });
    for (const scope of ['desk', 'zoom', 'omnibar', 'fiche', 'frise', 'note', 'main'] as const) {
      expect(matchShortcut(scope, new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, shiftKey: true }))).toBeNull();
    }
    // Ctrl+J, jamais Ctrl+K
    const desk = SHORTCUTS.filter((x) => x.scope === 'desk').flatMap((x) => x.chords);
    expect(desk.some((chord) => chord.key === 'j' && chord.mod)).toBe(true);
    expect(SHORTCUTS.filter((x) => !x.readOnly).flatMap((x) => x.chords).some((chord) => chord.key === 'k')).toBe(false);
  });

  it('« ? » ouvre l’aide hors d’un champ ; dans un champ, sous un dialogue et sous le verrou, il est ignoré', () => {
    mount();
    // dans un champ, « ? » s'écrit
    const field = document.getElementById('champ')!;
    act(() => field.focus());
    expect(press(field, { key: '?', shiftKey: true })).toBe(false);
    expect(useShortcutHelp.getState().open).toBe(false);
    // sous un dialogue ouvert
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(press(document.body, { key: '?', shiftKey: true })).toBe(false);
    dialog.remove();
    expect(useShortcutHelp.getState().open).toBe(false);
    // hors d'un champ : l'aide, tirée du registre entier, et ce qui mène à la barre d'état
    const line = document.getElementById('ligne')!;
    act(() => line.focus());
    expect(press(line, { key: '?', shiftKey: true })).toBe(true);
    const help = document.querySelector<HTMLElement>('[data-help]')!;
    expect(help).not.toBeNull();
    expect([...help.querySelectorAll<HTMLElement>('[data-shortcut]')].map((row) => row.dataset.shortcut)).toEqual(HELP_SECTIONS.flatMap((section) => SHORTCUTS.filter((x) => x.scope === section.scope).map((x) => x.id)));
    expect(new Set(HELP_SECTIONS.map((section) => section.scope))).toEqual(new Set(SHORTCUTS.map((x) => x.scope)));
    const text = help.textContent!;
    for (const keys of ['Ctrl+J', '↑ ↓', 'Entrée', 'Échap', 'Retour arrière', '← →', 'Maj+← →', 'Pg préc. · Pg suiv.', 'Début · Fin', 'Ctrl+Maj+K']) expect(text, keys).toContain(keys);
    expect(help.querySelector('[data-help-status]')!.textContent).toMatch(/barre d’état : F6/);
    // Échap ferme l'aide (la fenêtre) et rend le focus à la ligne
    press(document.activeElement ?? document.body, { key: 'Escape' });
    expect(useShortcutHelp.getState().open).toBe(false);
    expect(document.querySelector('[data-help]')).toBeNull();
    expect(document.activeElement).toBe(line);
  });

  it('sous le verrou, « ? » ne répond pas', () => {
    mount(true);
    expect(press(document.body, { key: '?', shiftKey: true })).toBe(false);
    expect(useShortcutHelp.getState().open).toBe(false);
    expect(document.querySelector('[data-help]')).toBeNull();
  });

  it('F6 mène d’une zone du châssis à l’autre, jusqu’à la barre d’état', () => {
    const el = mount();
    act(() => void useObjects.getState().openObject(S[1]!, { siblings: S }));
    const zone = () => {
      const active = document.activeElement;
      if (el.querySelector('[data-chassis="rail"]')!.contains(active)) return 'rail';
      if (el.querySelector('main')!.contains(active)) return 'main';
      if (el.querySelector('aside[data-drawer]')!.contains(active)) return 'fiche';
      if (el.querySelector('[data-chassis="status"]')!.contains(active)) return 'status';
      return 'ailleurs';
    };
    act(() => document.getElementById('ligne')!.focus());
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      press(document.activeElement ?? document.body, { key: 'F6', code: 'F6' });
      seen.push(zone());
    }
    expect(seen).toEqual(['fiche', 'status', 'rail', 'main']);
    press(document.activeElement ?? document.body, { key: 'F6', code: 'F6', shiftKey: true });
    expect(zone()).toBe('rail');
    // la fiche prend le focus elle-même : ↑ ↓ y passent d'un objet à l'autre
    press(document.activeElement ?? document.body, { key: 'F6', code: 'F6' });
    press(document.activeElement ?? document.body, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(el.querySelector('aside[data-drawer]'));
  });

  it('trois langues : chaque raccourci se dit en français, en anglais et en espagnol', () => {
    const said = (locale: Locale, fn: () => string) => {
      useI18n.setState({ locale });
      return fn();
    };
    try {
      for (const shortcut of SHORTCUTS) {
        const [fr, en, es] = (['fr', 'en', 'es'] as const).map((locale) => said(locale, shortcut.label));
        expect(fr && en && es, shortcut.id).toBeTruthy();
        expect(new Set([fr, en, es]).size, shortcut.id).toBeGreaterThan(1);
        for (const locale of ['fr', 'en', 'es'] as const) expect(said(locale, shortcut.keys).trim(), `${shortcut.id} ${locale}`).not.toBe('');
      }
      expect(said('en', SHORTCUTS.find((x) => x.id === 'back')!.keys)).toBe('Backspace');
      expect(said('es', SHORTCUTS.find((x) => x.id === 'cursorDay')!.keys)).toBe('RePág · AvPág');
      for (const section of HELP_SECTIONS) for (const locale of ['fr', 'en', 'es'] as const) expect(said(locale, section.title), section.scope).not.toBe('');
    } finally {
      useI18n.setState({ locale: 'fr' });
    }
    // chaque chaîne du registre et de l'aide passe par tr(fr, en, es)
    for (const path of ['src/app/shortcuts.ts', 'src/app/ShortcutHelp.tsx']) {
      const src = readFileSync(path, 'utf8');
      for (const call of src.matchAll(/\btr\(/g)) {
        const rest = src.slice(call.index! + 3);
        let depth = 1;
        let commas = 0;
        let quote = '';
        for (const ch of rest) {
          if (quote) {
            if (ch === quote) quote = '';
            continue;
          }
          if (ch === "'" || ch === '`' || ch === '"') quote = ch;
          else if (ch === '(') depth++;
          else if (ch === ')' && --depth === 0) break;
          else if (ch === ',' && depth === 1) commas++;
        }
        expect(commas, `${path} : ${rest.slice(0, 60)}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
