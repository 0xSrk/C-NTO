import { describe, expect, it } from 'vitest';
import { monteCarlo } from '../src/engine/montecarlo';
import type { Session } from '../src/engine/types';
import { monteCarloSample, scopeFor } from '../src/modules/metrique/range';

const MOTIF = [420, -260, 180, -150, 310, -90, 240, -330, 160, 60];
const AS_OF = '2026-10-01';
const date = (i: number) => new Date(Date.parse('2026-06-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);

/** 60 journées, PnL = motif[i % 10] × (i % 7 === 3 ? 1,5 : 1), sur un ou plusieurs comptes copiés. */
function journal(accounts: string[]): Session[] {
  return accounts.flatMap((account) =>
    Array.from({ length: 60 }, (_, i) => {
      const pnl = MOTIF[i % 10]! * (i % 7 === 3 ? 1.5 : 1);
      return { id: `${account}-${i}`, date: date(i), account, instruments: ['NQ'], source: 'csv' as const, tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
    }),
  );
}

const OPTS = { runs: 10_000, seed: 1, ruinDrawdown: 2_500, target: 3_000 };

function run(sessions: Session[]) {
  const scope = scopeFor('mc', sessions, [], 'tout', AS_OF, 'A');
  return monteCarlo(monteCarloSample(scope, 'seances'), OPTS)!;
}

describe('1.5 Monte-Carlo compte par compte', () => {
  it('un compte : horizon 60, objectif ≈ 0,661', () => {
    const one = run(journal(['A']));
    expect(one.horizon).toBe(60);
    expect(one.targetProbability!).toBeCloseTo(0.661, 2);
  });

  it('trois comptes copiés : identique au cas à un compte', () => {
    expect(run(journal(['A', 'B', 'C']))).toEqual(run(journal(['A'])));
  });

  it('autrefois, une entrée par séance et par compte : horizon 180', () => {
    const old = monteCarlo(journal(['A', 'B', 'C']).map((s) => s.pnl), OPTS)!;
    expect(old.horizon).toBe(180);
    expect(old.targetProbability!).toBeGreaterThan(0.9);
  });

  it('deux séances du même compte le même jour font une journée', () => {
    const twice = journal(['A']);
    const split = twice.flatMap((s, i) => (i === 0 ? [{ ...s, pnl: s.pnl / 2 }, { ...s, id: `${s.id}b`, pnl: s.pnl / 2 }] : [s]));
    expect(monteCarloSample(scopeFor('mc', split, [], 'tout', AS_OF, 'A'), 'seances')).toEqual(monteCarloSample(scopeFor('mc', twice, [], 'tout', AS_OF, 'A'), 'seances'));
  });
});
