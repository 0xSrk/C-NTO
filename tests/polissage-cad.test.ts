/**
 * @vitest-environment jsdom
 */
import { act, createElement, Profiler, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
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
import { useWallClock } from '@/app/useWallClock';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { CalendarEventRow } from '@/engine/calendarEvents';
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
    // 10:00:01 à New York : les dix secondes qui suivent ne passent aucune frontière de 15 s (POL9.1b), ni de minute.
    vi.setSystemTime(new Date('2026-11-09T15:00:01Z'));
    let commits = 0;
    const el = mount(createElement(Profiler, { id: 'desk', onRender: () => void (commits += 1) }, createElement(Shell, null, createElement('div', null, 'module'))));
    const clock = () => el.querySelector('[data-chassis="status"] time + span b')?.textContent;
    expect(clock()).toBe('10:00');
    commits = 0;
    seconds(10);
    expect(commits).toBe(0);
    // 10:00:11 → 10:01:01 : la minute tourne à sa frontière. Restent les cadences voulues — les bornes du jour (15 s), la
    // réponse du temps à sa demi-minute, la minute — et plus cinquante rendus du desk entier.
    seconds(50);
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

  it('POL9.1a une frontière franchie entre le rendu et l’effet se rattrape au premier minuteur : la minute ne reste pas une minute en retard', () => {
    vi.useFakeTimers(TIMERS);
    const boundary = Date.UTC(2026, 10, 8, 14, 31, 0);
    vi.setSystemTime(boundary - 5); // rendu à 14:30:59.995
    let heavy = true;
    function Clock() {
      const now = useWallClock(60_000);
      // Le premier rendu du châssis est lourd (tout le desk se monte dessous) : son effet passe après la frontière.
      if (heavy) {
        heavy = false;
        vi.setSystemTime(Date.now() + 20);
      }
      return createElement('b', null, new Date(now).toISOString().slice(11, 16));
    }
    const el = mount(createElement(Clock));
    expect(el.textContent).toBe('14:30');
    seconds(1);
    expect(el.textContent).toBe('14:31');
  });

  it('POL9.1b les bornes du jour et le miroir de la garde tournent aux frontières de 15 s de l’horloge murale, avec la frise', async () => {
    vi.useFakeTimers(TIMERS);
    vi.setSystemTime(new Date('2026-11-09T15:00:07Z'));
    const { useDayBornes } = await import('@/app/useDayBornes');
    const { useGuardMirror } = await import('@/app/useGuardMirror');
    const renders = { bornes: 0, mirror: 0 };
    function Bornes() {
      useDayBornes();
      renders.bornes += 1;
      return null;
    }
    function Mirror() {
      useGuardMirror();
      renders.mirror += 1;
      return null;
    }
    mount(createElement('div', null, createElement(Bornes), createElement(Mirror)));
    const before = { ...renders };
    // 15:00:07 → 15:00:15 : la frontière de 15 s passe ; un intervalle parti du montage attendrait 15:00:22.
    act(() => void vi.advanceTimersByTime(8_100));
    expect(renders.bornes).toBe(before.bornes + 1);
    expect(renders.mirror).toBe(before.mirror + 1);
  });

  it('POL9.4 la fiche Compte dit l’âge de la lecture du pont à la seconde, comme la barre : il avance au lieu de rester figé à l’ouverture', async () => {
    vi.useFakeTimers(TIMERS);
    vi.setSystemTime(new Date('2026-11-09T15:00:05Z'));
    const { ObjectDrawer } = await import('@/app/objects/Fiche');
    useBridge.setState({ nt: status({ accountsAt: Date.now() - 4_000, accountNames: ['Sim101'], accounts: [{ name: 'Sim101', cashValue: 50_000, realizedPnl: 0, unrealizedPnl: 0, positions: [] }] as NtBridgeStatus['accounts'] }) });
    const el = mount(createElement(ObjectDrawer));
    act(() => void useObjects.getState().openObject({ type: 'compte', id: 'Sim101' } as never));
    const meta = () => el.querySelector('[data-section="bridge"]')?.textContent ?? '';
    expect(meta()).toContain('lu il y a 4 s');
    seconds(3);
    expect(meta()).toContain('lu il y a 7 s');
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

  it('POL9.3 le « maintenant » du Calendrier tourne avec la minute de l’horloge murale, et M.003 lit la même horloge', async () => {
    const NOW = et('2026-10-28', '11:04') + 50_000; // 11:04:50 ET
    vi.useFakeTimers({ ...TIMERS, now: NOW });
    const row = (id: string, timeET: string, title: string): CalendarEventRow => ({ id: `bls:${id}`, sourceId: 'bls', date: '2026-10-28', timeET, title, category: 'emploi', impact: 2, instruments: [], estimated: false, syncedAt: NOW - 3_600_000 });
    useMacro.setState({ events: [row('a', '10:30', 'Publication passée'), row('b', '11:05', 'Publication témoin'), row('c', '14:00', 'Publication à venir')], sources: [{ sourceId: 'bls', state: 'ok', syncedAt: NOW - 3_600_000 }], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, calendarView: 'flux' } });
    const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
    const el = mount(createElement(Calendrier));
    const now = () => el.querySelector('[data-now]')?.textContent ?? '';
    expect(now()).toContain('11:04 ET');
    act(() => void vi.advanceTimersByTime(10_100));
    expect(now()).toContain('11:05 ET');
    // M.003 : l'heure courante vient de la même horloge murale, plus d'un intervalle de 60 s parti du montage.
    const dashboard = readFileSync('src/modules/metrique/Dashboard.tsx', 'utf8');
    expect(dashboard).toMatch(/useWallClock\(60_000\)/);
    expect(dashboard).not.toMatch(/setInterval\(/);
  });
});
