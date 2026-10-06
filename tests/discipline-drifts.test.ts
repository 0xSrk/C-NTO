import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADER_RULES, detectDrifts, entryExposure, entryOfTrade, type DisciplineEntry } from '@/engine/discipline';
import type { Trade } from '@/engine/types';

const ET = (hhmm: string, date = '2026-10-06') => Date.parse(`${date}T${hhmm}:00-04:00`);

function trade(id: string, instrument: string, qty: number, entry: string, exit: string, pnl: number, account = 'PA-1'): Trade {
  return { id, sessionId: 's', instrument, account, direction: 'long', qty, entryTime: ET(entry), exitTime: ET(exit), entryPrice: 20_000, exitPrice: 20_000, pnl, commission: 0 };
}

const entry = (id: string, instrument: string, qty: number, at: string, account = 'PA-1'): DisciplineEntry => ({ id, account, instrument, qty, time: ET(at) });

describe('dérives après une perte', () => {
  const loss = trade('t-loss', 'MNQ', 1, '09:40', '10:00', -120);
  const rules = DEFAULT_TRADER_RULES;

  it('revanche : une entrée dans la fenêtre après une sortie perdante, même compte seulement', () => {
    const found = detectDrifts([entry('e1', 'MNQ', 1, '10:03'), entry('e2', 'MNQ', 1, '10:06'), entry('e3', 'MNQ', 1, '10:03', 'Sim101')], [loss], rules);
    expect(found.map((f) => [f.id, f.kind])).toEqual([['revenge_entry:e1', 'revenge_entry']]);
    expect(found[0]).toMatchObject({ family: 'drift', account: 'PA-1', day: '2026-10-06', detail: { lossTradeId: 't-loss', lossPnl: -120, minutesAfterLoss: 3, windowMin: 5 } });
    expect(detectDrifts([entry('e1', 'MNQ', 1, '10:03')], [loss], { revengeWindowMin: 0 })).toEqual([]);
  });

  it('taille relevée : 1 MNQ perdant puis 1 NQ est signalé, par l’exposition du registre', () => {
    expect(entryExposure('MNQ', 1)).toBe(2);
    expect(entryExposure('NQ 12-26', 1)).toBe(20);
    expect(entryExposure('BTC', 1)).toBeNull();
    const later = (id: string, instrument: string, qty: number) => entry(id, instrument, qty, '11:00');
    const found = detectDrifts([later('up', 'NQ 12-26', 1), later('same', 'MNQ', 1), later('micro', 'MNQ', 2)], [loss], rules);
    expect(found.map((f) => f.id)).toEqual(['size_up_after_loss:up', 'size_up_after_loss:micro']);
    expect(found[0]?.detail).toMatchObject({ lossExposure: 2, entryExposure: 20, ratio: 10 });
    // 1 NQ perdant puis 5 MNQ : exposition plus faible.
    expect(detectDrifts([later('m5', 'MNQ', 5)], [trade('nq', 'NQ', 1, '09:40', '10:00', -400)], rules)).toEqual([]);
    // Pas la même journée CME : la perte de la veille ne compte pas.
    expect(detectDrifts([entry('next', 'NQ', 1, '09:31', '2026-10-07')], [loss], rules)).toEqual([]);
  });

  it('une sortie gagnante après la perte efface la dérive ; un autre compte n’est jamais apparié', () => {
    const win = trade('t-win', 'MNQ', 1, '10:01', '10:02', 80);
    expect(detectDrifts([entry('e', 'NQ', 1, '10:03')], [loss, win], rules)).toEqual([]);
    const other = trade('t-other', 'MNQ', 1, '10:01', '10:02', 80, 'Sim101');
    expect(detectDrifts([entry('e', 'NQ', 1, '10:03')], [loss, other], rules).map((f) => f.kind)).toEqual(['revenge_entry', 'size_up_after_loss']);
    expect(detectDrifts([entry('e', 'NQ', 1, '10:03', 'Sim101')], [loss], rules)).toEqual([]);
  });

  it('sur le journal : chaque trade est jugé à son entrée, identifiants stables', () => {
    const journal = [loss, trade('t2', 'NQ', 1, '10:02', '10:20', 50), trade('t3', 'MNQ', 1, '10:30', '10:40', 30)];
    const first = detectDrifts(journal.map(entryOfTrade), journal, rules);
    expect(first.map((f) => f.id)).toEqual(['revenge_entry:t2', 'size_up_after_loss:t2']);
    const again = detectDrifts([...journal].reverse().map(entryOfTrade), [...journal].reverse(), rules);
    expect(again.map((f) => f.id).sort()).toEqual(first.map((f) => f.id).sort());
    expect(again.find((f) => f.id === 'revenge_entry:t2')).toEqual(first.find((f) => f.id === 'revenge_entry:t2'));
  });
});
