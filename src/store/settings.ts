import { create } from 'zustand';
import { db, setSetting } from './db';

export type AgentProvider = 'openai-compatible' | 'anthropic';

export interface AgentConfig {
  provider: AgentProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  temperature: number;
  toolsEnabled: boolean;
}

export interface Settings {
  callsign: string;
  startingBalance: number;
  planId: string;
  boundaryHour: number;
  riskPerContract: number;
  calendarView: 'grille' | 'flux';
  agent: AgentConfig;
  orchestratorPort: number;
  bootSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  callsign: 'OPÉRATEUR',
  startingBalance: 50_000,
  planId: 'apex-50',
  boundaryHour: 0,
  riskPerContract: 0,
  calendarView: 'grille',
  agent: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    apiKey: '',
    systemPrompt:
      'Tu es l’agent embarqué de CΛNTO, desk de trading Nasdaq (NQ/MNQ, CME) forgé par SIΞRRΛSKΛ. Tu réponds en français, avec précision, et tu utilises les outils du desk pour lire les métriques, les séances, les notes et le calendrier du trader avant de conclure. Tu ne donnes jamais de conseil d’investissement personnalisé : tu analyses, tu structures, tu proposes des pistes de travail.',
    temperature: 0.3,
    toolsEnabled: true,
  },
  orchestratorPort: 47117,
  bootSeen: false,
};

interface SettingsState {
  ready: boolean;
  settings: Settings;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  updateAgent: (patch: Partial<AgentConfig>) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  async load() {
    const row = await db.settings.get('settings');
    const stored = (row?.value as Partial<Settings> | undefined) ?? {};
    set({ settings: { ...DEFAULT_SETTINGS, ...stored, agent: { ...DEFAULT_SETTINGS.agent, ...(stored.agent ?? {}) } }, ready: true });
  },
  async update(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await setSetting('settings', next);
  },
  async updateAgent(patch) {
    const next = { ...get().settings, agent: { ...get().settings.agent, ...patch } };
    set({ settings: next });
    await setSetting('settings', next);
  },
}));
