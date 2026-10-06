import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeFill, type FollowerState, type MasterFill, type RouteContext } from '@/engine/copier/router';
import { coerceCopierSync, packCopierSync } from '@/engine/copier/sync';
import { DEFAULT_COPIER, type CopierTopology } from '@/engine/copier/types';
import type { AccountView, ExecutionEvent, ExecutionPort, OrderRequest } from '@/engine/execution/port';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import { evaluatePlan, findPlan, planMargin, type PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { CopierHost } from '../electron/nt-bridge/copier-host';
import { Nt8ExecutionPort } from '../electron/nt-bridge/execution-port';
import type { NtBridgeServer } from '../electron/nt-bridge/server';

const PLAN: PropPlan = { ...findPlan('apex-50')!, id: 'cas-16', source: 'user', profitTarget: 1e9 };
const rule = { account: 'SimA', sizing: { mode: 'ratio' as const, value: 1, maxContracts: 20 }, symbolMap: { mode: 'identique' as const } };
const topo: CopierTopology = { masterAccount: 'Sim101', followers: [rule], latencyBudgetMs: 60_000, newsBlackout: false, windowStart: '00:00', windowEnd: '23:59', followerBufferFloor: 0.3 };
const fill = (side: 'buy' | 'sell', qty: number, id = 'x'): MasterFill => ({ account: 'Sim101', instrument: 'NQ 12-26', side, qty, price: 21_000, time: 1_000, executionId: id });
const ctx = (extra: Partial<RouteContext> = {}): RouteContext => ({ now: 1_000, localMinutes: 600, catalysts: [], maxContractsPerOrder: 20, states: [], ...extra });
const brief = (orders: OrderRequest[]) => orders.map((o) => `${o.account} ${o.side} ${o.qty} ${o.instrument}`);

/** Cas 1.6 de AUDIT pour un suiveur : 60 jours ouvrés depuis le 01/07/2026, un trade NQ par jour, MAE de 1 100 $ le dernier. */
function case16(account: string): { sessions: Session[]; trades: Trade[] } {
  const days: string[] = [];
  for (let t = Date.parse('2026-07-01T12:00:00Z'); days.length < 60; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) days.push(new Date(t).toISOString().slice(0, 10));
  }
  const pnlOf = (i: number) => (i <= 14 ? 200 : i <= 29 ? -60 : i <= 58 ? -25 : -50);
  const trades: Trade[] = days.map((date, i) => {
    const pnl = pnlOf(i);
    const entry = Date.parse(`${date}T10:00:00-04:00`);
    return { id: `t${i}`, sessionId: '', instrument: 'NQ', account, direction: 'long', qty: 1, entryTime: entry, exitTime: entry + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, mae: i === 59 ? 1_100 : Math.max(0, -pnl) };
  });
  return { sessions: groupIntoSessions(trades, 18, 'csv'), trades };
}

