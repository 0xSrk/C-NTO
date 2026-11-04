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

import { RailGates } from '@/app/RailGates';
import { EVENT_LOG_MAX } from '@/engine/agent/events';
import { useRegistre } from '@/app/registre';
import { RegistreDrawer } from '@/app/RegistreDrawer';
import { useI18n } from '@/i18n';
import { useCalendar } from '@/store/calendar';
import { deskEventLog, recordDeskEvent, useDeskEvents } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.38e — « Registre n » compte ce que le registre qu'il ouvre garde (correctif de la relecture adverse du lot 7). Le
 * registre ne garde que les 500 derniers événements (décision 13) : passé ce nombre, le lien ne dit plus « N en mémoire »
 * pour un total depuis le lancement, il dit les deux. Fichier à part : il range plus de 500 événements.
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

describe('OROS5.38e « Registre n » compte ce que le registre garde', () => {
  it('612 événements rangés : le lien et le tiroir disent 500 ; le nom accessible dit les deux nombres', async () => {
    const fill = (i: number) => recordDeskEvent('fill', { account: 'Sim101', instrument: 'MNQ 12-26', action: i % 2 ? 'Sell' : 'Buy', quantity: 1, price: 20_000 + i, time: '2026-10-14T13:40:00.000Z', entryExit: 'Entry' });
    for (let i = 0; i < 12; i += 1) fill(i);
    const node = await mount(createElement('div', null, createElement(RailGates), createElement(RegistreDrawer)));
    const link = () => node.querySelector<HTMLButtonElement>('button[data-registry]')!;
    // Sous la borne, rien ne change : un seul nombre, celui du registre.
    expect(link().textContent).toBe('Registre12');
    expect(link().getAttribute('aria-label')).toBe('Registre du lancement : 12 événement(s), en mémoire — ouvrir le registre');
    act(() => {
      for (let i = 12; i < 612; i += 1) fill(i);
    });
    expect(useDeskEvents.getState().count).toBe(612);
    expect(deskEventLog.size).toBe(EVENT_LOG_MAX);
    expect(link().textContent).toBe('Registre500');
    expect(link().getAttribute('aria-label')).toBe('Registre du lancement : 612 événement(s) depuis l’ouverture, les 500 derniers en mémoire — ouvrir le registre');
    await act(async () => link().click());
    // Le tiroir ouvert dit le même nombre que le lien.
    expect(node.querySelector('[data-registre]')!.textContent).toContain('500');
    expect(node.querySelectorAll('[data-registre] li[data-seq]')).toHaveLength(EVENT_LOG_MAX);
    useI18n.setState({ locale: 'en' });
    await act(async () => undefined);
    expect(link().getAttribute('aria-label')).toBe('Launch log: 612 event(s) since opening, the last 500 in memory — open the log');
  });
});
