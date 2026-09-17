import { create } from 'zustand';
import { desk, saveTextFile } from '@/lib/desk';
import { setUserPlans, type PropPlan } from '@/engine/propfirm';
import { db, exportVault, setSetting } from './db';
import { useUi } from './ui';

export type AgentProvider = 'openai-compatible' | 'anthropic';

export interface AgentConfig {
  provider: AgentProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Blob chiffré — le renderer ne détient plus la clé en clair sous le shell. */
  apiKeyEncrypted?: string;
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
  /** Plans saisis par l'opérateur — jamais écrasés par le registre bundled */
  userPlans: PropPlan[];
  boundaryHour: number;
  riskPerContract: number;
  calendarView: 'grille' | 'flux';
  /** Zoom UI : multiplicateur (auto) ou facteur absolu (manuel), 0.75–1.5 */
  uiZoom: number;
  /** true = calibrage écran automatique × uiZoom ; false = uiZoom absolu */
  uiZoomAuto: boolean;
  backupFolder: string | null;
  backupEncrypted: boolean;
  /** Copie quotidienne dans backupFolder si Electron et jour ≠ lastBackupAt. */
  backupDaily: boolean;
  /** Export barres + messages agent (gros). Défaut false. */
  backupIncludeHeavy: boolean;
  lastBackupAt: number | null;
  agent: AgentConfig;
  orchestratorPort: number;
  /** Autoriser l'orchestrateur externe à écrire (notes, annotations) */
  orchestratorAllowWrite: boolean;
  /** `dev` : git pull + npm install. Défaut `release` (page GitHub Releases). */
  updateChannel: 'release' | 'dev';
  llmAllowedHosts: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  callsign: 'OPÉRATEUR',
  startingBalance: 50_000,
  planId: 'apex-50',
  planAccount: '',
  userPlans: [],
  boundaryHour: 0,
  riskPerContract: 0,
  calendarView: 'grille',
  uiZoom: 1,
  uiZoomAuto: true,
  backupFolder: null,
  backupEncrypted: false,
  backupDaily: true,
  backupIncludeHeavy: false,
  lastBackupAt: null,
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
  updateChannel: 'release',
  llmAllowedHosts: [],
};

interface SettingsState {
  ready: boolean;
  settings: Settings;
  /** Vrai quand la clé API est chiffrée au repos par le trousseau du système */
  keyEncrypted: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  updateAgent: (patch: Partial<AgentConfig>) => Promise<void>;
  backupNow: () => Promise<{ ok: boolean; encrypted: boolean; path?: string }>;
}

type StoredSettings = Partial<Omit<Settings, 'agent'>> & {
  agent?: Partial<AgentConfig> & { apiKeyEncrypted?: string };
  userPlans?: unknown;
};

function keepUserPlans(raw: unknown): PropPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: PropPlan[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const p = row as Partial<PropPlan>;
    if (p.source !== 'user' || typeof p.id !== 'string' || !p.id) continue;
    out.push({ ...(p as PropPlan), source: 'user', version: typeof p.version === 'number' ? p.version : 1 });
  }
  return out;
}

/**
 * Persistance : sous le shell, la clé API est chiffrée par `safeStorage` (DPAPI / trousseau) et
 * seule sa forme chiffrée est écrite dans IndexedDB ; en navigateur elle reste en clair, localement.
 */
async function persist(settings: Settings): Promise<{ encrypted: boolean; blob?: string }> {
  const { apiKey, apiKeyEncrypted, ...agentRest } = settings.agent;
  let encrypted = false;
  let blob = apiKeyEncrypted;
  let agent: StoredSettings['agent'] = { ...agentRest, apiKey, apiKeyEncrypted };
  if (desk?.secrets && apiKey) {
    const payload = await desk.secrets.encrypt(apiKey);
    if (payload) {
      agent = { ...agentRest, apiKey: '', apiKeyEncrypted: payload };
      encrypted = true;
      blob = payload;
    }
  } else if (apiKeyEncrypted && !apiKey) {
    agent = { ...agentRest, apiKey: '', apiKeyEncrypted };
    encrypted = true;
    blob = apiKeyEncrypted;
  }
  await setSetting('settings', { ...settings, agent });
  return { encrypted, blob };
}

