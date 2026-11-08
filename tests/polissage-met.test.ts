/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, Suspense, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import p from '@/design/primitives.module.css';
import type { Bar } from '@/engine/bars';
import type { IndicatorLine } from '@/engine/indicators';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import m from '@/modules/metrique/metrique.module.css';
import { cssRules, HOVER_LIGHT, hoverOffenses } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// POL6.1 : le tirage reste en cours tant que le test le veut (sans Worker, `monteCarloOffthread` appelle `monteCarlo`).
vi.mock('@/engine/montecarlo', async (orig) => ({ ...(await orig<typeof import('@/engine/montecarlo')>()), monteCarlo: () => new Promise(() => undefined) }));

// POL6.4 : ce qui se calcule derrière l'onglet ou la période suspend sans fin ; un rendu urgent qui le calculerait
// remplacerait la vue par le repli de Suspense, un rendu différé garde l'ancienne vue à l'écran.
const { never } = vi.hoisted(() => ({
  never: (): never => {
    throw new Promise(() => undefined);
  },
}));
vi.mock('@/modules/metrique/Analyse', () => ({ Analyse: never }));
vi.mock('@/modules/metrique/Dashboard', async () => {
  const { createElement: h } = await import('react');
  return { Dashboard: ({ range }: { range: string }) => (range === '30j' ? h('p', { 'data-dash': range }) : never()) };
});
vi.mock('@/engine/selection', async (orig) => {
  const real = await orig<typeof import('@/engine/selection')>();
  return { ...real, selectionIndex: (...args: Parameters<typeof real.selectionIndex>) => (args[2].range === '30j' ? real.selectionIndex(...args) : never()) };
});

// POL6.5 : le canevas n'existe pas sous jsdom ; lightweight-charts est remplacé par un graphique qui garde l'écouteur du
// réticule, et le cadre est déclaré prêt (comme tests/crypto-chart-live.test.ts).
const chartCalls = vi.hoisted(() => ({ move: null as null | ((param: unknown) => void) }));
vi.mock('lightweight-charts', () => {
  const series = () => ({ setData: () => undefined, update: () => undefined, applyOptions: () => undefined, createPriceLine: () => ({ applyOptions: () => undefined }), removePriceLine: () => undefined });
  return {
    CandlestickSeries: 'Candlestick',
    HistogramSeries: 'Histogram',
    LineSeries: 'Line',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    createSeriesMarkers: () => ({ setMarkers: () => undefined }),
    createChart: () => ({
      addSeries: series,
      panes: () => [{ setHeight: () => undefined }, { setHeight: () => undefined }],
      subscribeCrosshairMove: (fn: (param: unknown) => void) => {
        chartCalls.move = fn;
      },
      timeScale: () => ({ fitContent: () => undefined, setVisibleLogicalRange: () => undefined }),
      applyOptions: () => undefined,
      removeSeries: () => undefined,
      remove: () => undefined,
    }),
  };
});
vi.mock('@/modules/visual/chartBox', () => ({ chartHostReady: () => true, safePaneHeight: (requested: number) => requested }));

