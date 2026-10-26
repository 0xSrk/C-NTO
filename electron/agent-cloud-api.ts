import { cleanText, isApiId } from './agent/cloudReport';

/**
 * Client de l'API Managed Agents d'Anthropic, côté process principal (agent cloud, `docs/AGENT-CLOUD.md`). Un seul
 * hôte, écrit ici : `api.anthropic.com`, en https ; aucune URL ne vient du renderer, chaque chemin est bâti d'un
 * identifiant d'objet vérifié (`isApiId`). Redirections refusées (la clé ne suit pas un 3xx), délai, corps borné et
 * décodé en UTF-8 strict. Les messages d'erreur ne citent ni la clé, ni l'URL complète, ni un corps entier.
 * Aucun import d'Electron : le `fetch` est injecté (`fetchImpl`), ce qui garde le module testable.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const CLOUD_API_ORIGIN = 'https://api.anthropic.com';
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';
/** Les points d'accès Managed Agents se comportent à l'identique en `2023-06-01` et `2026-10-21` ; le desk envoie déjà `2023-06-01`. */
export const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 20_000;
/** Une réponse JSON de l'API (liste de 20 sessions et leurs agents figés) reste sous 2 Mio. */
const JSON_MAX_BYTES = 2 * 1024 * 1024;
const ERROR_MAX_BYTES = 16 * 1024;
const MESSAGE_MAX = 200;
const RETRY_AFTER_MAX_SEC = 3600;

/**
 * Échec d'un appel. `status` : statut HTTP, ou 0 hors HTTP. `type` : le `error.type` de l'API (`authentication_error`,
 * `not_found_error`…), ou une cause locale (`no_key`, `invalid_id`, `timeout`, `network`, `redirect`, `too_large`, `unreadable`).
 */
export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'CloudApiError';
  }
}

export interface DeploymentView {
  id: string;
  name: string;
  status: 'active' | 'paused';
  archived: boolean;
  /** `manual`, ou le type d'erreur qui a mis le déploiement en pause (`environment_archived_error`…). */
  pausedReason: string | null;
  agentId: string | null;
  agentVersion: number | null;
  environmentId: string | null;
  cron: string | null;
  timezone: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  budgetCents: number | null;
  /** Posé par le desk (`metadata.canto` = `agent-cloud`) : un déploiement qu'il peut reprendre plutôt que doubler. */
  tagged: boolean;
}

export type SessionStatus = 'idle' | 'running' | 'rescheduling' | 'terminated';

export interface SessionView {
  id: string;
  status: SessionStatus;
  createdAt: number | null;
  updatedAt: number | null;
  archived: boolean;
  costCents: number | null;
  agentVersion: number | null;
  /** Un résultat attendu est encore évalué (`pending`, `running`, `evaluating`). */
  outcomePending: boolean;
  /** Dernier verdict terminal du correcteur (`satisfied`, `max_iterations_reached`, `failed`, `interrupted`). */
  outcomeResult: string | null;
}

export interface SessionPage {
  sessions: SessionView[];
  nextPage: string | null;
}

export interface RunView {
  id: string;
  createdAt: number | null;
  trigger: 'schedule' | 'manual' | null;
  sessionId: string | null;
  errorType: string | null;
  errorMessage: string;
}

export interface FileView {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: number | null;
}

export interface CloudApi {
  getDeployment(id: string): Promise<DeploymentView>;
  /** Déploiements non archivés d'un agent (100 au plus). */
  listDeployments(agentId: string): Promise<DeploymentView[]>;
  /** Sessions nées du déploiement, archivées comprises, la plus récente d'abord ; `nextPage` mène aux plus anciennes. */
  listSessions(deploymentId: string, opts?: { limit?: number; page?: string }): Promise<SessionPage>;
  /** Déclenchements en échec (aucune session créée) depuis `sinceIso`. */
  listFailedRuns(deploymentId: string, sinceIso: string, limit?: number): Promise<RunView[]>;
  /** Fichiers déposés par la session dans `/mnt/session/outputs/`. */
  listOutputFiles(sessionId: string): Promise<FileView[]>;
  /** Contenu d'un fichier en UTF-8 strict, refusé au-delà de `maxBytes`. */
  downloadText(fileId: string, maxBytes: number): Promise<string>;
  createEnvironment(body: Record<string, unknown>): Promise<{ id: string }>;
  updateEnvironment(id: string, body: Record<string, unknown>): Promise<{ id: string }>;
  createAgent(body: Record<string, unknown>): Promise<{ id: string; version: number }>;
  updateAgent(id: string, body: Record<string, unknown>): Promise<{ id: string; version: number }>;
  createDeployment(body: Record<string, unknown>): Promise<DeploymentView>;
  updateDeployment(id: string, body: Record<string, unknown>): Promise<DeploymentView>;
  runDeployment(id: string): Promise<RunView>;
  pauseDeployment(id: string): Promise<DeploymentView>;
  unpauseDeployment(id: string): Promise<DeploymentView>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 256): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