describe('A17.4 le plancher des suiveurs lit la marge datée de la jauge K.04 (décision 2, étendue au Copieur)', () => {
  it('cas 1.6 : la clôture laisse 49 %, la jauge 7 % ; le suiveur n’ouvre pas, il sort toujours', () => {
    const { sessions, trades } = case16('SimA');
    const ev = evaluatePlan(PLAN, sessions, trades, 'SimA');
    expect(ev.status).toBe('en-cours');
    // La marge de clôture laissait passer (1 225 $ ≥ 750 $) ; la jauge lit 175 $.
    expect(ev.buffer).toBeGreaterThanOrEqual(PLAN.maxDrawdown * topo.followerBufferFloor);
    expect(planMargin(ev)?.margin).toBe(175);
    const states: FollowerState[] = [{ account: 'SimA', plan: PLAN, sessions, trades }];
    const open = routeFill(fill('buy', 1), topo, ctx({ states }));
    expect(open.orders).toEqual([]);
    expect(open.refused.map((r) => [r.reason, r.account, r.qty])).toEqual([['floor', 'SimA', 1]]);
    // Une réduction de risque n'est jamais bloquée.
    const exit = routeFill(fill('sell', 2), topo, ctx({ states, copied: 0, commanded: { 'SimA|NQ 12-26': 2 } }));
    expect(brief(exit.orders)).toEqual(['SimA sell 2 NQ 12-26']);
  });

  it('un latent négatif du suiveur entame la marge ; un latent positif ne la relève pas', () => {
    // Sans séance rejouée : la marge est entière (2 500 $), le plancher à 750 $.
    const fresh: FollowerState[] = [{ account: 'SimA', plan: PLAN, sessions: [], trades: [] }];
    expect(brief(routeFill(fill('buy', 1), topo, ctx({ states: fresh })).orders)).toEqual(['SimA buy 1 NQ 12-26']);
    expect(brief(routeFill(fill('buy', 1), topo, ctx({ states: fresh, unrealized: { SimA: -1_000 } })).orders)).toEqual(['SimA buy 1 NQ 12-26']);
    const hit = routeFill(fill('buy', 1), topo, ctx({ states: fresh, unrealized: { SimA: -2_000 } }));
    expect(hit.orders).toEqual([]);
    expect(hit.refused.map((r) => r.reason)).toEqual(['floor']);
    // Le latent d'un autre compte ne compte pas ; une valeur illisible non plus.
    expect(routeFill(fill('buy', 1), topo, ctx({ states: fresh, unrealized: { SimB: -2_000 } })).orders).toHaveLength(1);
    expect(routeFill(fill('buy', 1), topo, ctx({ states: fresh, unrealized: { SimA: Number.NaN } })).orders).toHaveLength(1);
    // Un latent positif ne relève pas une marge datée trop basse.
    const { sessions, trades } = case16('SimA');
    const lifted = routeFill(fill('buy', 1), topo, ctx({ states: [{ account: 'SimA', plan: PLAN, sessions, trades }], unrealized: { SimA: 5_000 } }));
    expect(lifted.refused.map((r) => r.reason)).toEqual(['floor']);
    // La sortie part toujours, latent compris.
    expect(brief(routeFill(fill('sell', 1), topo, ctx({ states: fresh, unrealized: { SimA: -2_400 }, copied: 0, commanded: { 'SimA|NQ 12-26': 1 } })).orders)).toEqual(['SimA sell 1 NQ 12-26']);
  });

  it('le process principal relit la MAE des trades du suiveur : la jauge y est la même que dans le desk', () => {
    const { sessions, trades } = case16('SimA');
    const packed = packCopierSync({
      accounts: [
        { role: 'maitre', ntAccount: 'Sim101', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 20 }, symbolMap: { mode: 'identique' } },
        { role: 'suiveur', ntAccount: 'SimA', enabled: true, sizing: rule.sizing, symbolMap: rule.symbolMap, planId: PLAN.id },
      ],
      config: { ...DEFAULT_COPIER, latencyBudgetMs: 60_000, newsBlackout: false, windowStart: '00:00', windowEnd: '23:59' },
      sessions,
      trades,
      planById: (id) => (id === PLAN.id ? PLAN : undefined),
      catalysts: [],
      maxContractsPerOrder: 20,
    });
    const sync = coerceCopierSync(JSON.parse(JSON.stringify(packed)))!;
    const state = sync.states.find((row) => row.account === 'SimA')!;
    expect(state.trades.find((t) => t.id === 't59')).toMatchObject({ mae: 1_100 });
    expect(planMargin(evaluatePlan(PLAN, state.sessions, state.trades, 'SimA'))?.margin).toBe(175);
    expect(routeFill(fill('buy', 1), sync.topology, ctx({ states: sync.states })).refused.map((r) => r.reason)).toEqual(['floor']);
    // Une excursion illisible ou négative est écartée, pas inventée.
    const odd = coerceCopierSync({
      masterAccount: 'Sim101',
      maxContractsPerOrder: 20,
      followers: [{ ...rule, trades: [{ id: 'a', sessionId: 's', pnl: -10, mae: -5, mfe: 'x' }, { id: 'b', sessionId: 's', pnl: 10, mae: Number.POSITIVE_INFINITY, mfe: 12 }] }],
    })!;
    expect(odd.states[0]!.trades.map((t) => [t.mae, t.mfe])).toEqual([
      [undefined, undefined],
      [undefined, 12],
    ]);
  });
});

