import { create } from 'zustand';
import { FORMAT_LABEL } from '@/engine/import';
import { desk, type BridgeFilePayload, type BridgeStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { useJournal } from './journal';
import { useSettings } from './settings';
import { useUi } from './ui';

export interface BridgeLogEntry {
  id: string;
  at: number;
  file: string;
  kind: BridgeFilePayload['kind'];
  format: string;
  trades: number;
  sessionsAdded: number;
  sessionsMerged: number;
  warnings: string[];
  error?: string;
}

interface BridgeState {
  ready: boolean;
  available: boolean;
  status: BridgeStatus | null;
  log: BridgeLogEntry[];
  busy: boolean;
  load: () => Promise<void>;
  pickFolder: () => Promise<void>;
  useDefaultFolder: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  rescan: () => Promise<void>;
  openFolder: () => Promise<void>;
}

let unsubscribeFile: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

const IDLE: BridgeStatus = { enabled: false, folder: null, watching: false, files: 0, pending: 0, processed: 0 };

export const useBridge = create<BridgeState>((set, get) => ({
  ready: false,
  available: !!desk,
  status: null,
  log: [],
  busy: false,

  async load() {
    const api = desk?.bridge;
    if (!api) {
      set({ ready: true, status: IDLE });
      return;
    }
    if (!unsubscribeFile) {
      unsubscribeFile = api.onFile(async (file) => {
        const { settings } = useSettings.getState();
        const entry: BridgeLogEntry = { id: uid('bl'), at: Date.now(), file: file.name, kind: file.kind, format: 'inconnu', trades: 0, sessionsAdded: 0, sessionsMerged: 0, warnings: [] };
        try {
          const r = await useJournal.getState().importCsv(file.text, { boundaryHour: settings.boundaryHour, riskPerContract: settings.riskPerContract || undefined, source: 'ninjatrader' });
          entry.format = FORMAT_LABEL[r.format];
          entry.trades = r.newTrades;
          entry.sessionsAdded = r.added;
          entry.sessionsMerged = r.merged;
          entry.warnings = r.warnings;
          if (r.newTrades > 0) useUi.getState().toast(`Pont NinjaTrader · ${r.newTrades} trade(s) importé(s) depuis ${file.name} (${r.added} séance(s) créée(s), ${r.merged} fusionnée(s)).`, 'ok');
          else if (r.format === 'inconnu') useUi.getState().toast(`Pont NinjaTrader · ${file.name} ignoré : format non reconnu.`, 'warn');
        } catch (e) {
          entry.error = e instanceof Error ? e.message : String(e);
          useUi.getState().toast(`Pont NinjaTrader · échec sur ${file.name} : ${entry.error}`, 'error');
        }
        api.result(file.id, { format: entry.format, trades: entry.trades, sessionsAdded: entry.sessionsAdded, sessionsMerged: entry.sessionsMerged, warnings: entry.warnings });
        set({ log: [entry, ...get().log].slice(0, 60) });
      });
      unsubscribeStatus = api.onStatus((status) => set({ status }));
    }
    set({ status: (await api.status()) ?? IDLE, ready: true });
  },

  async pickFolder() {
    const api = desk?.bridge;
    if (!api) return;
    const folder = await api.pickFolder();
    if (!folder) return;
    set({ busy: true });
    set({ status: (await api.configure({ folder, enabled: true })) ?? get().status, busy: false });
  },

  async useDefaultFolder() {
    const api = desk?.bridge;
    if (!api) return;
    set({ busy: true });
    const folder = await api.defaultFolder();
    if (folder) set({ status: (await api.configure({ folder, enabled: true })) ?? get().status });
    set({ busy: false });
  },

  async setEnabled(enabled) {
    const api = desk?.bridge;
    if (!api) return;
    set({ status: (await api.configure({ enabled })) ?? get().status });
  },

  async rescan() {
    const api = desk?.bridge;
    if (!api) return;
    set({ busy: true });
    set({ status: (await api.rescan()) ?? get().status, busy: false });
  },

  async openFolder() {
    const folder = get().status?.folder;
    if (folder && desk?.bridge) await desk.bridge.openFolder(folder);
  },
}));

export function disposeBridge(): void {
  unsubscribeFile?.();
  unsubscribeStatus?.();
  unsubscribeFile = null;
  unsubscribeStatus = null;
}
