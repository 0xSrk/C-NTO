/**
 * @vitest-environment jsdom
 */
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
import { useRegistre } from '@/app/registre';
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
});
