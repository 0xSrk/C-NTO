import { describe, expect, it } from 'vitest';
import { linkId, recomputeOntology } from '@/engine/ontology';
import { deriveStructuralLinks, reconcileStructural, type OntologyNote, type StructuralInput } from '@/engine/ontology/structural';
import type { Link } from '@/engine/ontology/schema';
import type { Session, Trade } from '@/engine/types';

const NOW = 1_700_000_000_000;
const INSTRUMENTS = ['NQ', 'MNQ', 'ES'];

function note(partial: Partial<OntologyNote> & Pick<OntologyNote, 'id' | 'title' | 'body'>): OntologyNote {
  return { tags: [], ...partial };
}

function session(partial: Partial<Session> & Pick<Session, 'id' | 'date'>): Session {
  return {
    account: 'Sim101',
    instruments: ['MNQ'],
    source: 'manuel',
    tradeCount: 1,
    pnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    commission: 0,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function trade(partial: Partial<Trade> & Pick<Trade, 'id' | 'sessionId'>): Trade {
  return {
    instrument: 'MNQ',
    direction: 'long',
    qty: 1,
    entryTime: NOW,
    exitTime: NOW + 60_000,
    entryPrice: 20_000,
    exitPrice: 20_010,
    pnl: 20,
    commission: 0,
    tags: [],
    ...partial,
  };
}

function base(): StructuralInput {
  return {
    notes: [
      note({
        id: 'n1',
        title: '2026-09-30 séance',
        body: 'Long MNQ sur le compte Sim101\n#orb',
        tags: ['orb'],
      }),
      note({
        id: 'strat',
        title: 'ORB',
        body: '---\ntag: orb\n---\n#strategie\n',
        tags: ['strategie'],
      }),
      note({
        id: 'code',
        title: 'extrait',
        body: 'Rien ici.\n```\nNQ\n```\n',
        tags: [],
      }),
    ],
    sessions: [session({ id: 's1', date: '2026-09-30', tags: ['orb'] })],
    trades: [trade({ id: 't1', sessionId: 's1', tags: ['orb'] })],
    events: [
      { id: 'fomc', date: '2026-09-30', title: 'FOMC', impact: 3, instruments: [] },
      { id: 'cpi', date: '2026-09-30', title: 'CPI', impact: 2, instruments: ['MNQ'] },
      { id: 'esonly', date: '2026-09-30', title: 'Inventaires ES', impact: 3, instruments: ['ES'] },
      { id: 'minor', date: '2026-09-30', title: 'Mineur', impact: 1, instruments: [] },
    ],
    instruments: INSTRUMENTS,
  };
}

function ids(links: Link[], predicate?: Link['predicate']): string[] {
  return links.filter((l) => !predicate || l.predicate === predicate).map((l) => l.id);
}

describe('liens structurels', () => {
  it('relie la note datée, le symbole, le compte, la stratégie, la séance et les événements', () => {
    const links = deriveStructuralLinks(base());
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'de-la-seance', { type: 'session', id: 's1' }));
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'mentionne', { type: 'instrument', id: 'MNQ' }));
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'mentionne', { type: 'compte', id: 'Sim101' }));
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'mentionne', { type: 'strategie', id: 'strat' }));
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'pendant', { type: 'evenement', id: 'fomc' }));
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n1' }, 'pendant', { type: 'evenement', id: 'cpi' }));
    expect(ids(links)).not.toContain(linkId({ type: 'note', id: 'n1' }, 'pendant', { type: 'evenement', id: 'esonly' }));
    expect(ids(links)).not.toContain(linkId({ type: 'note', id: 'n1' }, 'pendant', { type: 'evenement', id: 'minor' }));
    expect(ids(links)).toContain(linkId({ type: 'trade', id: 't1' }, 'de-la-seance', { type: 'session', id: 's1' }));
    expect(ids(links)).toContain(linkId({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: 'fomc' }));
    expect(ids(links)).toContain(linkId({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: 'cpi' }));
    expect(ids(links)).not.toContain(linkId({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: 'esonly' }));
    expect(ids(links)).toContain(linkId({ type: 'session', id: 's1' }, 'pendant', { type: 'evenement', id: 'fomc' }));
    expect(ids(links)).toContain(linkId({ type: 'session', id: 's1' }, 'applique', { type: 'strategie', id: 'strat' }));
    expect(ids(links)).toContain(linkId({ type: 'trade', id: 't1' }, 'applique', { type: 'strategie', id: 'strat' }));
    expect(links.every((l) => l.kind === 'structurel' && l.by === 'moteur')).toBe(true);
  });

  it('ignore un symbole dans un bloc de code et lit la date d’en-tête', () => {
    const input = base();
    const links = deriveStructuralLinks(input);
    expect(links.some((l) => l.from.id === 'code' && l.to.type === 'instrument')).toBe(false);
    const dated = note({ id: 'hd', title: 'revue', body: '---\ndate: 2026-09-30\n---\nRien.\n', tags: [] });
    const next = deriveStructuralLinks({ ...input, notes: [...input.notes, dated] });
    expect(ids(next)).toContain(linkId({ type: 'note', id: 'hd' }, 'de-la-seance', { type: 'session', id: 's1' }));
  });

  it('alias par défaut : le titre slugifié, pas le tag strategie', () => {
    const input = base();
    input.notes = [
      note({ id: 'strat', title: 'Opening Range', body: '#strategie', tags: ['strategie'] }),
      note({ id: 'n2', title: 'autre', body: '#opening-range', tags: ['opening-range'] }),
    ];
    const links = deriveStructuralLinks(input);
    expect(ids(links)).toContain(linkId({ type: 'note', id: 'n2' }, 'mentionne', { type: 'strategie', id: 'strat' }));
  });

  it('reconcile est idempotent, retire une séance disparue et laisse un affirme', () => {
    const input = base();
    const derived = deriveStructuralLinks(input);
    const affirme: Link = {
      id: linkId({ type: 'note', id: 'n1' }, 'soutient', { type: 'strategie', id: 'strat' }),
      from: { type: 'note', id: 'n1' },
      to: { type: 'strategie', id: 'strat' },
      predicate: 'soutient',
      kind: 'affirme',
      by: 'utilisateur',
      createdAt: 50,
      updatedAt: 50,
    };
    const once = reconcileStructural([affirme], derived, 1_000);
    const twice = reconcileStructural(once, derived, 2_000);
    expect(twice).toEqual(once);
    expect(twice.find((l) => l.kind === 'affirme')).toEqual(affirme);

    const without = deriveStructuralLinks({ ...input, sessions: [] });
    const after = reconcileStructural(once, without, 3_000);
    expect(after.some((l) => l.to.type === 'session' && l.to.id === 's1' && l.kind === 'structurel')).toBe(false);
    expect(after.find((l) => l.kind === 'affirme')).toEqual(affirme);
  });

  it('recomputeOntology ne réécrit pas un affirme', () => {
    const input = base();
    const affirme: Link = {
      id: linkId({ type: 'note', id: 'n1' }, 'soutient', { type: 'strategie', id: 'strat' }),
      from: { type: 'note', id: 'n1' },
      to: { type: 'strategie', id: 'strat' },
      predicate: 'soutient',
      kind: 'affirme',
      by: 'utilisateur',
      createdAt: 50,
      updatedAt: 50,
    };
    const first = recomputeOntology(input, [affirme], 1_000);
    const second = recomputeOntology(input, first, 2_000);
    expect(second.find((l) => l.kind === 'affirme')).toEqual(affirme);
    expect(second.filter((l) => l.kind === 'structurel').map((l) => l.id)).toEqual(first.filter((l) => l.kind === 'structurel').map((l) => l.id));
  });
});
