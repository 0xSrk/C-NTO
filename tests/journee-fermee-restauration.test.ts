/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * OROS5.48o — correctif d'OROS5.48b (décision 15 de l'ADMIN, `CLAUDE.md` § 5). Restaurer un coffre réunit la journée fermée
 * qu'il porte à celle de la base (`restoredSettingValue`), mais la garde lit le store en mémoire (`useDayClose`) : sans le
 * relire, une fermeture vue au seul latent puis suivie d'un gain — celle qu'aucune autre lecture ne retrouve — ne fermait
 * rien jusqu'au redémarrage, le process principal n'en savait rien, et la fermeture suivante réécrivait la ligne sans elle.
 * Le test passe par Métrique même : le menu Options, « Restaurer une sauvegarde », la vraie `restoreVault`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = vi.hoisted(() => ({ file: '', closeDay: null as unknown as (close: { account: string; at: number }) => Promise<boolean> }));
host.closeDay = vi.fn(async () => true);

// Dexie est remplacé par une coquille : `db.<table>` reçoit plus bas des tables en mémoire (comme `tests/vault-restore.test.ts`).
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) {
      return fn();
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});
// Le desk : le fichier choisi, et le process principal qui entend les fermetures.
vi.mock('@/lib/desk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/desk')>()),
  desk: { agentOrders: { closeDay: (close: { account: string; at: number }) => host.closeDay(close) } },
  openTextFile: async () => ({ name: 'coffre.json', text: host.file }),
}));
// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import { useI18n } from '@/i18n';
import Metrique from '@/modules/metrique/Metrique';
import { useBridge } from '@/store/bridge';
import { useDayClose } from '@/store/dayClose';
import { db } from '@/store/db';
import { recordDayClose, traderRuleBlocks } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const et = (day: string, hhmm: string) => zonedToUtc(day, hhmm, ET_ZONE);
const DAY = '2026-10-06';
const SIM = 'SimApex1';
const OPEN = { account: SIM, instrument: 'MNQ 12-26', qty: 1 };

/** Une table en mémoire, rangée par la clé de sa ligne : de quoi lire et écrire `settings`. */
function table() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (row: Record<string, unknown>) => String(row.key ?? row.id);
  return {
    rows,
    async clear() {
      rows.clear();
    },
    async bulkPut(list: Record<string, unknown>[]) {
      for (const row of list) rows.set(key(row), row);
    },
    async put(row: Record<string, unknown>) {
      rows.set(key(row), row);
    },
    async get(k: string) {
      return rows.get(k);
    },
    async toArray() {
      return [...rows.values()];
    },
  };
}

const TABLES = ['sessions', 'trades', 'importedExecutions', 'openLots', 'notes', 'calendar', 'settings', 'copierAccounts', 'bots', 'calendarEvents', 'links', 'barSeries', 'agentMessages', 'pockets', 'positions', 'cashBalances', 'fxRates', 'equityPoints'] as const;

let root: Root | null = null;
let node: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  node?.remove();
  root = null;
  node = null;
  vi.useRealTimers();
});

/** Restaure `vault` comme le trader : Options, « Restaurer une sauvegarde », puis Restaurer au dialogue. */
async function restoreFromMetrique(vault: unknown) {
  host.file = JSON.stringify(vault);
  useI18n.setState({ locale: 'fr' });
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
  await act(async () => root?.render(createElement(Metrique)));
  const item = [...node.querySelectorAll<HTMLButtonElement>('[data-options] [role^="menuitem"]')].find((el) => el.textContent?.includes('Restaurer une sauvegarde'));
  expect(item).toBeDefined();
  await act(async () => item!.click());
  await vi.waitFor(() => expect(useUi.getState().pendingConfirm?.title).toBe('Restaurer cette sauvegarde ?'));
  await act(async () => useUi.getState().resolveConfirm(true));
  await vi.waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0));
}

describe('OROS5.48o · un coffre restauré ferme aussitôt la journée qu’il porte', () => {
  it('une fermeture vue au latent, au coffre restauré : la garde la lit sans redémarrage, le process principal l’entend, et la fermeture suivante la garde', async () => {
    const tables = Object.fromEntries(TABLES.map((name) => [name, table()]));
    Object.assign(db as unknown as Record<string, unknown>, tables);
    const settings = tables.settings!;
    settings.rows.set('settings', { key: 'settings', value: { ...DEFAULT_SETTINGS, planId: '', planAccount: SIM, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } } });
    vi.useFakeTimers({ toFake: ['Date'] });
    // 09:00, un poste neuf : aucune fermeture au coffre, aucune au process principal
    vi.setSystemTime(et(DAY, '09:00'));
    await useSettings.getState().load();
    await useDayClose.getState().load();
    expect(useDayClose.getState().closes).toEqual([]);
    // 11:45 : le coffre exporté à 11:30 porte la journée fermée depuis 10:00, vue au latent puis suivie d'un gain
    vi.setSystemTime(et(DAY, '11:45'));
    const closed = { day: DAY, account: SIM, at: et(DAY, '10:00') };
    await restoreFromMetrique({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'agent.dayClose', value: [closed] }] });
    expect(settings.rows.get('agent.dayClose')?.value).toEqual([closed]);
    // 11:50 : −100 $ réalisés, aucun latent ; la journée reste fermée depuis 10:00
    vi.setSystemTime(et(DAY, '11:50'));
    const at = et(DAY, '11:50');
    useJournal.setState({ trades: [{ id: 'a', sessionId: 's', instrument: 'MNQ', account: SIM, direction: 'long', qty: 1, entryTime: at - 1_200_000, exitTime: at - 600_000, entryPrice: 0, exitPrice: 0, pnl: -100, commission: 0 }] });
    useBridge.setState({ nt: { link: 'live', accountsAt: at, accounts: [{ name: SIM, cashValue: 0, realizedPnl: 0, unrealizedPnl: 0, positions: [] }], accountNames: [SIM] } as never });
    recordDayClose(at);
    expect(traderRuleBlocks(OPEN, at)).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 10:00 ET : limite 600 $ atteinte (règle du trader)' }]);
    expect(host.closeDay).toHaveBeenCalledWith({ account: SIM, at: et(DAY, '10:00') });
    // 12:10 : le compte suivi devient Sim102, qui atteint sa limite au latent ; la ligne garde SimApex1
    vi.setSystemTime(et(DAY, '12:10'));
    const later = et(DAY, '12:10');
    useSettings.setState({ settings: { ...useSettings.getState().settings, planAccount: 'Sim102' } });
    useBridge.setState({ nt: { link: 'live', accountsAt: later, accounts: [{ name: 'Sim102', cashValue: 0, realizedPnl: 0, unrealizedPnl: -700, positions: [] }], accountNames: ['Sim102'] } as never });
    recordDayClose(later);
    await vi.waitFor(() => expect((settings.rows.get('agent.dayClose')?.value as { account: string }[]).map((c) => c.account)).toEqual([SIM, 'Sim102']));
    expect(traderRuleBlocks(OPEN, later)[0]?.rule).toBe('after_daily_limit');
  });
});
