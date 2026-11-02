/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDayBornes } from '@/app/useDayBornes';
import { calendarSourcesState, dayBornes, LOSS_WARN, marginLevel, MARGIN_WARN, replayBornes, type BornesLive, type DayBornes } from '@/engine/bornes';
import { dayLoss, DEFAULT_TRADER_RULES, detectRuleBreaches, tradingDayNow, type TraderRules } from '@/engine/discipline';
import { BRIDGE_MAX_AGE_MS } from '@/engine/portfolio/types';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import type { NtBridgeStatus } from '@/lib/desk';
import { drawdownGauge } from '@/modules/metrique/drawdownLimit';
import { useBridge } from '@/store/bridge';
import { dailyLossReached, trackedPropShare } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

/** OROS5.11 : les bornes de la journée, calculées une fois ; le rejeu ne tourne qu'au changement de journal, de plan ou de compte. */

// Le compteur d'appels : les fonctions mêmes, enveloppées, pour tous les modules qui les importent.
vi.mock('@/engine/propfirm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/propfirm')>();
  return { ...actual, evaluatePlan: vi.fn(actual.evaluatePlan) };
});
vi.mock('@/engine/discipline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/discipline')>();
  return { ...actual, detectRuleBreaches: vi.fn(actual.detectRuleBreaches) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mardi 27 octobre 2026, 11 h à New York : la journée CME du 27. */
const NOW = Date.parse('2026-10-27T15:00:00Z');
const TODAY = '2026-10-27';
const APEX = 'Apex-PA-50K';

function session(id: string, date: string, pnl: number, tradeCount = 1, account = APEX): Session {
  return { id, date, account, instruments: ['MNQ'], source: 'demo', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}
function trade(id: string, sessionId: string, at: number, pnl: number, account = APEX): Trade {
  return { id, sessionId, instrument: 'MNQ', account, direction: 'long', qty: 1, entryTime: at, exitTime: at + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 };
}

function nt(over: Partial<NtBridgeStatus> = {}, unrealized: Record<string, number> = {}): NtBridgeStatus {
  return {
    link: 'live',
    port: 0,
    addonVersion: '2.2.0',
    ntVersion: '8.1',
    accountsAt: NOW - 4_000,
    accounts: Object.entries(unrealized).map(([name, unrealizedPnl]) => ({ name, cashValue: 0, realizedPnl: 0, unrealizedPnl, positions: [] })),
    accountNames: Object.keys(unrealized),
    heartbeatLatencyMs: 10,
    ordersOpen: true,
    ordersClosed: false,
    hasToken: true,
    extraAccounts: [],
    maxContractsPerOrder: 5,
    killSwitchShortcut: 'CommandOrControl+Shift+K',
    ...over,
  } as NtBridgeStatus;
}

const RULES: TraderRules = { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500, maxTradesPerDay: 6, catalystBlackoutMin: 15 };

/** Les bornes lues des stores, comme le crochet : le journal, les réglages, le pont. */
function bornesFromStores(now = NOW): DayBornes {
  const { settings } = useSettings.getState();
  const { sessions, trades } = useJournal.getState();
  const status = useBridge.getState().nt;
  const replay = replayBornes({ sessions, trades, account: settings.planAccount, plan: findPlan(settings.planId) ?? null, rules: settings.traderRules });
  const live: BornesLive = { now, link: status?.link ?? 'absent', accountsAt: status?.accountsAt ?? null, accounts: status?.accounts ?? [], catalysts: [], ordersOpen: status?.ordersOpen, ordersClosed: status?.ordersClosed, maxContractsPerOrder: status?.maxContractsPerOrder ?? null };
  return dayBornes(replay, live);
}

/** Le latent que lit la garde (`trackedPlan`, `liveUnrealized`) : pont vivant, nom exact du compte suivi, ou tous. */
function guardUnrealized(planAccount: string): number {
  const status = useBridge.getState().nt;
  if (status?.link !== 'live') return 0;
  return status.accounts.filter((a) => !planAccount || a.name === planAccount).reduce((sum, a) => sum + a.unrealizedPnl, 0);
}

function bench(state: 'offline' | 'warn' | 'breach' | 'kill', planAccount = APEX) {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount, traderRules: RULES } });
  useJournal.setState({ sessions: [session('s0', '2026-10-26', -63, 4), session('s1', TODAY, -100, 1)], trades: [trade('t1', 's1', Date.parse('2026-10-27T13:00:00Z'), -100)] });
  const unrealized = state === 'breach' ? -423.5 : state === 'warn' ? -286.25 : 0;
  useBridge.setState({ nt: state === 'offline' ? null : nt({ ordersOpen: state !== 'kill', ordersClosed: state === 'kill' }, { Sim101: -40, [APEX]: unrealized }) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  useBridge.setState({ nt: null });
  useJournal.setState({ sessions: [], trades: [] });
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

describe('OROS5.11 · valeurs croisées avec la garde (trackedPropShare), K.04 et la perte du jour', () => {
  it('la marge est celle que lit la garde, datée comme K.04 ; la perte du jour, celle de dayLoss et de l’alerte', () => {
    for (const state of ['offline', 'warn', 'breach', 'kill'] as const) {
      for (const planAccount of [APEX, '']) {
        bench(state, planAccount);
        const b = bornesFromStores();
        const tag = `${state} ${planAccount || 'tous'}`;
        // la garde : la part transmise au process principal pour le compte suivi (ou n'importe lequel, tous suivis)
        expect(b.margin.share, tag).not.toBeNull();
        expect(b.margin.share!, tag).toBeCloseTo(trackedPropShare(planAccount || 'Sim101')!, 12);
        // K.04 : la marge datée du rejeu, au plus-bas de la dernière séance, et sa date
        if (planAccount) {
          const gauge = drawdownGauge({ plan: findPlan('apex-50')!, account: planAccount, history: useJournal.getState(), maxDrawdown: 0, startingBalance: 50_000 });
          expect(gauge.kind).toBe('plan');
          if (gauge.kind === 'plan') {
            expect(b.margin.dated, tag).toBe(gauge.margin);
            expect(b.margin.date, tag).toBe(gauge.date);
          }
        }
        // la perte du jour : dayLoss avec le latent que lit la garde ; l'alerte à 100 % le dit aussi
        const { sessions, trades } = useJournal.getState();
        const expected = dayLoss({ sessions, trades, day: tradingDayNow(NOW), account: planAccount, unrealized: guardUnrealized(planAccount) });
        expect(b.loss.value, tag).toBe(expected.loss);
        expect(b.loss.consumed! >= 1, tag).toBe(dailyLossReached(NOW));
        expect(b.loss).toMatchObject({ limit: 500, source: 'trader' });
      }
    }
  });

  it('les niveaux : attention à 75 % de la limite, franchie à 100 % ; le canal fermé au kill switch', () => {
    expect(LOSS_WARN).toBe(0.75);
    bench('warn');
    expect(bornesFromStores().loss).toMatchObject({ level: 2, remaining: 500 - 386.25 });
    bench('breach');
    expect(bornesFromStores().loss).toMatchObject({ level: 3, remaining: 500 - 523.5 });
    expect(bornesFromStores().nearest).toBe('loss');
    bench('kill');
    expect(bornesFromStores().channel).toMatchObject({ state: 'closed', killed: true, level: 3 });
    bench('offline');
    expect(bornesFromStores().channel).toMatchObject({ state: 'absent', killed: false, level: 0 });
    expect(MARGIN_WARN).toBe(0.25);
    expect([marginLevel(0.26, 'en-cours'), marginLevel(0.25, 'en-cours'), marginLevel(0, 'en-cours'), marginLevel(0.5, 'echec'), marginLevel(0.1, 'objectif'), marginLevel(null, 'en-cours')]).toEqual([0, 2, 3, 3, 0, 0]);
  });

  it('l’âge du pont est dit, et une valeur vive lue au-delà de BRIDGE_MAX_AGE_MS est périmée (C.013)', () => {
    bench('warn');
    expect(bornesFromStores().day).toMatchObject({ live: true, today: true, ageMs: 4_000, stale: false });
    useBridge.setState({ nt: nt({ accountsAt: NOW - BRIDGE_MAX_AGE_MS - 1 }, { [APEX]: 0 }) });
    expect(bornesFromStores().day).toMatchObject({ ageMs: BRIDGE_MAX_AGE_MS + 1, stale: true });
  });

  it('provenance : un compte du pont reconnu par le seul nom replié n’entre pas dans le latent, comme pour la garde', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'SimApex1', traderRules: RULES } });
    useJournal.setState({ sessions: [session('a', TODAY, -100, 1, 'SimApex1')], trades: [] });
    useBridge.setState({ nt: nt({}, { SIMAPEX1: -500 }) });
    const b = bornesFromStores();
    expect(b.day).toMatchObject({ bridgeAccount: { name: 'SIMAPEX1', by: 'folded' }, unrealizedRead: false });
    expect(b.margin.share!).toBeCloseTo(trackedPropShare('SimApex1')!, 12);
    expect(b.loss.value).toBe(100);
    useBridge.setState({ nt: nt({}, { SimApex1: -500 }) });
    expect(bornesFromStores().day).toMatchObject({ bridgeAccount: { name: 'SimApex1', by: 'exact' }, unrealizedRead: true });
    expect(bornesFromStores().loss.value).toBe(600);
  });
});

