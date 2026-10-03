import { describe, expect, it } from 'vitest';
import { microCounterpart } from '@/engine/instruments';
import { CONTRACT_PAIRS, microOf } from '@/engine/copier/symbols';
import { routeFill, type MasterFill, type RouteContext } from '@/engine/copier/router';
import type { CopierTopology } from '@/engine/copier/types';
import { coerceCopierSync, packCopierSync } from '@/engine/copier/sync';
import { DEFAULT_COPIER } from '@/engine/copier/types';
import { loadVector } from './helpers/loadVector';

interface Vector {
  fill: MasterFill;
  topology: CopierTopology;
  context: RouteContext;
  orders: { account: string; instrument: string; qty: number }[];
  refused: { reason: string; account: string }[];
}

describe('routeFill', () => {
  for (const name of ['copier.route.basic.json', 'copier.route.blackout.json', 'copier.route.prop-floor.json']) {
    it(name, () => {
      const vector = loadVector<Vector>(name);
      const result = routeFill(vector.fill, vector.topology, vector.context);
      expect(result.orders).toEqual(vector.orders);
      expect(result.refused).toEqual(vector.refused);
    });
  }

  it('refuse un fill plus vieux que le budget, et accepte l’âge égal au budget', () => {
    const vector = loadVector<Vector>('copier.route.basic.json');
    const late = routeFill(vector.fill, { ...vector.topology, latencyBudgetMs: 250 }, { ...vector.context, now: vector.fill.time + 251 });
    expect(late.orders).toEqual([]);
    expect(late.refused.map((row) => row.reason)).toEqual(['latency', 'latency']);
    const edge = routeFill(vector.fill, { ...vector.topology, latencyBudgetMs: 250 }, { ...vector.context, now: vector.fill.time + 250 });
    expect(edge.orders).toHaveLength(2);
  });

  it('refuse hors fenêtre', () => {
    const vector = loadVector<Vector>('copier.route.basic.json');
    const closed = routeFill(vector.fill, { ...vector.topology, windowStart: '09:30', windowEnd: '11:00' }, { ...vector.context, localMinutes: 8 * 60 });
    expect(closed.refused.map((row) => row.reason)).toEqual(['window', 'window']);
  });

  it('refuse un plafond suiveur ou un instrument sans micro', () => {
    const vector = loadVector<Vector>('copier.route.basic.json');
    const capped = routeFill(vector.fill, vector.topology, { ...vector.context, maxContractsPerOrder: 4 });
    expect(capped.refused.find((row) => row.account === 'Sim102')?.reason).toBe('cap');
    expect(capped.orders.map((order) => order.account)).toEqual(['Sim103']);
    const unknown = routeFill(
      { ...vector.fill, instrument: 'ZZ 12-26' },
      { ...vector.topology, followers: [vector.topology.followers[0]!] },
      vector.context,
    );
    expect(unknown.refused.map((row) => row.reason)).toEqual(['instrument']);
  });

  it('aligne la carte micro sur le registre', () => {
    for (const pair of CONTRACT_PAIRS) expect(microOf(pair.standard)).toEqual(microCounterpart(pair.standard));
  });

  it('écarte un suiveur qui n’est pas Sim', () => {
    const sync = coerceCopierSync({
      masterAccount: 'Sim101',
      maxContractsPerOrder: 20,
      followers: [
        { account: 'APEX-1', sizing: { mode: 'ratio', value: 1, maxContracts: 2 }, symbolMap: { mode: 'identique' } },
        { account: 'Sim102', sizing: { mode: 'fixe', value: 1, maxContracts: 2 }, symbolMap: { mode: 'identique' } },
      ],
    });
    expect(sync?.topology.followers.map((row) => row.account)).toEqual(['Sim102']);
    const packed = packCopierSync({
      accounts: [
        { role: 'maitre', ntAccount: 'Sim101', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 1 }, symbolMap: { mode: 'identique' } },
        { role: 'maitre', ntAccount: 'Sim999', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 1 }, symbolMap: { mode: 'identique' } },
      ],
      config: DEFAULT_COPIER,
      sessions: [],
      trades: [],
      planById: () => undefined,
      catalysts: [],
      maxContractsPerOrder: 20,
    });
    expect(packed.masterAccount).toBe('');
  });
});
