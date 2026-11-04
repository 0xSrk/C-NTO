/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

// Le canevas n'existe pas sous jsdom : lightweight-charts est remplacé par un enregistreur des traits et de leurs options.
const charts = vi.hoisted(() => ({ series: [] as { kind: string; options: Record<string, unknown> }[] }));
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
    createChart: () => ({
      addCustomSeries: (view: { constructor: { name: string }; defaultOptions: () => Record<string, unknown> }, options: Record<string, unknown>) => {
        const series = { kind: view.constructor.name, options: merge({ ...view.defaultOptions() }, options) };
        charts.series.push(series);
        return { setData: () => undefined, applyOptions: (next: Record<string, unknown>) => void merge(series.options, next) };
      },
      panes: () => [0, 1, 2].map(() => ({ setHeight: () => undefined })),
      subscribeCrosshairMove: () => undefined,
      subscribeClick: () => undefined,
      timeScale: () => ({ fitContent: () => undefined, getVisibleLogicalRange: () => ({ from: 0, to: 10 }), setVisibleLogicalRange: () => undefined, coordinateToLogical: () => 0 }),
      applyOptions: () => undefined,
      remove: () => undefined,
    }),
  };
});

import { ObjectDrawer } from '@/app/objects/Fiche';
import f from '@/app/objects/fiche.module.css';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { equityCurve } from '@/engine/equityCurve';
import { summarizeTrades } from '@/engine/metrics';
import { entityKey, mirror, type EntityRef, type Link } from '@/engine/ontology';
import { OUT_OF_SELECTION, selectJournal, type Selection } from '@/engine/selection';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import d from '@/modules/metrique/dashboard.module.css';
import { EquityTrait, NONE, StemTrait, type EquityRow, type Ink, type TraitOptions } from '@/modules/metrique/equitySeries';
import Metrique from '@/modules/metrique/Metrique';
import m from '@/modules/metrique/metrique.module.css';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.32 — l'ensemble devient une sélection partagée. Le périmètre d'« Autour de… » est fait des puces de Métrique
 * (compte, période, instrument), actives et modifiables sur place ; B · Séances les lit au lieu de « Filtres propres à
 * l'onglet » ; chaque panneau dit n / N ; la puce Instrument recalcule K et A.01, allume ses pas sur A.02 et atténue le
 * reste à 35 %. Rien ne disparaît.
 */

const NOW = Date.parse('2026-10-20T16:00:00Z');
const AS_OF = '2026-10-20';
const APEX = 'Apex-PA-50K';
const CPI = 'bls:cpi-2026-10-14';

const trade = (id: string, sessionId: string, date: string, instrument: string, pnl: number, account = APEX): Trade => {
  const entryTime = Date.parse(`${date}T14:00:00Z`) + Number(id.slice(1)) * 60_000;
  return { id, sessionId, instrument, account, direction: 'long', qty: 1, entryTime, exitTime: entryTime + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 };
};
const session = (id: string, date: string, trades: Trade[], account = APEX): Session => ({ id, date, account, source: 'ninjatrader', tags: [], createdAt: 0, updatedAt: 0, ...summarizeTrades(trades) });

/** Six séances : cinq dans les trente jours (deux instruments, deux comptes), une en août. */
const T = {
  s1: [trade('t1', 's1', '2026-10-06', 'NQ', 200), trade('t2', 's1', '2026-10-06', 'ES', -50)],
  s2: [trade('t3', 's2', '2026-10-08', 'NQ', -100)],
  s3: [trade('t4', 's3', '2026-10-12', 'ES', 80, 'Sim101')],
  s4: [trade('t5', 's4', '2026-10-14', 'NQ', 150), trade('t6', 's4', '2026-10-14', 'NQ', -30)],
  s5: [trade('t7', 's5', '2026-10-16', 'ES', -40)],
  s6: [trade('t8', 's6', '2026-08-03', 'NQ', 60)],
};
const SESSIONS = [session('s1', '2026-10-06', T.s1), session('s2', '2026-10-08', T.s2), session('s3', '2026-10-12', T.s3, 'Sim101'), session('s4', '2026-10-14', T.s4), session('s5', '2026-10-16', T.s5), session('s6', '2026-08-03', T.s6)];
const TRADES = Object.values(T).flat();