function todayUtc(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function writeBackupFile(folder: string, encrypt: boolean, includeHeavy: boolean): Promise<{ ok: boolean; encrypted: boolean; path?: string }> {
  const json = await exportVault({ includeHeavy });
  const name = `canto-vault-${todayUtc()}.json`;
  if (desk?.files.writeInFolder) return desk.files.writeInFolder(folder, name, json, encrypt);
  const saved = await saveTextFile(name, json, 'application/json');
  return { ok: saved, encrypted: false };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  keyEncrypted: false,
  async load() {
    const row = await db.settings.get('settings');
    const stored = (row?.value as StoredSettings | undefined) ?? {};
    const { apiKeyEncrypted, ...agentStored } = stored.agent ?? {};
    const blob = typeof apiKeyEncrypted === 'string' && apiKeyEncrypted.length > 0 ? apiKeyEncrypted : undefined;
    let apiKey = blob ? '' : typeof agentStored.apiKey === 'string' ? agentStored.apiKey : '';
    let keyEncrypted = !!blob;
    let next = { ...DEFAULT_SETTINGS, ...stored, userPlans: keepUserPlans(stored.userPlans), agent: { ...DEFAULT_SETTINGS.agent, ...agentStored, apiKey, apiKeyEncrypted: blob } };
    setUserPlans(next.userPlans);
    if (apiKey && desk?.secrets) {
      const r = await persist(next);
      if (r.encrypted) {
        apiKey = '';
        keyEncrypted = true;
        next = { ...next, agent: { ...next.agent, apiKey: '', apiKeyEncrypted: r.blob } };
      }
    }
    set({ settings: next, keyEncrypted, ready: true });
    void maybeDailyBackup(next);
  },
  async update(patch) {
    const next = { ...get().settings, ...patch, userPlans: keepUserPlans(patch.userPlans ?? get().settings.userPlans) };
    setUserPlans(next.userPlans);
    set({ settings: next });
    const r = await persist(next);
    set({
      keyEncrypted: r.encrypted,
      settings: r.blob ? { ...get().settings, agent: { ...get().settings.agent, apiKey: r.encrypted ? '' : get().settings.agent.apiKey, apiKeyEncrypted: r.blob } } : get().settings,
    });
  },
  async updateAgent(patch) {
    const next = { ...get().settings, agent: { ...get().settings.agent, ...patch } };
    set({ settings: next });
    const r = await persist(next);
    set({
      keyEncrypted: r.encrypted,
      settings: {
        ...get().settings,
        agent: { ...get().settings.agent, apiKey: r.encrypted && patch.apiKey !== undefined ? '' : get().settings.agent.apiKey, apiKeyEncrypted: r.blob ?? get().settings.agent.apiKeyEncrypted },
      },
    });
  },
  async backupNow() {
    let folder = get().settings.backupFolder;
    if (!folder && desk?.files.pickFolder) {
      folder = await desk.files.pickFolder();
      if (folder) await get().update({ backupFolder: folder });
    }
    const includeHeavy = get().settings.backupIncludeHeavy === true;
    if (!folder) {
      const json = await exportVault({ includeHeavy });
      const saved = await saveTextFile(`canto-vault-${todayUtc()}.json`, json, 'application/json');
      if (saved) await get().update({ lastBackupAt: Date.now() });
      return { ok: saved, encrypted: false };
    }
    const r = await writeBackupFile(folder, get().settings.backupEncrypted, includeHeavy);
    if (r.ok) {
      await get().update({ lastBackupAt: Date.now() });
      if (get().settings.backupEncrypted && !r.encrypted) useUi.getState().toast('Chiffrement indisponible : sauvegarde écrite en clair.', 'warn');
    }
    return r;
  },
}));

async function maybeDailyBackup(settings: Settings): Promise<void> {
  if (!settings.backupDaily || !settings.backupFolder || !desk?.files.writeInFolder) return;
  const last = settings.lastBackupAt ? todayUtc(settings.lastBackupAt) : '';
  if (todayUtc() === last) return;
  const r = await writeBackupFile(settings.backupFolder, settings.backupEncrypted, settings.backupIncludeHeavy === true);
  if (!r.ok) return;
  await useSettings.getState().update({ lastBackupAt: Date.now() });
  if (settings.backupEncrypted && !r.encrypted) useUi.getState().toast('Chiffrement indisponible : sauvegarde écrite en clair.', 'warn');
}
