import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { coerceStoredReport, isApiId, parseReport, REPORT_FILE, REPORT_MAX_BYTES, reportSummary, sortReports, type CloudReport, type CloudReportSummary } from './agent/cloudReport';
import { CloudApiError, createCloudApi, type CloudApi, type DeploymentView, type FetchLike, type SessionView } from './agent-cloud-api';
import { uiText, type AppLocale } from './locale';

/**
 * Agent cloud (Managed Agents d'Anthropic), côté process principal : `docs/AGENT-CLOUD.md`. Le pont ne fait que
 * RELEVER : rien n'écoute, rien du desk ne part vers le cloud. Le process principal garde la clé (chiffrée par le
 * trousseau du système, jamais rendue au renderer), interroge le déploiement planifié, télécharge le `rapport.json`
 * de chaque session finie, le lit au contrat `canto.rapport/1` et range la forme normalisée dans
 * `userData/agent-reports/<session>.json` : le dossier que l'onglet Agent IA affiche.
 */

export const AGENT_CLOUD_FILE = 'agent-cloud.json';
export const AGENT_REPORTS_DIR = 'agent-reports';
/** Relevé régulier, et relevé rapproché tant qu'une session tourne. */
export const PULL_EVERY_MS = 15 * 60_000;
export const PULL_PENDING_MS = 3 * 60_000;
const START_DELAY_MS = 10_000;
/** Une session finie sans `rapport.json` 30 min après sa dernière mise à jour n'en livrera plus. */
export const NO_REPORT_AFTER_MS = 30 * 60_000;
const SESSIONS_PER_PULL = 20;
const DOWNLOADS_PER_PULL = 5;
const COLLECTED_MAX = 500;
const READ_MAX = 1000;
const LIST_MAX = 400;
const FAILURES_SHOWN = 5;
const FAILED_RUNS_WINDOW_MS = 7 * 86_400_000;
export const DEFAULT_SCHEDULE: CloudSchedule = { cron: '0 7 * * 1-5', timezone: 'Europe/Paris' };

export interface CloudSchedule {
  cron: string;
  timezone: string;
}

export type CloudFailureKind = 'run' | 'no_report' | 'invalid' | 'too_large' | 'archived';
const FAILURE_KINDS: readonly CloudFailureKind[] = ['run', 'no_report', 'invalid', 'too_large', 'archived'];

export interface CloudFailure {
  at: number;
  kind: CloudFailureKind;
  detail: string;
}

export interface CloudDeploymentState {
  name: string;
  state: 'active' | 'paused' | 'archived';
  pausedReason: string | null;
  cron: string | null;
  timezone: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  budgetCents: number | null;
  agentVersion: number | null;
}

export type CloudBusy = 'provision' | 'run' | 'pause' | 'unpause' | null;

export interface AgentCloudStatus {
  /** Le trousseau du système chiffre : sans lui, aucune clé n'est gardée. */
  available: boolean;
  keyStored: boolean;
  deploymentId: string | null;
  /** Le desk a installé ce déploiement (environnement, agent, déploiement) et peut le mettre à jour. */
  managed: boolean;
  /** Planification voulue, appliquée à la prochaine installation. */
  schedule: CloudSchedule;
  deployment: CloudDeploymentState | null;
  pulling: boolean;
  busy: CloudBusy;
  lastPullAt: number | null;
  nextPullAt: number | null;
  error: string | null;
  /** Sessions en cours ou dont le rapport n'est pas encore indexé. */
  pending: number;
  failures: CloudFailure[];
  reports: number;
  unread: number;
}

export interface AgentCloudSeal {
  available(): boolean;
  /** Blob chiffré (base64), `null` si le trousseau refuse. */
  encrypt(text: string): string | null;
  /** Texte clair, `''` si illisible. */
  decrypt(blob: string): string;
}

export interface CloudDialogOptions {
  type: 'warning' | 'question';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
  title: string;
  message: string;
  detail?: string;
}

