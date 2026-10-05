import { describe, expect, it } from 'vitest';
import { routeFill } from '@/engine/copier/router';
import { coerceCopierSync, ignoredFollowers, packCopierSync } from '@/engine/copier/sync';
import { DEFAULT_COPIER, type CopierTopology } from '@/engine/copier/types';

const rule = (account: string) => ({ account, sizing: { mode: 'ratio' as const, value: 1, maxContracts: 5 }, symbolMap: { mode: 'identique' as const } });

describe('Copieur · jamais le maître ni un doublon parmi les suiveurs', () => {
  it('la charge IPC écarte le maître et les doublons', () => {
    const sync = coerceCopierSync({ masterAccount: 'Sim101', maxContractsPerOrder: 20, followers: [rule('Sim101'), rule('Sim102'), rule('Sim102'), rule('Sim103')] });
    expect(sync?.topology.followers.map((f) => f.account)).toEqual(['Sim102', 'Sim103']);
    expect(sync?.states.map((s) => s.account)).toEqual(['Sim102', 'Sim103']);
  });

  it('le renderer n’emballe ni le maître ni un doublon, et l’onglet les signale', () => {
    const base = { enabled: true, sizing: { mode: 'ratio' as const, value: 1, maxContracts: 5 }, symbolMap: { mode: 'identique' as const } };
    const accounts = [
      { ...base, role: 'maitre' as const, ntAccount: 'Sim101' },
      { ...base, role: 'suiveur' as const, ntAccount: ' Sim101 ' },
      { ...base, role: 'suiveur' as const, ntAccount: 'Sim102' },
      { ...base, role: 'suiveur' as const, ntAccount: 'Sim102' },
      { ...base, role: 'suiveur' as const, ntAccount: 'APEX-1' },
    ];
    const packed = packCopierSync({ accounts, config: DEFAULT_COPIER, sessions: [], trades: [], planById: () => undefined, catalysts: [], maxContractsPerOrder: 20 }) as { followers: { account: string }[] };
    expect(packed.followers.map((f) => f.account)).toEqual(['Sim102']);
    expect(ignoredFollowers(accounts)).toEqual(['Sim101', 'Sim102']);
  });

  it('même avec une topologie fautive, le routeur n’envoie rien au maître', () => {
    const topology: CopierTopology = { masterAccount: 'Sim101', followers: [rule('Sim101'), rule('Sim102')], latencyBudgetMs: 60_000, newsBlackout: false, windowStart: '00:00', windowEnd: '23:59', followerBufferFloor: 0.3 };
    const fill = { account: 'Sim101', instrument: 'NQ 12-26', side: 'buy' as const, qty: 1, price: 21_000, time: 1_000, executionId: 'x' };
    const routed = routeFill(fill, topology, { now: 1_000, localMinutes: 600, catalysts: [], maxContractsPerOrder: 20, states: [] });
    expect(routed.orders.map((o) => o.account)).toEqual(['Sim102']);
  });
});
