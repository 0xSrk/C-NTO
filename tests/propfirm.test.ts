import { describe, expect, it } from 'vitest';
import { evaluatePlan, findPlan, PROP_FIRMS, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { loadVector } from './helpers/loadVector';

const session = (id: string, date: string, pnl: number): Session => ({
  id,
  date,
  instruments: ['NQ'],
  source: 'manuel',
  tradeCount: 1,
  pnl,
  grossProfit: Math.max(0, pnl),
  grossLoss: Math.min(0, pnl),
  commission: 0,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

const plan: PropPlan = {
  id: 'test-eod',
  firm: 'Test',
  label: '50K',
  accountSize: 50_000,
  profitTarget: 3_000,
  maxDrawdown: 2_000,
  drawdownType: 'eod-trailing',
  minTradingDays: 2,
  phase: 'evaluation',
};

describe('evaluatePlan · trailing fin de journée', () => {
  it('fait remonter le plancher avec les clôtures journalières', () => {
    const r = evaluatePlan(plan, [session('a', '2026-01-05', 1000), session('b', '2026-01-06', 500), session('c', '2026-01-07', -300)]);
    expect(r.status).toBe('en-cours');
    expect(r.highWater).toBe(51_500);
    expect(r.floor).toBe(49_500);
    expect(r.balance).toBe(51_200);
    expect(r.buffer).toBe(1_700);
    expect(r.daysTraded).toBe(3);
    expect(r.targetProgress).toBeCloseTo(1200 / 3000);
  });

  it('déclare l’objectif atteint avec le minimum de jours', () => {
    const r = evaluatePlan(plan, [session('a', '2026-01-05', 2000), session('b', '2026-01-06', 1500)]);
    expect(r.status).toBe('objectif');
    expect(r.remainingToTarget).toBe(0);
  });

  it('échoue quand le solde passe sous le plancher', () => {
    const r = evaluatePlan(plan, [session('a', '2026-01-05', 1000), session('b', '2026-01-06', -3100), session('c', '2026-01-07', 5000)]);
    expect(r.status).toBe('echec');
    expect(r.failedOn).toBe('2026-01-06');
    expect(r.timeline.length).toBe(2);
  });

  it('applique la limite de perte journalière', () => {
    const r = evaluatePlan({ ...plan, dailyLossLimit: 1_000 }, [session('a', '2026-01-05', -1000)]);
    expect(r.status).toBe('echec');
    expect(r.reason).toMatch(/journalière/);
  });

  it('valide l’objectif le jour où il est atteint, même si le compte rechute ensuite', () => {
    const vec = loadVector<{ plan: PropPlan; sessions: Session[] }>('propfirm.pass-then-giveback.json');
    const expected = loadVector<{ status: string; passedOn?: string; timelineLength: number; remainingToTarget: number }>('propfirm.pass-then-giveback.expected.json');
    const r = evaluatePlan(vec.plan, vec.sessions);
    expect(r.status).toBe(expected.status);
    expect(r.passedOn).toBe(expected.passedOn);
    expect(r.timeline.length).toBe(expected.timelineLength);
    expect(r.remainingToTarget).toBe(expected.remainingToTarget);
  });

  it('filtre par compte et agrège les séances d’une même journée', () => {
    const all = [{ ...session('a', '2026-01-05', 1000), account: 'X' }, { ...session('b', '2026-01-05', 500), account: 'Y' }, { ...session('c', '2026-01-06', 200), account: 'X' }];
    const merged = evaluatePlan(plan, all);
    expect(merged.timeline.length).toBe(2);
    expect(merged.timeline[0].dayPnl).toBe(1500);
    const onlyX = evaluatePlan(plan, all, [], 'X');
    expect(onlyX.balance).toBe(51_200);
    expect(onlyX.daysTraded).toBe(2);
  });

  it('bloque l’objectif si la règle de consistance n’est pas respectée', () => {
    const r = evaluatePlan({ ...plan, consistencyPct: 0.3 }, [session('a', '2026-01-05', 2500), session('b', '2026-01-06', 600)]);
    expect(r.status).toBe('en-cours');
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.share).toBeCloseTo(2500 / 3100);
  });
});

describe('evaluatePlan · trailing intrajournalier avec verrou', () => {
  const intraday: PropPlan = { ...plan, id: 'intra', drawdownType: 'intraday-trailing', maxDrawdown: 2_500, trailingLockAt: 100 };
  const trade = (sessionId: string, i: number, pnl: number, mfe: number, mae: number): Trade => ({
    id: `${sessionId}-${i}`,
    sessionId,
    instrument: 'NQ',
    direction: 'long',
    qty: 1,
    entryTime: i * 1000,
    exitTime: i * 1000 + 500,
    entryPrice: 0,
    exitPrice: 0,
    pnl,
    commission: 0,
    mfe,
    mae,
  });

  it('remonte le plancher sur le pic intrajournalier (MFE) puis verrouille', () => {
    const trades = [trade('a', 1, 500, 3000, 100)];
    const r = evaluatePlan(intraday, [session('a', '2026-01-05', 500)], trades);
    // pic intraday = 50 000 + 3 000 → plancher = min(53 000 − 2 500, 50 100) = 50 100
    expect(r.highWater).toBe(53_000);
    expect(r.floor).toBe(50_100);
    expect(r.status).toBe('en-cours');
  });

  it('détecte une violation intrajournalière via la MAE', () => {
    const trades = [trade('a', 1, -200, 50, 2600)];
    const r = evaluatePlan(intraday, [session('a', '2026-01-05', -200)], trades);
    expect(r.status).toBe('echec');
  });
});

describe('registre prop firms', () => {
  it('expose des plans cohérents', () => {
    expect(PROP_FIRMS.length).toBeGreaterThan(3);
    for (const f of PROP_FIRMS) {
      for (const p of f.plans) {
        expect(p.profitTarget).toBeGreaterThan(0);
        expect(p.maxDrawdown).toBeGreaterThan(0);
        expect(p.maxDrawdown).toBeLessThan(p.accountSize);
      }
    }
    expect(findPlan('apex-50')?.drawdownType).toBe('intraday-trailing');
    expect(findPlan('nope')).toBeUndefined();
  });
});