import Metrique from '@/modules/metrique/Metrique';
import { MonteCarloView } from '@/modules/metrique/MonteCarloView';
import { Chart } from '@/modules/visual/Chart';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function mount(element: ReactElement): HTMLDivElement {
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

const sheet = (path: string) => cssRules(readFileSync(path, 'utf8'));
/** La règle de premier niveau (hors de tout bloc @) qui porte exactement ce sélecteur. */
const top = (path: string, selector: string) => sheet(path).find((rule) => rule.selector === selector && rule.at.length === 0);

const session = (i: number): Session => ({
  id: `s${i}`,
  date: `2026-10-${String(10 + i).padStart(2, '0')}`,
  account: 'Sim101',
  instruments: ['NQ'],
  source: 'manuel',
  tradeCount: 3,
  pnl: i % 2 ? 420 : -260,
  grossProfit: 600,
  grossLoss: -300,
  commission: 6,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

describe('POL6 Métrique et Visual : la dynamique se polit, le repos ne bouge pas', () => {
  it('POL6.1 Monte-Carlo : un tirage court ne fait rien clignoter, un tirage long court sur le filet de l’en-tête sans rien pousser', () => {
    vi.useFakeTimers();
    const sessions = Array.from({ length: 8 }, (_, i) => session(i));
    const node = mount(createElement(MonteCarloView, { scope: { sessions, trades: [], account: 'Sim101', ignores: [], needsAccount: false } }));
    const cancel = () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Annuler') ?? null;
    // Sous --t-fast (120 ms), le calcul ne se montre pas : ni barre, ni « Annuler ».
    expect(node.querySelector(`.${p.progress}`)).toBeNull();
    expect(cancel()).toBeNull();
    act(() => vi.advanceTimersByTime(130));
    // Au-delà, la barre sort du flux des paramètres : elle se pose sur le filet de l'en-tête, dans son enveloppe.
    const bar = node.querySelector(`.${p.progress}`);
    expect(bar).not.toBeNull();
    expect(bar!.closest(`.${m.rows}`)).toBeNull();
    expect(bar!.parentElement!.classList.contains(m.mcBusy!)).toBe(true);
    // « Annuler » paraît et garde la hauteur de l'en-tête.
    expect(cancel()?.classList.contains(m.mcCancel!)).toBe(true);
    const sheetPath = 'src/modules/metrique/metrique.module.css';
    expect(top(sheetPath, '.mcBusy')?.body).toMatch(/position:\s*absolute/);
    expect(top(sheetPath, '.mcBusy')?.body).toMatch(/margin-top:\s*-21px/);
    expect(top(sheetPath, '.mcCancel')?.body).toMatch(/margin-block:\s*-5px/);
    // Annuler : la barre et le bouton partent ensemble, dans le même rendu.
    act(() => cancel()!.click());
    expect(node.querySelector(`.${p.progress}`)).toBeNull();
    expect(cancel()).toBeNull();
  });

  it('POL6.2 ce qui s’atténue revient comme il est parti : la transition vit sur la ligne, la cellule et la carte, pas sur l’état', () => {
    const fade = /transition:[^;]*\bopacity 220ms linear/;
    // A.04 : la ligne hors sélection (`.out`, sur le `tr`) ; B · Séances : ses cellules (`.rowOut td`) ; la carte d'un
    // indicateur éteint (`.indicator.off`), dans Visual comme dans Crypto.
    expect(top('src/modules/metrique/dashboard.module.css', '.objRow')?.body).toMatch(fade);
    expect(top('src/modules/metrique/metrique.module.css', '.grilleTable td')?.body).toMatch(fade);
    expect(top('src/modules/visual/visual.module.css', '.indicator')?.body).toMatch(fade);
    // Les états gardent leur valeur : 35 % hors sélection (OROS5.32), 50 % pour l'indicateur éteint.
    expect(top('src/modules/metrique/dashboard.module.css', '.out')?.body).toMatch(/opacity:\s*0\.35/);
    expect(top('src/modules/metrique/metrique.module.css', '.rowOut td')?.body).toMatch(/opacity:\s*0\.35/);
    expect(top('src/modules/visual/visual.module.css', '.indicator.off')?.body).toMatch(/opacity:\s*0\.5\b/);
  });

  it('POL6.3 ce qui se clique s’éclaire au passage du pointeur : « Les N séances », les lignes de B · Séances, le catalogue et le × des indicateurs', () => {
    const DASH = 'src/modules/metrique/dashboard.module.css';
    const MET = 'src/modules/metrique/metrique.module.css';
    const VIS = 'src/modules/visual/visual.module.css';
    const lit = (path: string, base: string) =>
      sheet(path).filter((rule) => rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head)) && rule.selector.split(',').some((part) => part.trim().startsWith(base) && part.includes(':hover')));
    for (const [path, base, light] of [
      [DASH, '.more', /color:\s*var\(--text-0\)/],
      [MET, '.grilleTable tbody tr', /background-color:\s*color-mix\(in srgb, var\(--ivory\) 2\.5%, transparent\)/],
      [VIS, '.catalogItem', /border-color:\s*var\(--line-2\)/],
      [VIS, '.catalogItem', /color:\s*var\(--text-0\)/],
      [VIS, '.indicatorHead > button:last-child', /color:\s*var\(--text-0\)/],
    ] as const) {
      const rules = lit(path, base);
      expect(rules.length, `${path} › ${base}:hover`).toBeGreaterThan(0);
      expect(rules.some((rule) => light.test(rule.body)), `${path} › ${base}:hover ${light}`).toBe(true);
      // De la lumière seulement, et jamais d'or.
      for (const rule of rules) {
        for (const prop of rule.props) expect(HOVER_LIGHT.has(prop), `${rule.selector} : ${prop}`).toBe(true);
        expect(rule.body).not.toMatch(/--gold/);
      }
      expect(hoverOffenses(readFileSync(path, 'utf8')).offenders).toEqual([]);
    }
    // La lumière d'une ligne de B · Séances laisse leur teinte à la ligne cochée et à la ligne choisie.
    const row = lit(MET, '.grilleTable tbody tr')[0]!.selector;
    expect(row).toContain(':not(.rowChecked)');
    expect(row).toContain(':not(:global(.selected))');
    // Elle monte au pas de A.04 ; la règle qui la porte vient après `.rowOut td`, qui ne l'écrase donc pas.
    expect(top(MET, '.grilleTable td')?.body).toMatch(/transition:[^;]*\bbackground-color 200ms linear/);
    expect(top(MET, '.grilleTable td')?.body).toMatch(/transition:[^;]*\bopacity 220ms linear/);
    const order = sheet(MET).map((rule) => (rule.at.length === 0 ? rule.selector : ''));
    expect(order.lastIndexOf('.grilleTable td')).toBeGreaterThan(order.lastIndexOf('.rowOut td'));
    // L'encre monte en 200 ms, un contour en 260 ms (la lumière d'un bouton de la maison, `.btn`).
    expect(top(DASH, '.more')?.body).toMatch(/transition:\s*color 200ms linear/);
    expect(top(VIS, '.catalogItem')?.body).toMatch(/transition:[^;]*\bcolor 200ms linear/);
    expect(top(VIS, '.catalogItem')?.body).toMatch(/transition:[^;]*\bborder-color 260ms var\(--ease-out\)/);
    expect(top(VIS, '.indicatorHead > button:last-child')?.body).toMatch(/transition:\s*color 200ms linear/);
  });

  it('POL6.4 le sous-onglet et la période s’allument au geste ; ce qu’ils ouvrent se calcule derrière, sans repli', () => {
    useUi.setState({ metricRange: '30j', metricAccount: null, metricInstrument: null, metricHour: null });
    act(() => useObjects.getState().setView('metrique', 'bord'));
    const node = mount(createElement(Suspense, { fallback: createElement('p', { 'data-fallback': '' }) }, createElement(Metrique)));
    const tab = (letter: string) => [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.querySelector('i')?.textContent === letter)!;
    const period = (label: string) => [...node.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent === label)!;
    const fallback = () => node.querySelector('[data-fallback]');
    expect(node.querySelector('[data-dash]')?.getAttribute('data-dash')).toBe('30j');
    // C · Analyse : l'onglet s'allume aussitôt ; la vue qu'il ouvre se calcule derrière, A reste à l'écran entre-temps.
    act(() => tab('C').click());
    expect(tab('C').getAttribute('aria-selected')).toBe('true');
    expect(fallback()).toBeNull();
    expect(node.querySelector('[data-dash]')).not.toBeNull();
    // Retour à A, puis 90J : la période s'allume aussitôt, A garde ses 30 jours tant que les 90 se calculent.
    act(() => tab('A').click());
    act(() => period('90J').click());
    expect(period('90J').getAttribute('aria-pressed')).toBe('true');
    expect(fallback()).toBeNull();
    expect(node.querySelector('[data-dash]')?.getAttribute('data-dash')).toBe('30j');
    // B · Séances lit la période au store : sa grille se recalcule derrière, elle aussi.
    act(() => period('30J').click());
    act(() => tab('B').click());
    expect(node.textContent).toContain('Aucune séance');
    act(() => period('90J').click());
    expect(period('90J').getAttribute('aria-pressed')).toBe('true');
    expect(fallback()).toBeNull();
    expect(node.textContent).toContain('Aucune séance');
  });

  it('POL6.5 Visual : la légende sous le réticule ne se relit qu’à une bougie nouvelle, ou quand la série ou les indicateurs changent', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    try {
      const T0 = 1_791_500_400;
      const bar = (i: number): Bar => ({ time: T0 + i * 300, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 });
      const onHover = vi.fn();
      const show = (bars: Bar[], lines: IndicatorLine[] = []) => act(() => root!.render(createElement(Chart, { bars, timeframe: 5, lines, trades: [], onHover })));
      const bars = [bar(0), bar(1), bar(2)];
      mount(createElement(Chart, { bars, timeframe: 5, lines: [], trades: [], onHover }));
      const at = (time?: number) => act(() => chartCalls.move!({ time, point: time === undefined ? undefined : { x: 10, y: 10 }, seriesData: new Map() }));
      // Trois pixels dans la même bougie : une seule lecture.
      at(T0);
      at(T0);
      at(T0);
      expect(onHover).toHaveBeenCalledTimes(1);
      expect(onHover).toHaveBeenLastCalledWith({ time: T0, bar: bars[0], values: [] });
      // Une bougie nouvelle : une lecture.
      at(T0 + 300);
      expect(onHover).toHaveBeenCalledTimes(2);
      // Le pointeur sort : une seule lecture vide.
      at();
      at();
      expect(onHover).toHaveBeenCalledTimes(3);
      expect(onHover).toHaveBeenLastCalledWith(null);
      // La bougie vivante change sous un pointeur immobile : la légende se relit, à ses nouvelles valeurs.
      at(T0 + 600);
      expect(onHover).toHaveBeenCalledTimes(4);
      const live = [bars[0]!, bars[1]!, { ...bar(2), close: 104 }];
      show(live);
      at(T0 + 600);
      expect(onHover).toHaveBeenCalledTimes(5);
      expect(onHover).toHaveBeenLastCalledWith({ time: T0 + 600, bar: live[2], values: [] });
      // Un indicateur change : la légende se relit aussi.
      show(live, [{ key: 'ema', label: 'EMA 21', color: '#ffffff', pane: 'price', data: [] }]);
      at(T0 + 600);
      expect(onHover).toHaveBeenCalledTimes(6);
      expect(onHover.mock.lastCall?.[0]).toMatchObject({ time: T0 + 600, values: [{ key: 'ema', value: null }] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
