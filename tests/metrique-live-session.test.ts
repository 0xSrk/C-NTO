/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDeskTool } from '@/engine/agent/runner';
import { DEFAULT_TRADER_RULES, tradingDayNow } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import { fmtUsd } from '@/lib/format';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import Metrique from '@/modules/metrique/Metrique';
import { livePorts } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const NOW = zonedToUtc('2026-10-06', '10:00', ET_ZONE);
const DAY = tradingDayNow(NOW);

function session(account: string, pnl: number, tradeCount: number): Session {
  return { id: `s-${account}`, date: DAY, account, instruments: ['MNQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: 0, grossLoss: pnl, commission: 0, tags: [], createdAt: NOW, updatedAt: NOW };
}

function trade(account: string, pnl: number): Trade {
  return { id: `t-${account}`, sessionId: `s-${account}`, instrument: 'MNQ', account, direction: 'long', qty: 1, entryTime: NOW - 60_000, exitTime: NOW - 30_000, entryPrice: 20_000, exitPrice: 20_000, pnl, commission: 0 };
}

const account = (name: string, unrealizedPnl: number) => ({ name, cashValue: 50_000, realizedPnl: 0, unrealizedPnl, positions: [] });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

/** Valeur d'une case du bloc « Séance en cours » (libellé, puis `<b>`). */
function cell(node: HTMLElement, label: string): string {
  const span = [...node.querySelectorAll('span')].find((el) => el.firstChild?.textContent === label);
  return span?.querySelector('b')?.textContent ?? '';
}

describe('A13.6 séance en cours sur le compte suivi', () => {
  it('lit la perte et la limite sur le compte de discipline_status, et « frais » vieillit sans nouveau compte', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Plan suivi sur Sim101 ; le filtre de Métrique regarde Sim102, bien plus en perte.
    useSettings.setState((state) => ({ settings: { ...state.settings, planId: 'tpt-50', planAccount: 'Sim101', traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 2_000, maxTradesPerDay: 8 } } }));
    useJournal.setState({ sessions: [session('Sim101', -120, 2), session('Sim102', -900, 5)], trades: [trade('Sim101', -120), trade('Sim102', -900)] });
    useBridge.setState({
      nt: {
        link: 'live',
        port: 48231,
        addonVersion: '2.2.0',
        ntVersion: '8.1',
        accounts: [account('Sim101', -40), account('Sim102', -300)],
        accountsAt: NOW - 10_000,
        accountNames: ['Sim101', 'Sim102'],
        heartbeatLatencyMs: 4,
        ordersOpen: true,
        hasToken: true,
        extraAccounts: [],
        maxContractsPerOrder: 20,
        killSwitchShortcut: 'CommandOrControl+Shift+K',
        auth: 'mutual',
      },
    });
    useUi.setState({ metricAccount: 'Sim102' });

    const agent = (await executeDeskTool(livePorts(), 'discipline_status', {}, { source: 'llm' })) as { account: string; dailyLoss: { loss: number; limit: number; source: string } };
    expect(agent.account).toBe('Sim101');
    expect(agent.dailyLoss).toMatchObject({ loss: 160, limit: 1_100, source: 'plan' });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Metrique)));
    const node = host;

    expect(cell(node, 'Compte suivi')).toBe('Sim101');
    expect.soft(cell(node, 'Perte du jour')).toBe(`${fmtUsd(agent.dailyLoss.loss)} / ${fmtUsd(agent.dailyLoss.limit)} · plan`);
    expect.soft(cell(node, 'Latent')).toBe(fmtUsd(-40, { sign: true }));
    expect.soft(cell(node, 'Trades')).toBe('2 / 8 · frais');

    // Une minute sans nouveau `bridge.accounts` : les comptes ne sont plus frais.
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(cell(node, 'Trades')).toBe('2 / 8 · périmé');
  });
});
