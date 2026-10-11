/** API exposée par le shell Electron (preload). Absente lorsque CΛNTO tourne dans un navigateur. */
import type { CalendarEventRow, CalendarSourceStatus } from '@/engine/calendarEvents';
import type { ChangelogFile } from '@/engine/changelog';
import type { AgentOrderRefusal } from '@/engine/agent/orders';
import type { CryptoBar, CryptoFeedEvent, CryptoSeriesId, CryptoTimeframe, CryptoVenue, VenueState } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import type { KillSwitchReport } from '@/engine/execution/killSwitch';
import type { OrderBookView, OrderChange } from '@/engine/execution/orderBook';
/** Passerelle MCP des agents externes (process principal). Le jeton n'y figure jamais. */
export interface McpStatus {
  running: boolean;
  port: number;
  calls: number;
  lastCallAt?: number;
  error?: string;
}

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

/** Exécution reçue du pont : CSV pour le journal, champs lus par le journal d'événements. */
export interface NtExecutionPayload {
  csv: string;
  executionId: string;
  fill?: { account: string; instrument: string; action: string; quantity: number; price: number; time: number; entryExit?: string };
}

export interface NtBridgeStatus {
  link: 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
  port: number;
  addonVersion: string | null;
  ntVersion: string | null;
  accounts: { name: string; cashValue: number; realizedPnl: number; unrealizedPnl: number; positions: { instrument: string; quantity: number; avgPrice: number }[] }[];
  /** Réception des derniers comptes par le process principal (epoch ms) ; `null` avant le premier envoi. */
  accountsAt?: number | null;
  accountNames: string[];
  heartbeatLatencyMs: number | null;
  ordersOpen: boolean;
  hasToken: boolean;
  extraAccounts: string[];
  maxContractsPerOrder: number;
  killSwitchShortcut: string;
  /** `token` : AddOn antérieur à 2.2.0, qui envoie son jeton sans vérifier le desk. */
  auth?: 'mutual' | 'token' | null;
}

/** Ce que Couper laisse derrière lui (voir `electron/nt-bridge/copier-host.ts`). */
export interface CopierCutReport {
  cancelled: string[];
  open: { account: string; instrument: string; qty: number }[];
  flattened: string[];
}

export interface CopierHostStatus {
  armed: boolean;
  link: 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
  routed: number;
  lastRefusal: { reason: string; account: string; instrument: string; qty: number } | null;
  flattenOnCut: boolean;
}

export interface CopierApi {
  status: () => Promise<CopierHostStatus | null>;
  configure: (sync: unknown) => Promise<boolean>;
  arm: () => Promise<CopierHostStatus | null>;
  cut: () => Promise<CopierCutReport>;
  onStatus: (cb: (status: CopierHostStatus) => void) => () => void;
}

/** Ordres proposés par l'agent (A5) : gardes, dialogue et soumission dans le process principal. */
export interface AgentOrderStatus {
  enabled: boolean;
  maxQty: number;
  maxPosition: number;
  perMinute: number;
  /** Une proposition attend la réponse du trader. */
  pending: boolean;
}

export type AgentOrderOrigin = 'llm' | 'mcp' | 'orch';

export type AgentOrderOutcome =
  | { status: 'sent'; orderId: string; latencyMs?: number; account: string; instrument: string; side: 'buy' | 'sell'; qty: number; resulting: number }
  | { status: 'refused'; reason: AgentOrderRefusal | 'invalid'; detail: string }
  | { status: 'declined'; detail: string }
  | { status: 'failed'; code?: number; detail: string };

export interface AgentOrdersApi {
  status: () => Promise<AgentOrderStatus>;
  /** Dialogue du process principal ; rend le statut, activé ou non. */
  enable: () => Promise<AgentOrderStatus>;
  disable: () => Promise<AgentOrderStatus>;
  /** Relever une limite passe par un dialogue du process principal. */
  limits: (raw: Partial<Pick<AgentOrderStatus, 'maxQty' | 'maxPosition' | 'perMinute'>>) => Promise<AgentOrderStatus>;
  /** `traderRule` : règle du trader que l'ouverture enfreindrait (`traderRuleFor`), relue par le process principal. */
  propose: (raw: unknown, origin: AgentOrderOrigin, propShare: number | null, traderRule?: { rule: string; detail: string } | null) => Promise<AgentOrderOutcome>;
}

/** Siège nominatif : le process principal vérifie le code ; le renderer ne reçoit que le nom signé. */
export interface SeatApi {
  status: () => Promise<{ client: string } | null>;
  submit: (line: string) => Promise<{ ok: true; client: string } | { ok: false }>;
}

/** Module crypto (onglet 09) : l'interrupteur et l'état des trois venues. Le renderer les lit, le process principal les tient. */
export interface CryptoMainStatus {
  enabled: boolean;
  venues: Record<CryptoVenue, VenueState>;
}

/**
 * Le module crypto vu du renderer : tout le réseau est dans le process principal, qui valide chaque requête et refuse tout
 * interrupteur éteint (`crypto_disabled`, `{ ok: false }`, `null`) ou forme invalide (`invalid_request`).
 */
