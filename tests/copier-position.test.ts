import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMasterFill, FLAT, followerTarget, rebaseExposure, splitMove } from '@/engine/copier/position';
import { routeFill, type MasterFill, type RouteContext } from '@/engine/copier/router';
import type { CopierTopology, FollowerRule } from '@/engine/copier/types';
import type { AccountView, ExecutionEvent, ExecutionPort, OrderRequest } from '@/engine/execution/port';
import { CopierHost } from '../electron/nt-bridge/copier-host';

const fixe2: FollowerRule = { account: 'Sim103', sizing: { mode: 'fixe', value: 2, maxContracts: 20 }, symbolMap: { mode: 'identique' } };
const ratio = (value: number, maxContracts = 20): FollowerRule => ({ account: 'Sim102', sizing: { mode: 'ratio', value, maxContracts }, symbolMap: { mode: 'identique' } });
const topo = (followers: FollowerRule[], extra: Partial<CopierTopology> = {}): CopierTopology => ({
  masterAccount: 'Sim101',
  followers,
  latencyBudgetMs: 60_000,
  newsBlackout: false,
  windowStart: '00:00',
  windowEnd: '23:59',
  followerBufferFloor: 0.3,
  ...extra,
});
const fill = (side: 'buy' | 'sell', qty: number, id = 'x'): MasterFill => ({ account: 'Sim101', instrument: 'NQ 12-26', side, qty, price: 21_000, time: 1_000, executionId: id });
const ctx = (extra: Partial<RouteContext> = {}): RouteContext => ({ now: 1_000, localMinutes: 600, catalysts: [], maxContractsPerOrder: 20, states: [], ...extra });
const brief = (orders: OrderRequest[]) => orders.map((o) => `${o.account} ${o.side} ${o.qty} ${o.instrument}`);

describe('exposition copiée du maître', () => {
  it('croissance copiée, réduction sur la part non copiée d’abord, retournement, désarmé non copié', () => {
    let e = applyMasterFill(FLAT, 1, true);
    expect(e).toEqual({ pos: 1, copied: 1 });
    e = applyMasterFill(e, 2, true);
    expect(e).toEqual({ pos: 3, copied: 3 });
    e = applyMasterFill(e, -4, true);
    expect(e).toEqual({ pos: -1, copied: -1 });
    e = applyMasterFill(e, 1, true);
    expect(e).toEqual({ pos: 0, copied: 0 });
    // Position déjà là à l'armement (2), puis +1 copié : la sortie de 2 entame d'abord l'ancienne part.
    e = applyMasterFill(rebaseExposure(FLAT, 2), 1, true);
    expect(e).toEqual({ pos: 3, copied: 1 });
    expect(applyMasterFill(e, -2, true)).toEqual({ pos: 1, copied: 1 });
    expect(applyMasterFill({ pos: 1, copied: 1 }, 1, false)).toEqual({ pos: 2, copied: 1 });
  });

  it('cible du suiveur par position : ratio arrondi, taille fixe une fois, carte micro', () => {
    expect(followerTarget(3, 'NQ 12-26', fixe2)).toEqual({ instrument: 'NQ 12-26', target: 2, unmapped: false });
    expect(followerTarget(-3, 'NQ 12-26', fixe2).target).toBe(-2);
    expect(followerTarget(0, 'NQ 12-26', fixe2).target).toBe(0);
    expect(followerTarget(-3, 'NQ 12-26', ratio(0.5)).target).toBe(-2);
    expect(followerTarget(1, 'NQ 12-26', { ...ratio(1), symbolMap: { mode: 'micro' } })).toEqual({ instrument: 'MNQ 12-26', target: 10, unmapped: false });
    expect(followerTarget(1, 'ZZ 12-26', { ...ratio(1), symbolMap: { mode: 'micro' } }).unmapped).toBe(true);
    expect(splitMove(2, -1)).toEqual({ reduce: -2, open: -1 });
    expect(splitMove(3, 1)).toEqual({ reduce: -2, open: 0 });
    expect(splitMove(1, 3)).toEqual({ reduce: 0, open: 2 });
  });
});

