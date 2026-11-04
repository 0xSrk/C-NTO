import { describe, expect, it } from 'vitest';
import { heldPosition, type BridgeView } from '../electron/agent-orders';
import { foldAccount, matchAccount, sameAccount } from '@/engine/accounts';
import { sumAccountPnl } from '@/engine/portfolio';
import type { Session } from '@/engine/types';

/** OROS5.8 : une seule règle d'appariement des comptes, celle du process principal (`heldPosition`). */

const view = (names: readonly string[]): BridgeView => ({ link: 'live', ordersOpen: true, accounts: names.map((name) => ({ name, positions: [{ instrument: 'MNQ 12-26', quantity: 1 }] })) });

/** [comptes du pont, compte demandé, compte retenu (null : inconnu du pont)] */
const CASES: [string[], string, string | null][] = [
  [['Sim101', 'SimApex1'], 'SimApex1', 'SimApex1'],
  [['SimApex1'], 'simapex1', 'SimApex1'],
  [['SimApex1'], 'SIMAPEX1', 'SimApex1'],
  [['Sim Apex 1'], '  sim   apex 1 ', 'Sim Apex 1'],
  [['Sim\tApex 1'], 'sim apex 1', 'Sim\tApex 1'],
  [['Sim Apex 1'], 'SimApex1', null],
  // le nom exact passe avant un nom replié placé plus haut dans la liste
  [['SIMAPEX1', 'SimApex1'], 'SimApex1', 'SimApex1'],
  // deux noms repliés égaux : le premier du pont
  [['SIMAPEX1', 'simapex1'], 'SimApex1', 'SIMAPEX1'],
  [['Sim101'], 'Apex-PA-50K', null],
  [[], 'Sim101', null],
  [['Sim101'], 'Sim1010', null],
  [['Apex-PA-50K'], 'apex-pa-50k', 'Apex-PA-50K'],
];

describe('OROS5.8 · apparier les comptes comme la garde', () => {
  it('sur la table de cas, matchAccount retient le compte que heldPosition lit au pont', () => {
    for (const [names, wanted, expected] of CASES) {
      const held = heldPosition(view(names), wanted, 'MNQ 12-26');
      const match = matchAccount(names, wanted);
      expect(match?.name ?? null, `${JSON.stringify(names)} ← ${JSON.stringify(wanted)}`).toBe(expected);
      // inconnu du pont : heldPosition garde le nom proposé et une position nulle
      expect(held.account).toBe(match?.name ?? wanted);
      expect(held.quantity).toBe(match ? 1 : 0);
      expect(match?.by ?? null).toBe(expected === null ? null : expected === wanted ? 'exact' : 'folded');
    }
  });

  it('sameAccount dit oui là où heldPosition apparie, deux à deux, et non ailleurs', () => {
    const names = [...new Set(CASES.flatMap(([list, wanted]) => [...list, wanted]))];
    let yes = 0;
    for (const a of names) {
      for (const b of names) {
        const held = heldPosition(view([b]), a, 'MNQ 12-26');
        expect(sameAccount(a, b), `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`).toBe(held.quantity === 1);
        if (a !== b && sameAccount(a, b)) yes += 1;
      }
    }
    // la table porte des noms repliés égaux, pas seulement des identiques
    expect(yes).toBeGreaterThan(0);
    expect(foldAccount('  Sim \t Apex  1 ')).toBe('sim apex 1');
  });

  it('constat : la valorisation du Portefeuille garde son appariement exact (sumAccountPnl)', () => {
    const session = (id: string, account: string, pnl: number): Session => ({ id, date: '2026-10-14', account, instruments: ['MNQ'], source: 'manuel', tradeCount: 1, pnl, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
    const sessions = [session('a', 'SimApex1', 100), session('b', 'simapex1', 40), session('c', ' SimApex1 ', 7)];
    // la règle de la garde les tiendrait pour un seul compte…
    expect(sessions.every((s) => sameAccount(s.account!, 'SimApex1'))).toBe(true);
    // …la valorisation n'en retient que le nom exact, jusqu'à décision de l'ADMIN (décision 13, CLAUDE.md § 2.5)
    expect(sumAccountPnl(sessions, 'SimApex1')).toBe(100);
    expect(sumAccountPnl(sessions, 'simapex1')).toBe(40);
  });
});
