/**
 * @vitest-environment jsdom
 */
import { act, createElement, Profiler, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * POL9 — cadence et repos (polissage du desk, 2026-11-08). Au repos, le desk ne recalcule que ce qui change : l'horloge
 * du châssis dit la minute et ne re-rend plus tout le desk chaque seconde ; ce qui compte vraiment les secondes (l'âge de
 * la lecture du pont, la barre du dialogue) bat de lui-même ; un battement du pont ne re-rend plus le châssis ; les
 * « maintenant » du Calendrier et de M.003 tournent à la frontière de l'horloge murale, en même temps que la barre.
 */

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { FriseAnswer } from '@/app/FriseAnswer';
import { useKillLatch, useKillSwitch } from '@/app/killState';
import { Shell } from '@/app/Shell';
import { StatusBornes } from '@/app/StatusBornes';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const TIMERS: { toFake: ('Date' | 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval')[] } = { toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] };
const et = (day: string, time: string) => zonedToUtc(day, time, ET_ZONE);

function status(patch: Partial<NtBridgeStatus> = {}): NtBridgeStatus {
  return { link: 'live', port: 0, addonVersion: '2.2.0', ntVersion: '8.1', accounts: [], accountsAt: Date.now(), accountNames: ['Sim101'], heartbeatLatencyMs: 12, ordersOpen: true, hasToken: true, extraAccounts: [], maxContractsPerOrder: 1, killSwitchShortcut: 'CommandOrControl+Shift+K', ...patch };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
/** Une seconde d'horloge, dans son propre `act` : chaque minuteur échu rend ce qu'il doit, comme dans le desk. */
function seconds(n: number) {
  for (let i = 0; i < n; i++) act(() => void vi.advanceTimersByTime(1_000));
}

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 15 } } });
  useJournal.setState({ sessions: [], trades: [] });
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
  useBridge.setState({ nt: null });
});

describe('POL9 · cadence et repos', () => {
  it('POL9.1 l’horloge du châssis dit la minute : aucun rendu du desk en dix secondes, la minute tourne à sa frontière, une veille se rattrape en une seconde', () => {
    vi.useFakeTimers(TIMERS);
    vi.setSystemTime(new Date('2026-11-09T15:00:05Z')); // 10:00:05 à New York
    let commits = 0;
    const el = mount(createElement(Profiler, { id: 'desk', onRender: () => void (commits += 1) }, createElement(Shell, null, createElement('div', null, 'module'))));
    const clock = () => el.querySelector('[data-chassis="status"] time + span b')?.textContent;
    expect(clock()).toBe('10:00');
    commits = 0;
    seconds(10);
    expect(commits).toBe(0);
    // 10:00:15 → 10:01:01 : la minute tourne à sa frontière. Restent les cadences voulues — les bornes du jour (15 s), la
    // réponse du temps à sa demi-minute, la minute — et plus quarante-six rendus du desk entier.
    seconds(46);
    expect(clock()).toBe('10:01');
    expect(commits).toBeLessThan(10);
    // Veille du poste : les minuteurs s'arrêtent, l'horloge murale avance de deux minutes ; une seconde suffit au rattrapage.
    act(() => void vi.setSystemTime(new Date('2026-11-09T15:03:10Z')));
    seconds(1);
    expect(clock()).toBe('10:03');
  });

  it('POL9.1 ce qui compte les secondes bat de lui-même : l’âge de la lecture du pont, et la réponse du temps à sa demi-minute', () => {
    vi.useFakeTimers(TIMERS);
    vi.setSystemTime(new Date('2026-11-09T15:00:05Z'));
    useBridge.setState({ nt: status({ accountsAt: Date.now() }) });
    const bar = mount(createElement(StatusBornes));
    const bridge = () => bar.querySelector('[data-status="bridge"]')?.textContent ?? '';
    seconds(3);
    expect(bridge()).toMatch(/\b3 s\b/);
    act(() => root!.unmount());
    host!.remove();

    // 08:00:20 ET, la fenêtre ± 15 du CPI s'ouvre à 08:15 : « 15 min » jusqu'à 08:00:30, « 14 min » ensuite.
    useBridge.setState({ nt: null });
    useCalendar.setState({ entries: [] });
    vi.setSystemTime(et('2026-10-14', '08:00') + 20_000);
    const answer = mount(createElement(FriseAnswer));
    const delay = () => answer.querySelector('[data-status="answer"] b')?.textContent ?? null;
    expect(delay()).toBe('15 min');
    act(() => void vi.advanceTimersByTime(9_990));
    expect(delay()).toBe('15 min');
    act(() => void vi.advanceTimersByTime(20));
    expect(delay()).toBe('14 min');
  });

  it('POL9.2 un battement du pont ne re-rend pas le châssis : le kill switch ne lit que ses deux primitives', () => {
    let renders = 0;
    function Probe() {
      const kill = useKillSwitch();
      renders += 1;
      return createElement('i', { 'data-engaged': String(kill.engaged), 'data-shortcut': kill.shortcut });
    }
    useBridge.setState({ nt: status() });
    const el = mount(createElement(Probe));
    const before = renders;
    for (let i = 0; i < 5; i++) act(() => useBridge.setState({ nt: status({ heartbeatLatencyMs: 10 + i, accountsAt: 1_000 + i }) }));
    expect(renders).toBe(before);
    // Le canal fermé par le kill switch bascule dans le même commit qu'avant.
    act(() => useBridge.setState({ nt: status({ ordersOpen: false, ordersClosed: true }) }));
    expect(el.querySelector('i')?.getAttribute('data-engaged')).toBe('true');
    expect(el.querySelector('i')?.getAttribute('data-shortcut')).toBe('CommandOrControl+Shift+K');
  });

});
