import { create } from 'zustand';
import { tr } from '@/i18n';
import { desk, saveTextFile } from '@/lib/desk';
import { setUserPlans, type PropPlan } from '@/engine/propfirm';
import { db, exportVault, setSetting } from './db';
import { useUi } from './ui';

export type AgentProvider = 'openai-compatible' | 'anthropic';

const AGENT_PROMPT_FR =
  'Tu es l’agent embarqué de CΛNTO, desk de trading Nasdaq (NQ/MNQ, CME) forgé par SIΞRRΛSKΛ. Tu réponds en français, avec précision, et tu utilises les outils du desk pour lire les métriques, les séances, les notes et le calendrier du trader avant de conclure. Tu ne donnes jamais de conseil d’investissement personnalisé : tu analyses, tu structures, tu proposes des pistes de travail.';
const AGENT_PROMPT_EN =
  'You are the embedded agent of CΛNTO, a Nasdaq trading desk (NQ/MNQ, CME) forged by SIΞRRΛSKΛ. You reply in English, with precision, and you use desk tools to read the trader’s metrics, sessions, notes, and calendar before concluding. You never give personalized investment advice: you analyze, structure, and suggest lines of work.';
const AGENT_PROMPT_ES =
  'Eres el agente integrado de CΛNTO, un desk de trading Nasdaq (NQ/MNQ, CME) forjado por SIΞRRΛSKΛ. Respondes en español, con precisión, y usas las herramientas del desk para leer las métricas, sesiones, notas y el calendario del trader antes de concluir. Nunca das consejo de inversión personalizado: analizas, estructuras y propones pistas de trabajo.';

/** Consigne système par défaut selon la langue active. */
export function defaultAgentPrompt(): string {
  return tr(AGENT_PROMPT_FR, AGENT_PROMPT_EN, AGENT_PROMPT_ES);
}

/** Vrai si le texte stocké est encore l’une des consignes par défaut (FR / EN / ES). */
export function isDefaultAgentPrompt(prompt: string): boolean {
  return prompt === AGENT_PROMPT_FR || prompt === AGENT_PROMPT_EN || prompt === AGENT_PROMPT_ES;
}

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
  /** `dev` : clone git (pull + relance). Conservé pour l’UI ; un checkout git tire toujours origin/main. */
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
    systemPrompt: AGENT_PROMPT_FR,
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

const USER_PLANS_MAX = 64;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function keepUserPlans(raw: unknown): PropPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: PropPlan[] = [];
  for (const row of raw) {
    if (out.length >= USER_PLANS_MAX) break;
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const p = row as Partial<PropPlan>;
    if (p.source !== 'user' || typeof p.id !== 'string' || !p.id || p.id.length > 64) continue;
    if (!finite(p.accountSize) || !finite(p.profitTarget) || !finite(p.maxDrawdown)) continue;
    if (typeof p.firm !== 'string' || typeof p.label !== 'string' || p.firm.length > 120 || p.label.length > 120) continue;
    out.push({ ...(p as PropPlan), source: 'user', version: typeof p.version === 'number' && Number.isFinite(p.version) ? p.version : 1 });
  }
  return out;
}

const AGENT_PROVIDERS: readonly AgentProvider[] = ['openai-compatible', 'anthropic'];

function pickStr(v: unknown, max: number, fallback: string): string {
  return typeof v === 'string' && v.length <= max ? v : fallback;
}
function pickNum(v: unknown, min: number, max: number, fallback: number, integer = false): number {
  if (!finite(v) || v < min || v > max) return fallback;
  if (integer && !Number.isInteger(v)) return fallback;
  return v;
}
function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function pickEnum<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Sous-objet `agent` validé champ par champ ; toute valeur hors type/bornes retombe sur `base`. */
export function coerceAgentConfig(raw: unknown, base: AgentConfig): AgentConfig {
  const r = asRecord(raw) ?? {};
  const out: AgentConfig = {
    provider: pickEnum(r.provider, AGENT_PROVIDERS, base.provider),
    baseUrl: pickStr(r.baseUrl, 2048, base.baseUrl),
    model: pickStr(r.model, 256, base.model),
    apiKey: pickStr(r.apiKey, 4096, base.apiKey),
    systemPrompt: pickStr(r.systemPrompt, 20_000, base.systemPrompt),
    temperature: pickNum(r.temperature, 0, 2, base.temperature),
    toolsEnabled: pickBool(r.toolsEnabled, base.toolsEnabled),
  };
  const blob = 'apiKeyEncrypted' in r ? r.apiKeyEncrypted : base.apiKeyEncrypted;
  if (typeof blob === 'string' && blob.length > 0 && blob.length <= 8192) out.apiKeyEncrypted = blob;
  return out;
}

