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
import { recordDeskEvent } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.38c — la ligne active du registre est un événement, pas un rang (correctif de la relecture adverse du lot 7). La
 * liste va du plus récent au plus ancien : chaque événement rangé décale les lignes d'un rang, et le choix doit rester sur
 * l'événement choisi ; la ligne active ne revient en vue que quand le choix change. Fichier à part : le registre du
 * lancement est global, ce fichier part d'un registre vide.
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
  vi.restoreAllMocks();
});

describe('OROS5.38c la ligne active du registre tient son événement', () => {
  it('un événement rangé pendant le choix ne déplace ni le choix, ni ce qu’Entrée ouvre, ni la liste', async () => {
    recordDeskEvent('bridge_link', { from: 'connecting', to: 'live' });
    recordDeskEvent('order', { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'limit', state: 'Working', byAgent: false });
    recordDeskEvent('order', { account: 'Sim102', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'limit', state: 'Working', byAgent: false });
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const node = await mount(createElement(RegistreDrawer));
    act(() => void openRegistre(null));
    const list = node.querySelector<HTMLElement>('[data-registre] [role="listbox"]')!;
    const press = (key: string) => act(() => void list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    const active = () => list.querySelector<HTMLElement>(`#${list.getAttribute('aria-activedescendant')}`)!;
    expect(active().dataset.seq).toBe('3');
    press('ArrowDown');
    press('ArrowDown');
    // Le lien du pont, qui n'ouvre rien.
    expect(active().dataset.seq).toBe('1');
    expect(active().dataset.kind).toBe('bridge_link');
    const scrolled = scroll.mock.calls.length;
    // Une alerte arrive : elle se pose en tête, le choix reste sur le lien du pont.
    act(() => recordDeskEvent('crypto_alert', { alertId: 'a1', target: 'coinbase:BTC-USD', kind: 'price_above', level: 85_000, value: 85_100, author: 'user' }));
    expect(list.querySelector('li')!.getAttribute('data-seq')).toBe('4');
    expect(active().dataset.seq).toBe('1');
    expect(list.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    // La liste ne revient pas d'elle-même vers la ligne active.
    expect(scroll.mock.calls.length).toBe(scrolled);
    press('Enter');
    expect(useObjects.getState().open).toBeNull();
    // ↑ repart de l'événement choisi : l'ordre de Sim101.
    press('ArrowUp');
    expect(active().dataset.seq).toBe('2');
    expect(scroll.mock.calls.length).toBe(scrolled + 1);
    press('Enter');
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: 'Sim101' });
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });
});
