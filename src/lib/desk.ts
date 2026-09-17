/** API exposée par le shell Electron (preload). Absente lorsque CΛNTO tourne dans un navigateur. */
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
  /** Jeton de session à fournir par l'orchestrateur (`?token=` ou `desk.auth`) */
  token?: string;
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
  result: (fileId: string, result: { format: string; trades: number; sessionsAdded: number; sessionsMerged: number; warnings: string[] }) => void;
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
  update: {
    check: () => Promise<UpdateStatus | null>;
    apply: (opts?: { channel?: string; confirmStash?: boolean }) => Promise<UpdateStatus | null>;
    relaunch: () => Promise<boolean>;
    startDesk: () => Promise<boolean>;
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
    writeInFolder?: (folder: string, name: string, text: string, encrypt: boolean) => Promise<{ ok: boolean; encrypted: boolean; path?: string }>;
  };
  calendar?: {
    fetchMacro: (
      fromDate: string,
      toDate: string,
    ) => Promise<{
      releases: {
        id: string;
        date: string;
        timeET?: string;
        title: string;
        currency: string;
        impact: 1 | 2 | 3;
        forecast?: string;
        previous?: string;
        actual?: string;
        period?: string;
        source: 'investing' | 'forexfactory';
        at: string;
      }[];
      source: 'investing' | 'forexfactory' | 'none';
      error?: string;
    }>;
  };
  orchestrator: {
    start: (port: number, allowWrites?: boolean) => Promise<OrchestratorStatus>;
    stop: () => Promise<OrchestratorStatus>;
    status: () => Promise<OrchestratorStatus>;
    rotateToken: () => Promise<OrchestratorStatus>;
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
    return desk.files.openText([{ name: 'Fichiers', extensions: ext }]);
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
