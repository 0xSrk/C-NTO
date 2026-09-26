import { describe, expect, it } from 'vitest';
import { claimConfidence, deriveStructuralLinks, linkId } from '@/engine/ontology';
import type { Link } from '@/engine/ontology/schema';
import type { OntologyNote } from '@/engine/ontology/structural';
import type { Session, Trade } from '@/engine/types';
import { loadVector } from './helpers/loadVector';

interface ClaimVector {
  day: string;
  otherDay: string;
  fomc: { wins: number; winPnl: number; losses: number; lossPnl: number; risk: number };
  other: { count: number; pnl: number; risk: number };
  expected: {
    n: number;
    expectancyR: number;
    winRate: number;
    profitFactor: number;
    sample: 'insuffisant' | 'faible' | 'moyen' | 'solide';
    rMode: 'risque' | 'approx';
  };
}

function session(id: string, date: string): Session {
  return {
    id,
    date,
    account: 'Sim101',
    instruments: ['MNQ'],
    source: 'manuel',
    tradeCount: 1,
    pnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    commission: 0,
    tags: ['orb'],
    createdAt: 1,
    updatedAt: 1,
  };
}

function trade(id: string, sessionId: string, pnl: number, risk: number): Trade {
  return {
    id,
    sessionId,
    instrument: 'MNQ',
    direction: 'long',
    qty: 1,
    entryTime: 1,
    exitTime: 2,
    entryPrice: 20_000,
    exitPrice: 20_000,
    pnl,
    commission: 0,
    risk,
    tags: ['orb'],
  };
}

describe('confiance d’une affirmation', () => {
  const vector = loadVector<ClaimVector>('ontology-claim.json');

  it('filtre FOMC : n = 12, expectancy et taux de gain calculés à la main, échantillon faible', () => {
    const strat: OntologyNote = { id: 'strat', title: 'ORB', body: '---\ntag: orb\n---\n#strategie\n', tags: ['strategie'] };
    const claim: OntologyNote = { id: 'claim', title: `${vector.day} séance`, body: 'L’ORB marche les jours de FOMC.', tags: [] };
    const sessions = [session('s-fomc', vector.day), session('s-other', vector.otherDay)];
    const trades: Trade[] = [];
    for (let i = 0; i < vector.fomc.wins; i++) trades.push(trade(`w${i}`, 's-fomc', vector.fomc.winPnl, vector.fomc.risk));
    for (let i = 0; i < vector.fomc.losses; i++) trades.push(trade(`l${i}`, 's-fomc', vector.fomc.lossPnl, vector.fomc.risk));
    for (let i = 0; i < vector.other.count; i++) trades.push(trade(`o${i}`, 's-other', vector.other.pnl, vector.other.risk));
    expect(trades).toHaveLength(40);

    const events = [
      { id: 'ev-fomc', date: vector.day, title: 'FOMC', impact: 3 as const, instruments: [] as string[] },
      { id: 'ev-cpi', date: vector.otherDay, title: 'CPI', impact: 3 as const, instruments: [] as string[] },
    ];
    const structural = deriveStructuralLinks({
      notes: [strat, claim],
      sessions,
      trades,
      events,
      instruments: ['MNQ'],
    });
    const soutient: Link = {
      id: linkId({ type: 'note', id: 'claim' }, 'soutient', { type: 'strategie', id: 'strat' }),
      from: { type: 'note', id: 'claim' },
      to: { type: 'strategie', id: 'strat' },
      predicate: 'soutient',
      kind: 'affirme',
      by: 'utilisateur',
      createdAt: 1,
      updatedAt: 1,
    };
    const links = [...structural, soutient];
    const result = claimConfidence({ type: 'note', id: 'claim' }, links, trades, sessions, events);
    expect(result).not.toBeNull();
    expect(result!.n).toBe(vector.expected.n);
    expect(result!.expectancyR).toBe(vector.expected.expectancyR);
    expect(result!.winRate).toBeCloseTo(vector.expected.winRate, 12);
    expect(result!.winRate).toBeCloseTo(8 / 12, 12);
    expect(result!.profitFactor).toBe(vector.expected.profitFactor);
    expect(result!.sample).toBe(vector.expected.sample);
    expect(result!.rMode).toBe(vector.expected.rMode);

    const unfiltered = links.filter((l) => !(l.from.id === 'claim' && l.predicate === 'pendant'));
    const wide = claimConfidence({ type: 'note', id: 'claim' }, unfiltered, trades, sessions, events);
    expect(wide!.n).toBe(40);
  });

  it('approximé à 4 ticks quand le trade n’a pas de risque, et null sans affirmation', () => {
    const sessions = [session('s1', '2026-09-30')];
    const trades = [trade('t1', 's1', 4, 0)];
    delete trades[0]!.risk;
    const links: Link[] = [
      {
        id: 'n',
        from: { type: 'note', id: 'claim' },
        to: { type: 'strategie', id: 'strat' },
        predicate: 'soutient',
        kind: 'affirme',
        by: 'utilisateur',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a',
        from: { type: 'session', id: 's1' },
        to: { type: 'strategie', id: 'strat' },
        predicate: 'applique',
        kind: 'structurel',
        by: 'moteur',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const result = claimConfidence({ type: 'note', id: 'claim' }, links, trades, sessions, []);
    expect(result).toMatchObject({ n: 1, expectancyR: 2, sample: 'insuffisant', rMode: 'approx' });
    expect(claimConfidence({ type: 'note', id: 'claim' }, [], trades, sessions, [])).toBeNull();
  });
});