function instant(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Montant en cents, chaîne entière décimale (`"2500"`), en dollars US seulement. */
function cents(v: unknown): number | null {
  if (!isRecord(v) || (v.currency !== undefined && v.currency !== 'USD')) return null;
  if (typeof v.amount !== 'string' || !/^\d{1,12}$/.test(v.amount)) return null;
  return Number(v.amount);
}

function apiId(v: unknown, prefix: string): string | null {
  return isApiId(v, prefix) ? v : null;
}

export function parseDeployment(raw: unknown): DeploymentView {
  if (!isRecord(raw)) throw new CloudApiError(0, 'unreadable', 'Déploiement illisible');
  const id = apiId(raw.id, 'depl');
  if (!id) throw new CloudApiError(0, 'unreadable', 'Déploiement illisible');
  const schedule = isRecord(raw.schedule) ? raw.schedule : null;
  const upcoming = schedule && Array.isArray(schedule.upcoming_runs_at) ? schedule.upcoming_runs_at.map(instant).filter((t): t is number => t !== null) : [];
  const paused = isRecord(raw.paused_reason) ? raw.paused_reason : null;
  const pausedError = paused && isRecord(paused.error) ? str(paused.error.type, 80) : null;
  const agent = isRecord(raw.agent) ? raw.agent : null;
  const budget = isRecord(raw.budget) ? raw.budget : null;
  return {
    id,
    name: cleanText(raw.name, 256),
    status: raw.status === 'paused' ? 'paused' : 'active',
    archived: typeof raw.archived_at === 'string',
    pausedReason: paused ? (pausedError ?? str(paused.type, 40)) : null,
    agentId: agent ? apiId(agent.id, 'agent') : null,
    agentVersion: agent ? int(agent.version) : null,
    environmentId: apiId(raw.environment_id, 'env'),
    cron: schedule ? str(schedule.expression) : null,
    timezone: schedule ? str(schedule.timezone, 64) : null,
    nextRunAt: upcoming.length ? Math.min(...upcoming) : null,
    lastRunAt: schedule ? instant(schedule.last_run_at) : null,
    budgetCents: budget ? cents(budget.max_list_cost) : null,
    tagged: isRecord(raw.metadata) && raw.metadata.canto === 'agent-cloud',
  };
}

const SESSION_STATUSES: readonly SessionStatus[] = ['idle', 'running', 'rescheduling', 'terminated'];
const OUTCOME_OPEN = new Set(['pending', 'running', 'evaluating']);

export function parseSession(raw: unknown): SessionView | null {
  if (!isRecord(raw)) return null;
  const id = apiId(raw.id, 'sesn');
  const status = SESSION_STATUSES.find((s) => s === raw.status);
  if (!id || !status) return null;
  const evaluations = Array.isArray(raw.outcome_evaluations) ? raw.outcome_evaluations.filter(isRecord) : [];
  const results = evaluations.map((e) => str(e.result, 40)).filter((r): r is string => r !== null);
  const terminal = results.filter((r) => !OUTCOME_OPEN.has(r));
  const usage = isRecord(raw.usage) ? raw.usage : null;
  const agent = isRecord(raw.agent) ? raw.agent : null;
  return {
    id,
    status,
    createdAt: instant(raw.created_at),
    updatedAt: instant(raw.updated_at),
    archived: typeof raw.archived_at === 'string',
    costCents: usage ? cents(usage.list_cost) : null,
    agentVersion: agent ? int(agent.version) : null,
    outcomePending: results.some((r) => OUTCOME_OPEN.has(r)),
    outcomeResult: terminal.length ? (terminal[terminal.length - 1] ?? null) : null,
  };
}

export function parseRun(raw: unknown): RunView | null {
  if (!isRecord(raw)) return null;
  const id = apiId(raw.id, 'drun');
  if (!id) return null;
  const error = isRecord(raw.error) ? raw.error : null;
  const trigger = isRecord(raw.trigger_context) ? raw.trigger_context.type : null;
  return {
    id,
    createdAt: instant(raw.created_at),
    trigger: trigger === 'schedule' || trigger === 'manual' ? trigger : null,
    sessionId: apiId(raw.session_id, 'sesn'),
    errorType: error ? str(error.type, 80) : null,
    errorMessage: error ? cleanText(error.message, MESSAGE_MAX) : '',
  };
}

export function parseFile(raw: unknown): FileView | null {
  if (!isRecord(raw)) return null;
  const id = apiId(raw.id, 'file');
  const filename = str(raw.filename, 500);
  const sizeBytes = int(raw.size_bytes);
  if (!id || !filename || sizeBytes === null || sizeBytes < 0) return null;
  return { id, filename, sizeBytes, createdAt: instant(raw.created_at) };
}

function listOf<T>(raw: unknown, parse: (item: unknown) => T | null): T[] {
  if (!isRecord(raw) || !Array.isArray(raw.data)) throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
  return raw.data.map(parse).filter((x): x is T => x !== null);
}

function versioned(raw: unknown, prefix: string): { id: string; version: number } {
  const id = isRecord(raw) ? apiId(raw.id, prefix) : null;
  const version = isRecord(raw) ? int(raw.version) : null;
  if (!id || version === null) throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
  return { id, version };
}

function retryAfterSeconds(raw: string | null): number | undefined {
  const text = raw?.trim() ?? '';
  if (!/^\d{1,7}$/.test(text)) return undefined;
  return Math.min(Number(text), RETRY_AFTER_MAX_SEC);
}

/** Attend `work` jusqu'à l'échéance du signal au plus, même si `fetchImpl` ou le flux l'ignorent. */
function within<T>(work: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const expire = (): void => reject(signal.reason);
    if (signal.aborted) expire();
    else signal.addEventListener('abort', expire, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', expire));
  });
}