const link = (from: EntityRef, predicate: Link['predicate'], to: EntityRef): Link => ({ id: `${entityKey(from)}|${predicate}|${entityKey(to)}`, from, to, predicate, kind: 'structurel', by: 'moteur', createdAt: 0, updatedAt: 0 });
const LINKS: Link[] = (['s3', 's4', 's6'] as const).map((id) => link({ type: 'session', id }, 'pendant', { type: 'evenement', id: CPI }));

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: Parameters<Root['render']>[0]): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** Change une liste comme le geste de l'opérateur. */
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const counts = (node: ParentNode) => [...node.querySelectorAll<HTMLElement>('[data-count]')].map((el) => el.dataset.count);
const opacity = (file: string, selector: string) => cssRules(readFileSync(file, 'utf8')).find((rule) => rule.selector === selector && rule.at.length === 0)?.body ?? '';
const size = { clientWidth: 800, clientHeight: 300 };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const [key, value] of Object.entries(size)) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  charts.series.length = 0;
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique', metricAccount: null, metricRange: '30j', metricInstrument: null });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: SESSIONS, trades: TRADES });
  useNotes.setState({ notes: [] });
  useMacro.setState({ events: [{ id: CPI, sourceId: 'bls', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 } as CalendarEventRow], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links: LINKS });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const key of Object.keys(size)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OROS5.32 l’ensemble ouvert par « Autour de… » porte ses puces', () => {
  it('compte, période et instrument : actives, modifiables sur place, partagées ; n / N exacts, le reste à 35 %', async () => {
    const node = await mount(createElement(ObjectDrawer));
    act(() => void useObjects.getState().openObject({ type: 'session', id: 's4' }));
    const around = () => node.querySelector<HTMLElement>('aside[data-drawer] [data-section="around"]')!;
    const follow = (id: string) => act(() => around().querySelector<HTMLButtonElement>(`[data-predicate="${id}"]`)!.click());
    // un ensemble de catalyseurs n'a pas de périmètre de journal : ni puces ni n / N
    follow('out:pendant:evenement');
    expect(around().querySelector('[data-selection]')).toBeNull();
    follow('in:pendant:session');
    expect(useObjects.getState().set?.members.map((x) => x.id)).toEqual(['s6', 's3', 's4']);

    // le périmètre n'est plus un texte : trois puces, les listes de la sélection partagée, actives
    const head = around().querySelector<HTMLElement>('[data-selection]')!;
    expect(head).not.toBeNull();
    const chip = (name: string) => head.querySelector<HTMLSelectElement>(`[data-chip="${name}"] select`)!;
    expect([...head.querySelectorAll<HTMLElement>('[data-chip]')].map((el) => el.dataset.chip)).toEqual(['account', 'range', 'instrument']);
    for (const name of ['account', 'range', 'instrument']) expect(chip(name).disabled, name).toBe(false);
    expect([chip('account').value, chip('range').value, chip('instrument').value]).toEqual(['', '30j', '']);
    expect([...chip('account').options].map((o) => o.value)).toEqual(['', APEX, 'Sim101']);
    expect([...chip('instrument').options].map((o) => o.value)).toEqual(['', 'ES', 'NQ']);

    const members = () => [...around().querySelectorAll<HTMLElement>('[data-member]')];
    const lit = () => members().filter((row) => !row.hasAttribute('data-out')).map((row) => row.dataset.member);
    const state = (): Selection => ({ account: useUi.getState().metricAccount, range: useUi.getState().metricRange, instrument: useUi.getState().metricInstrument });
    // trente jours : la séance d'août sort, atténuée, et reste à sa place
    expect(counts(head)).toEqual(['2/3']);
    expect(head.querySelector('[data-count]')!.textContent).toBe('2 / 3 séances');
    expect(lit()).toEqual(['session:s3', 'session:s4']);
    expect(members()).toHaveLength(3);
    const out = members().find((row) => row.dataset.member === 'session:s6')!;
    expect(out.classList.contains(f.out!)).toBe(true);

    // la puce Instrument, changée sur place : le store la porte, partout
    choose(chip('instrument'), 'NQ');
    expect(state()).toEqual({ account: null, range: '30j', instrument: 'NQ' });
    expect(counts(around())).toEqual(['1/3']);
    expect(lit()).toEqual(['session:s4']);
    expect(members()).toHaveLength(3);
    // la période : tout l'historique
    choose(chip('range'), 'tout');
    expect(state().range).toBe('tout');
    expect(counts(around())).toEqual(['2/3']);
    expect(lit()).toEqual(['session:s6', 'session:s4']);
    // M.036 lit l'ensemble face au reste du périmètre (compte, période, instrument), par le moteur
    const perimeter = selectJournal(SESSIONS, TRADES, state(), AS_OF);
    const reading = mirror(perimeter.sessions, perimeter.trades, new Set(['s6', 's3', 's4']));
    expect([reading.inside.sessions, reading.outside.sessions]).toEqual([2, 2]);
    const m036 = around().querySelector('[data-figure="M.036"]')!;
    expect(m036.querySelector('[data-mirror="sessions"]')!.textContent).toBe(`${reading.inside.sessions}Séances${reading.outside.sessions}`);
    expect(m036.querySelector('[data-mirror="trades"]')!.textContent).toBe(`${reading.inside.trades}Trades${reading.outside.trades}`);
    // le compte
    choose(chip('account'), 'Sim101');
    expect(state().account).toBe('Sim101');
    expect(counts(around())).toEqual(['0/3']);
    choose(chip('instrument'), '');
    expect(counts(around())).toEqual(['1/3']);
    expect(lit()).toEqual(['session:s3']);
    // partagée : une puce posée ailleurs (Métrique) se lit ici
    act(() => useUi.setState({ metricAccount: null, metricInstrument: 'ES' }));
    expect([chip('account').value, chip('range').value, chip('instrument').value]).toEqual(['', 'tout', 'ES']);
    expect(lit()).toEqual(['session:s3']);
    // l'ensemble lui-même ne change pas : rien n'est écrit, rien ne disparaît
    expect(useObjects.getState().set?.members.map((x) => x.id)).toEqual(['s6', 's3', 's4']);
  });
});