describe('OROS5.11 · zéro n’est jamais l’absence', () => {
  it('sans séance, sans pont, sans règle ni plan : chaque borne vaut null, « — » à l’écran', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: DEFAULT_TRADER_RULES } });
    const b = bornesFromStores();
    expect(b.loss).toMatchObject({ value: null, limit: null, consumed: null, remaining: null, pnl: null });
    expect(b.trades).toMatchObject({ count: null, max: null, consumed: null, over: null });
    expect(b.margin).toMatchObject({ value: null, share: null, dated: null, planLabel: null });
    expect(b.catalyst).toMatchObject({ at: null, untilMin: null });
    expect(b.channel.state).toBe('absent');
    expect(b.nearest).toBeNull();
  });

  it('en séance sans trade : zéro perte et zéro trade sont des valeurs, pas l’absence', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: APEX, traderRules: RULES } });
    useBridge.setState({ nt: nt({}, { [APEX]: 0 }) });
    const b = bornesFromStores();
    expect(b.loss).toMatchObject({ value: 0, consumed: 0, remaining: 500, level: 0 });
    expect(b.trades).toMatchObject({ count: 0, max: 6, consumed: 0 });
    // une perte connue sans limite réglée : la valeur, et aucune part consommée
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: APEX, traderRules: DEFAULT_TRADER_RULES } });
    useJournal.setState({ sessions: [session('t', TODAY, -80)], trades: [] });
    expect(bornesFromStores().loss).toMatchObject({ value: 80, limit: null, consumed: null });
  });

  it('hors séance, la dernière journée est une lecture datée, sans alerte', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: APEX, traderRules: { ...RULES, maxDailyLoss: 50 } } });
    useJournal.setState({ sessions: [session('s', '2026-10-23', -300, 2)], trades: [] });
    const b = bornesFromStores();
    expect(b.day).toMatchObject({ key: '2026-10-23', today: false, live: false, ageMs: null });
    expect(b.loss).toMatchObject({ value: 300, level: 0 });
    expect(calendarSourcesState([], undefined, 0)).toBe('offline');
  });
});