/**
 * Valide un objet de réglages venant du stockage ou d'un coffre : chaque clé est typée et bornée,
 * les valeurs invalides retombent sur `base`, les clés inconnues sont ignorées (ni prototype, ni surplus).
 */
export function coerceSettings(raw: unknown, base: Settings): Settings {
  const r = asRecord(raw) ?? {};
  const hosts = Array.isArray(r.llmAllowedHosts)
    ? r.llmAllowedHosts.filter((h): h is string => typeof h === 'string' && h.length > 0 && h.length <= 128).slice(0, 16)
    : base.llmAllowedHosts;
  return {
    callsign: pickStr(r.callsign, 40, base.callsign),
    startingBalance: finite(r.startingBalance) && r.startingBalance > 0 && r.startingBalance <= 1e9 ? r.startingBalance : base.startingBalance,
    planId: pickStr(r.planId, 64, base.planId),
    planAccount: pickStr(r.planAccount, 64, base.planAccount),
    userPlans: 'userPlans' in r ? keepUserPlans(r.userPlans) : base.userPlans,
    boundaryHour: pickNum(r.boundaryHour, 0, 23, base.boundaryHour, true),
    riskPerContract: pickNum(r.riskPerContract, 0, 1e9, base.riskPerContract),
    calendarView: pickEnum(r.calendarView, ['grille', 'flux'] as const, base.calendarView),
    uiZoom: pickNum(r.uiZoom, 0.5, 2, base.uiZoom),
    uiZoomAuto: pickBool(r.uiZoomAuto, base.uiZoomAuto),
    backupFolder: r.backupFolder === null ? null : typeof r.backupFolder === 'string' && r.backupFolder.length <= 1024 ? r.backupFolder : base.backupFolder,
    backupEncrypted: pickBool(r.backupEncrypted, base.backupEncrypted),
    backupDaily: pickBool(r.backupDaily, base.backupDaily),
    backupIncludeHeavy: pickBool(r.backupIncludeHeavy, base.backupIncludeHeavy),
    lastBackupAt: r.lastBackupAt === null ? null : finite(r.lastBackupAt) ? r.lastBackupAt : base.lastBackupAt,
    agent: coerceAgentConfig(r.agent, base.agent),
    orchestratorPort: pickNum(r.orchestratorPort, 1024, 65535, base.orchestratorPort, true),
    orchestratorAllowWrite: pickBool(r.orchestratorAllowWrite, base.orchestratorAllowWrite),
    updateChannel: pickEnum(r.updateChannel, ['release', 'dev'] as const, base.updateChannel),
    llmAllowedHosts: hosts,
  };
}

/** Clés d'un coffre autorisées à écraser les réglages locaux (jamais orchestrateur, sauvegarde, hôtes LLM, secrets). */
export const RESTORABLE_SETTING_KEYS = ['callsign', 'startingBalance', 'planId', 'planAccount', 'userPlans', 'boundaryHour', 'riskPerContract', 'calendarView', 'backupIncludeHeavy', 'uiZoom', 'uiZoomAuto'] as const;
export const RESTORABLE_AGENT_KEYS = ['provider', 'baseUrl', 'model', 'systemPrompt', 'temperature', 'toolsEnabled'] as const;

