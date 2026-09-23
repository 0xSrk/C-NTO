import { create } from 'zustand';
import { uid } from '@/lib/id';

export type TabId = 'metrique' | 'visual' | 'calendrier' | 'note' | 'agent' | 'bot' | 'copieur';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
  action?: { label: string; run: () => void };
}

interface UiState {
  tab: TabId;
  setTab: (t: TabId) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismiss: (id: string) => void;
  /** Sélection croisée : une séance choisie dans Métrique s'affiche dans Visual */
  focusSessionId: string | null;
  focusSession: (id: string | null) => void;
  /** Date choisie dans le calendrier, ouverte depuis un autre module */
  focusDate: string | null;
  focusOnDate: (d: string | null) => void;
  /** Dialogue de confirmation (remplace window.confirm) */
  pendingConfirm: { title: string; text?: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
  confirm: (title: string, text?: string, danger?: boolean) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
}

export const useUi = create<UiState>((set, get) => ({
  tab: 'metrique',
  setTab: (tab) => set({ tab }),
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