export interface AgentCloudDeps {
  userDataDir: string;
  locale: () => AppLocale;
  window: () => { isDestroyed(): boolean } | null;
  showMessageBox: (win: { isDestroyed(): boolean }, options: CloudDialogOptions) => Promise<{ response: number }>;
  send: (channel: string, payload: unknown) => void;
  log: (line: string) => void;
  seal: AgentCloudSeal;
  fetchImpl: FetchLike;
  openPath: (dir: string) => Promise<boolean>;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  now?: () => number;
  /** Client de l'API ; par défaut celui de `agent-cloud-api.ts`, sur la clé gardée ici. */
  api?: CloudApi;
}

interface Collected {
  at: number;
  ok: boolean;
  kind?: CloudFailureKind;
  detail?: string;
}

interface CloudConfig {
  key: string | null;
  deploymentId: string | null;
  environmentId: string | null;
  agentId: string | null;
  agentVersion: number | null;
  managed: boolean;
  schedule: CloudSchedule;
  read: string[];
  collected: Record<string, Collected>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Cinq champs cron POSIX, chiffres et `* , / -` seulement (le serveur valide le reste). */
export function isCron(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 120 && /^[0-9*,/-]+( [0-9*,/-]+){4}$/.test(v);
}

/** Identifiant IANA (`Europe/Paris`, `America/Chicago`, `UTC`). */
export function isTimezone(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(v);
}

/** Une clé API : ASCII imprimable sans espace, de 20 à 512 caractères. */
export function isApiKeyText(v: unknown): v is string {
  return typeof v === 'string' && /^[\x21-\x7e]{20,512}$/.test(v);
}

function coerceConfig(raw: unknown): CloudConfig {
  const r = isRecord(raw) && raw.v === 1 ? raw : {};
  const schedule = isRecord(r.schedule) && isCron(r.schedule.cron) && isTimezone(r.schedule.timezone) ? { cron: r.schedule.cron, timezone: r.schedule.timezone } : DEFAULT_SCHEDULE;
  const collected: Record<string, Collected> = {};
  if (isRecord(r.collected)) {
    for (const [id, entry] of Object.entries(r.collected)) {
      if (!isApiId(id, 'sesn') || !isRecord(entry) || typeof entry.at !== 'number' || typeof entry.ok !== 'boolean') continue;
      const kind = FAILURE_KINDS.find((k) => k === entry.kind);
      collected[id] = { at: entry.at, ok: entry.ok, kind, detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 200) : undefined };
    }
  }
  return {
    key: typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 8192 ? r.key : null,
    deploymentId: isApiId(r.deploymentId, 'depl') ? r.deploymentId : null,
    environmentId: isApiId(r.environmentId, 'env') ? r.environmentId : null,
    agentId: isApiId(r.agentId, 'agent') ? r.agentId : null,
    agentVersion: typeof r.agentVersion === 'number' && Number.isSafeInteger(r.agentVersion) ? r.agentVersion : null,
    managed: r.managed === true,
    schedule,
    read: Array.isArray(r.read) ? r.read.filter((id): id is string => isApiId(id, 'sesn')).slice(-READ_MAX) : [],
    collected,
  };
}

function deploymentState(view: DeploymentView): CloudDeploymentState {
  return {
    name: view.name,
    state: view.archived ? 'archived' : view.status,
    pausedReason: view.pausedReason,
    cron: view.cron,
    timezone: view.timezone,
    nextRunAt: view.archived || view.status === 'paused' ? null : view.nextRunAt,
    lastRunAt: view.lastRunAt,
    budgetCents: view.budgetCents,
    agentVersion: view.agentVersion,
  };
}

