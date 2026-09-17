import { create } from 'zustand';
import { desk } from '@/lib/desk';
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
  /** Compte rejoué contre le plan ('' = toutes les séances) */
  planAccount: string;
  boundaryHour: number;
  riskPerContract: number;
  calendarView: 'grille' | 'flux';
  /** Zoom UI : multiplicateur (auto) ou facteur absolu (manuel), 0.75–1.5 */
  uiZoom: number;
  /** true = calibrage écran automatique × uiZoom ; false = uiZoom absolu */
  uiZoomAuto: boolean;
  agent: AgentConfig;
  orchestratorPort: number;
  /** Autoriser l'orchestrateur externe à écrire (notes, annotations) */
  orchestratorAllowWrite: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  callsign: 'OPÉRATEUR',
  startingBalance: 50_000,
  planId: 'apex-50',
  planAccount: '',
  boundaryHour: 0,
  riskPerContract: 0,
  calendarView: 'grille',
  uiZoom: 1,
  uiZoomAuto: true,
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
  orchestratorAllowWrite: false,
};

interface SettingsState {
  ready: boolean;
  settings: Settings;
  /** Vrai quand la clé API est chiffrée au repos par le trousseau du système */
  keyEncrypted: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  updateAgent: (patch: Partial<AgentConfig>) => Promise<void>;
}

type StoredSettings = Partial<Omit<Settings, 'agent'>> & {
  agent?: Partial<AgentConfig> & { apiKeyEncrypted?: string };
};

/**
 * Persistance : sous le shell, la clé API est chiffrée par `safeStorage` (DPAPI / trousseau) et
 * seule sa forme chiffrée est écrite dans IndexedDB ; en navigateur elle reste en clair, localement.
 */
async function persist(settings: Settings): Promise<boolean> {
  const { apiKey, ...agentRest } = settings.agent;
  let encrypted = false;
  let agent: StoredSettings['agent'] = { ...agentRest, apiKey };
  if (desk?.secrets && apiKey) {
    const payload = await desk.secrets.encrypt(apiKey);
    if (payload) {
      agent = { ...agentRest, apiKey: '', apiKeyEncrypted: payload };
      encrypted = true;
    }
  }
  await setSetting('settings', { ...settings, agent });
  return encrypted;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  keyEncrypted: false,
  async load() {
    const row = await db.settings.get('settings');
    const stored = (row?.value as StoredSettings | undefined) ?? {};
    const { apiKeyEncrypted, ...agentStored } = stored.agent ?? {};
    let apiKey = typeof agentStored.apiKey === 'string' ? agentStored.apiKey : '';
    let keyEncrypted = false;
    if (apiKeyEncrypted && desk?.secrets) {
      const clear = await desk.secrets.decrypt(apiKeyEncrypted);
      if (clear !== null) {
        apiKey = clear;
        keyEncrypted = true;
      }
    }
    set({ settings: { ...DEFAULT_SETTINGS, ...stored, agent: { ...DEFAULT_SETTINGS.agent, ...agentStored, apiKey } }, keyEncrypted, ready: true });
  },
  async update(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    set({ keyEncrypted: await persist(next) });
  },
  async updateAgent(patch) {
    const next = { ...get().settings, agent: { ...get().settings.agent, ...patch } };
    set({ settings: next });
    set({ keyEncrypted: await persist(next) });
  },
}));
