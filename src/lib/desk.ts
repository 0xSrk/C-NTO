/** API exposée par le shell Electron (preload). Absente lorsque CΛNTO tourne dans un navigateur. */
import type { CalendarEventRow, CalendarSourceStatus } from '@/engine/calendarEvents';
export interface OrchestratorRequest {
  id: string;
  clientId: string;
  method: string;
  params: unknown;
}

export interface OrchestratorStatus {
  running: boolean;
  port: number;
  clients: number;
  error?: string;
}

export interface BridgeStatus {
  enabled: boolean;
  folder: string | null;
  watching: boolean;
  error?: string;
  files: number;
  pending: number;
  processed: number;
  lastEvent?: { at: number; file: string; kind: 'nouveau' | 'modifié' | 'rescan' };
  lastImport?: { at: number; file: string; format: string; trades: number; sessionsAdded: number; sessionsMerged: number; warnings: string[] };
}

export interface BridgeFilePayload {
  id: string;
  name: string;
  path: string;
  size: number;
  text: string;
  kind: 'nouveau' | 'modifié' | 'rescan';
}

export interface BridgeApi {
  status: () => Promise<BridgeStatus | null>;
  configure: (cfg: { folder?: string | null; enabled?: boolean }) => Promise<BridgeStatus | null>;
  pickFolder: () => Promise<string | null>;
  defaultFolder: () => Promise<string | null>;
  rescan: () => Promise<BridgeStatus | null>;
  result: (
    fileId: string,
    result: {
      format: string;
      trades: number;
      sessionsAdded: number;
      sessionsMerged: number;
      warnings: string[];
      path?: string;
      acceptedIds?: string[];
      skipped?: number;
    },
  ) => void;
  openFolder: (target: string) => Promise<boolean>;
  onFile: (cb: (file: BridgeFilePayload) => void) => () => void;
  onStatus: (cb: (status: BridgeStatus) => void) => () => void;
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
  busy: boolean;
  error?: string;
  /** Fichiers suivis modifiés localement, quand error === 'dirty_needs_stash'. */
  dirtyFiles?: string[];
  /** Application installée : installeur ouvert pour l'utilisateur (DMG, deb). */
  opened?: string;
  source: 'git' | 'github' | 'none';
  applied?: boolean;
}

export interface ZoomSnapshot {
  factor: number;
  auto: number;
  user: number;
  mode: 'auto' | 'manual';
  display: { width: number; height: number; scaleFactor: number; label: string };
}

export interface DeskApi {
  isDesk: true;
  platform: string;
  /** Version locale (package.json / app.getVersion) */
  version: () => Promise<string>;
  locale?: {
    get: () => Promise<'fr' | 'en' | 'es'>;
    set: (locale: 'fr' | 'en' | 'es') => Promise<'fr' | 'en' | 'es'>;
  };
  update: {
    check: () => Promise<UpdateStatus | null>;
    apply: (opts?: { channel?: string; confirmStash?: boolean }) => Promise<UpdateStatus | null>;
    relaunch: () => Promise<boolean>;
    startDesk: () => Promise<boolean>;
    onProgress?: (cb: (p: { received: number; total: number }) => void) => () => void;
  };
  bridge: BridgeApi;
  secrets: {
    /** Chiffre avec le trousseau du système ; null si indisponible */
    encrypt: (text: string) => Promise<string | null>;
  };
  llm?: {
    start: (payload: {
      requestId: string;
      config: { provider: string; baseUrl: string; model: string; temperature: number; apiKeyEncrypted?: string };
      messages: unknown[];
      tools: unknown[];
      allowedHosts?: string[];
    }) => Promise<void>;
    abort: (requestId: string) => void;
    probe: (config: {
      provider: string;
      baseUrl: string;
      model: string;
      temperature?: number;
      apiKeyEncrypted?: string;
      allowedHosts?: string[];
    }) => Promise<{ ok: boolean; detail: string; models?: string[] }>;
    onDelta: (cb: (p: { requestId: string; text: string }) => void) => () => void;
    onDone: (cb: (p: { requestId: string; result: { text: string; toolCalls: { id: string; name: string; args: string }[] } }) => void) => () => void;
    onError: (cb: (p: { requestId: string; error: string }) => void) => () => void;
  };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    onMaximized: (cb: (max: boolean) => void) => () => void;
  };
  zoom?: {
    get: () => Promise<ZoomSnapshot | null>;
    set: (payload: { user?: number; auto?: boolean }) => Promise<ZoomSnapshot | null>;
    step: (direction: 1 | -1) => Promise<ZoomSnapshot | null>;
    reset: () => Promise<ZoomSnapshot | null>;
    onChange: (cb: (snap: ZoomSnapshot) => void) => () => void;
  };
  files: {
    saveText: (defaultName: string, text: string) => Promise<boolean>;
    openText: (filters: { name: string; extensions: string[] }[]) => Promise<{ name: string; text: string } | null>;
    pickFolder?: () => Promise<string | null>;
    /** `reason: 'not_granted'` = dossier jamais accordé par un dialogue sur ce poste (à rechoisir). */
    writeInFolder?: (folder: string, name: string, text: string, encrypt: boolean) => Promise<{ ok: boolean; encrypted: boolean; path?: string; reason?: 'invalid' | 'not_granted' }>;
  };
  marketdata?: {
    subscribe: (req: { instrument: string; kind: 'bars' | 'quote' | 'tick'; timeframe?: number; contractMonth?: string }) => Promise<{ ok: false; detail: string }>;
    unsubscribe: (id: string) => Promise<{ ok: false; detail: string }>;
    onEvent: (cb: (event: { kind: string }) => void) => () => void;
  };
  calendar?: {
    fetchMacro: (fromDate: string, toDate: string) => Promise<{
      events: CalendarEventRow[];
      sources: CalendarSourceStatus[];
      error?: string;
    }>;
  };
  orchestrator: {
    start: (port: number, allowWrites?: boolean) => Promise<OrchestratorStatus>;
    stop: () => Promise<OrchestratorStatus>;
    status: () => Promise<OrchestratorStatus>;
    rotateToken: () => Promise<OrchestratorStatus>;
    copyToken: () => Promise<string | null>;
    respond: (id: string, clientId: string, result: unknown, error?: string) => void;
    broadcast: (event: string, payload: unknown) => void;
    onRequest: (cb: (req: OrchestratorRequest) => void) => () => void;
    onStatus: (cb: (status: OrchestratorStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    canto?: DeskApi;
  }
}

export const desk: DeskApi | undefined = typeof window !== 'undefined' ? window.canto : undefined;
export const isDesk = !!desk;

/** Enregistre un texte : dialogue natif sous Electron, téléchargement dans le navigateur. */
export async function saveTextFile(defaultName: string, text: string, mime = 'text/plain'): Promise<boolean> {
  if (desk) return desk.files.saveText(defaultName, text);
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Ouvre un fichier texte : dialogue natif sous Electron, `<input type=file>` sinon. */
export function openTextFile(accept = '.csv,.txt,.json'): Promise<{ name: string; text: string } | null> {
  if (desk) {
    const ext = accept.split(',').map((e) => e.trim().replace(/^\./, ''));
    const lang = document.documentElement.lang;
    const name = lang === 'en' ? 'Files' : lang === 'es' ? 'Archivos' : 'Fichiers';
    return desk.files.openText([{ name, extensions: ext }]);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
