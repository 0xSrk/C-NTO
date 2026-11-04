import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * OROS5.48d — la veille de la journée fermée (`recordDayClose`, décision 15) tourne à chaque statut du pont, sans cadence :
 * un latent qui touche la limite un instant ferme la journée. Elle ne rejoue pas la journée pour autant : le réalisé du jour
 * et sa première atteinte se relisent au changement de journal, de compte suivi ou de limite, un statut du pont ne relit que
 * le latent (la règle d'OROS5.11 pour les bornes).
 */

vi.mock('@/engine/propfirm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/engine/propfirm')>();
  return { ...mod, evaluatePlan: vi.fn(mod.evaluatePlan) };
});
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { evaluatePlan } from '@/engine/propfirm';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import type { NtBridgeStatus } from '@/lib/desk';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useBridge } from '@/store/bridge';
import { useDayClose } from '@/store/dayClose';
import { traderRuleBlocks, useDeskEvents } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

const et = (day: string, hhmm: string) => zonedToUtc(day, hhmm, ET_ZONE);
const DAY = '2026-10-06';
const SIM = 'SimApex1';

function trade(id: string, exit: string, pnl: number): Trade {
  return { id, sessionId: 's6', instrument: 'MNQ', account: SIM, direction: 'long', qty: 1, entryTime: et(DAY, exit) - 600_000, exitTime: et(DAY, exit), entryPrice: 0, exitPrice: 0, pnl, commission: 0 };
}
function session(trades: Trade[]): Session {
  return { id: 's6', date: DAY, account: SIM, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: trades.length, pnl: trades.reduce((sum, t) => sum + t.pnl, 0), grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}
const live = (unrealized: number, at: number): NtBridgeStatus => ({ link: 'live', accountsAt: at, accounts: [{ name: SIM, cashValue: 0, realizedPnl: 0, unrealizedPnl: unrealized, positions: [] }], accountNames: [SIM] }) as unknown as NtBridgeStatus;

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  useBridge.setState({ nt: null });
  useJournal.setState({ sessions: [], trades: [] });
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useDayClose.setState({ closes: [] });
});

describe('OROS5.48d · la veille de la journée fermée ne rejoue pas la journée à chaque statut du pont', () => {
  it('trente statuts du pont : aucun rejeu ; un latent qui touche la limite un instant ferme la journée ; un changement de journal, un rejeu', () => {
    // la cadence des autres veilles (2 s) reste à l'arrêt : seuls les statuts du pont relisent la journée fermée
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(et(DAY, '11:00'));
    // sans plan suivi : la marge ne rejoue rien ; la limite est la règle du trader, 600 $
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: SIM, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } } });
    const trades = [trade('a', '10:20', -300), trade('c', '10:40', 80)];
    useJournal.setState({ sessions: [session(trades)], trades });
    useBridge.setState({ nt: live(-10, Date.now()) });
    stop = useDeskEvents.getState().start();
    const evaluate = vi.mocked(evaluatePlan);
    evaluate.mockClear();

    for (let i = 1; i <= 30; i++) useBridge.setState({ nt: live(-10 - i, Date.now()) });
    expect(evaluate).not.toHaveBeenCalled();
    expect(useDayClose.getState().closes).toEqual([]);

    // 11:02 : un statut porte le latent à −400 $ (perte relue 620 $), le suivant le ramène à −10 $
    vi.setSystemTime(et(DAY, '11:02'));
    useBridge.setState({ nt: live(-400, Date.now()) });
    useBridge.setState({ nt: live(-10, Date.now()) });
    expect(useDayClose.getState().closes).toEqual([{ day: DAY, account: SIM, at: et(DAY, '11:02') }]);
    expect(traderRuleBlocks({ account: SIM, instrument: 'MNQ', qty: 1 }, et(DAY, '11:05'))[0]?.detail).toBe('journée fermée depuis 11:02 ET : limite 600 $ atteinte (règle du trader)');
    expect(evaluate).not.toHaveBeenCalled();

    // un trade de plus au journal : la journée se rejoue, une fois
    const more = [...trades, trade('d', '11:01', -20)];
    useJournal.setState({ sessions: [session(more)], trades: more });
    const once = evaluate.mock.calls.length;
    expect(once).toBeGreaterThan(0);
    for (let i = 1; i <= 5; i++) useBridge.setState({ nt: live(-10 - i, Date.now()) });
    expect(evaluate.mock.calls.length).toBe(once);
  });
});
