/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bar, BarSeries } from '@/engine/bars';
import type { FeedEvent, HistoryRequest, Nt8Transport } from '@/engine/marketdata';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Pont simulé derrière `window.canto.marketdata`, posé avant tout import (le desk le lit au chargement).
 * Comme l'AddOn 2.2.0 : barres datées à la clôture, en secondes. Un historique peut être retenu (`hold`)
 * pour voir l'écran entre le changement de série et la réponse de NinjaTrader.
 */
const bridge = vi.hoisted(() => {
  const listeners = new Set<(event: FeedEvent) => void>();
  const held = new Map<string, () => void>();
  const state = {
    histories: [] as HistoryRequest[],
    unsubscribed: [] as string[],
    hold: new Set<string>(),
    release(instrument: string) {
      held.get(instrument)?.();
      held.delete(instrument);
    },
  };
  const bars = (req: HistoryRequest): Bar[] =>
    Array.from({ length: 6 }, (_, i) => {
      const close = Math.floor(req.to / (req.timeframe * 60)) * req.timeframe * 60 - i * req.timeframe * 60;
      return { time: close, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 };
    }).reverse();
  const transport: Nt8Transport = {
    async history(req) {
      state.histories.push({ ...req });
      const answer = { ok: true as const, bars: bars(req) };
      if (!state.hold.has(req.instrument)) return answer;
      return new Promise((resolve) => held.set(req.instrument, () => resolve(answer)));
    },
    async subscribe(req) {
      return { ok: true, subscriptionId: `${req.instrument}|${req.timeframe}` };
    },
    async unsubscribe(id) {
      state.unsubscribed.push(id);
      return { ok: true };
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  (window as unknown as { canto: unknown }).canto = { marketdata: transport };
  return state;
});

/** Le graphique (canevas) est remplacé par un relevé des barres qu'il reçoit. */
const chart = vi.hoisted(() => ({ bars: [] as Bar[][] }));
vi.mock('@/modules/visual/Chart', () => ({
  Chart: (props: { bars: Bar[] }) => {
    chart.bars.push(props.bars);
    return null;
  },
}));

import Visual from '@/modules/visual/Visual';
import { useBars } from '@/store/bars';

const NOW = Date.UTC(2026, 9, 6, 14, 2, 30);
const bar = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close, volume: 1 });
const series = (id: string, instrument: string, timeframe: number, source: BarSeries['source'], close: number): BarSeries => ({
  id,
  instrument,
  timeframe,
  label: `${instrument} · ${timeframe} min · ${id}`,
  source,
  bars: [bar(1_790_000_000, close), bar(1_790_000_000 + timeframe * 60, close)],
  createdAt: 0,
});
const NQ5 = series('nq5', 'NQ', 5, 'demo', 1);
const NQ1 = series('nq1', 'NQ', 1, 'csv', 2);
const ES5 = series('es5', 'ES', 5, 'csv', 3);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function button(node: HTMLElement, text: string): HTMLButtonElement {
  const found = [...node.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`bouton « ${text} » introuvable`);
  return found as HTMLButtonElement;
}

/** Étiquette de source posée sur le graphique (une des trois). */
const STAMPS = ['Données synthétiques · démo', 'Import CSV', 'Données NinjaTrader'];
const stamp = (node: HTMLElement) => [...node.querySelectorAll('span')].map((el) => el.textContent ?? '').find((text) => STAMPS.includes(text)) ?? '';
const labels = (node: HTMLElement) => [...node.querySelectorAll('button')].map((el) => el.textContent ?? '');
const shown = () => chart.bars.at(-1) ?? [];

describe('A13.5 Visual au changement de série', () => {
  it('vide les barres du pont au changement d’unité ou d’instrument, étiquette NinjaTrader, « Ne plus suivre »', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    useBars.setState({ ready: true, series: [NQ5, NQ1, ES5], activeId: 'nq5', indicators: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Visual)));
    const node = host;
    expect(stamp(node)).toBe('Données synthétiques · démo');
    expect(shown()).toEqual(NQ5.bars);

    await act(async () => {
      button(node, 'Suivre le pont').click();
      await flush();
    });
    expect(bridge.histories.map((req) => `${req.instrument}|${req.timeframe}`)).toEqual(['NQ 12-26|5']);
    expect(shown().map((row) => row.close)).toEqual([100.5, 101.5, 102.5, 103.5, 104.5, 105.5].reverse());
    expect.soft(stamp(node)).toBe('Données NinjaTrader');
    expect.soft(labels(node)).toContain('Ne plus suivre');

    // Autre unité : les barres 5 min du pont quittent l'écran avant que NinjaTrader réponde.
    bridge.hold.add('NQ 12-26');
    await act(async () => {
      useBars.setState({ activeId: 'nq1' });
      await flush();
    });
    expect(bridge.histories.map((req) => `${req.instrument}|${req.timeframe}`)).toEqual(['NQ 12-26|5', 'NQ 12-26|1']);
    expect(bridge.unsubscribed).toEqual(['NQ 12-26|5']);
    expect.soft(shown()).toEqual(NQ1.bars);
    await act(async () => {
      bridge.release('NQ 12-26');
      await flush();
    });
    expect(shown()).toHaveLength(6);
    expect.soft(stamp(node)).toBe('Données NinjaTrader');

    // Autre instrument : même chose, le contrat suit la racine.
    bridge.hold.add('ES 12-26');
    await act(async () => {
      useBars.setState({ activeId: 'es5' });
      await flush();
    });
    expect(bridge.histories.at(-1)).toMatchObject({ instrument: 'ES 12-26', timeframe: 5 });
    expect.soft(shown()).toEqual(ES5.bars);
    await act(async () => {
      bridge.release('ES 12-26');
      await flush();
    });
    expect(shown()).toHaveLength(6);

    await act(async () => button(node, 'Ne plus suivre').click());
    expect(shown()).toEqual(ES5.bars);
    expect(stamp(node)).toBe('Import CSV');
    expect(button(node, 'Suivre le pont')).toBeTruthy();
  });
});
