import { describe, expect, it } from 'vitest';
import { ERR } from '../electron/nt-bridge/protocol';
import { GUARD, guardSubmit, killSwitchAccounts, type GuardOrder, type GuardPolicy, type GuardSnapshot } from '@/engine/execution/guards';
import { loadVector } from './helpers/loadVector';

interface GuardCase {
  name: string;
  order: GuardOrder;
  policy: GuardPolicy;
  snap: GuardSnapshot;
  ok?: boolean;
  code?: number;
}

describe('gardes pures', () => {
  const vector = loadVector<{ cases: GuardCase[] }>('execution.guards.json');

  it('couvre chaque code et le cas accepté', () => {
    expect(GUARD).toEqual({ ACCOUNT: ERR.ACCOUNT, LOST: ERR.LOST, QUANTITY: ERR.QUANTITY, TAG: ERR.TAG });
    const codes = new Set<number>();
    for (const row of vector.cases) {
      const verdict = guardSubmit(row.order, row.policy, row.snap);
      if (row.ok) expect(verdict.ok, row.name).toBe(true);
      else {
        expect(verdict.ok, row.name).toBe(false);
        if (!verdict.ok && row.code !== undefined) {
          expect(verdict.code, row.name).toBe(row.code);
          codes.add(row.code);
        }
      }
    }
    expect([...codes].sort((a, b) => a - b)).toEqual([-32013, -32012, -32011, -32010]);
  });

  it('le kill switch n’aplatit que les comptes autorisés', () => {
    expect(killSwitchAccounts(['Sim101', 'APEX-50K'], [])).toEqual(['Sim101']);
    expect(killSwitchAccounts(['Sim101', 'APEX-50K'], ['APEX-50K'])).toEqual(['Sim101', 'APEX-50K']);
  });
});
