import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { findPlan, setUserPlans, type PropPlan } from '@/engine/propfirm';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';
import { dailyLossReached, trackedPropShare, traderRuleFor } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

const NOW = Date.parse('2026-10-07T14:00:00Z');

/** Pont vivant : un compte par nom, avec son latent. */
function live(unrealized: Record<string, number>): NtBridgeStatus {
  return {
    link: 'live',
    port: 0,
    addonVersion: '2.2.0',
    ntVersion: '8.1',
    accountsAt: NOW - 4_000,
    accounts: Object.entries(unrealized).map(([name, unrealizedPnl]) => ({ name, cashValue: 0, realizedPnl: 0, unrealizedPnl, positions: [] })),
    accountNames: Object.keys(unrealized),
    heartbeatLatencyMs: 10,
    ordersOpen: true,
    ordersClosed: false,
    hasToken: true,
    extraAccounts: [],
    maxContractsPerOrder: 5,
    killSwitchShortcut: 'CommandOrControl+Shift+K',
  } as NtBridgeStatus;
}

afterEach(() => {
  setUserPlans([]);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: [], trades: [] });
  useMacro.setState({ events: [] });
  useBridge.setState({ nt: null });
});

describe('A18 le latent du pont est lu comme la garde du process principal', () => {
  const follow = (planAccount: string) => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 }, planAccount } });
    useJournal.setState({ sessions: [], trades: [] });
    useMacro.setState({ events: [] });
  };
  const proposal = { account: 'SimApex1', instrument: 'MNQ 12-26', qty: 1 };

  it('un compte du pont qui ne diffère que par la casse et les espaces porte son latent dans la perte du jour', () => {
    follow('SimApex1');
    useBridge.setState({ nt: live({ ' simapex1 ': -600 }) });
    expect(dailyLossReached(NOW)).toBe(true);
    expect(traderRuleFor(proposal, NOW)).toMatchObject({ rule: 'after_daily_limit' });
  });

  it('le nom exact passe d’abord, comme heldPosition (electron/agent-orders.ts)', () => {
    follow('SimApex1');
    useBridge.setState({ nt: live({ simapex1: -600, SimApex1: -50 }) });
    expect(dailyLossReached(NOW)).toBe(false);
    expect(traderRuleFor(proposal, NOW)).toBeNull();
  });

  it('hors du pont vivant, aucun latent', () => {
    follow('SimApex1');
    useBridge.setState({ nt: { ...live({ simapex1: -600 }), link: 'lost' } });
    expect(dailyLossReached(NOW)).toBe(false);
  });

  it('la marge du plan suivi compte le latent du compte replié comme celui du compte exact', () => {
    const plan: PropPlan = { ...findPlan('apex-50')!, id: 'a18', source: 'user', profitTarget: 1e9 };
    setUserPlans([plan]);
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: plan.id, planAccount: 'SimApex1' } });
    useBridge.setState({ nt: null });
    const none = trackedPropShare('SimApex1');
    useBridge.setState({ nt: live({ SimApex1: -400 }) });
    const exact = trackedPropShare('SimApex1');
    useBridge.setState({ nt: live({ 'SIMAPEX1 ': -400 }) });
    const folded = trackedPropShare('SimApex1');
    expect(none).not.toBeNull();
    expect(exact!).toBeLessThan(none!);
    expect(folded).toBe(exact);
  });
});
