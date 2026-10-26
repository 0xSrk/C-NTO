import { create } from 'zustand';
import type { CloudReport, CloudReportSummary } from '@/engine/agent/cloudReport';
import { desk, type AgentCloudApi, type AgentCloudStatus, type CloudSchedule } from '@/lib/desk';

/**
 * Agent cloud vu du renderer (`docs/AGENT-CLOUD.md`) : le statut du pont et le dossier des rapports, poussés par le
 * process principal. Rien ici ne touche au réseau ni à la clé : chaque action est une méthode nommée du preload, et
 * celles qui dépensent des crédits ouvrent un dialogue du process principal. Hors du desk, le store reste vide.
 */
export interface AgentCloudState {
  /** Vrai une fois le premier statut lu, ou constaté absent hors du desk. */
  ready: boolean;
  status: AgentCloudStatus | null;
  /** Le dossier, du plus récent au plus ancien. */
  reports: CloudReportSummary[];
  selectedId: string | null;
  /** Le rapport ouvert, lu à la sélection. */
  open: CloudReport | null;
  load: () => Promise<void>;
  /** Ouvre une fiche et la marque lue. `null` referme le lecteur. */
  select: (id: string | null) => Promise<void>;
  pull: () => Promise<void>;
  provision: () => Promise<void>;
  run: () => Promise<void>;
  pause: () => Promise<void>;
  unpause: () => Promise<void>;
  setKey: (text: string) => Promise<void>;
  setDeployment: (id: string | null) => Promise<void>;
  setSchedule: (schedule: CloudSchedule) => Promise<void>;
  openFolder: () => Promise<boolean>;
}

let unsubscribe: (() => void) | null = null;

export const useAgentCloud = create<AgentCloudState>((set, get) => {
  /** Une action du process principal : son statut remplace le nôtre ; `null` (refus, hôte absent) ne change rien. */
  const act = async (call: (api: AgentCloudApi) => Promise<AgentCloudStatus | null>): Promise<void> => {
    const api = desk?.agentCloud;
    if (!api) return;
    const status = await call(api);
    if (status) set({ status });
  };

  return {
    ready: false,
    status: null,
    reports: [],
    selectedId: null,
    open: null,

    async load() {
      const api = desk?.agentCloud;
      if (!api) {
        set({ ready: true });
        return;
      }
      if (!unsubscribe) {
        const offStatus = api.onStatus((status) => set({ status }));
        const offReports = api.onReports((reports) => {
          set({ reports });
          const { selectedId } = get();
          if (selectedId && !reports.some((r) => r.id === selectedId)) set({ selectedId: null, open: null });
        });
        unsubscribe = () => {
          offStatus();
          offReports();
        };
      }
      const [status, reports] = await Promise.all([api.status(), api.list()]);
      set({ ready: true, status: status ?? get().status, reports: Array.isArray(reports) ? reports : [] });
    },

    async select(id) {
      const api = desk?.agentCloud;
      if (!api || id === null) {
        set({ selectedId: null, open: null });
        return;
      }
      set({ selectedId: id });
      const report = await api.read(id);
      // Une autre fiche a pu être choisie pendant la lecture : seule la dernière s'affiche.
      if (get().selectedId !== id) return;
      set({ open: report });
      if (report && get().reports.some((r) => r.id === id && !r.read)) {
        set({ reports: get().reports.map((r) => (r.id === id ? { ...r, read: true } : r)) });
        const status = await api.markRead(id);
        if (status) set({ status });
      }
    },

    pull: () => act((api) => api.pull()),
    provision: () => act((api) => api.provision()),
    run: () => act((api) => api.run()),
    pause: () => act((api) => api.pause()),
    unpause: () => act((api) => api.unpause()),
    setKey: (text) => act((api) => api.setKey(text)),
    setDeployment: (id) => act((api) => api.setDeployment(id)),
    setSchedule: (schedule) => act((api) => api.setSchedule(schedule)),
    async openFolder() {
      return (await desk?.agentCloud?.openFolder()) ?? false;
    },
  };
});

/** Pour les tests : oublie les abonnements posés par `load()`. */
export function resetAgentCloudForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  useAgentCloud.setState({ ready: false, status: null, reports: [], selectedId: null, open: null });
}
