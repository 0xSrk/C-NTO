import { describe, expect, it } from 'vitest';
import { scopeFor } from '../src/modules/metrique/range';
import type { Session, Trade } from '../src/engine/types';

/** Deux comptes, 90 jours, une séance et un trade par jour et par compte. */
const AS_OF = '2026-10-01';
const day = (back: number) => new Date(Date.parse(`${AS_OF}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
const sessions: Session[] = [];
const trades: Trade[] = [];
for (const account of ['A', 'B']) {
  for (let back = 0; back < 90; back++) {
    const id = `${account}-${back}`;
    sessions.push({ id, date: day(back), account, instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 10, grossProfit: 10, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
    trades.push({ id: `t-${id}`, sessionId: id, instrument: 'NQ', account, direction: 'long', qty: 1, entryTime: 0, exitTime: 1, entryPrice: 1, exitPrice: 1, pnl: 10, commission: 0 });
  }
}

describe('1.4 filtres de période et de compte par onglet', () => {
  it('« 30J + compte A » : l’Analyse ne voit que le compte A sur 30 jours', () => {
    const scope = scopeFor('analyse', sessions, trades, '30j', AS_OF, 'A');
    expect(scope.sessions).toHaveLength(30);
    expect(new Set(scope.sessions.map((s) => s.account))).toEqual(new Set(['A']));
    expect(scope.trades).toHaveLength(30);
    expect(scope.ignores).toEqual([]);
  });

  it('la Firme prop voit tout l’historique du compte A, et dit qu’elle ignore la période', () => {
    const scope = scopeFor('prop', sessions, trades, '30j', AS_OF, 'A');
    expect(scope.sessions).toHaveLength(90);
    expect(new Set(scope.trades.map((t) => t.account))).toEqual(new Set(['A']));
    expect(scope.ignores).toEqual(['periode']);
  });

  it('le Monte-Carlo refuse de tourner sans compte ; avec un compte, période et compte', () => {
    const none = scopeFor('mc', sessions, trades, '30j', AS_OF, null);
    expect(none).toMatchObject({ needsAccount: true, sessions: [], trades: [] });
    const a = scopeFor('mc', sessions, trades, '30j', AS_OF, 'A');
    expect(a.needsAccount).toBe(false);
    expect(a.sessions).toHaveLength(30);
  });

  it('le Tableau de bord garde période et compte', () => {
    expect(scopeFor('bord', sessions, trades, '7j', AS_OF, null).sessions).toHaveLength(14);
  });
});
