import { describe, expect, it } from 'vitest';
import { findPlan } from '@/engine/propfirm';
import { consolidate, convertAmount, valuePocket } from '@/engine/portfolio';
import type { Pocket, Position, ValuationContext } from '@/engine/portfolio';
import type { Session } from '@/engine/types';

const now = 1_800_000_000_000;

function session(date: string, pnl: number, account = 'APEX-1'): Session {
  return {
    id: `s-${date}`,
    date,
    account,
    instruments: [],
    source: 'manuel',
    tradeCount: 1,
    pnl,
    grossProfit: Math.max(0, pnl),
    grossLoss: Math.min(0, pnl),
    commission: 0,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ctx(over: Partial<ValuationContext> = {}): ValuationContext {
  return {
    now,
    sessions: [],
    trades: [],
    positions: [],
    cash: [],
    fx: [],
    base: 'USD',
    ...over,
  };
}

describe('valuePocket', () => {
  it('prop : journal puis pont vivant, le pont remplace le réalisé', () => {
    const plan = findPlan('apex-50');
    expect(plan).toBeDefined();
    const pocket: Pocket = { id: 'p', name: 'Apex', kind: 'propfirm', currency: 'USD', account: 'APEX-1', planId: 'apex-50', createdAt: now };
    const journal = valuePocket(pocket, ctx({ plan, sessions: [session('2026-01-05', 100)] }));
    expect(journal.nativeEquity).toBe(50_100);
    expect(journal.mark).toBe('journal');
    expect(journal.equityBase).toBe(50_100);

    const live = valuePocket(
      pocket,
      ctx({
        plan,
        sessions: [session('2026-01-05', 100)],
        bridgeSnapshot: { account: 'APEX-1', cashValue: 51_000, unrealizedPnl: 250, positions: [], at: now - 1_000 },
      }),
    );
    expect(live.nativeEquity).toBe(51_250);
    expect(live.mark).toBe('pont');
    expect(live.unrealized).toBe(250);

    const stale = valuePocket(
      pocket,
      ctx({
        plan,
        sessions: [session('2026-01-05', 100)],
        bridgeSnapshot: { account: 'APEX-1', cashValue: 51_000, unrealizedPnl: 250, positions: [], at: now - 61_000 },
      }),
    );
    expect(stale.mark).toBe('journal');
    expect(stale.nativeEquity).toBe(50_100);
  });

  it('futures sans plan : cash + séances, pont si l’instantané a moins de 60 s', () => {
    const pocket: Pocket = { id: 'f', name: 'Fut', kind: 'futures', currency: 'USD', account: 'SIM', createdAt: now };
    const v = valuePocket(
      pocket,
      ctx({
        sessions: [session('2026-01-05', 40, 'SIM')],
        cash: [{ id: 'c', pocketId: 'f', currency: 'USD', amount: 1_000, at: now }],
      }),
    );
    expect(v.nativeEquity).toBe(1_040);
    expect(v.mark).toBe('journal');
    const live = valuePocket(
      pocket,
      ctx({
        sessions: [session('2026-01-05', 40, 'SIM')],
        cash: [{ id: 'c', pocketId: 'f', currency: 'USD', amount: 1_000, at: now }],
        bridgeSnapshot: { account: 'SIM', cashValue: 2_000, unrealizedPnl: -15, positions: [], at: now - 500 },
      }),
    );
    expect(live.nativeEquity).toBe(1_985);
    expect(live.mark).toBe('pont');
  });

  it('position sans dernier prix : unrealized null, marque au prix de revient', () => {
    const pocket: Pocket = { id: 'a', name: 'Actions', kind: 'actions', currency: 'USD', createdAt: now };
    const position: Position = { id: 'pos', pocketId: 'a', symbol: 'ZZZ', quantity: 2, avgPrice: 10, currency: 'USD', openedAt: now };
    const v = valuePocket(pocket, ctx({ positions: [position] }));
    expect(v.unrealized).toBeNull();
    expect(v.nativeEquity).toBe(20);
    expect(v.mark).toBe('prix de revient');
  });

  it('dernier prix : plus-value, et pointValue NQ si le multiplicateur est absent', () => {
    const pocket: Pocket = { id: 'a', name: 'Actions', kind: 'actions', currency: 'USD', createdAt: now };
    const marked: Position = { id: 'pos', pocketId: 'a', symbol: 'ZZZ', quantity: 2, avgPrice: 10, lastPrice: 12, currency: 'USD', openedAt: now };
    const v = valuePocket(pocket, ctx({ positions: [marked] }));
    expect(v.unrealized).toBe(4);
    expect(v.nativeEquity).toBe(24);
    expect(v.mark).toBe('saisi');

    const nq: Position = { id: 'nq', pocketId: 'a', symbol: 'NQ', quantity: 1, avgPrice: 100, lastPrice: 110, currency: 'USD', openedAt: now };
    const fut = valuePocket(pocket, ctx({ positions: [nq] }));
    expect(fut.unrealized).toBe(200);
    expect(fut.nativeEquity).toBe(2_200);
  });

  it('liquidités : somme du cash', () => {
    const pocket: Pocket = { id: 'l', name: 'Cash', kind: 'liquidites', currency: 'USD', createdAt: now };
    const v = valuePocket(
      pocket,
      ctx({
        cash: [
          { id: 'c1', pocketId: 'l', currency: 'USD', amount: 800, at: now },
          { id: 'c2', pocketId: 'l', currency: 'USD', amount: 200, at: now },
        ],
      }),
    );
    expect(v.nativeEquity).toBe(1_000);
    expect(v.mark).toBe('saisi');
  });

  it('taux manquant : poche exclue, le total ne la convertit pas à 1', () => {
    const eur: Pocket = { id: 'e', name: 'EU', kind: 'actions', currency: 'EUR', createdAt: now };
    const usd: Pocket = { id: 'u', name: 'US', kind: 'liquidites', currency: 'USD', createdAt: now };
    const position: Position = { id: 'pos', pocketId: 'e', symbol: 'AIR', quantity: 10, avgPrice: 100, currency: 'EUR', openedAt: now };
    const missing = valuePocket(eur, ctx({ positions: [position] }));
    expect(missing.equityBase).toBeNull();
    expect(missing.reason).toBe('taux EUR/USD manquant');
    expect(missing.nativeEquity).toBe(1_000);
    const kept = valuePocket(usd, ctx({ cash: [{ id: 'c', pocketId: 'u', currency: 'USD', amount: 50, at: now }] }));
    const coeur = consolidate([missing, kept], 'USD', now);
    expect(coeur.netValue).toBe(50);
    expect(coeur.excluded).toEqual([{ pocketId: 'e', reason: 'taux EUR/USD manquant' }]);
  });

  it('déduit USDEUR depuis EURUSD', () => {
    const direct = convertAmount(110, 'USD', 'EUR', [{ pair: 'EURUSD', rate: 1.1, at: now, by: 'utilisateur' }]);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.value).toBeCloseTo(100);
    const pocket: Pocket = { id: 'e', name: 'EU', kind: 'liquidites', currency: 'EUR', createdAt: now };
    const v = valuePocket(
      pocket,
      ctx({
        base: 'USD',
        fx: [{ pair: 'EURUSD', rate: 1.25, at: now, by: 'utilisateur' }],
        cash: [{ id: 'c', pocketId: 'e', currency: 'EUR', amount: 80, at: now }],
      }),
    );
    expect(v.equityBase).toBe(100);
  });

  it('crypto : exclue', () => {
    const pocket: Pocket = { id: 'x', name: 'X', kind: 'crypto', currency: 'USD', createdAt: now };
    const v = valuePocket(pocket, ctx());
    expect(v.equityBase).toBeNull();
    expect(v.reason).toBe('crypto hors périmètre');
  });
});
