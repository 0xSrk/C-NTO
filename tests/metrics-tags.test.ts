import { describe, expect, it } from 'vitest';
import { stampTradeTags, tagTiming } from '@/engine/tradeUnits';
import { prepareVaultRestore } from '@/store/db';

const trade = {
  id: 't',
  sessionId: 's',
  instrument: 'NQ',
  direction: 'long' as const,
  qty: 1,
  entryTime: 1_000,
  exitTime: 2_000,
  entryPrice: 20_000,
  exitPrice: 20_010,
  pnl: 100,
  commission: 0,
};

describe('étiquettes datées', () => {
  it('classe une étiquette sans date en inconnue, avant la sortie en intention, après en jugement', () => {
    expect(tagTiming({ exitTime: trade.exitTime }, 'A+')).toBe('inconnue');
    expect(tagTiming({ ...trade, tagEvents: [{ tag: 'plan', at: 1_500 }] }, 'plan')).toBe('intention');
    expect(tagTiming({ ...trade, tagEvents: [{ tag: 'plan', at: 2_000 }] }, 'plan')).toBe('intention');
    expect(tagTiming({ ...trade, tagEvents: [{ tag: 'revue', at: 2_001 }] }, 'revue')).toBe('jugement');
  });

  it('date la pose nouvelle et laisse les étiquettes anciennes sans date', () => {
    const stamped = stampTradeTags({ tags: ['A+'] }, ['A+', 'plan'], 5_000);
    expect(stamped.schemaVersion).toBe(2);
    expect(stamped.tags).toEqual(['A+', 'plan']);
    expect(stamped.tagEvents).toEqual([{ tag: 'plan', at: 5_000 }]);
    expect(tagTiming({ ...trade, ...stamped }, 'A+')).toBe('inconnue');
    expect(tagTiming({ ...trade, ...stamped }, 'plan')).toBe('jugement');
  });

  it('lit un coffre ancien sans tagEvents et un coffre qui en porte', () => {
    const session = {
      id: 's',
      date: '2026-01-05',
      instruments: ['NQ'],
      source: 'csv',
      tradeCount: 1,
      pnl: 100,
      grossProfit: 100,
      grossLoss: 0,
      commission: 0,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const vault = {
      format: 'canto-vault-v2',
      schemaVersion: 2,
      sessions: [session],
      trades: [
        { ...trade, id: 'old', tags: ['A+'] },
        { ...trade, id: 'dated', tags: ['plan'], tagEvents: [{ tag: 'plan', at: 1_500 }], schemaVersion: 2 },
        { ...trade, id: 'bad', tagEvents: [{ tag: 4 }] },
      ],
    };
    const restored = prepareVaultRestore(JSON.stringify(vault));
    expect(restored.trades.map((row) => row.id).sort()).toEqual(['dated', 'old']);
    expect(restored.trades.find((row) => row.id === 'old')?.tagEvents).toBeUndefined();
    expect(restored.trades.find((row) => row.id === 'dated')?.tagEvents).toEqual([{ tag: 'plan', at: 1_500 }]);
    expect(restored.skipped.trades).toBe(1);
  });
});
