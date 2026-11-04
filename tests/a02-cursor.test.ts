/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { majorCatalysts } from '@/engine/discipline';
import { equityCurve } from '@/engine/equityCurve';
import { catalystSource } from '@/engine/macroMerge';
import type { Session, Trade } from '@/engine/types';
import { replayDiscipline } from '@/lib/frise';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.36 — A.02 se lie au curseur de temps et aux jeux d'événements (Système 5 « Fiche et Frise » ; repris du prototype
 * C · Frise, d3). Le réticule unique de A.02 s'épingle au pas du curseur ; le survol garde la priorité. Les jeux
 * d'événements s'allument en puces, avec leur n : les catalyseurs majeurs de la source unique (C.090, tiges nommées) et
 * les écarts rejoués (C.024 au pied, ×n). Zoom, molette et double-clic ne changent pas.
 */

interface FakeSeries {
  kind: string;
  options: Record<string, unknown>;
}

interface FakeChart {
  series: FakeSeries[];
  crosshair: ((param: { time?: number; point?: { x: number; y: number }; sourceEvent?: object }) => void) | null;
  /** Les positions posées par le desk (`setCrosshairPosition`), puis `null` à chaque `clearCrosshairPosition`. */
  pinned: ({ price: number; time: number; series: number } | null)[];
  /**
   * La position que la bibliothèque garde (lightweight-charts 5.2.1) : posée par `setCrosshairPosition` sans événement,
   * ou par le pointeur ; effacée par `clearCrosshairPosition` ou quand le pointeur quitte la courbe. Tant qu'elle est là,
   * chaque `applyOptions` d'une série la relance (`updateCrosshair`) : un mouvement avec un point, sans `sourceEvent`.
   */
  saved: number | null;
}

const state = vi.hoisted(() => ({ charts: [] as FakeChart[] }));
vi.mock('lightweight-charts', () => {
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const key of Object.keys(src)) {
      const value = src[key];
      if (value === undefined) continue;
      if (typeof value !== 'object' || dst[key] === undefined || Array.isArray(value)) dst[key] = value;
      else if (value !== null) merge(dst[key] as Record<string, unknown>, value as Record<string, unknown>);
    }
    return dst;
  };
  return {
    customSeriesDefaultOptions: { color: '#000' },
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Magnet: 3 },
    LineStyle: { Dotted: 1, SparseDotted: 4 },
    createChart: () => {
      const chart: FakeChart = { series: [], crosshair: null, pinned: [], saved: null };
      const apis: unknown[] = [];
      state.charts.push(chart);
      return {
        addCustomSeries: (view: { constructor: { name: string }; defaultOptions: () => Record<string, unknown> }, options: Record<string, unknown>) => {
          const series: FakeSeries = { kind: view.constructor.name, options: merge({ ...view.defaultOptions() }, options) };
          chart.series.push(series);
          const api = {
            setData: () => undefined,
            applyOptions: (next: Record<string, unknown>) => {
              merge(series.options, next);
              if (chart.saved !== null) chart.crosshair?.({ time: chart.saved, point: { x: 1, y: 1 } });
            },
          };
          apis.push(api);
          return api;
        },
        panes: () => [0, 1, 2].map(() => ({ setHeight: () => undefined })),
        subscribeCrosshairMove: (cb: FakeChart['crosshair']) => {
          chart.crosshair = cb;
        },
        subscribeClick: () => undefined,
        setCrosshairPosition: (price: number, time: number, api: unknown) => {
          chart.saved = time;
          chart.pinned.push({ price, time, series: apis.indexOf(api) });
        },
        clearCrosshairPosition: () => {
          chart.saved = null;
          chart.pinned.push(null);
        },
        timeScale: () => ({ fitContent: () => undefined, getVisibleLogicalRange: () => ({ from: 0, to: 20 }), setVisibleLogicalRange: () => undefined, coordinateToLogical: () => 10 }),
        applyOptions: () => undefined,
        remove: () => undefined,
      };
    },
  };
});