describe('A17.4 l’hôte passe au routeur le latent des suiveurs lu sur le pont', () => {
  function memoryPort() {
    const listeners = new Set<(event: ExecutionEvent) => void>();
    const submitted: OrderRequest[] = [];
    const port: ExecutionPort = {
      sourceId: 'memory',
      capabilities: { submit: true, cancel: true, flatten: true, accounts: 'sim' },
      status: () => ({ state: 'live' }),
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      submit(order) {
        submitted.push(order);
        return Promise.resolve({ ok: true as const, orderId: `o${submitted.length}` });
      },
      async cancel() {
        return { ok: true };
      },
      async flatten() {
        return { ok: true, closed: 0 };
      },
      dispose() {},
    };
    let seq = 0;
    return {
      port,
      submitted,
      fill: (side: 'buy' | 'sell', qty: number) => listeners.forEach((cb) => cb({ kind: 'fill', fill: { ...fill(side, qty, `e${++seq}`), time: Date.now() } })),
      accounts: (accounts: AccountView[]) => listeners.forEach((cb) => cb({ kind: 'accounts', accounts })),
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('le pont transmet le latent de chaque compte', () => {
    const port = new Nt8ExecutionPort({ status: () => ({ link: 'live' }) } as unknown as NtBridgeServer);
    const seen: ExecutionEvent[] = [];
    port.subscribe((event) => seen.push(event));
    port.ingestAccounts([{ name: 'SimA', cashValue: 50_000, realizedPnl: 0, unrealizedPnl: -2_000, positions: [{ instrument: 'NQ 12-26', quantity: 1, avgPrice: 21_000 }] }]);
    expect(seen).toEqual([{ kind: 'accounts', accounts: [{ name: 'SimA', unrealizedPnl: -2_000, positions: [{ instrument: 'NQ 12-26', qty: 1, avgPrice: 21_000 }] }] }]);
  });

  it('latent de −2 000 $ sur une marge entière : refus ; à −1 000 $, l’ouverture part', async () => {
    const m = memoryPort();
    const logs: string[] = [];
    const host = new CopierHost(m.port, mkdtempSync(path.join(tmpdir(), 'canto-floor-')), (line) => logs.push(line));
    host.open();
    const configured = host.configure({
      masterAccount: 'Sim101',
      latencyBudgetMs: 60_000,
      newsBlackout: false,
      windowStart: '00:00',
      windowEnd: '23:59',
      followerBufferFloor: 0.3,
      flattenOnCut: false,
      maxContractsPerOrder: 20,
      catalysts: [],
      followers: [{ ...rule, plan: PLAN, sessions: [], trades: [] }],
    });
    expect(configured).toBe(true);
    m.accounts([
      { name: 'Sim101', positions: [] },
      { name: 'SimA', positions: [], unrealizedPnl: -2_000 },
    ]);
    host.arm();
    m.fill('buy', 1);
    await settle();
    expect(m.submitted).toEqual([]);
    expect(host.status().lastRefusal).toMatchObject({ reason: 'floor', account: 'SimA' });
    expect(logs.join('\n')).toContain('motif=floor compte=SimA');
    m.accounts([
      { name: 'Sim101', positions: [{ instrument: 'NQ 12-26', qty: 1, avgPrice: 21_000 }] },
      { name: 'SimA', positions: [], unrealizedPnl: -1_000 },
    ]);
    m.fill('buy', 1);
    await settle();
    expect(brief(m.submitted)).toEqual(['SimA buy 2 NQ 12-26']);
    host.dispose();
  });
});
