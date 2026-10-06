/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bar } from '@/engine/bars';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { ContextAxis } from '@/modules/metrique/ContextAxis';
import { useBars } from '@/store/bars';
import { useMacro } from '@/store/macro';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function weekdays(start: string, count: number): string[] {
  const out: string[] = [];
  let cursor = start;
  while (out.length < count) {
    const dow = new Date(`${cursor}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y ?? 2024, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
  }
  return out;
}

/** Séance dont la variance de Garman-Klass annualisée vaut `sigma` (ouverture = clôture). */
function barAt(date: string, sigma: number): Bar {
  const half = Math.sqrt((2 * sigma * sigma) / 252) / 2;
  return { time: zonedToUtc(date, '12:00', ET_ZONE) / 1000, open: 20_000, close: 20_000, high: 20_000 * Math.exp(half), low: 20_000 * Math.exp(-half), volume: 1 };
}

function daySession(date: string): Session {
  return { id: `s-${date}`, date, account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 200, grossProfit: 200, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function dayTrade(date: string): Trade {
  const entry = zonedToUtc(date, '10:00', ET_ZONE);
  return { id: `t-${date}`, sessionId: `s-${date}`, instrument: 'NQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: entry, exitTime: entry + 60_000, entryPrice: 20_000, exitPrice: 20_010, pnl: 200, commission: 0 };
}

describe('lecture par contexte à l’écran', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('choisit l’axe par un sélecteur segmenté, et traduit les régimes, les bandes et l’IC', async () => {
    const dates = weekdays('2024-01-02', 240);
    const bars = dates.map((date, index) => barAt(date, index < 133 ? 0.3 - (0.1 * index) / 133 : 0.26));
    const traded = dates.slice(120, 170);
    useI18n.setState({ locale: 'en' });
    useBars.setState({ series: [{ id: 'nq', instrument: 'NQ', timeframe: 1440, label: 'NQ', source: 'csv', bars, createdAt: 0 }], activeId: 'nq' });
    useMacro.setState({ events: [] });
    useSettings.setState({ settings: DEFAULT_SETTINGS });
    useUi.setState({ metricAccount: null });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(ContextAxis, { sessions: traded.map(daySession), trades: traded.map(dayTrade) }));
    });
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons).toHaveLength(9);
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent)).toEqual(['Weekday']);
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'false')).toHaveLength(8);

    const firstCells = () => [...host!.querySelectorAll('tbody tr')].map((row) => row.querySelector('td')?.textContent ?? '');
    await act(async () => {
      buttons.find((button) => button.textContent === 'Regime')?.click();
    });
    expect(buttons.find((button) => button.textContent === 'Regime')?.getAttribute('aria-pressed')).toBe('true');
    const regimes = firstCells();
    expect(regimes).toContain('shock');
    expect(regimes.every((name) => ['expansion', 'compression', 'shock', 'receding'].includes(name))).toBe(true);
    expect(host.querySelector('thead')?.textContent).toContain('90% CI');

    await act(async () => {
      buttons.find((button) => button.textContent === 'Band')?.click();
    });
    const bands = firstCells();
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.every((name) => ['low', 'medium', 'high'].includes(name))).toBe(true);
  });

  it('dit pourquoi le régime ne se lit pas sur une série de démonstration', async () => {
    const dates = weekdays('2024-01-02', 240);
    const traded = dates.slice(120, 170);
    useI18n.setState({ locale: 'es' });
    useBars.setState({ series: [{ id: 'demo', instrument: 'NQ', timeframe: 5, label: 'NQ · demo', source: 'demo', bars: dates.map((date) => barAt(date, 0.2)), createdAt: 0 }], activeId: 'demo' });
    useMacro.setState({ events: [] });
    useSettings.setState({ settings: DEFAULT_SETTINGS });
    useUi.setState({ metricAccount: null });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(ContextAxis, { sessions: traded.map(daySession), trades: traded.map(dayTrade) }));
    });
    await act(async () => {
      [...host!.querySelectorAll('button')].find((button) => button.textContent === 'Régimen')?.click();
    });
    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).toContain('El régimen y la banda no se leen en una serie de demostración: importe barras de NQ.');
  });
});
