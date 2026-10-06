/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookOrder, OrderBookView, OrderChange } from '@/engine/execution/orderBook';
import type { NtBridgeStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Livre des ordres du process principal, simulé derrière `window.canto.ntbridge` (lu au chargement du desk). */
const book = vi.hoisted(() => {
  const state = {
    view: null as OrderBookView | null,
    changed: null as ((change: OrderChange) => void) | null,
  };
  (window as unknown as { canto: unknown }).canto = {
    ntbridge: {
      orders: async () => state.view,
      onOrder: (cb: (change: OrderChange) => void) => {
        state.changed = cb;
        return () => {
          state.changed = null;
        };
      },
    },
  };
  return state;
});

// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import Metrique from '@/modules/metrique/Metrique';
import { useBridge } from '@/store/bridge';

const order = (orderId: string, unconfirmed: boolean): BookOrder & { unconfirmed: boolean } => ({
  account: 'Sim101',
  orderId,
  instrument: 'MNQ 12-26',
  side: 'buy',
  type: 'limit',
  qty: 1,
  state: 'Working',
  byAgent: false,
  terminal: false,
  since: 1,
  updatedAt: 2,
  unconfirmed,
});

const status = (link: NtBridgeStatus['link']): NtBridgeStatus => ({
  link,
  port: 48231,
  addonVersion: link === 'absent' ? null : '2.2.0',
  ntVersion: null,
  accounts: [],
  accountNames: [],
  heartbeatLatencyMs: null,
  ordersOpen: link === 'live',
  hasToken: true,
  extraAccounts: [],
  maxContractsPerOrder: 20,
  killSwitchShortcut: 'CommandOrControl+Shift+K',
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const lines = (node: HTMLElement) => [...node.querySelectorAll('p')].map((p) => p.textContent ?? '');

describe('A13.7 ordres en cours seulement avec un pont', () => {
  it('rien sans AddOn ; avec le pont, l’ordre vu avant la coupure est marqué non confirmé', async () => {
    book.view = { link: 'absent', asOf: null, complete: false, active: [], terminal: [] };
    useBridge.setState({ nt: status('absent') });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Metrique)));
    const node = host;
    expect.soft(lines(node)).not.toContain('Aucun ordre en cours.');
    expect.soft(lines(node)).not.toContain('livre incomplet (AddOn 2.2.0)');

    // L'AddOn se connecte : le livre se recharge au premier changement d'ordre.
    book.view = { link: 'live', asOf: 3, complete: false, active: [order('o-1', true), order('o-2', false)], terminal: [] };
    await act(async () => {
      useBridge.setState({ nt: status('live') });
      book.changed?.({ order: order('o-2', false), previousState: null });
      await Promise.resolve();
    });
    expect(lines(node)).toContain('livre incomplet (AddOn 2.2.0)');
    expect(lines(node)).toContain('achat 1 MNQ 12-26 · Sim101 · Working · non confirmé');
    expect(lines(node)).toContain('achat 1 MNQ 12-26 · Sim101 · Working');
  });
});
