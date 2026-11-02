import { create } from 'zustand';
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
  /** Filtre de comptes de Métrique. `null` = tous les comptes. */
  metricAccount: string | null;
  setMetricAccount: (account: string | null) => void;
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

export const useUi = create<UiState>((set, get) => ({
  tab: 'metrique',
  // Le curseur ne vit que là où on le lit : ouvrir un module hors de Métrique et du Calendrier le rend au présent.
  setTab: (tab) => set({ tab, timeCursor: cursorOnTab(tab, get().timeCursor) }),
  metricAccount: null,
  setMetricAccount: (metricAccount) => set({ metricAccount }),
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
