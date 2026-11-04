/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react';
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
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { useI18n, type Locale } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { dailyLossReached, traderRuleBlocks } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.23 — la réponse du temps, repliée au bout de la ligne de la journée : ce qui est en vigueur d'abord (le kill
 * switch en tête), sinon ce qui vient et son délai, puis sa source. L'heure de New York. La journée CME n'est que celle de
 * la frise : à 18:30 ET, l'« aujourd'hui » du rail et du Calendrier reste la date locale. La perte du jour n'est en
 * vigueur que tant que la garde la relit au-delà de sa limite.
 */

const et = (day: string, time: string) => zonedToUtc(day, time, ET_ZONE);
/** Mercredi 14 octobre 2026 : le CPI à 08:30 ET, estimé par le calendrier local (aucune source officielle synchronisée). */
const CPI = '2026-10-14';
const APEX = 'Apex-PA-50K';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(children: ReactNode = createElement('div', null, 'module')): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Shell, { children })));
  return host;
}
const answer = () => host!.querySelector<HTMLElement>('[data-status="answer"]')!;
const longText = () => answer().querySelector('[class*="answerLong"]')!.textContent;
const delay = () => answer().querySelector('b')?.textContent ?? null;

function at(ms: number) {
  vi.setSystemTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 15 } } });
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
  useKillLatch.setState({ engaged: false });
  useI18n.setState({ locale: 'fr' });
});

describe('OROS5.23 · la réponse du temps dans la barre d’état', () => {
  it('ce qui est en vigueur passe avant ce qui vient ; ce qui vient dit son délai ; la source est dite', () => {
    // 08:00 ET : la fenêtre ± 15 du CPI s'ouvre à 08:15 — à venir, avec son délai
    at(et(CPI, '08:00'));
    mount();
    expect(answer().dataset.answer).toBe('ahead');
    expect(delay()).toBe('15 min');
    expect(longText()).toBe('08:15 Fenêtre ± 15 · Inflation CPI');
    expect(answer().querySelector('[data-source]')?.getAttribute('data-source')).toBe('local');
    expect(answer().getAttribute('aria-label')).toBe('15 min · 08:15 Fenêtre ± 15 · Inflation CPI, calendrier local · estimé, sources officielles incomplètes, heure de New York');
    act(() => root!.unmount());
    // 08:20 ET : la fenêtre vaut ; la publication de 08:30 n'est pas redite à venir
    at(et(CPI, '08:20'));
    mount();
    expect(answer().dataset.answer).toBe('window');
    expect(delay()).toBeNull();
    expect(longText()).toBe('Fenêtre ± 15 · Inflation CPI jusqu’à 08:45');
    expect(answer().getAttribute('aria-label')).toMatch(/^Fenêtre ± 15 · Inflation CPI jusqu’à 08:45, calendrier local · estimé/);
    act(() => root!.unmount());
    // 08:50 ET : la fenêtre close, ce qui vient : l'ouverture RTH, la séance n'a pas de source de calendrier
    at(et(CPI, '08:50'));
    mount();
    expect(answer().dataset.answer).toBe('ahead');
    expect(delay()).toBe('40 min');
    expect(longText()).toBe('09:30 Ouverture RTH');
    expect(answer().querySelector('[data-source]')).toBeNull();
    // l'axe des heures n'entre pas dans la barre : il vit dans le tiroir
    expect(host!.querySelector('[data-chassis="status"] [role="slider"]')).toBeNull();
  });

  it('le kill switch en tête : C.123 « soumission fermée », ce qui vaut d’autre au nom accessible', () => {
    at(et(CPI, '08:20'));
    useKillLatch.setState({ engaged: true });
    mount();
    expect(answer().dataset.answer).toBe('kill');
    expect(longText()).toBe('Soumission fermée');
    const signal = answer().querySelector<HTMLElement>('[data-level]')!;
    expect(signal.dataset.level).toBe('3');
    expect(signal.classList.contains('sig-l3')).toBe(true);
    expect(signal.querySelector('.skg-123')).not.toBeNull();
    expect(answer().getAttribute('aria-label')).toMatch(/^Soumission fermée jusqu’au redémarrage du desk ; Fenêtre ± 15 · Inflation CPI jusqu’à 08:45/);
  });

  it('à 18:30 ET, la frise lit la journée CME du lendemain ; la date du Calendrier et du rail ne change pas', async () => {
    // mardi 27 octobre 2026, 18:30 à New York (22:30 UTC) : la journée CME est celle du mercredi 28 ; la date locale reste le 27
    at(et('2026-10-27', '18:30'));
    useCalendar.setState({
      entries: [
        { id: 'e1', date: '2026-10-27', kind: 'note', title: 'Revoir la séance', createdAt: 0, updatedAt: 0 },
        { id: 'e2', date: '2026-10-28', kind: 'note', title: 'Préparer le PIB', createdAt: 0, updatedAt: 0 },
        { id: 'e3', date: '2026-10-28', kind: 'event', title: 'Appel', time: '09:00', createdAt: 0, updatedAt: 0 },
      ],
    });
    const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
    mount(createElement(Calendrier));
    await act(async () => undefined);
    expect(answer().dataset.day).toBe('2026-10-28');
    // le rail compte les repères du jour local
    const rail = host!.querySelector<HTMLElement>('nav button[data-tab="calendrier"]')!;
    expect(rail.textContent).toContain('1 repère ce jour');
    // le Calendrier marque aujourd'hui le 27
    const today = host!.querySelector<HTMLElement>('[data-today]')!;
    expect(today.closest<HTMLElement>('[data-day]')!.dataset.day).toBe('2026-10-27');
  });

  it('OROS5.45 à l’étroit, ce qui vient garde son délai et sa borne ; l’heure cède, le nom accessible la garde', () => {
    at(et(CPI, '08:00'));
    mount();
    const short = () => answer().querySelector('[class*="answerShort"]')!.textContent;
    expect(short()).toBe('Fenêtre ± 15 · Inflation CPI');
    expect(longText()).toBe('08:15 Fenêtre ± 15 · Inflation CPI');
    expect(answer().getAttribute('aria-label')).toMatch(/^15 min · 08:15 Fenêtre ± 15 · Inflation CPI,/);
    act(() => useI18n.setState({ locale: 'es' }));
    expect(short()).toBe('Ventana ± 15 · Inflación CPI');
  });

  it('trois langues', () => {
    at(et(CPI, '08:20'));
    mount();
    const said = (locale: Locale) => {
      act(() => useI18n.setState({ locale }));
      return [longText(), answer().getAttribute('aria-label')];
    };
    expect(said('fr')).toEqual(['Fenêtre ± 15 · Inflation CPI jusqu’à 08:45', 'Fenêtre ± 15 · Inflation CPI jusqu’à 08:45, calendrier local · estimé, sources officielles incomplètes, heure de New York']);
    expect(said('en')).toEqual(['± 15 window · CPI inflation until 08:45', '± 15 window · CPI inflation until 08:45, local calendar · estimated, official sources incomplete, New York time']);
    expect(said('es')).toEqual(['Ventana ± 15 · Inflación CPI hasta 08:45', 'Ventana ± 15 · Inflación CPI hasta 08:45, calendario local · estimado, fuentes oficiales incompletas, hora de Nueva York']);
  });
});

