import { create } from 'zustand';
import { uid } from '@/lib/id';

export type TabId = 'metrique' | 'visual' | 'calendrier' | 'note' | 'agent' | 'bot' | 'copieur';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

interface UiState {
  tab: TabId;
  setTab: (t: TabId) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone']) => void;
  dismiss: (id: string) => void;
  /** Sélection croisée : une séance choisie dans Métrique s'affiche dans Visual */
  focusSessionId: string | null;
  focusSession: (id: string | null) => void;
  /** Date choisie dans le calendrier, ouverte depuis un autre module */
  focusDate: string | null;
  focusOnDate: (d: string | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  tab: 'metrique',
  setTab: (tab) => set({ tab }),
  toasts: [],
  toast(text, tone = 'info') {
    const id = uid('n');
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  focusSessionId: null,
  focusSession: (id) => set({ focusSessionId: id }),
  focusDate: null,
  focusOnDate: (d) => set({ focusDate: d }),
}));
