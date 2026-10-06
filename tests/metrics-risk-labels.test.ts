/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session, Trade } from '@/engine/types';
import { useI18n, type Locale } from '@/i18n';
import { RiskReading } from '@/modules/metrique/RiskReading';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessions: Session[] = [{ id: 's1', date: '2026-09-01', account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 4, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 }];

function trade(id: string, pnl: number, minute: number, stopPrice: number): Trade {
  const entryTime = Date.parse('2026-09-01T14:00:00Z') + minute * 60_000;
  return { id, sessionId: 's1', instrument: 'NQ', account: 'Sim101', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 60_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, stopPrice };
}

const trades = [trade('a', 200, 0, 19_990), trade('b', -100, 5, 19_950), trade('c', 150, 10, 19_900), trade('d', -50, 15, 19_700)];

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function readingText(locale: Locale): Promise<string> {
  useI18n.setState({ locale });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, impliedVol: 0.2 } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(RiskReading, { sessions, trades })));
  return host.textContent ?? '';
}

describe('Lecture du risque › libellés en trois langues', () => {
  it('anglais : « 90% CI », « 95th » et des bornes de classes au point', async () => {
    const text = await readingText('en');
    expect(text).toContain('90% CI');
    expect(text).toMatch(/95th \d/);
    for (const label of ['< 0.25 σ', '0.25–0.5 σ', '0.5–1 σ', '> 1 σ']) expect(text).toContain(label);
    for (const french of ['IC 90 %', '95e', '0,25', '0,5–1']) expect(text).not.toContain(french);
  });

  it('espagnol : « IC 90 % », « 95.º » et des bornes à la virgule', async () => {
    const text = await readingText('es');
    expect(text).toContain('IC 90 %');
    expect(text).toMatch(/95\.º \d/);
    for (const label of ['< 0,25 σ', '0,25–0,5 σ', '0,5–1 σ', '> 1 σ']) expect(text).toContain(label);
  });

  it('français : inchangé', async () => {
    const text = await readingText('fr');
    expect(text).toContain('IC 90 %');
    expect(text).toMatch(/95e \d/);
    for (const label of ['< 0,25 σ', '0,25–0,5 σ', '0,5–1 σ', '> 1 σ']) expect(text).toContain(label);
  });
});
