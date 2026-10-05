import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccountView, ExecutionEvent, ExecutionPort } from '@/engine/execution/port';
import { cutSummary } from '@/modules/copieur/cutSummary';
import { CopierHost } from '../electron/nt-bridge/copier-host';

function harness(flattenOnCut = false) {
  const listeners = new Set<(event: ExecutionEvent) => void>();
  const flattened: string[] = [];
  let n = 0;
  const port: ExecutionPort = {
    sourceId: 'memory',
    capabilities: { submit: true, cancel: true, flatten: true, accounts: 'sim' },
    status: () => ({ state: 'live' }),
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async submit() {
      return { ok: true, orderId: `o${++n}` };
    },
    async cancel() {
      return { ok: true };
    },
    async flatten(account) {
      flattened.push(account);
      return { ok: true, closed: 1 };
    },
    dispose() {},
  };
  const host = new CopierHost(port, mkdtempSync(path.join(tmpdir(), 'canto-cut-')), () => {});
  host.open();
  host.configure({
    masterAccount: 'Sim101',
    latencyBudgetMs: 60_000,
    newsBlackout: false,
    windowStart: '00:00',
    windowEnd: '23:59',
    followerBufferFloor: 0.3,
    flattenOnCut,
    maxContractsPerOrder: 20,
    catalysts: [],
    followers: [{ account: 'Sim102', sizing: { mode: 'ratio', value: 2, maxContracts: 20 }, symbolMap: { mode: 'identique' } }],
  });
  host.arm();
  const emit = (event: ExecutionEvent) => listeners.forEach((cb) => cb(event));
  return {
    host,
    flattened,
    buy: () => emit({ kind: 'fill', fill: { account: 'Sim101', instrument: 'NQ 12-26', side: 'buy', qty: 1, price: 1, time: Date.now(), executionId: `e${Math.random()}` } }),
    accounts: (accounts: AccountView[]) => emit({ kind: 'accounts', accounts }),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Couper dit ce qui reste ouvert', () => {
  it('sans « Aplatir en coupant », Couper rend les positions copiées encore ouvertes', async () => {
    const h = harness();
    h.buy();
    await settle();
    const report = h.host.cut();
    expect(report.open).toEqual([{ account: 'Sim102', instrument: 'NQ 12-26', qty: 2 }]);
    expect(report.flattened).toEqual([]);
    expect(h.flattened).toEqual([]);
    h.host.dispose();
  });

  it('une position déjà fermée dans NinjaTrader n’est pas annoncée ouverte', async () => {
    const h = harness();
    h.buy();
    await settle();
    h.accounts([{ name: 'Sim102', positions: [] }]);
    expect(h.host.cut().open).toEqual([]);
    h.host.dispose();
  });

  it('avec « Aplatir en coupant », les suiveurs sont aplatis et rien n’est annoncé ouvert', async () => {
    const h = harness(true);
    h.buy();
    await settle();
    const report = h.host.cut();
    expect(report.flattened).toEqual(['Sim102']);
    expect(report.open).toEqual([]);
    expect(h.flattened).toEqual(['Sim102']);
    h.host.dispose();
  });

  it('le message nomme les positions ouvertes et dit comment les clore', () => {
    const open = cutSummary({ cancelled: ['o1'], open: [{ account: 'Sim102', instrument: 'NQ 12-26', qty: 2 }], flattened: [] });
    expect(open.tone).toBe('warn');
    expect(open.text).toContain('Sim102 NQ 12-26 +2');
    expect(open.text).toContain('Aplatir les suiveurs en coupant');
    expect(cutSummary({ cancelled: [], open: [], flattened: [] })).toEqual({ text: 'Copie coupée · 0 ordre(s) annulé(s).', tone: 'ok' });
    expect(cutSummary({ cancelled: [], open: [], flattened: ['Sim102'] }).text).toContain('Aplatissement demandé : Sim102');
  });
});