function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => undefined);
  } catch {
    /* corps déjà verrouillé : rien à libérer */
  }
}

/** Corps lu sur `max` octets au plus et décodé en UTF-8 strict ; la cause d'origine (qui peut citer l'URL) ne sort pas. */
async function readText(res: Response, max: number, signal: AbortSignal): Promise<string> {
  if (Number(res.headers.get('content-length')) > max) {
    discard(res);
    throw new CloudApiError(0, 'too_large', 'Réponse trop volumineuse');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const step = await within(reader.read(), signal);
      if (step.done) break;
      const chunk: unknown = step.value;
      if (!ArrayBuffer.isView(chunk)) throw new TypeError('bloc inattendu');
      size += chunk.byteLength;
      if (size > max) throw new CloudApiError(0, 'too_large', 'Réponse trop volumineuse');
      chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  } catch (error) {
    if (error instanceof CloudApiError) throw error;
    throw signal.aborted ? new CloudApiError(0, 'timeout', 'Délai dépassé (api.anthropic.com)') : new CloudApiError(0, 'unreadable', 'Réponse illisible');
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
  }
}

/** Code court d'une erreur de transport (`ENOTFOUND`…), jamais un texte libre. */
function transportCode(error: unknown): string {
  const code = (value: unknown): string => {
    const c = typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;
    return typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(c) ? c : '';
  };
  return code(error) || code((error as { cause?: unknown } | null | undefined)?.cause);
}

interface Call {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  maxBytes?: number;
}

