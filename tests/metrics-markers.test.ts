import { describe, expect, it } from 'vitest';
import { analysisCandidates, durationLabel, markerVerdicts, type MarkerCandidate } from '@/engine/inference';
import type { Trade } from '@/engine/types';

function candidate(id: string, indices: number[]): MarkerCandidate {
  const kind = id.startsWith('slot:') ? 'slot' : id.startsWith('duration:') ? 'duration' : 'strategy';
  return { id, kind, indices };
}

/** 60 valeurs fortes réparties sur les deux moitiés, 20 zéros. La moyenne du groupe est le maximum possible. */
function balanced(secondValue: number): { pnls: number[]; group: number[] } {
  const pnls = Array.from({ length: 80 }, () => 0);
  const group = [...Array.from({ length: 30 }, (_, i) => i), ...Array.from({ length: 30 }, (_, i) => 40 + i)];
  for (let i = 0; i < 30; i++) pnls[i] = 20 - secondValue;
  for (let i = 40; i < 70; i++) pnls[i] = secondValue;
  return { pnls, group };
}

describe('rail de repères', () => {
  const opts = { draws: 300, seed: 1, minTrades: 30, fdr: 0.05 };

  it('retient un écart qui persiste sur la seconde moitié', () => {
    const { pnls, group } = balanced(10);
    const [verdict] = markerVerdicts(pnls, [candidate('slot:1:9', group)], opts);
    expect(verdict?.count).toBe(60);
    expect(verdict?.p ?? 1).toBeLessThan(0.05);
    expect(verdict?.kept).toBe(true);
    expect(verdict?.halfMean).toBeCloseTo(10);
  });

  it('écarte un écart qui perd la moitié de son ampleur, un groupe trop petit, et un effet absent de la seconde moitié', () => {
    const faded = balanced(4);
    const [lost] = markerVerdicts(faded.pnls, [candidate('slot:1:9', faded.group)], opts);
    expect(lost?.mean).toBeCloseTo(10);
    expect(lost?.halfMean).toBeCloseTo(4);
    expect(lost?.p ?? 1).toBeLessThan(0.05);
    expect(lost?.kept).toBe(false);

    const small = markerVerdicts(Array.from({ length: 20 }, () => 5), [candidate('slot:2:9', [0, 1, 2])], opts);
    expect(small[0]?.p).toBeNull();
    expect(small[0]?.kept).toBe(false);

    const early = Array.from({ length: 80 }, (_, i) => (i < 40 ? 10 : 0));
    const [firstHalf] = markerVerdicts(early, [candidate('slot:3:9', Array.from({ length: 40 }, (_, i) => i))], opts);
    expect(firstHalf?.halfMean).toBeNull();
    expect(firstHalf?.kept).toBe(false);
  });

  it('classe un trade de 3 minutes à 10 h dans le créneau, la durée et la stratégie', () => {
    const entry = Date.parse('2026-01-05T15:00:00Z');
    const trade: Trade = {
      id: 't',
      sessionId: 's',
      instrument: 'NQ',
      direction: 'long',
      qty: 1,
      entryTime: entry,
      exitTime: entry + 3 * 60_000,
      entryPrice: 20_000,
      exitPrice: 20_010,
      pnl: 200,
      commission: 0,
      strategy: 'ORB',
    };
    expect(durationLabel(trade.entryTime, trade.exitTime)).toBe('2–5m');
    const { candidates } = analysisCandidates([trade]);
    expect(candidates.map((c) => c.id).sort()).toEqual(['duration:2–5m', 'slot:1:10', 'strategy:ORB']);
  });
});
