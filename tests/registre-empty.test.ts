/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { openRegistre, useRegistre } from '@/app/registre';
import { RegistreDrawer } from '@/app/RegistreDrawer';
import { useI18n } from '@/i18n';
import { useCalendar } from '@/store/calendar';
import { deskEventLog } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.38d — un registre vide se ferme aussi par Échap (correctif de la relecture adverse du lot 7). Vide, le tiroir ne
 * rend pas la liste : le focus doit tout de même entrer dans le tiroir, sans quoi Échap n'y arrive pas — il reste au
 * bouton qui l'a ouvert, et le châssis le lit pour fermer la fiche ouverte. Fichier à part : il part d'un registre vide.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useRegistre.setState({ open: false, kinds: [], origin: null });
  useUi.setState({ tab: 'metrique', friseOpen: false });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: [], trades: [] });
  useNotes.setState({ notes: [] });
  useCalendar.setState({ entries: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS5.38d un registre vide se ferme par Échap', () => {
  it('ouvert vide, le focus entre dans le tiroir ; Échap le ferme, rend le focus, et le châssis ne le relit pas', async () => {
    expect(deskEventLog.size).toBe(0);
    const node = await mount(createElement('div', null, createElement('button', { id: 'origine' }, 'Registre 0'), createElement(RegistreDrawer)));
    const origin = node.querySelector<HTMLButtonElement>('#origine')!;
    origin.focus();
    await act(async () => void openRegistre(origin));
    const drawer = node.querySelector<HTMLElement>('[data-registre]')!;
    expect(drawer.textContent).toContain('Rien depuis l’ouverture');
    expect(drawer.querySelector('[role="listbox"]')).toBeNull();
    // Le focus est dans le tiroir : Échap y arrive, d'où que la touche parte.
    expect(drawer.contains(document.activeElement)).toBe(true);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void document.activeElement!.dispatchEvent(escape));
    expect(useRegistre.getState().open).toBe(false);
    expect(node.querySelector('[data-registre]')).toBeNull();
    expect(document.activeElement).toBe(origin);
    // Lue par le tiroir : le châssis (`Shell`, qui écarte une touche déjà prise) ne ferme pas la fiche ouverte avec elle.
    expect(escape.defaultPrevented).toBe(true);
  });
});
