/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { horizonSigma, sigmaWidths, tickDecimals } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Sessions } from '@/modules/metrique/Sessions';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function trade(id: string, instrument: string, entryPrice: number, minute: number): Trade {
  const entryTime = Date.parse('2026-09-01T14:00:00Z') + minute * 60_000;
  return { id, sessionId: 's1', instrument, account: 'Sim101', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 60_000, entryPrice, exitPrice: entryPrice, pnl: 0, commission: 0 };
}

// Le 6E sort le premier : c'est son cours qui servait de référence à toute la séance.
const trades = [trade('e1', '6E', 1.085, 0), trade('n1', 'NQ', 20_000, 5), trade('e2', '6E', 1.2, 10), trade('m1', 'MNQ', 20_000, 15)];

describe('largeurs ±1 σ par instrument, au pas de cotation', () => {
  it('décimales du pas du registre', () => {
    expect([0.25, 0.1, 1, 0.01, 0.00005, 0.0001].map(tickDecimals)).toEqual([2, 1, 0, 2, 5, 4]);
  });

  it('une ligne par instrument, cours de son premier trade, largeurs arrondies au pas', () => {
    const rows = sigmaWidths(trades, 0.2);
    expect(rows.map((row) => [row.instrument, row.price, row.decimals])).toEqual([
      ['6E', 1.085, 5],
      ['NQ', 20_000, 2],
      ['MNQ', 20_000, 2],
    ]);
    const euro = rows[0]!;
    expect([euro.day, euro.week, euro.month]).toEqual([0.01365, 0.0301, 0.06265]);
    expect(Math.abs(euro.day - horizonSigma(1.085, 0.2, 252))).toBeLessThanOrEqual(0.000025);
    const nasdaq = rows[1]!;
    expect([nasdaq.day, nasdaq.week, nasdaq.month]).toEqual([252, 554.75, 1_154.75]);
    expect(sigmaWidths([trade('x', 'NQ', 0, 0)], 0.2)).toEqual([]);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Séances › largeurs implicites', () => {
  it('affiche le 6E à son pas (0,01365), pas 0,0, et une ligne par instrument', async () => {
    const session: Session = { id: 's1', date: '2026-09-01', account: 'Sim101', instruments: ['6E', 'NQ', 'MNQ'], source: 'csv', tradeCount: trades.length, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
    useI18n.setState({ locale: 'fr' });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, impliedVol: 0.2 } });
    useJournal.setState({ sessions: [session], trades });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Sessions)));
    await act(async () => (host!.querySelector('tbody tr.clickable') as HTMLElement).click());
    const block = [...host.querySelectorAll('div, p')].reverse().find((node) => (node.textContent ?? '').startsWith('Largeurs implicites'));
    const text = block?.textContent ?? '';
    expect(text).toContain('6E · jour 0,01365 · semaine 0,03010 · mois 0,06265');
    expect(text).toContain('NQ · jour 252,00 · semaine 554,75 · mois 1 154,75');
    expect(text).toContain('MNQ · jour 252,00');
    expect(text).not.toContain('0,0 ·');
    useSettings.setState({ settings: DEFAULT_SETTINGS });
  });
});