import { useI18n } from '@/i18n';
import { EquityCard } from '@/modules/metrique/EquityChart';
import { cursorStep, eventMarks } from '@/modules/metrique/equitySeries';
import { useMacro } from '@/store/macro';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

function session(id: string, date: string, pnl: number, tradeCount = 1): Session {
  return { id, date, account: 'Sim101', instruments: ['MNQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, exit: string, pnl: number): Trade {
  const exitTime = Date.parse(exit);
  return { id, sessionId, account: 'Sim101', instrument: 'MNQ', direction: 'long', qty: 1, entryTime: exitTime - 60_000, exitTime, entryPrice: 100, exitPrice: 101, pnl, commission: 0 };
}

const sessions = [session('a', '2026-09-01', 100, 2), session('b', '2026-09-02', 300), session('c', '2026-09-03', -450), session('d', '2026-09-04', 200)];
const trades = [
  trade('t1', 'a', '2026-09-01T13:30:00Z', 40),
  trade('t2', 'a', '2026-09-01T14:00:00Z', 60),
  trade('t3', 'b', '2026-09-02T14:00:00Z', 300),
  trade('t4', 'c', '2026-09-03T14:00:00Z', -450),
  trade('t5', 'd', '2026-09-04T14:00:00Z', 200),
];
/** Une publication officielle, le 2 septembre à 08:30 ET : la source unique la fusionne aux repères locaux. */
const CPI: CalendarEventRow = { id: 'bls:cpi-2026-09-02', sourceId: 'bls', date: '2026-09-02', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 } as CalendarEventRow;
const RULES = { ...DEFAULT_SETTINGS.traderRules, maxTradesPerDay: 1 };

let root: Root | null = null;
let host: HTMLElement | null = null;
const size = { clientWidth: 800, clientHeight: 300 };

async function mount(): Promise<FakeChart> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(EquityCard, { sessions, trades })));
  return state.charts.at(-1)!;
}

const trait = (chart: FakeChart, kind: string) => chart.series.find((row) => row.kind === kind)!;
/** Le pointeur sur un pas : la bibliothèque garde sa position et passe l'événement d'origine. */
const hoverAt = (chart: FakeChart, time: number) => {
  chart.saved = time;
  chart.crosshair!({ time, point: { x: 10, y: 10 }, sourceEvent: {} });
};
/** Le pointeur quitte la courbe : la position gardée s'efface. */
const leave = (chart: FakeChart) => {
  chart.saved = null;
  chart.crosshair!({});
};
const readout = () => host!.querySelector('[aria-live]')!.textContent ?? '';
const chip = (set: 'catalysts' | 'drifts') => host!.querySelector<HTMLButtonElement>(`button[data-event-set="${set}"]`)!;