describe('routeur par position', () => {
  it('entrée en trois fills, taille fixe 2 : un seul ordre de 2 ; la sortie ramène à zéro', () => {
    const t = topo([fixe2]);
    const first = routeFill(fill('buy', 1), t, ctx({ copied: 1 }));
    expect(brief(first.orders)).toEqual(['Sim103 buy 2 NQ 12-26']);
    expect(routeFill(fill('buy', 1), t, ctx({ copied: 2, commanded: { 'Sim103|NQ 12-26': 2 } })).orders).toEqual([]);
    expect(routeFill(fill('buy', 1), t, ctx({ copied: 3, commanded: { 'Sim103|NQ 12-26': 2 } })).orders).toEqual([]);
    expect(brief(routeFill(fill('sell', 3), t, ctx({ copied: 0, commanded: { 'Sim103|NQ 12-26': 2 } })).orders)).toEqual(['Sim103 sell 2 NQ 12-26']);
  });

  it('une sortie part toujours : hors fenêtre, blackout, latence, marge prop ou plafond du suiveur', () => {
    const t = topo([ratio(1, 2)], { windowStart: '09:30', windowEnd: '09:31', newsBlackout: true });
    const blocked = ctx({ now: 999_999, catalysts: [{ at: 1_000 }], localMinutes: 0, commanded: { 'Sim102|NQ 12-26': 3 } });
    expect(brief(routeFill(fill('sell', 3), t, { ...blocked, copied: 0 }).orders)).toEqual(['Sim102 sell 3 NQ 12-26']);
    // L'ouverture, elle, reste refusée par les mêmes gardes.
    const open = routeFill(fill('buy', 1), t, { ...blocked, commanded: {}, copied: 1 });
    expect(open.orders).toEqual([]);
    expect(open.refused.map((r) => r.reason)).toEqual(['latency']);
  });

  it('jamais de position inverse : la réduction est bornée par la position réelle du suiveur', () => {
    const t = topo([ratio(1)]);
    const base = ctx({ copied: 0, commanded: { 'Sim102|NQ 12-26': 3 } });
    expect(brief(routeFill(fill('sell', 3), t, { ...base, actual: { 'Sim102|NQ 12-26': 1 } }).orders)).toEqual(['Sim102 sell 1 NQ 12-26']);
    expect(routeFill(fill('sell', 3), t, { ...base, actual: { 'Sim102|NQ 12-26': 0 } }).orders).toEqual([]);
    expect(routeFill(fill('sell', 3), t, { ...base, actual: { 'Sim102|NQ 12-26': -2 } }).orders).toEqual([]);
  });

  it('retournement : la clôture part, l’ouverture inverse passe les gardes ; découpage au plafond du pont', () => {
    const t = topo([ratio(1)], { windowStart: '09:30', windowEnd: '09:31' });
    const flip = routeFill(fill('sell', 3), t, ctx({ copied: -1, localMinutes: 0, commanded: { 'Sim102|NQ 12-26': 2 } }));
    expect(brief(flip.orders)).toEqual(['Sim102 sell 2 NQ 12-26']);
    expect(flip.refused.map((r) => [r.reason, r.qty])).toEqual([['window', 1]]);
    const big = routeFill(fill('sell', 30), topo([ratio(1, 50)]), ctx({ copied: 0, commanded: { 'Sim102|NQ 12-26': 30 } }));
    expect(brief(big.orders)).toEqual(['Sim102 sell 20 NQ 12-26', 'Sim102 sell 10 NQ 12-26']);
  });
});

describe('hôte de réplication · position', () => {
  function memoryPort() {
    const listeners = new Set<(event: ExecutionEvent) => void>();
    const submitted: OrderRequest[] = [];
    const releases: (() => void)[] = [];
    let hold = false;
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
        const ack = { ok: true as const, orderId: `o${submitted.length}` };
        if (!hold) return Promise.resolve(ack);
        return new Promise((resolve) => releases.push(() => resolve(ack)));
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
      hold: (on: boolean) => (hold = on),
      release: () => releases.splice(0).forEach((r) => r()),
      fill: (side: 'buy' | 'sell', qty: number) => listeners.forEach((cb) => cb({ kind: 'fill', fill: { ...fill(side, qty, `e${++seq}`), time: Date.now() } })),
      accounts: (accounts: AccountView[]) => listeners.forEach((cb) => cb({ kind: 'accounts', accounts })),
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const config = { masterAccount: 'Sim101', latencyBudgetMs: 60_000, newsBlackout: false, windowStart: '00:00', windowEnd: '23:59', followerBufferFloor: 0.3, flattenOnCut: false, maxContractsPerOrder: 20, catalysts: [], followers: [fixe2] };

  it('fills partiels, puis sortie : un ordre d’entrée, un ordre de sortie, aucune dérive', async () => {
    const m = memoryPort();
    const host = new CopierHost(m.port, mkdtempSync(path.join(tmpdir(), 'canto-pos-')), () => {});
    host.open();
    host.configure(config);
    host.arm();
    m.fill('buy', 1);
    m.fill('buy', 1);
    m.fill('buy', 1);
    await settle();
    m.fill('sell', 3);
    await settle();
    expect(brief(m.submitted)).toEqual(['Sim103 buy 2 NQ 12-26', 'Sim103 sell 2 NQ 12-26']);
    host.dispose();
  });

  it('deux fills pendant un envoi : le second ne renvoie pas ce qui est déjà en vol', async () => {
    const m = memoryPort();
    const host = new CopierHost(m.port, mkdtempSync(path.join(tmpdir(), 'canto-pos-')), () => {});
    host.open();
    host.configure({ ...config, followers: [ratio(1)] });
    host.arm();
    m.hold(true);
    m.fill('buy', 1);
    m.fill('buy', 1);
    m.release();
    await settle();
    m.release();
    await settle();
    expect(brief(m.submitted)).toEqual(['Sim102 buy 1 NQ 12-26', 'Sim102 buy 1 NQ 12-26']);
    host.dispose();
  });

  it('position du maître déjà ouverte à l’armement : sa sortie ne touche pas les suiveurs', async () => {
    const m = memoryPort();
    const host = new CopierHost(m.port, mkdtempSync(path.join(tmpdir(), 'canto-pos-')), () => {});
    host.open();
    host.configure({ ...config, followers: [ratio(1)] });
    m.accounts([
      { name: 'Sim101', positions: [{ instrument: 'NQ 12-26', qty: 2, avgPrice: 21_000 }] },
      { name: 'Sim102', positions: [] },
    ]);
    host.arm();
    m.fill('sell', 2);
    await settle();
    expect(m.submitted).toEqual([]);
    host.dispose();
  });
});
