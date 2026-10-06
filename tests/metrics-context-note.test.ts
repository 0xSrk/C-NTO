/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bar, BarSeries } from '@/engine/bars';
import { useI18n } from '@/i18n';
import { ContextNote } from '@/modules/metrique/Analyse';
import { useBars } from '@/store/bars';
import { useMacro } from '@/store/macro';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function weekdays(start: string, count: number): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${start}T12:00:00Z`);
  while (out.length < count) {
    const day = new Date(cursor);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(day.toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function noteText(series: BarSeries): Promise<string> {
  useI18n.setState({ locale: 'fr' });
  useMacro.setState({ events: [] });
  useBars.setState({ series: [series], activeId: series.id });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(ContextNote, { sessions: [], trades: [] })));
  return host.textContent ?? '';
}

describe('Analyse › contexte du jour', () => {
  it('date la fiche d’une série journalière par la date civile de ses barres', async () => {
    // CSV journalier lu à UTC+3 : la barre du lundi 2024-07-15 est horodatée le dimanche à 21 h UTC.
    const dates = weekdays('2024-01-02', 140);
    const bars: Bar[] = dates.map((date, index) => {
      const close = 20_000 + 10 * index;
      return { time: Date.parse(`${date}T00:00:00Z`) / 1000 - 3 * 3600, open: close - 5, high: close + 25, low: close - 30, close, volume: 1 };
    });
    const text = await noteText({ id: 'd1', instrument: 'NQ', timeframe: 1440, label: 'NQ · 1440 min · CSV', source: 'csv', bars, createdAt: 0 });
    expect(dates.at(-1)).toBe('2024-07-15');
    expect(text).toContain('2024-07-15');
    expect(text).not.toContain('2024-07-14');
  });
});
