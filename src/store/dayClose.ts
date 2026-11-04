import { create } from 'zustand';
import { foldDayAccount, mergeDayCloses, withDayClose, type AgentDayClose } from '@/engine/agent/dayClose';
import { cmeTradingDay } from '@/engine/tradingDay';
import { desk } from '@/lib/desk';
import { getSetting, setSetting } from './db';

/**
 * La journée fermée, côté renderer (décision 15 de l'ADMIN, 2026-11-03 ; OROS5.48b) : une fois la perte du jour atteinte,
 * la journée CME reste fermée aux ouvertures de l'agent jusqu'à la journée CME suivante, même si un gain ramène ensuite la
 * perte sous la limite. Tenue au coffre (`agent.dayClose`, contrôlée par `SETTING_ROW_SANITIZERS` de `src/store/db.ts`) :
 * elle survit à un rechargement du renderer et à un redémarrage du desk le même jour. Chaque fermeture part aussi au
 * process principal (`closeDay`), qui garde la sienne. Rien ici ne rouvre une journée : il n'y a que `close`.
 */

/** La clé de la journée fermée dans la table `settings` du coffre. */
export const DAY_CLOSE_KEY = 'agent.dayClose';

interface DayCloseState {
  /** Les fermetures de la journée la plus récente, une par compte ('' : tous les comptes). */
  closes: readonly AgentDayClose[];
  /** Relit le coffre, sans rien perdre de ce qui a déjà été vu, puis redit au process principal les fermetures du jour. */
  load: () => Promise<void>;
  /** Retient une fermeture ; rend vrai si elle change ce que le desk tient. */
  close: (close: AgentDayClose) => boolean;
}

/** Le process principal retient la fermeture de son côté ; un desk absent ou qui refuse n'y change rien ici. */
function report(close: AgentDayClose): void {
  const send = desk?.agentOrders?.closeDay;
  if (!send) return;
  try {
    void send({ account: close.account, at: close.at }).catch(() => undefined);
  } catch {
    /* le process principal garde la sienne s'il l'a vue dans une proposition */
  }
}

function persist(closes: readonly AgentDayClose[]): void {
  try {
    void setSetting(DAY_CLOSE_KEY, closes).catch(() => undefined);
  } catch {
    /* coffre indisponible : la fermeture tient en mémoire, et au process principal */
  }
}

export const useDayClose = create<DayCloseState>((set, get) => ({
  closes: [],

  async load() {
    let stored: unknown = null;
    try {
      stored = await getSetting<unknown>(DAY_CLOSE_KEY, null);
    } catch {
      /* coffre illisible : ce qui a été vu depuis l'ouverture reste */
    }
    const merged = mergeDayCloses(stored, get().closes);
    set({ closes: merged });
    if (JSON.stringify(merged) !== JSON.stringify(stored)) persist(merged);
    const today = cmeTradingDay(Date.now());
    for (const close of merged) if (close.day === today) report(close);
  },

  close(close) {
    const next = withDayClose(get().closes, close);
    if (JSON.stringify(next) === JSON.stringify(get().closes)) return false;
    set({ closes: next });
    persist(next);
    report(next.find((c) => c.day === close.day && foldDayAccount(c.account) === foldDayAccount(close.account)) ?? close);
    return true;
  },
}));