/** Ne garde d'un objet `settings` de coffre que les clés restaurables (typées ensuite par `coerceSettings`). */
export function pickRestorableSettings(raw: unknown): Record<string, unknown> {
  const r = asRecord(raw);
  const out: Record<string, unknown> = {};
  if (!r) return out;
  for (const k of RESTORABLE_SETTING_KEYS) if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k];
  const agent = asRecord(r.agent);
  if (agent) {
    const a: Record<string, unknown> = {};
    for (const k of RESTORABLE_AGENT_KEYS) if (Object.prototype.hasOwnProperty.call(agent, k)) a[k] = agent[k];
    if (Object.keys(a).length) out.agent = a;
  }
  return out;
}

/** Fusionne des réglages restaurables sur les réglages courants, avec validation complète. */
export function mergeRestoredSettings(current: unknown, restored: unknown): Settings {
  const base = coerceSettings(current, DEFAULT_SETTINGS);
  const picked = pickRestorableSettings(restored);
  const agentPatch = asRecord(picked.agent) ?? {};
  return coerceSettings({ ...base, ...picked, agent: { ...base.agent, ...agentPatch } }, base);
}

let warnedEncryptUnavailable = false;

/**
 * Persistance : sous le shell, la clé API est chiffrée par `safeStorage` (DPAPI / trousseau) et
 * seule sa forme chiffrée est écrite dans IndexedDB ; en navigateur elle reste en clair, localement.
 * Sous le shell, si le chiffrement échoue, la clé en clair n'est JAMAIS écrite : elle ne vit qu'en mémoire.
 */
async function persist(settings: Settings): Promise<{ encrypted: boolean; blob?: string; dropped: boolean }> {
  const { apiKey, apiKeyEncrypted, ...agentRest } = settings.agent;
  let encrypted = false;
  let dropped = false;
  let blob = apiKeyEncrypted;
  let agent: StoredSettings['agent'] = { ...agentRest, apiKey, apiKeyEncrypted };
  if (desk?.secrets && apiKey) {
    const payload = await desk.secrets.encrypt(apiKey);
    if (payload) {
      agent = { ...agentRest, apiKey: '', apiKeyEncrypted: payload };
      encrypted = true;
      blob = payload;
    } else {
      // Trousseau indisponible : on conserve l'ancien blob s'il existe, jamais le clair.
      agent = { ...agentRest, apiKey: '', apiKeyEncrypted };
      dropped = true;
      if (!warnedEncryptUnavailable) {
        warnedEncryptUnavailable = true;
        useUi.getState().toast(
          tr('Chiffrement indisponible : la clé n’est pas enregistrée.', 'Encryption unavailable: the key is not saved.', 'Cifrado no disponible: la clave no se guarda.'),
          'warn',
        );
      }
    }
  } else if (apiKeyEncrypted && !apiKey) {
    agent = { ...agentRest, apiKey: '', apiKeyEncrypted };
    encrypted = true;
    blob = apiKeyEncrypted;
  }
  await setSetting('settings', { ...settings, agent });
  return { encrypted, blob, dropped };
}