describe('OROS5.32 Métrique lit la sélection partagée : n / N dans chaque panneau, le reste à 35 %', () => {
  it('la puce Instrument recalcule K et A.01, allume ses pas sur A.02, atténue A.03 et A.04 ; B · Séances la lit', async () => {
    const node = await mount(createElement(Metrique));
    // trente jours, tous comptes, tous instruments : n = N
    expect(counts(node)).toEqual(['7/7', '5/5', '7/7', '5/5']);
    const header = node.querySelector<HTMLSelectElement>('[data-chip="instrument"] select')!;
    expect([...header.options].map((o) => o.value)).toEqual(['', 'ES', 'NQ']);
    const k02 = () => node.querySelector<HTMLElement>('[data-k="K.02"]')!.textContent ?? '';
    // Le total se dit une fois, en tête de la bande K, et K.02 ses gagnants (OROS5.34).
    const band = () => node.querySelector<HTMLElement>('[data-sample="band"]')!.textContent ?? '';
    expect(k02()).toContain('3 gagnants');
    expect(band()).toContain('n = 7 trades');

    // A.03 pose la puce Instrument
    act(() => node.querySelector<HTMLButtonElement>('[data-instrument="NQ"]')!.click());
    expect(useUi.getState().metricInstrument).toBe('NQ');
    expect(header.value).toBe('NQ');
    // K et A.01 sur la part NQ : quatre trades, deux gagnants ; A.01 dit 4 / 7 trades
    expect(k02()).toContain('2 gagnants');
    expect(band()).toContain('n = 4 trades');
    expect(k02()).toMatch(/50,0\s?%/);
    expect(counts(node)).toEqual(['4/7', '3/5', '4/7', '3/5']);
    expect([...node.querySelectorAll<HTMLElement>('[data-count]')].map((el) => el.textContent)).toEqual(['4 / 7 trades', '3 / 5 séances', '4 / 7 trades', '3 / 5 séances']);
    // A.03 : rien ne disparaît ; l'autre instrument reste, atténué
    const rows = [...node.querySelectorAll<HTMLElement>('[data-instrument]')];
    expect(rows.map((row) => [row.dataset.instrument, row.getAttribute('aria-pressed'), row.hasAttribute('data-out')])).toEqual([
      ['NQ', 'true', false],
      ['ES', 'false', true],
    ]);
    expect(rows[1]!.classList.contains(d.out!)).toBe(true);
    // A.04 : ses cinq séances, celles sans NQ atténuées
    const a04 = [...node.querySelectorAll<HTMLElement>('tr[data-session]')];
    expect(a04.map((row) => row.dataset.session)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(a04.filter((row) => row.hasAttribute('data-out')).map((row) => row.dataset.session)).toEqual(['s5', 's3']);
    for (const row of a04.filter((r) => r.hasAttribute('data-out'))) expect(row.classList.contains(d.out!)).toBe(true);
    // A.02 garde la courbe du compte et de la période, et allume les journées NQ : 06, 08 et 14 octobre
    const equity = charts.series.find((row) => row.kind === 'EquityTrait')!.options;
    expect(equity.selecting).toBe(true);
    const curve = equityCurve(selectJournal(SESSIONS, TRADES, { account: null, range: '30j', instrument: null }, AS_OF).sessions, TRADES, 'session');
    const on = curve.steps.map((_, i) => (equity.inSelection as (i: number) => boolean)(i));
    expect(curve.steps.filter((_, i) => on[i]).map((step) => step.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-14']);
    expect(charts.series.find((row) => row.kind === 'StemTrait')!.options.selecting).toBe(true);

    // B · Séances : plus de « Filtres propres à l'onglet » ; la sélection s'y lit, rien n'y disparaît
    act(() => useObjects.getState().setView('metrique', 'seances'));
    expect(node.textContent).not.toContain('Filtres propres');
    expect(counts(node)).toEqual(['3/6']);
    const listed = [...node.querySelectorAll<HTMLElement>('tbody tr.clickable')];
    expect(listed).toHaveLength(6);
    expect(listed.filter((row) => row.hasAttribute('data-out'))).toHaveLength(3);
    for (const row of listed.filter((r) => r.hasAttribute('data-out'))) expect(row.classList.contains(m.rowOut!)).toBe(true);
    // la période de l'en-tête est la même puce : TOUT rallume la séance NQ d'août
    act(() => [...node.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent === 'TOUT')!.click());
    expect(useUi.getState().metricRange).toBe('tout');
    expect(counts(node)).toEqual(['4/6']);
    // le clic sur une ligne garde l'édition (le panneau de détail), atténuée ou non
    act(() => listed.find((row) => row.hasAttribute('data-out'))!.click());
    expect(node.textContent).not.toContain('sélectionnez une séance');
  });

  it('35 % hors sélection : la même atténuation partout, et sur le trait de A.02', () => {
    expect(OUT_OF_SELECTION).toBe(0.35);
    expect(opacity('src/app/objects/fiche.module.css', '.out')).toMatch(/opacity: 0\.35;/);
    expect(opacity('src/modules/metrique/dashboard.module.css', '.out')).toMatch(/opacity: 0\.35;/);
    expect(opacity('src/modules/metrique/metrique.module.css', '.rowOut td')).toMatch(/opacity: 0\.35;/);
  });
});

describe('OROS5.32 A.02 : les pas de la sélection allumés, le reste atténué à 35 %', () => {
  /** Contexte 2D enregistreur : chaque appel, sa couleur et son opacité. */
  function recorder() {
    const calls: { op: string; args: unknown[]; fill: unknown; alpha: number }[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '' };
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key as string];
        if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
        return (...args: unknown[]) => calls.push({ op: String(key), args, fill: target.fillStyle, alpha: target.globalAlpha as number });
      },
      set(target, key, value) {
        target[key as string] = value;
        return true;
      },
    });
    return { ctx, calls };
  }
  const INK: Ink = { line: '#edebe4', pos: '#74c69d', neg: '#e0735f', red: '#e5263d', faint: '#80858e', label: '#a3a7af', zero: '#33363d', paper: '#14151a', mono: 'monospace' };
  const row = (time: number, equity: number, pnl: number): EquityRow => ({ time: time as EquityRow['time'], equity, peak: Math.max(equity, 0), drawdown: 0, pnl, session: NONE });
  const ROWS = [row(1, 0, 0), row(2, 300, 300), row(3, -100, -400), row(4, 200, 300)];
  function paint(view: EquityTrait | StemTrait, options: Partial<TraitOptions>) {
    const { ctx, calls } = recorder();
    view.update({ bars: ROWS.map((originalData, i) => ({ x: 20 + i * 100, time: i, originalData, barColor: '' })), barSpacing: 100, visibleRange: { from: 0, to: ROWS.length }, conflationFactor: 1 }, { ...view.defaultOptions(), ink: INK, ...options });
    const scope = { context: ctx, bitmapSize: { width: 400, height: 200 }, mediaSize: { width: 400, height: 200 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 };
    view.renderer().draw({ useBitmapCoordinateSpace: (fn: (s: typeof scope) => void) => fn(scope), useMediaCoordinateSpace: () => undefined } as never, (price: number) => (100 - price / 5) as never, false);
    return calls;
  }

  beforeEach(() => {
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
      },
    );
  });

  it('le fil d’un pas hors sélection passe à 35 % ; chaque pas de la sélection reçoit son carré', () => {
    const lit = (i: number) => i === 1 || i === 3;
    const stems = (options: Partial<TraitOptions>) => paint(new StemTrait(), options).filter((call) => call.op === 'fillRect' && (call.fill === INK.pos || call.fill === INK.neg));
    // sans puce : chaque fil à 0,78
    expect(new Set(stems({}).map((call) => call.alpha))).toEqual(new Set([0.78]));
    // avec la puce : le pas 2 (hors sélection) à 0,78 × 35 %, les pas 1 et 3 inchangés ; rien ne disparaît
    const selected = stems({ selecting: true, inSelection: lit });
    expect(selected).toHaveLength(6);
    expect(selected.map((call) => Number(call.alpha.toFixed(4)))).toEqual([0.78, 0.78, 0.273, 0.273, 0.78, 0.78]);
    expect(0.78 * OUT_OF_SELECTION).toBeCloseTo(0.273, 6);
    // la courbe : un carré plein sur chaque pas allumé, aucun sans puce
    const squares = (options: Partial<TraitOptions>) => paint(new EquityTrait(), { marks: { high: NONE, highLabel: '', trough: NONE, troughLabel: '' }, ...options }).filter((call) => call.op === 'fillRect' && call.fill === INK.line && call.args[2] === 3 && call.args[3] === 3);
    expect(squares({})).toHaveLength(0);
    // centrés sur les pas 1 et 3 (x = 120 et 320) : un carré de 3 px commence à x − 1,5, arrondi
    expect(squares({ selecting: true, inSelection: lit }).map((call) => call.args[0])).toEqual([Math.round(120 - 1.5), Math.round(320 - 1.5)]);
  });
});