/* ─── Un seul rejeu : le crochet, un journal de 5 000 trades ─── */

function bigJournal(): { sessions: Session[]; trades: Trade[] } {
  const days: string[] = [];
  for (let t = Date.parse(`${TODAY}T12:00:00Z`); days.length < 1_000; t -= 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) days.unshift(new Date(t).toISOString().slice(0, 10));
  }
  const sessions: Session[] = [];
  const trades: Trade[] = [];
  days.forEach((date, i) => {
    let pnl = 0;
    for (let k = 0; k < 5; k++) {
      const p = (((i * 7 + k * 13) % 9) - 4) * 3;
      pnl += p;
      trades.push(trade(`t${i}-${k}`, `s${i}`, Date.parse(`${date}T14:00:00Z`) + k * 600_000, p));
    }
    sessions.push(session(`s${i}`, date, pnl, 5));
  });
  return { sessions, trades };
}

describe('OROS5.11 · useDayBornes ne rejoue qu’au changement de journal, de plan ou de compte', () => {
  let root: Root | null = null;
  let latest: DayBornes | null = null;
  function Probe() {
    latest = useDayBornes();
    return null;
  }

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('5 000 trades : ni un statut du pont ni un tic de 15 s ne relancent evaluatePlan ni detectRuleBreaches', async () => {
    const journal = bigJournal();
    expect(journal.trades).toHaveLength(5_000);
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: APEX, traderRules: RULES } });
    useJournal.setState(journal);
    useBridge.setState({ nt: nt({}, { [APEX]: -10 }) });
    const evaluate = vi.mocked(evaluatePlan);
    const breaches = vi.mocked(detectRuleBreaches);
    evaluate.mockClear();
    breaches.mockClear();

    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Probe)));
    // un rejeu : le plan sur tout l'historique, la journée lue (son plus-bas), ses écarts
    const replays = { evaluate: evaluate.mock.calls.length, breaches: breaches.mock.calls.length };
    expect(replays.evaluate).toBeGreaterThan(0);
    expect(replays.breaches).toBeGreaterThan(0);
    expect(latest!.day).toMatchObject({ key: TODAY, live: true });
    const first = latest!.margin.value!;

    // trente statuts du pont : le latent et l'âge bougent, le rejeu non
    for (let i = 1; i <= 30; i++) {
      await act(async () => useBridge.setState({ nt: nt({ accountsAt: NOW - (31 - i) * 1_000 }, { [APEX]: -10 - i }) }));
    }
    expect(evaluate.mock.calls.length).toBe(replays.evaluate);
    expect(breaches.mock.calls.length).toBe(replays.breaches);
    expect(latest!.margin.value).toBeCloseTo(first - 30, 9);
    expect(latest!.loss.unrealized).toBe(-40);
    expect(latest!.day.ageMs).toBe(1_000);

    // huit tics de 15 s : l'âge avance, le rejeu non
    const age = latest!.day.ageMs!;
    for (let i = 1; i <= 8; i++) await act(async () => vi.advanceTimersByTime(15_000));
    expect(latest!.day.ageMs).toBe(age + 8 * 15_000);
    expect(evaluate.mock.calls.length).toBe(replays.evaluate);
    expect(breaches.mock.calls.length).toBe(replays.breaches);

    // un changement de journal, de plan, puis de compte : un rejeu chacun
    let before = evaluate.mock.calls.length;
    await act(async () => useJournal.setState({ trades: [...journal.trades, trade('extra', `s${999}`, Date.parse(`${TODAY}T16:00:00Z`), -5)] }));
    expect(evaluate.mock.calls.length).toBeGreaterThan(before);
    before = evaluate.mock.calls.length;
    await act(async () => useSettings.setState({ settings: { ...useSettings.getState().settings, planId: 'apex-100' } }));
    expect(evaluate.mock.calls.length).toBeGreaterThan(before);
    before = evaluate.mock.calls.length;
    const beforeBreaches = breaches.mock.calls.length;
    await act(async () => useSettings.setState({ settings: { ...useSettings.getState().settings, planAccount: '' } }));
    expect(evaluate.mock.calls.length).toBeGreaterThan(before);
    expect(breaches.mock.calls.length).toBeGreaterThan(beforeBreaches);
  });
});