export class AgentCloudHost {
  protected config: CloudConfig;
  protected readonly api: CloudApi;
  protected readonly now: () => number;
  private readonly file: string;
  private readonly dir: string;
  private readonly timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  private plainKey: string | null = null;
  private index: Map<string, CloudReport> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<AgentCloudStatus> | null = null;
  private stopped = true;
  /** Clé refusée (401/403) : plus de relevé automatique avant une nouvelle clé. */
  private authBlocked = false;
  protected deployment: CloudDeploymentState | null = null;
  protected busy: CloudBusy = null;
  private lastPullAt: number | null = null;
  private nextPullAt: number | null = null;
  protected error: string | null = null;
  private pending = 0;
  private runFailures: CloudFailure[] = [];
  private lastStatus = '';
  private lastList = '';

  constructor(protected readonly deps: AgentCloudDeps) {
    this.file = path.join(deps.userDataDir, AGENT_CLOUD_FILE);
    this.dir = path.join(deps.userDataDir, AGENT_REPORTS_DIR);
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? { setTimeout, clearTimeout };
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      /* premier lancement : rien de configuré */
    }
    this.config = coerceConfig(raw);
    this.api = deps.api ?? createCloudApi({ key: () => this.key(), fetchImpl: deps.fetchImpl });
  }

  protected t(fr: string, en: string, es: string): string {
    return uiText(this.deps.locale(), fr, en, es);
  }

  /** La clé en clair, gardée en mémoire du process principal ; `''` sans clé ou si le trousseau ne la rend pas. */
  private key(): string {
    if (this.plainKey !== null) return this.plainKey;
    const blob = this.config.key;
    this.plainKey = blob && this.deps.seal.available() ? this.deps.seal.decrypt(blob) : '';
    return this.plainKey;
  }

  protected persist(): void {
    try {
      mkdirSync(this.deps.userDataDir, { recursive: true });
      const c = this.config;
      const entries = Object.entries(c.collected)
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, COLLECTED_MAX);
      const body = { v: 1, key: c.key, deploymentId: c.deploymentId, environmentId: c.environmentId, agentId: c.agentId, agentVersion: c.agentVersion, managed: c.managed, schedule: c.schedule, read: c.read.slice(-READ_MAX), collected: Object.fromEntries(entries) };
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      this.deps.log('agent cloud · réglages non écrits (écriture impossible)');
    }
  }

  private reports(): Map<string, CloudReport> {
    if (this.index) return this.index;
    const index = new Map<string, CloudReport>();
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      /* dossier pas encore créé */
    }
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!isApiId(id, 'sesn')) continue;
      try {
        const report = coerceStoredReport(JSON.parse(readFileSync(path.join(this.dir, name), 'utf8')));
        if (report && report.id === id) index.set(id, report);
      } catch {
        /* fiche illisible : ignorée */
      }
    }
    this.index = index;
    return index;
  }

  private unreadCount(): number {
    const read = new Set(this.config.read);
    let n = 0;
    for (const id of this.reports().keys()) if (!read.has(id)) n += 1;
    return n;
  }

  private failures(): CloudFailure[] {
    const fromSessions: CloudFailure[] = Object.values(this.config.collected)
      .filter((c) => !c.ok && c.kind)
      .map((c) => ({ at: c.at, kind: c.kind as CloudFailureKind, detail: c.detail ?? '' }));
    return [...fromSessions, ...this.runFailures].sort((a, b) => b.at - a.at).slice(0, FAILURES_SHOWN);
  }

  status(): AgentCloudStatus {
    return {
      available: this.deps.seal.available(),
      keyStored: !!this.config.key,
      deploymentId: this.config.deploymentId,
      managed: this.config.managed,
      schedule: { ...this.config.schedule },
      deployment: this.deployment,
      pulling: this.inFlight !== null,
      busy: this.busy,
      lastPullAt: this.lastPullAt,
      nextPullAt: this.nextPullAt,
      error: this.error,
      pending: this.pending,
      failures: this.failures(),
      reports: this.reports().size,
      unread: this.unreadCount(),
    };
  }

  /** Le dossier, du plus récent au plus ancien (400 fiches au plus). */
  list(): CloudReportSummary[] {
    const read = new Set(this.config.read);
    return sortReports([...this.reports().values()])
      .slice(0, LIST_MAX)
      .map((r) => reportSummary(r, read.has(r.id)));
  }

  read(id: unknown): CloudReport | null {
    return isApiId(id, 'sesn') ? (this.reports().get(id) ?? null) : null;
  }

  markRead(id: unknown): AgentCloudStatus {
    if (isApiId(id, 'sesn') && this.reports().has(id) && !this.config.read.includes(id)) {
      this.config.read = [...this.config.read, id].slice(-READ_MAX);
      this.persist();
      this.publish(true);
    }
    return this.status();
  }

  protected publish(listChanged = false): void {
    const status = this.status();
    const text = JSON.stringify(status);
    try {
      if (text !== this.lastStatus) {
        this.lastStatus = text;
        this.deps.send('agent-cloud:status', status);
      }
      if (listChanged) {
        const list = this.list();
        const listText = JSON.stringify(list);
        if (listText !== this.lastList) {
          this.lastList = listText;
          this.deps.send('agent-cloud:reports', list);
        }
      }
    } catch {
      /* fenêtre fermée : le prochain statut repartira */
    }
  }

  /** Clé saisie par l'opérateur : chiffrée ici, jamais rendue. Une chaîne vide efface la clé. */
  setKey(text: unknown): AgentCloudStatus {
    if (text === '') {
      if (this.config.key) this.deps.log('agent cloud · clé effacée');
      this.config.key = null;
      this.plainKey = null;
      this.authBlocked = false;
      this.error = null;
      this.persist();
      this.reschedule();
      this.publish();
      return this.status();
    }
    const key = typeof text === 'string' ? text.trim() : '';
    if (!isApiKeyText(key)) {
      this.error = this.t('Clé API illisible : collez la clé entière (sk-ant-…).', 'Unreadable API key: paste the whole key (sk-ant-…).', 'Clave API ilegible: pegue la clave entera (sk-ant-…).');
      this.publish();
      return this.status();
    }
    const blob = this.deps.seal.available() ? this.deps.seal.encrypt(key) : null;
    if (!blob) {
      this.error = this.t(
        'Trousseau du système indisponible : la clé n’est pas gardée.',
        'System keychain unavailable: the key is not kept.',
        'Llavero del sistema no disponible: la clave no se guarda.',
      );
      this.publish();
      return this.status();
    }
    this.config.key = blob;
    this.plainKey = key;
    this.authBlocked = false;
    this.error = null;
    this.persist();
    this.deps.log('agent cloud · clé enregistrée (chiffrée par le trousseau)');
    this.reschedule(1_000);
    this.publish();
    return this.status();
  }

  /** Déploiement créé ailleurs (Console) : le desk le relève, mais ne le modifie pas. `null` l'oublie. */
  setDeployment(id: unknown): AgentCloudStatus {
    if (id === null) {
      if (this.config.deploymentId) this.deps.log('agent cloud · déploiement oublié');
      this.config.deploymentId = null;
      this.config.managed = false;
      this.deployment = null;
      this.error = null;
    } else if (isApiId(id, 'depl')) {
      if (id !== this.config.deploymentId) {
        this.config.deploymentId = id;
        this.config.managed = false;
        this.deployment = null;
        this.deps.log('agent cloud · déploiement externe enregistré');
      }
    } else {
      this.error = this.t('Identifiant de déploiement invalide (depl_…).', 'Invalid deployment ID (depl_…).', 'Identificador de despliegue no válido (depl_…).');
      this.publish();
      return this.status();
    }
    this.persist();
    this.reschedule(1_000);
    this.publish();
    return this.status();
  }

  setSchedule(raw: unknown): AgentCloudStatus {
    const r = isRecord(raw) ? raw : {};
    if (!isCron(r.cron) || !isTimezone(r.timezone)) {
      this.error = this.t(
        'Planification invalide : cinq champs cron et un fuseau IANA (Europe/Paris).',
        'Invalid schedule: five cron fields and an IANA time zone (Europe/Paris).',
        'Planificación no válida: cinco campos cron y una zona IANA (Europe/Paris).',
      );
      this.publish();
      return this.status();
    }
    this.config.schedule = { cron: r.cron, timezone: r.timezone };
    this.error = null;
    this.persist();
    this.publish();
    return this.status();
  }

  async openFolder(): Promise<boolean> {
    try {
      mkdirSync(this.dir, { recursive: true });
      return await this.deps.openPath(this.dir);
    } catch {
      return false;
    }
  }

  start(): void {
    this.stopped = false;
    this.reschedule(START_DELAY_MS);
    this.publish(true);
  }

  shutdown(): void {
    this.stopped = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.nextPullAt = null;
  }

  protected configured(): boolean {
    return !!this.config.key && !!this.config.deploymentId;
  }

  /** Prochain relevé automatique : jamais hors service, ni avec une clé refusée. */
  protected reschedule(delay?: number): void {
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.nextPullAt = null;
    if (this.stopped || !this.configured() || this.authBlocked) return;
    const wait = delay ?? (this.pending > 0 ? PULL_PENDING_MS : PULL_EVERY_MS);
    this.nextPullAt = this.now() + wait;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.pull();
    }, wait);
  }

  /** Un relevé à la fois : un appel pendant un relevé rend celui en cours. */
  pull(): Promise<AgentCloudStatus> {
    if (this.inFlight) return this.inFlight;
    const run = this.pullOnce().finally(() => {
      this.inFlight = null;
      this.publish(true);
    });
    this.inFlight = run;
    this.publish();
    return run;
  }

  private explain(error: unknown): string {
    if (error instanceof CloudApiError) {
      if (error.type === 'no_key') return this.t('Aucune clé API enregistrée.', 'No API key stored.', 'Ninguna clave API guardada.');
      if (error.status === 401 || error.status === 403)
        return this.t(`Clé refusée par Anthropic (${error.status}) : enregistrez une clé valide.`, `Key refused by Anthropic (${error.status}): store a valid key.`, `Clave rechazada por Anthropic (${error.status}): guarde una clave válida.`);
      if (error.status === 404) return this.t('Déploiement introuvable dans cette organisation.', 'Deployment not found in this organization.', 'Despliegue no encontrado en esta organización.');
      if (error.status === 402) return this.t('Crédits API épuisés (402).', 'API credits exhausted (402).', 'Créditos API agotados (402).');
      return error.message;
    }
    return this.t('Relevé impossible.', 'Pull failed.', 'Lectura imposible.');
  }

  private async pullOnce(): Promise<AgentCloudStatus> {
    const deploymentId = this.config.deploymentId;
    if (!this.config.key || !deploymentId) {
      this.error = this.config.key ? null : this.t('Aucune clé API enregistrée.', 'No API key stored.', 'Ninguna clave API guardada.');
      return this.status();
    }
    let added = 0;
    let retryAfterMs: number | undefined;
    try {
      const view = await this.api.getDeployment(deploymentId);
      this.deployment = deploymentState(view);
      const sessions = await this.api.listSessions(deploymentId, SESSIONS_PER_PULL);
      added = await this.collect(sessions);
      try {
        const since = new Date(this.now() - FAILED_RUNS_WINDOW_MS).toISOString();
        const runs = await this.api.listFailedRuns(deploymentId, since, FAILURES_SHOWN);
        this.runFailures = runs.filter((r) => r.errorType).map((r) => ({ at: r.createdAt ?? this.now(), kind: 'run' as const, detail: `${r.errorType}${r.errorMessage ? ` · ${r.errorMessage}` : ''}`.slice(0, 200) }));
      } catch {
        /* les échecs de déclenchement sont un plus : le relevé tient sans eux */
      }
      this.error = null;
      this.lastPullAt = this.now();
      if (added > 0) this.deps.log(`agent cloud · ${added} rapport(s) reçu(s)`);
    } catch (error) {
      this.error = this.explain(error);
      if (error instanceof CloudApiError && (error.status === 401 || error.status === 403)) this.authBlocked = true;
      if (error instanceof CloudApiError && error.retryAfterSec) retryAfterMs = error.retryAfterSec * 1000;
      this.deps.log(`agent cloud · relevé en échec : ${error instanceof CloudApiError ? `${error.status} ${error.type}` : 'erreur'}`);
    }
    this.reschedule(retryAfterMs);
    return this.status();
  }

  /** Range le rapport de chaque session finie qui n'a pas encore été relevée. Rend le nombre de rapports ajoutés. */
  private async collect(sessions: SessionView[]): Promise<number> {
    try {
      return await this.collectEach(sessions);
    } finally {
      this.persist();
    }
  }

  private async collectEach(sessions: SessionView[]): Promise<number> {
    let pending = 0;
    let downloads = 0;
    let added = 0;
    for (const session of sessions) {
      if (this.config.collected[session.id] || this.reports().has(session.id)) continue;
      if (session.archived) {
        this.mark(session.id, false, 'archived', '');
        continue;
      }
      if (session.status === 'running' || session.status === 'rescheduling' || session.outcomePending) {
        pending += 1;
        continue;
      }
      if (downloads >= DOWNLOADS_PER_PULL) {
        pending += 1;
        continue;
      }
      downloads += 1;
      const files = await this.api.listOutputFiles(session.id);
      const file = files.find((f) => f.filename === REPORT_FILE);
      if (!file) {
        const since = session.updatedAt ?? session.createdAt ?? 0;
        if (session.status === 'terminated' || this.now() - since > NO_REPORT_AFTER_MS) {
          const why = session.outcomeResult ? `outcome ${session.outcomeResult}` : session.status;
          this.mark(session.id, false, 'no_report', why);
        } else pending += 1;
        continue;
      }
      if (file.sizeBytes > REPORT_MAX_BYTES) {
        this.mark(session.id, false, 'too_large', `${file.sizeBytes} o`);
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await this.api.downloadText(file.id, REPORT_MAX_BYTES));
      } catch (error) {
        // Clé refusée, quota, panne du serveur ou du réseau : le relevé échoue et la session sera reprise.
        // Un 4xx propre au fichier (non téléchargeable, disparu) ou un corps illisible la classe.
        const transient = error instanceof CloudApiError && (error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500 || ['timeout', 'network', 'no_key'].includes(error.type));
        if (transient) throw error;
        const kind = error instanceof CloudApiError && error.type === 'too_large' ? 'too_large' : 'invalid';
        this.mark(session.id, false, kind, error instanceof CloudApiError && error.status ? `HTTP ${error.status}` : 'json');
        continue;
      }
      const parsed = parseReport(raw);
      if (!parsed.ok) {
        this.mark(session.id, false, 'invalid', parsed.reason);
        continue;
      }
      const report: CloudReport = {
        v: 1,
        id: session.id,
        ...parsed.report,
        receivedAt: this.now(),
        session: { id: session.id, createdAt: session.createdAt, costCents: session.costCents, agentVersion: session.agentVersion },
      };
      this.store(report);
      this.mark(session.id, true);
      added += 1;
    }
    this.pending = pending;
    return added;
  }

  /** Note la session comme relevée (rapport rangé, ou échec qui ne se rattrapera pas) ; écrit à la fin du relevé. */
  private mark(id: string, ok: boolean, kind?: CloudFailureKind, detail?: string): void {
    this.config.collected[id] = ok ? { at: this.now(), ok } : { at: this.now(), ok, kind, detail };
  }

  private store(report: CloudReport): void {
    mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, `${report.id}.json`);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(report), 'utf8');
    renameSync(tmp, target);
    this.reports().set(report.id, report);
  }
}