export function createCloudApi(deps: { key: () => string; fetchImpl: FetchLike; timeoutMs?: number }): CloudApi {
  const timeoutMs = deps.timeoutMs && deps.timeoutMs > 0 && deps.timeoutMs < 2 ** 31 ? deps.timeoutMs : TIMEOUT_MS;

  async function send(call: Call): Promise<{ res: Response; signal: AbortSignal }> {
    const key = deps.key();
    if (!key) throw new CloudApiError(0, 'no_key', 'Clé API absente');
    const url = new URL(call.path, CLOUD_API_ORIGIN);
    for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
    const signal = AbortSignal.timeout(timeoutMs);
    const headers: Record<string, string> = {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': MANAGED_AGENTS_BETA,
      accept: 'application/json',
    };
    if (call.body) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await within(
        deps.fetchImpl(url.href, { method: call.method, headers, body: call.body ? JSON.stringify(call.body) : undefined, redirect: 'manual', credentials: 'omit', signal }),
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw new CloudApiError(0, 'timeout', 'Délai dépassé (api.anthropic.com)');
      const code = transportCode(error);
      throw new CloudApiError(0, 'network', `Réseau indisponible (api.anthropic.com${code ? `, ${code}` : ''})`);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      discard(res);
      throw new CloudApiError(res.status, 'redirect', 'Redirection refusée : la clé ne quitte pas api.anthropic.com');
    }
    if (!res.ok) {
      let type = 'http_error';
      let detail = '';
      try {
        const parsed: unknown = JSON.parse(await readText(res, ERROR_MAX_BYTES, signal));
        const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
        type = (error && str(error.type, 64)) || type;
        detail = error ? cleanText(error.message, MESSAGE_MAX) : '';
      } catch {
        /* corps d'erreur illisible : le statut suffit */
      }
      const retryAfterSec = res.status === 429 ? retryAfterSeconds(res.headers.get('retry-after')) : undefined;
      throw new CloudApiError(res.status, type, `HTTP ${res.status} · ${type}${detail ? ` : ${detail}` : ''}`.slice(0, MESSAGE_MAX + 60), retryAfterSec);
    }
    return { res, signal };
  }

  async function json(call: Call): Promise<unknown> {
    const { res, signal } = await send(call);
    const text = await readText(res, call.maxBytes ?? JSON_MAX_BYTES, signal);
    try {
      return JSON.parse(text);
    } catch {
      throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
    }
  }

  const checked = (id: string, prefix: string): string => {
    if (!isApiId(id, prefix)) throw new CloudApiError(0, 'invalid_id', `Identifiant invalide (${prefix}_…)`);
    return id;
  };
  const clampLimit = (n: number | undefined, max: number, fallback: number) => String(Number.isInteger(n) && n !== undefined && n >= 1 ? Math.min(n, max) : fallback);

  return {
    async getDeployment(id) {
      return parseDeployment(await json({ method: 'GET', path: `/v1/deployments/${checked(id, 'depl')}` }));
    },
    async listDeployments(agentId) {
      const raw = await json({ method: 'GET', path: '/v1/deployments', query: { agent_id: checked(agentId, 'agent'), limit: '100' } });
      return listOf(raw, (item) => {
        try {
          return parseDeployment(item);
        } catch {
          return null;
        }
      });
    },
    async listSessions(deploymentId, opts) {
      const query: Record<string, string> = { deployment_id: checked(deploymentId, 'depl'), order: 'desc', include_archived: 'true', limit: clampLimit(opts?.limit, 100, 20) };
      // Le curseur est opaque : il ne fait que repasser, borné et sans caractère de contrôle.
      if (opts?.page && /^[\x21-\x7e]{1,512}$/.test(opts.page)) query.page = opts.page;
      const raw = await json({ method: 'GET', path: '/v1/sessions', query });
      const next = isRecord(raw) && typeof raw.next_page === 'string' && raw.next_page.length <= 512 ? raw.next_page : null;
      return { sessions: listOf(raw, parseSession), nextPage: next };
    },
    async listFailedRuns(deploymentId, sinceIso, limit) {
      const query: Record<string, string> = { deployment_id: checked(deploymentId, 'depl'), has_error: 'true', limit: clampLimit(limit, 100, 5) };
      if (Number.isFinite(Date.parse(sinceIso))) query['created_at[gte]'] = new Date(sinceIso).toISOString();
      return listOf(await json({ method: 'GET', path: '/v1/deployment_runs', query }), parseRun);
    },
    async listOutputFiles(sessionId) {
      const files = listOf(await json({ method: 'GET', path: '/v1/files', query: { scope_id: checked(sessionId, 'sesn'), limit: '100' } }), parseFile);
      return files.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    },
    async downloadText(fileId, maxBytes) {
      const { res, signal } = await send({ method: 'GET', path: `/v1/files/${checked(fileId, 'file')}/content` });
      return readText(res, maxBytes, signal);
    },
    async createEnvironment(body) {
      const raw = await json({ method: 'POST', path: '/v1/environments', body });
      const id = isRecord(raw) ? apiId(raw.id, 'env') : null;
      if (!id) throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
      return { id };
    },
    async updateEnvironment(id, body) {
      const raw = await json({ method: 'POST', path: `/v1/environments/${checked(id, 'env')}`, body });
      const got = isRecord(raw) ? apiId(raw.id, 'env') : null;
      if (!got) throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
      return { id: got };
    },
    async createAgent(body) {
      return versioned(await json({ method: 'POST', path: '/v1/agents', body }), 'agent');
    },
    async updateAgent(id, body) {
      return versioned(await json({ method: 'POST', path: `/v1/agents/${checked(id, 'agent')}`, body }), 'agent');
    },
    async createDeployment(body) {
      return parseDeployment(await json({ method: 'POST', path: '/v1/deployments', body }));
    },
    async updateDeployment(id, body) {
      return parseDeployment(await json({ method: 'POST', path: `/v1/deployments/${checked(id, 'depl')}`, body }));
    },
    async runDeployment(id) {
      const run = parseRun(await json({ method: 'POST', path: `/v1/deployments/${checked(id, 'depl')}/run` }));
      if (!run) throw new CloudApiError(0, 'unreadable', 'Réponse illisible');
      return run;
    },
    async pauseDeployment(id) {
      return parseDeployment(await json({ method: 'POST', path: `/v1/deployments/${checked(id, 'depl')}/pause` }));
    },
    async unpauseDeployment(id) {
      return parseDeployment(await json({ method: 'POST', path: `/v1/deployments/${checked(id, 'depl')}/unpause` }));
    },
  };
}