function todayUtc(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type BackupResult = { ok: boolean; encrypted: boolean; path?: string; reason?: 'invalid' | 'not_granted' };

async function writeBackupFile(folder: string, encrypt: boolean, includeHeavy: boolean): Promise<BackupResult> {
  const json = await exportVault({ includeHeavy });
  const name = `canto-vault-${todayUtc()}.json`;
  if (desk?.files.writeInFolder) return desk.files.writeInFolder(folder, name, json, encrypt);
  const saved = await saveTextFile(name, json, 'application/json');
  return { ok: saved, encrypted: false };
}

/** Le shell n'écrit que dans un dossier accordé par un dialogue : sinon, inviter à le rechoisir. */
function explainBackupFailure(r: BackupResult): void {
  if (r.ok) return;
  useUi.getState().toast(
    r.reason === 'not_granted'
      ? tr(
          'Dossier de sauvegarde à reconfirmer : Réglages › Dossier de sauvegarde › Choisir.',
          'Backup folder must be re-confirmed: Settings › Backup folder › Choose.',
          'Carpeta de copia por reconfirmar: Ajustes › Carpeta de copia › Elegir.',
        )
      : tr('Sauvegarde impossible dans ce dossier.', 'Could not write the backup in this folder.', 'No se pudo escribir la copia en esta carpeta.'),
    'warn',
  );
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  keyEncrypted: false,
  async load() {
    const row = await db.settings.get('settings');
    const stored = (row?.value as StoredSettings | undefined) ?? {};
    const agentStored = (stored.agent ?? {}) as Record<string, unknown>;
    const rawBlob = agentStored.apiKeyEncrypted;
    const blob = typeof rawBlob === 'string' && rawBlob.length > 0 && rawBlob.length <= 8192 ? rawBlob : undefined;
    const plain = typeof agentStored.apiKey === 'string' && agentStored.apiKey.length <= 4096 ? agentStored.apiKey : '';
    let apiKey = blob ? '' : plain;
    let keyEncrypted = !!blob;
    let next = coerceSettings({ ...stored, agent: { ...agentStored, apiKey, apiKeyEncrypted: blob } }, DEFAULT_SETTINGS);
    setUserPlans(next.userPlans);
    // Une ligne portant à la fois clé en clair et blob : on réécrit tout de suite sans le clair.
    const leakedPlain = !!blob && plain.length > 0;
    if ((apiKey && desk?.secrets) || leakedPlain) {
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
    // Le blob n'est réinjecté que si ce patch touchait la clé : sinon une écriture concurrente
    // (ex. lastBackupAt) pourrait remplacer une clé fraîchement saisie par l'ancien blob.
    if (patch.agent?.apiKey === undefined) return;
    set({
      keyEncrypted: r.encrypted,
      settings: r.blob ? { ...get().settings, agent: { ...get().settings.agent, apiKey: r.encrypted ? '' : get().settings.agent.apiKey, apiKeyEncrypted: r.blob } } : get().settings,
    });
  },
  async updateAgent(patch) {
    const touchesKey = Object.prototype.hasOwnProperty.call(patch, 'apiKey');
    const agent = { ...get().settings.agent, ...patch };
    // Effacement explicite : le blob chiffré part avec le clair, sinon la clé ne peut jamais être retirée.
    if (touchesKey && patch.apiKey === '') delete agent.apiKeyEncrypted;
    const next = { ...get().settings, agent };
    set({ settings: next });
    const r = await persist(next);
    if (!touchesKey) return;
    set({
      keyEncrypted: r.encrypted,
      settings: {
        ...get().settings,
        agent: { ...get().settings.agent, apiKey: r.encrypted ? '' : get().settings.agent.apiKey, apiKeyEncrypted: r.blob },
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
    explainBackupFailure(r);
    if (r.ok) {
      await get().update({ lastBackupAt: Date.now() });
      if (get().settings.backupEncrypted && !r.encrypted) {
        useUi.getState().toast(
          tr('Chiffrement indisponible : sauvegarde écrite en clair.', 'Encryption unavailable: backup written in cleartext.', 'Cifrado no disponible: copia de seguridad escrita en claro.'),
          'warn',
        );
      }
    }
    return r;
  },
}));

async function maybeDailyBackup(settings: Settings): Promise<void> {
  if (!settings.backupDaily || !settings.backupFolder || !desk?.files.writeInFolder) return;
  const last = settings.lastBackupAt ? todayUtc(settings.lastBackupAt) : '';
  if (todayUtc() === last) return;
  const r = await writeBackupFile(settings.backupFolder, settings.backupEncrypted, settings.backupIncludeHeavy === true);
  if (!r.ok) {
    explainBackupFailure(r);
    return;
  }
  await useSettings.getState().update({ lastBackupAt: Date.now() });
  if (settings.backupEncrypted && !r.encrypted) {
    useUi.getState().toast(
      tr('Chiffrement indisponible : sauvegarde écrite en clair.', 'Encryption unavailable: backup written in cleartext.', 'Cifrado no disponible: copia de seguridad escrita en claro.'),
      'warn',
    );
  }
}
