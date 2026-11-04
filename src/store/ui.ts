import { create } from 'zustand';
import type { MetricRange, Selection } from '@/engine/selection';
import { cursorOnTab, CURSOR_TABS } from '@/lib/frise';
import { uid } from '@/lib/id';

/** `copieur` : `08 · CPY` sur le rail depuis la 3.3.0. `crypto` : `09 · CRY`, éteint par défaut. */
export type TabId = 'metrique' | 'visual' | 'calendrier' | 'note' | 'agent' | 'bot' | 'copieur' | 'portefeuille' | 'crypto';

/** Les fenêtres de Métrique qu'un autre lieu du desk peut demander : les Réglages du desk, le pont NinjaTrader. */
export type MetriqueModal = 'reglages' | 'pont';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
  action?: { label: string; run: () => void };
}

interface UiState {
  tab: TabId;
  setTab: (t: TabId) => void;
  /**
   * La sélection partagée (OROS5.32) : le compte, la période et l'instrument, que portent les puces de Métrique et celles
   * d'« Autour de… ». Une puce changée ici change partout. En mémoire seulement.
   */
  /** Filtre de comptes de Métrique, puce Compte. `null` = tous les comptes. */
  metricAccount: string | null;
  setMetricAccount: (account: string | null) => void;
  /** La puce Période ; trente jours au démarrage. */
  metricRange: MetricRange;
  setMetricRange: (range: MetricRange) => void;
  /** La puce Instrument. `null` = tous les instruments. */
  metricInstrument: string | null;
  setMetricInstrument: (instrument: string | null) => void;
  /** La puce Heure, posée depuis M.003 (OROS5.35) : l'heure d'entrée à New York. `null` = toutes les heures. */
  metricHour: number | null;
  setMetricHour: (hour: number | null) => void;
  /** Troisième segment du fil d'Ariane, ignoré s'il ne concerne pas l'onglet actif. */
  crumb: { tab: TabId; label: string } | null;
  setCrumb: (tab: TabId, label: string) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismiss: (id: string) => void;
  /** Sélection croisée : une séance choisie dans Métrique s'affiche dans Visual */
  focusSessionId: string | null;
  focusSession: (id: string | null) => void;
  /** Date choisie dans le calendrier, ouverte depuis un autre module */
  focusDate: string | null;
  focusOnDate: (d: string | null) => void;
  /**
   * Une fenêtre d'un module, demandée d'ailleurs (la barre d'état ouvre les Réglages du desk) : le module la prend à son
   * montage et l'ouvre. Navigation seule : la fenêtre n'écrit que sur le geste de l'opérateur, comme ouverte du module.
   */
  modalRequest: { tab: 'metrique'; modal: MetriqueModal } | null;
  requestModal: (tab: 'metrique', modal: MetriqueModal) => void;
  /**
   * Le curseur de temps de la frise (OROS5.24) : l'instant tiré, `null` pour le présent. En mémoire seulement. Il ne vit que
   * dans Métrique et le Calendrier (`CURSOR_TABS`), qui le lisent : ailleurs il reste au présent, et quitter ces modules
   * l'y rend.
   */
  timeCursor: number | null;
  setTimeCursor: (ms: number | null) => void;
  /** Le tiroir de la frise est déplié au-dessus de la barre d'état. En mémoire. */
  friseOpen: boolean;
  setFriseOpen: (open: boolean) => void;
  /** Dialogue de confirmation (remplace window.confirm) */
  pendingConfirm: { title: string; text?: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
  confirm: (title: string, text?: string, danger?: boolean) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
}

/** La sélection partagée telle que la lisent les puces et les panneaux (OROS5.32). */
export function selectionOf(state: { metricAccount: string | null; metricRange: MetricRange; metricInstrument: string | null; metricHour?: number | null }): Selection {
  return { account: state.metricAccount, range: state.metricRange, instrument: state.metricInstrument, hour: state.metricHour ?? null };
}

export const useUi = create<UiState>((set, get) => ({
  tab: 'metrique',
  // Le curseur ne vit que là où on le lit : ouvrir un module hors de Métrique et du Calendrier le rend au présent.
  setTab: (tab) => set({ tab, timeCursor: cursorOnTab(tab, get().timeCursor) }),
  metricAccount: null,
  setMetricAccount: (metricAccount) => set({ metricAccount }),
  metricRange: '30j',
  setMetricRange: (metricRange) => set({ metricRange }),
  metricInstrument: null,
  setMetricInstrument: (metricInstrument) => set({ metricInstrument }),
  metricHour: null,
  setMetricHour: (metricHour) => set({ metricHour: metricHour != null && Number.isInteger(metricHour) && metricHour >= 0 && metricHour <= 23 ? metricHour : null }),
  crumb: null,
  setCrumb: (tab, label) => set({ crumb: { tab, label } }),
  toasts: [],
  toast(text, tone = 'info', action) {
    const id = uid('n');
    set({ toasts: [...get().toasts, { id, text, tone, action }] });
    setTimeout(() => get().dismiss(id), action ? 12000 : tone === 'error' ? 7000 : 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  focusSessionId: null,
  focusSession: (id) => set({ focusSessionId: id }),
  focusDate: null,
  focusOnDate: (d) => set({ focusDate: d }),
  modalRequest: null,
  requestModal: (tab, modal) => set({ modalRequest: { tab, modal } }),
  timeCursor: null,
  setTimeCursor: (ms) => set({ timeCursor: ms === null || !Number.isFinite(ms) || !(CURSOR_TABS as readonly string[]).includes(get().tab) ? null : ms }),
  friseOpen: false,
  setFriseOpen: (friseOpen) => set({ friseOpen }),
  pendingConfirm: null,
  confirm(title, text, danger = true) {
    get().pendingConfirm?.resolve(false);
    return new Promise<boolean>((resolve) => set({ pendingConfirm: { title, text, danger, resolve } }));
  },
  resolveConfirm(ok) {
    const p = get().pendingConfirm;
    set({ pendingConfirm: null });
    p?.resolve(ok);
  },
}));
