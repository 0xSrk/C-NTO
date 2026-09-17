export const VAULT_FORMAT = 'canto-vault-v2' as const;

export interface VaultV2 {
  format: typeof VAULT_FORMAT;
  schemaVersion: 2;
  appVersion: string;
  exportedAt: number;
  sessions: unknown[];
  trades: unknown[];
  notes: unknown[];
  calendarNotes?: unknown[];
  bots?: unknown[];
  copier?: unknown[];
  settings?: unknown;
}

export interface VaultParts {
  appVersion: string;
  exportedAt?: number;
  sessions: unknown[];
  trades: unknown[];
  notes: unknown[];
  calendarNotes?: unknown[];
  bots?: unknown[];
  copier?: unknown[];
  settings?: unknown;
}

export interface ParsedVault {
  sessions: unknown;
  trades: unknown;
  notes: unknown;
  calendar: unknown;
  bots: unknown;
  copier: unknown;
  settings: unknown;
  settingsIsObject: boolean;
}

/** Retire les champs secrets (clé API, jeton) quel que soit le nidage. */
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = k.toLowerCase();
    if (n.includes('token')) continue;
    if (n.includes('apikey') || (n.includes('api') && n.includes('key'))) continue;
    if (n.includes('blob') && n.includes('key')) continue;
    out[k] = stripSecrets(v);
  }
  return out;
}

export function buildVaultV2(input: VaultParts): VaultV2 {
  const vault: VaultV2 = {
    format: VAULT_FORMAT,
    schemaVersion: 2,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt ?? Date.now(),
    sessions: input.sessions,
    trades: input.trades,
    notes: input.notes,
  };
  if (input.calendarNotes) vault.calendarNotes = input.calendarNotes;
  if (input.bots) vault.bots = input.bots;
  if (input.copier) vault.copier = input.copier;
  if (input.settings !== undefined) vault.settings = stripSecrets(input.settings);
  return vault;
}

export function parseVaultJson(json: string): ParsedVault {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Fichier illisible : JSON invalide.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Fichier non reconnu : sauvegarde CΛNTO attendue.');
  }
  const rec = data as Record<string, unknown>;
  const v2 = rec.format === VAULT_FORMAT || rec.schemaVersion === 2;
  const v1 = rec.artefact === 'CΛNTO';
  if (!v2 && !v1 && rec.sessions === undefined) {
    throw new Error('Fichier non reconnu : sauvegarde CΛNTO attendue.');
  }
  const settings = rec.settings;
  return {
    sessions: rec.sessions,
    trades: rec.trades,
    notes: rec.notes,
    calendar: rec.calendarNotes ?? rec.calendar,
    bots: rec.bots,
    copier: rec.copier ?? rec.copierAccounts,
    settings,
    settingsIsObject: !!settings && typeof settings === 'object' && !Array.isArray(settings),
  };
}