describe('OROS5.23 · la perte du jour n’est en vigueur que tant que la garde la relit au-delà de sa limite', () => {
  // Mardi 6 octobre 2026, limite de 600 $ (règle du trader) sur Apex-PA-50K : −300 $ à 10:20, −320 $ à 10:56, +80 $ à 11:40.
  const DAY = '2026-10-06';
  const trade = (id: string, exit: string, pnl: number): Trade => ({ id, sessionId: 's6', instrument: 'MNQ', account: APEX, direction: 'long', qty: 1, entryTime: et(DAY, exit) - 600_000, exitTime: et(DAY, exit), entryPrice: 0, exitPrice: 0, pnl, commission: 0 });
  const session = (pnl: number, n: number): Session => ({ id: 's6', date: DAY, account: APEX, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: n, pnl, grossProfit: 0, grossLoss: pnl, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
  /** Le journal tel qu'il est à l'instant lu : les seuls trades déjà sortis. */
  function journalAt(time: string) {
    const all = [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)];
    const done = all.filter((t) => t.exitTime <= et(DAY, time));
    useJournal.setState({ sessions: [session(done.reduce((sum, t) => sum + t.pnl, 0), done.length)], trades: done });
  }
  const guardBlocks = () => traderRuleBlocks({ account: APEX, instrument: 'MNQ', qty: 1 }).some((b) => b.rule === 'after_daily_limit');
  const live = (unrealized: number): NtBridgeStatus =>
    ({
      link: 'live',
      port: 0,
      addonVersion: '2.2.0',
      ntVersion: '8.1',
      accountsAt: Date.now() - 2_000,
      accounts: [{ name: APEX, cashValue: 0, realizedPnl: 0, unrealizedPnl: unrealized, positions: [] }],
      accountNames: [APEX],
      heartbeatLatencyMs: 9,
      ordersOpen: true,
      ordersClosed: false,
      hasToken: true,
      extraAccounts: [],
      maxContractsPerOrder: 5,
      killSwitchShortcut: 'CommandOrControl+Shift+K',
    }) as NtBridgeStatus;

  beforeEach(() => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: APEX, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } } });
  });

  it('atteinte à 10:56, en vigueur à 11:10 ; reprise sous la limite par un gain à 11:40, elle ne l’est plus à 11:45, comme pour la garde', () => {
    at(et(DAY, '11:10'));
    journalAt('11:10');
    mount();
    expect(answer().dataset.answer).toBe('lossReached');
    expect(longText()).toBe('Perte du jour atteinte depuis 10:56');
    expect(dailyLossReached()).toBe(true);
    expect(guardBlocks()).toBe(true);
    act(() => root!.unmount());
    // 11:45 : −540 $, la garde laisse repasser une ouverture ; la barre ne dit plus « en vigueur »
    at(et(DAY, '11:45'));
    journalAt('11:45');
    mount();
    expect(dailyLossReached()).toBe(false);
    expect(guardBlocks()).toBe(false);
    expect(answer().dataset.answer).not.toBe('lossReached');
    expect(answer().getAttribute('aria-label')).not.toMatch(/Perte du jour atteinte/);
  });

  it('au présent, le latent négatif du pont compte comme pour la garde : la perte relue au-delà de la limite vaut, « latent compris »', () => {
    at(et(DAY, '11:45'));
    journalAt('11:45');
    useBridge.setState({ nt: live(-80) });
    mount();
    expect(dailyLossReached()).toBe(true);
    expect(guardBlocks()).toBe(true);
    expect(answer().dataset.answer).toBe('lossReached');
    expect(longText()).toBe('Perte du jour atteinte · latent compris');
    // un latent positif ne compte pas : ni pour la garde, ni pour la barre
    act(() => useBridge.setState({ nt: live(200) }));
    expect(dailyLossReached()).toBe(false);
    expect(answer().dataset.answer).not.toBe('lossReached');
  });
});