export interface CryptoApi {
  status: () => Promise<CryptoMainStatus>;
  /** Dialogue du process principal ; rend le statut, allumé ou non. */
  enable: () => Promise<CryptoMainStatus>;
  disable: () => Promise<CryptoMainStatus>;
  /** Historique d'une série (marché affichable ou source du CVD Binance), bougies en secondes UTC. */
  history: (req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }) => Promise<{ ok: true; bars: CryptoBar[] } | { ok: false; detail: string }>;
  /** `ticker` : marché affichable ; `bars` : affichable ou source du CVD, timeframe requis. */
  subscribe: (req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }) => Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string }>;
  unsubscribe: (id: string) => Promise<{ ok: boolean }>;
  /** Dernière lecture de la température ; `null` interrupteur éteint. */
  temperature: () => Promise<TemperatureReading | null>;
  /** Tickers et bougies des abonnements, au plus un envoi toutes les 250 ms par série et timeframe ou par marché. */
  onEvent: (cb: (e: CryptoFeedEvent) => void) => () => void;
  onTemperature: (cb: (r: TemperatureReading) => void) => () => void;
  onStatus: (cb: (s: CryptoMainStatus) => void) => () => void;
}

export interface NtBridgeApi {
  status: () => Promise<NtBridgeStatus | null>;
  rotateToken: () => Promise<{ hasToken: boolean }>;
  writeConfig: () => Promise<{ ok: boolean; path?: string; error?: string; aclRestricted?: boolean }>;
  allowAccount: (name: string) => Promise<NtBridgeStatus | null>;
  setMaxContracts: (n: number) => Promise<NtBridgeStatus | null>;
  order: (payload: { op: 'submit' | 'cancel' | 'flatten'; [key: string]: unknown }) => Promise<{ ok: boolean; code?: number; message?: string; orderId?: string; latencyMs?: number; closed?: number }>;
  killSwitch: () => Promise<KillSwitchReport>;
  onStatus: (cb: (status: NtBridgeStatus) => void) => () => void;
  onExecution: (cb: (payload: NtExecutionPayload) => void) => () => void;
  /** Livre des ordres en cours tenu par le process principal (lecture seule). */
  orders?: () => Promise<OrderBookView | null>;
  /** Changement d'état d'un ordre du pont, une fois par changement. */
  onOrder?: (cb: (change: OrderChange) => void) => () => void;
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
    /** Journal de la Release disponible. `null` si l'asset manque, dépasse 64 Ko ou est invalide. */
    changelog: () => Promise<ChangelogFile | null>;
    apply: (opts?: { channel?: string; confirmStash?: boolean }) => Promise<UpdateStatus | null>;
    relaunch: () => Promise<boolean>;
    startDesk: () => Promise<boolean>;
    onProgress?: (cb: (p: { received: number; total: number }) => void) => () => void;
  };
  bridge: BridgeApi;
  ntbridge?: NtBridgeApi;
  copier?: CopierApi;
  agentOrders?: AgentOrdersApi;
  seat?: SeatApi;
  /** Module crypto personnel, éteint par défaut ; absent hors du desk. */
  crypto?: CryptoApi;
  secrets: {
    /** Chiffre avec le trousseau du système ; null si indisponible */
    encrypt: (text: string) => Promise<string | null>;
  };
  llm?: {
    start: (payload: {
      requestId: string;
      config: { provider: string; baseUrl: string; model: string; temperature: number; apiKeyEncrypted?: string; apiKeyHost?: string };
      messages: unknown[];
      tools: unknown[];
      toolChoice?: 'auto' | 'none';
      allowedHosts?: string[];
    }) => Promise<void>;
    abort: (requestId: string) => void;
    probe: (config: {
      provider: string;
      baseUrl: string;
      model: string;
      temperature?: number;
      apiKeyEncrypted?: string;
      apiKeyHost?: string;
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
    subscribe: (req: { instrument: string; kind: 'bars' | 'quote' | 'tick'; timeframe?: number; contractMonth?: string }) => Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string; code?: number }>;
    unsubscribe: (id: string) => Promise<{ ok: boolean; detail?: string }>;
    history?: (req: { instrument: string; timeframe: number; from: number; to: number }) => Promise<{ ok: true; bars: unknown[] } | { ok: false; detail: string }>;
    onEvent: (cb: (event: { kind: string }) => void) => () => void;
  };
  calendar?: {
    fetchMacro: (fromDate: string, toDate: string) => Promise<{
      events: CalendarEventRow[];
      sources: CalendarSourceStatus[];
      error?: string;
    }>;
  };
  mcp?: {
    start: (port: number, allowWrites?: boolean) => Promise<McpStatus>;
    stop: () => Promise<McpStatus>;
    status: () => Promise<McpStatus>;
    rotateToken: () => Promise<McpStatus>;
    connection: () => Promise<{ url: string; token: string } | null>;
    onStatus: (cb: (status: McpStatus) => void) => () => void;
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
