/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { expectancyR, realizedRewardRisk, rrMatrix } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';

function session(id: string, date: string): Session {
  return { id, date, account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, pnl: number, minute: number): Trade {
  const entryTime = Date.parse('2026-09-01T14:00:00Z') + minute * 60_000;
  return { id, sessionId, instrument: 'NQ', account: 'Sim101', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 30_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0 };
}

const sessions = [session('a', '2026-09-01'), session('b', '2026-09-02')];
// 50 % de réussite, gain moyen +100, perte moyenne −200, un trade nul. Aucun stop ni objectif saisi.
const mixed = [trade('t1', 'a', 100, 0), trade('t2', 'a', -200, 5), trade('t3', 'b', 100, 1440), trade('t4', 'b', -200, 1445), trade('t5', 'b', 0, 1450)];
const winners = [trade('w1', 'a', 100, 0), trade('w2', 'b', 50, 1440)];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(trades: Trade[]) {
  const { RiskReading } = await import('@/modules/metrique/RiskReading');
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(RiskReading, { sessions, trades }));
  });
  const heads = [...host.querySelectorAll('thead th')].map((cell) => cell.textContent ?? '');
  const firstRow = [...host.querySelectorAll('tbody tr:first-child td')].map((cell) => cell.textContent ?? '');
  return { heads, firstRow };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('R/R réalisé de la matrice R-R', () => {
  it('gain moyen ÷ |perte moyenne|, trades nuls exclus : 0,5, soit −0,25 R à 50 %', () => {
    const rr = realizedRewardRisk(mixed);
    expect(rr).toBeCloseTo(0.5);
    expect(expectancyR(0.5, rr)).toBeCloseTo(-0.25);
    const matrix = rrMatrix(0.5, rr);
    expect(matrix.rewardRisks.at(-1)).toBeCloseTo(0.5);
    expect(matrix.realized).toEqual({ row: 0, col: 5 });
    expect(matrix.cells[0]?.[5]).toBeCloseTo(-0.25);
  });

  it('sans perte, NaN et pas de colonne réalisée', () => {
    expect(realizedRewardRisk(winners)).toBeNaN();
    expect(realizedRewardRisk([])).toBeNaN();
    const matrix = rrMatrix(1, realizedRewardRisk(winners));
    expect(matrix.rewardRisks).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(matrix.realized).toBeNull();
  });

  it('l’onglet C place le R/R réalisé, pas le R/R prévu, dans la matrice', async () => {
    const { heads, firstRow } = await mount(mixed);
    expect(heads.at(-1)).toBe('0,50 R');
    expect(firstRow.at(-1)).toBe('-0,25 ·');
  });

  it('l’onglet C n’affiche aucune colonne réalisée sans perte', async () => {
    const { heads, firstRow } = await mount(winners);
    expect(heads).toEqual(['Taux', '1,00', '1,50', '2,00', '2,50', '3,00']);
    expect(firstRow.some((cell) => cell.includes('·'))).toBe(false);
  });
});