beforeEach(() => {
  state.charts.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  for (const [key, value] of Object.entries(size)) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  useI18n.setState({ locale: 'fr' });
  useUi.setState({ tab: 'metrique', timeCursor: null });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: RULES, planId: '', planAccount: '' } });
  useMacro.setState({ events: [CPI], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUi.setState({ timeCursor: null });
  for (const key of Object.keys(size)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals();
});

describe('OROS5.36 le réticule de A.02 s’épingle au pas du curseur', () => {
  it('le pas du curseur : la séance de sa journée CME ; au grain trade, le dernier trade sorti avant lui', () => {
    const curve = equityCurve(sessions, trades, 'session');
    expect(cursorStep(curve, null)).toBeNull();
    expect(cursorStep(curve, Date.parse('2026-09-03T14:00:00Z'))).toBe(3);
    // 18:30 ET le 2 : la journée CME du 3 a commencé.
    expect(cursorStep(curve, Date.parse('2026-09-02T22:30:00Z'))).toBe(3);
    // Une journée sans séance : aucun pas.
    expect(cursorStep(curve, Date.parse('2026-09-08T14:00:00Z'))).toBe(-1);
    const byTrade = equityCurve(sessions, trades, 'trade');
    expect(cursorStep(byTrade, Date.parse('2026-09-01T13:45:00Z'))).toBe(1);
    expect(cursorStep(byTrade, Date.parse('2026-09-01T15:00:00Z'))).toBe(2);
    // Avant la première sortie du jour : le premier trade du jour.
    expect(cursorStep(byTrade, Date.parse('2026-09-01T12:00:00Z'))).toBe(1);
  });

  it('le réticule unique se pose sur le pas du curseur, la lecture le dit ; le survol garde la priorité', async () => {
    const chart = await mount();
    const curve = equityCurve(sessions, trades, 'session');
    expect(chart.series.map((row) => row.options.focus)).toEqual([-1, -1, -1]);
    await act(async () => useUi.setState({ timeCursor: Date.parse('2026-09-03T14:00:00Z') }));
    // Un seul réticule : celui de la bibliothèque, posé sur la crête du pas, au trait d'équité.
    expect(chart.pinned.at(-1)).toEqual({ price: curve.steps[3]!.equity, time: curve.steps[3]!.time, series: 0 });
    expect(chart.series.map((row) => row.options.focus)).toEqual([3, 3, 3]);
    expect(readout()).toMatch(/03\/09/);
    expect(readout()).toMatch(/−450,00/);
    expect(host!.querySelector('[data-pinned]')).not.toBeNull();
    // Le survol passe devant : le pas survolé, sans repose du réticule.
    const posed = chart.pinned.length;
    await act(async () => hoverAt(chart, curve.steps[2]!.time));
    expect(chart.series.map((row) => row.options.focus)).toEqual([2, 2, 2]);
    expect(readout()).toMatch(/02\/09/);
    expect(chart.pinned.length).toBe(posed);
    // Le pointeur quitte la courbe : le réticule revient au pas du curseur.
    await act(async () => leave(chart));
    expect(chart.series.map((row) => row.options.focus)).toEqual([3, 3, 3]);
    expect(chart.pinned.at(-1)).toEqual({ price: curve.steps[3]!.equity, time: curve.steps[3]!.time, series: 0 });
    // Le présent : plus de réticule posé, la lecture revient au dernier pas.
    await act(async () => useUi.setState({ timeCursor: null }));
    expect(chart.pinned.at(-1)).toBeNull();
    expect(chart.series.map((row) => row.options.focus)).toEqual([-1, -1, -1]);
    expect(readout()).toMatch(/04\/09/);
  });

  it('OROS5.36b le réticule suit chaque pas du curseur : la position que la bibliothèque relance n’est pas un survol', async () => {
    const chart = await mount();
    const curve = equityCurve(sessions, trades, 'session');
    for (const [at, index, day] of [
      ['2026-09-03T14:00:00Z', 3, /03\/09/],
      ['2026-09-02T14:00:00Z', 2, /02\/09/],
      ['2026-09-01T14:00:00Z', 1, /01\/09/],
      ['2026-09-04T14:00:00Z', 4, /04\/09/],
    ] as const) {
      await act(async () => useUi.setState({ timeCursor: Date.parse(at) }));
      expect(chart.pinned.at(-1)).toEqual({ price: curve.steps[index]!.equity, time: curve.steps[index]!.time, series: 0 });
      expect(chart.series.map((row) => row.options.focus)).toEqual([index, index, index]);
      expect(readout()).toMatch(day);
      // La date tenue garde son or.
      expect(host!.querySelector('[data-pinned]')).not.toBeNull();
    }
    // Une courbe nouvelle (un trade de plus le 4), le curseur au même pas : `draw` remet le focus, l'effet le repose.
    await act(async () => useUi.setState({ timeCursor: Date.parse('2026-09-02T14:00:00Z') }));
    const more = [...sessions.slice(0, 3), session('d', '2026-09-04', 260, 2)];
    await act(async () => root!.render(createElement(EquityCard, { sessions: more, trades: [...trades, trade('t6', 'd', '2026-09-04T15:00:00Z', 60)] })));
    expect(chart.series.map((row) => row.options.focus)).toEqual([2, 2, 2]);
    expect(host!.querySelector('[data-pinned]')).not.toBeNull();
  });

  it('un curseur sur une journée sans séance : ni réticule ni pas, la lecture le dit', async () => {
    const chart = await mount();
    await act(async () => useUi.setState({ timeCursor: Date.parse('2026-09-08T14:00:00Z') }));
    expect(chart.pinned.at(-1)).toBeNull();
    expect(chart.series.map((row) => row.options.focus)).toEqual([-1, -1, -1]);
    expect(readout()).toMatch(/hors période/);
  });
});

describe('OROS5.36 les jeux d’événements s’allument en puces, avec leur n', () => {
  it('catalyseurs et écarts : leur n exact, la source unique et le rejeu de la frise ; éteints, rien n’est peint', async () => {
    const chart = await mount();
    const curve = equityCurve(sessions, trades, 'session');
    const days = new Set(curve.steps.filter((s) => !s.origin).map((s) => s.date));
    // Ce que la courbe porte : les catalyseurs majeurs (impact 3, à l'heure) d'une journée de la courbe, et les écarts rejoués.
    const catalysts = majorCatalysts(catalystSource([CPI], [2026])).filter((c) => days.has(c.date));
    const findings = replayDiscipline(trades, catalystSource([CPI], [2026]), RULES, null, '');
    expect(catalysts.some((c) => c.title === 'Inflation CPI' && c.date === '2026-09-02')).toBe(true);
    expect(findings.some((f) => f.kind === 'over_max_trades' && f.day === '2026-09-01')).toBe(true);
    expect(chip('catalysts').textContent).toContain(`Catalyseurs ${catalysts.length}`);
    expect(chip('drifts').textContent).toContain(`Écarts ${findings.length}`);
    // Éteints au départ : la courbe reste celle d'avant.
    expect([chip('catalysts'), chip('drifts')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    const events = () => trait(chart, 'EquityTrait').options.events as ReturnType<typeof eventMarks>;
    expect(events()).toEqual({ catalysts: [], drifts: [] });
    await act(async () => chip('catalysts').click());
    expect(chip('catalysts').getAttribute('aria-pressed')).toBe('true');
    expect(events().catalysts.reduce((n, m) => n + m.count, 0)).toBe(catalysts.length);
    // La tige du CPI, nommée, au pas du 2 septembre.
    expect(events().catalysts.find((m) => m.index === 2)?.label).toMatch(/CPI/);
    expect(events().drifts).toEqual([]);
    await act(async () => chip('drifts').click());
    expect(events().drifts.reduce((n, m) => n + m.count, 0)).toBe(findings.length);
    // Au pied du pas du 1er septembre : le deuxième trade du jour dépasse le maximum.
    expect(events().drifts.find((m) => m.index === 1)?.count).toBeGreaterThanOrEqual(1);
    await act(async () => chip('catalysts').click());
    expect(events().catalysts).toEqual([]);
  });

  it('au grain trade, les marques suivent le trade : l’écart au trade qu’il marque, le catalyseur au premier trade sorti après lui', () => {
    const byTrade = equityCurve(sessions, trades, 'trade');
    const events = catalystSource([CPI], [2026]);
    const findings = replayDiscipline(trades, events, RULES, null, '');
    const marks = eventMarks(byTrade, { catalysts: majorCatalysts(events), findings, trades });
    const over = findings.find((f) => f.kind === 'over_max_trades')!;
    const step = byTrade.steps.findIndex((s) => s.at === trades.find((t) => t.id === over.entryId)!.exitTime);
    expect(marks.drifts.some((m) => m.index === step)).toBe(true);
    // Le CPI du 2 à 08:30 ET (12:30 UTC) : le trade du 2, sorti à 14:00 UTC.
    expect(marks.catalysts.find((m) => /CPI/.test(m.label))?.index).toBe(byTrade.steps.findIndex((s) => s.at === Date.parse('2026-09-02T14:00:00Z')));
  });

  it('OROS5.36a un estimé local se nomme « ≈ » sur sa tige et dans la lecture ; la publication officielle du même mois, sans', async () => {
    // Juillet 2026 : le CPI local tombe le 2e mercredi (le 8, estimé) ; la publication officielle du BLS, le 14. Pas le
    // même jour : la source unique garde les deux, l'estimé marqué (décision 13).
    const july = [session('j1', '2026-07-08', 120), session('j2', '2026-07-14', -80)];
    const julyTrades = [trade('u1', 'j1', '2026-07-08T14:00:00Z', 120), trade('u2', 'j2', '2026-07-14T14:00:00Z', -80)];
    const official: CalendarEventRow = { ...CPI, id: 'bls:cpi-2026-07-14', date: '2026-07-14' };
    const majors = majorCatalysts(catalystSource([official], [2026]));
    expect(majors.filter((c) => c.date === '2026-07-08' || c.date === '2026-07-14').map((c) => [c.date, c.estimated === true])).toEqual([
      ['2026-07-08', true],
      ['2026-07-14', false],
    ]);
    const marks = eventMarks(equityCurve(july, julyTrades, 'session'), { catalysts: majors, findings: [], trades: julyTrades });
    expect(marks.catalysts).toEqual([
      { index: 1, label: '≈ Inflation CPI', count: 1 },
      { index: 2, label: 'Inflation CPI', count: 1 },
    ]);
    // La lecture du pas tenu par le curseur le dit aussi.
    useMacro.setState({ events: [official] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(EquityCard, { sessions: july, trades: julyTrades })));
    await act(async () => chip('catalysts').click());
    await act(async () => useUi.setState({ timeCursor: Date.parse('2026-07-08T15:00:00Z') }));
    expect(readout()).toMatch(/08\/07 · ≈ Inflation CPI/);
    await act(async () => useUi.setState({ timeCursor: Date.parse('2026-07-14T15:00:00Z') }));
    expect(readout()).toMatch(/14\/07 · Inflation CPI/);
  });

  it('zoom, molette et double-clic ne changent pas', async () => {
    await mount();
    const el = host!.querySelector('[role="img"]')!;
    const plain = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    el.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const zoom = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
  });
});

describe('OROS5.45m les tiges de A.02 s’atteignent au clavier et ouvrent leur catalyseur', () => {
  it('la puce Catalyseurs allumée, chaque catalyseur d’une tige est un bouton hors de la toile, qui ouvre sa fiche', async () => {
    const opened: { id: string; origin: HTMLElement | null }[] = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(EquityCard, { sessions, trades, onCatalyst: (id: string, origin: HTMLElement | null) => opened.push({ id, origin }) })));
    // éteinte, aucune liste : la courbe reste la même tant qu'on n'allume rien
    expect(host.querySelector('[data-stems]')).toBeNull();
    await act(async () => chip('catalysts').click());
    const list = host.querySelector<HTMLElement>('[data-stems]')!;
    expect(list).not.toBeNull();
    expect(list.getAttribute('aria-label')).toBe('Catalyseurs de la courbe');
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Inflation CPI · 02.09']);
    // au clavier : un bouton, dans l'ordre de tabulation, hors de la toile (role="img")
    expect(buttons[0]!.closest('[role="img"]')).toBeNull();
    expect(buttons[0]!.tabIndex).toBe(0);
    await act(async () => buttons[0]!.click());
    expect(opened).toEqual([{ id: CPI.id, origin: buttons[0] }]);
    // en trois langues
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(host.querySelector('[data-stems]')!.getAttribute('aria-label')).toBe('Catalysts on the curve');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(host.querySelector('[data-stems]')!.getAttribute('aria-label')).toBe('Catalizadores de la curva');
    // éteinte de nouveau, la liste s'en va
    await act(async () => chip('catalysts').click());
    expect(host.querySelector('[data-stems]')).toBeNull();
  });
});
