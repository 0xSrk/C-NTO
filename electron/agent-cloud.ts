import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { coerceStoredReport, isApiId, isDateNear, parseReport, REPORT_FILE, REPORT_MAX_BYTES, reportSummary, sortReports, type CloudReport, type CloudReportSummary } from './agent/cloudReport';
import { CloudApiError, createCloudApi, type CloudApi, type DeploymentView, type FetchLike, type SessionView } from './agent-cloud-api';
import { BUDGET_CENTS_PER_RUN, cloudAgentBody, cloudDeploymentBody, cloudEnvironmentBody, DEPLOYMENT_NAME, OFFICIAL_DOMAINS } from './agent-cloud-definition';
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
/** Pages de sessions lues au plus par relevé (100 sessions), quand aucune de la page n'est déjà connue : un desk resté fermé rattrape. */
const SESSION_PAGES = 5;
/** Délai avant de lire les fichiers d'une session finie : le dernier fichier écrit met quelques secondes à être indexé. */
export const SETTLE_MS = 60_000;
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
type ProvisionStep = 'environment' | 'agent' | 'deployment' | 'pause' | 'resume';

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

  /** Non lus parmi les fiches que le dossier montre : une fiche au-delà ne pourrait jamais être lue. */
  private unreadCount(): number {
    const read = new Set(this.config.read);
    return sortReports([...this.reports().values()])
      .slice(0, LIST_MAX)
      .filter((r) => !read.has(r.id)).length;
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
    if (this.busy) return this.refuseBusy();
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

  /**
   * Déploiement créé ailleurs (Console) : le desk le relève et peut le lancer, sans le modifier ni le suspendre.
   * `null` l'oublie. Le déploiement que le desk a installé n'est oublié ou remplacé qu'après un dialogue qui le suspend :
   * oublié tel quel, il continuerait de tourner chaque jour, sur les crédits, sans que personne ne le relève.
   */
  async setDeployment(id: unknown): Promise<AgentCloudStatus> {
    if (this.busy) return this.refuseBusy();
    if (id !== null && !isApiId(id, 'depl'))
      return this.refuse('Identifiant de déploiement invalide (depl_…).', 'Invalid deployment ID (depl_…).', 'Identificador de despliegue no válido (depl_…).');
    const current = this.config.deploymentId;
    if (id === current) return this.status();
    if (!current || !this.config.managed) {
      this.adopt(id);
      return this.status();
    }
    return this.control('pause', async () => {
      const choice = await this.ask({
        type: 'warning',
        title: 'CΛNTO',
        message: this.t('Suspendre le déploiement du desk avant de le quitter ?', 'Pause the desk’s deployment before leaving it?', '¿Suspender el despliegue del desk antes de dejarlo?'),
        detail: this.t(
          'Quitté sans être suspendu, il continuerait de tourner chaque jour chez Anthropic, sur les crédits API, sans que le desk le relève. Suspendu, il ne coûte rien ; une nouvelle installation le reprendra.',
          'Left without a pause, it would keep running every day at Anthropic, on API credits, with nothing pulling it. Paused, it costs nothing; a new install picks it up again.',
          'Dejado sin suspender, seguiría ejecutándose cada día en Anthropic, con los créditos API, sin que el desk lo recoja. Suspendido, no cuesta nada; una nueva instalación lo retoma.',
        ),
        buttons: [this.t('Suspendre et quitter', 'Pause and leave', 'Suspender y dejar'), this.t('Annuler', 'Cancel', 'Cancelar')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice !== 0) return;
      if (this.deployment?.state !== 'paused' && this.deployment?.state !== 'archived') {
        try {
          await this.api.pauseDeployment(current);
        } catch (error) {
          // Disparu côté Anthropic : il n'y a plus rien à suspendre. Toute autre erreur garde le déploiement.
          if (!(error instanceof CloudApiError && error.status === 404)) throw error;
        }
      }
      this.deps.log('agent cloud · déploiement du desk suspendu');
      this.adopt(id);
    });
  }

  /** Relève désormais `id` (externe), ou plus rien. */
  private adopt(id: string | null): void {
    this.deps.log(id === null ? 'agent cloud · déploiement oublié' : 'agent cloud · déploiement externe enregistré');
    this.config.deploymentId = id;
    this.config.managed = false;
    this.deployment = null;
    this.error = null;
    this.authBlocked = false;
    this.pending = 0;
    this.runFailures = [];
    this.persist();
    this.reschedule(1_000);
    this.publish();
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

  /** Réponse du dialogue du process principal ; sans fenêtre, ou si le dialogue échoue, l'annulation. */
  private async ask(options: CloudDialogOptions): Promise<number> {
    const win = this.deps.window();
    if (!win || win.isDestroyed()) return options.cancelId;
    try {
      return (await this.deps.showMessageBox(win, options)).response;
    } catch {
      return options.cancelId;
    }
  }

  /** Une action sur le cloud à la fois ; une erreur de l'API devient le message du statut. */
  private async control(kind: Exclude<CloudBusy, null>, work: () => Promise<void>): Promise<AgentCloudStatus> {
    if (this.busy) return this.status();
    this.busy = kind;
    this.publish();
    try {
      await work();
    } catch (error) {
      this.error = this.explain(error);
      this.deps.log(`agent cloud · ${kind} en échec : ${error instanceof CloudApiError ? `${error.status} ${error.type}` : 'erreur'}`);
    } finally {
      this.busy = null;
      this.publish();
    }
    return this.status();
  }

  private refuse(fr: string, en: string, es: string): AgentCloudStatus {
    this.error = this.t(fr, en, es);
    this.publish();
    return this.status();
  }

  private refuseBusy(): AgentCloudStatus {
    return this.refuse('Une action sur l’agent cloud est en cours.', 'A cloud agent action is in progress.', 'Una acción sobre el agente en la nube está en curso.');
  }

  private refuseExternal(): AgentCloudStatus {
    return this.refuse(
      'Déploiement externe : le desk ne le suspend ni ne le reprend ; faites-le dans la Console.',
      'External deployment: the desk neither pauses nor resumes it; do it in the Console.',
      'Despliegue externo: el desk no lo suspende ni lo reanuda; hágalo en la Consola.',
    );
  }

  /** Met à jour l'objet gardé ; disparu (404) ou archivé (refusé), il est recréé. Sans identifiant, il est créé. */
  private async upsert<T>(id: string | null, update: (id: string) => Promise<T>, create: () => Promise<T>, what: string): Promise<T> {
    if (!id) return create();
    try {
      return await update(id);
    } catch (error) {
      const gone = error instanceof CloudApiError && (error.status === 404 || error.status === 409 || (error.status === 400 && /archiv/i.test(error.message)));
      if (!gone) throw error;
      this.deps.log(`agent cloud · ${what} introuvable ou archivé : recréé`);
      return create();
    }
  }

  /** Un montant en dollars, à la manière de la langue du desk : `3,00 $`, `$3.00`. */
  private money(cents: number): string {
    const amount = (cents / 100).toFixed(2);
    return this.deps.locale() === 'en' ? `$${amount}` : `${amount.replace('.', ',')} $`;
  }

  /**
   * Le plafond que le déploiement déclare, relu juste avant un dialogue qui dépense : jamais celui de la définition
   * du desk par défaut. Sans plafond, le dialogue le dit ; déploiement illisible, plafond inconnu.
   */
  private async capText(id: string): Promise<string> {
    try {
      this.deployment = deploymentState(await this.api.getDeployment(id));
    } catch {
      /* le dernier relevé fait foi, s'il y en a un */
    }
    if (!this.deployment) return this.t('plafond inconnu (déploiement non relu)', 'cap unknown (deployment not read)', 'límite desconocido (despliegue no leído)');
    const cents = this.deployment.budgetCents;
    if (cents === null) return this.t('aucun plafond : la session n’est pas plafonnée', 'no cap: the session is uncapped', 'sin límite: la sesión no tiene tope');
    const amount = this.money(cents);
    return this.t(
      `plafond ${amount} par exécution (la dernière requête en cours peut le dépasser de peu)`,
      `cap ${amount} per run (the request in progress may overshoot it slightly)`,
      `límite ${amount} por ejecución (la petición en curso puede superarlo un poco)`,
    );
  }

  /**
   * Installe (ou met à jour) l'environnement, l'agent et le déploiement planifié décrits par `agent-cloud-definition.ts`.
   * Dialogue du process principal, Annuler par défaut : planifier, installer en pause, ou rien. Chaque identifiant
   * obtenu est écrit tout de suite : une installation coupée en route reprend où elle s'est arrêtée.
   */
  async provision(): Promise<AgentCloudStatus> {
    if (!this.config.key) return this.refuse('Aucune clé API enregistrée.', 'No API key stored.', 'Ninguna clave API guardada.');
    if (this.config.deploymentId && !this.config.managed)
      return this.refuse(
        'Déploiement externe : le desk le relève sans le modifier. Oubliez-le pour que le desk installe le sien.',
        'External deployment: the desk reads it without changing it. Forget it to let the desk install its own.',
        'Despliegue externo: el desk lo lee sin modificarlo. Olvídelo para que el desk instale el suyo.',
      );
    return this.control('provision', async () => {
      const existing = !!this.config.deploymentId;
      const { cron, timezone } = this.config.schedule;
      const choice = await this.ask({
        type: 'warning',
        title: 'CΛNTO',
        message: existing ? this.t('Mettre à jour l’agent cloud ?', 'Update the cloud agent?', '¿Actualizar el agente en la nube?') : this.t('Installer l’agent cloud ?', 'Install the cloud agent?', '¿Instalar el agente en la nube?'),
        detail: [
          this.t('Modèle : Claude Opus 5.5, effort élevé', 'Model: Claude Opus 5.5, high effort', 'Modelo: Claude Opus 5.5, esfuerzo alto'),
          `${this.t('Planification', 'Schedule', 'Planificación')} : ${cron} · ${timezone}`,
          this.t(
            `Plafond appliqué : ${this.money(BUDGET_CENTS_PER_RUN)} par exécution, aux tarifs publics`,
            `Cap applied: ${this.money(BUDGET_CENTS_PER_RUN)} per run, at list prices`,
            `Límite aplicado: ${this.money(BUDGET_CENTS_PER_RUN)} por ejecución, a precios públicos`,
          ),
          this.t(`Sources : ${OFFICIAL_DOMAINS.length} domaines officiels (Fed, BLS, BEA, Trésor, EIA, CME…)`, `Sources: ${OFFICIAL_DOMAINS.length} official domains (Fed, BLS, BEA, Treasury, EIA, CME…)`, `Fuentes: ${OFFICIAL_DOMAINS.length} dominios oficiales (Fed, BLS, BEA, Tesoro, EIA, CME…)`),
          '',
          this.t(
            'Facturé sur les crédits API de l’organisation de la clé. Aucune donnée du desk n’est envoyée : le desk relève seulement le rapport.',
            'Billed to the API credits of the key’s organization. No desk data is sent: the desk only pulls the report.',
            'Facturado a los créditos API de la organización de la clave. No se envía ningún dato del desk: el desk solo recoge el informe.',
          ),
        ].join('\n'),
        buttons: [this.t('Installer et planifier', 'Install and schedule', 'Instalar y planificar'), this.t('Installer en pause', 'Install paused', 'Instalar en pausa'), this.t('Annuler', 'Cancel', 'Cancelar')],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
      });
      if (choice !== 0 && choice !== 1) return;
      let step: ProvisionStep = 'environment';
      try {
        const env = await this.upsert(this.config.environmentId, (id) => this.api.updateEnvironment(id, cloudEnvironmentBody()), () => this.api.createEnvironment(cloudEnvironmentBody()), 'environnement');
        this.config.environmentId = env.id;
        this.persist();
        step = 'agent';
        const locale = this.deps.locale();
        const body = cloudAgentBody(locale);
        const agent = await this.upsert(this.config.agentId, (id) => this.api.updateAgent(id, body), () => this.api.createAgent(body), 'agent');
        this.config.agentId = agent.id;
        this.config.agentVersion = agent.version;
        this.persist();
        step = 'deployment';
        const plan = cloudDeploymentBody({ agentId: agent.id, environmentId: env.id, cron, timezone, locale });
        // Un déploiement du desk déjà là (réponse perdue en route, déploiement quitté puis suspendu) est repris, jamais doublé.
        const known = existing ? this.config.deploymentId : ((await this.api.listDeployments(agent.id)).find((d) => d.tagged && !d.archived && d.name === DEPLOYMENT_NAME)?.id ?? null);
        let view = await this.upsert(known, (id) => this.api.updateDeployment(id, plan), () => this.api.createDeployment(plan), 'déploiement');
        this.config.deploymentId = view.id;
        this.config.managed = true;
        this.deployment = deploymentState(view);
        this.persist();
        step = choice === 1 ? 'pause' : 'resume';
        if (choice === 1 && view.status === 'active') view = await this.api.pauseDeployment(view.id);
        if (choice === 0 && view.status === 'paused') view = await this.api.unpauseDeployment(view.id);
        this.deployment = deploymentState(view);
        this.error = null;
        this.deps.log(`agent cloud · ${existing || known ? 'mis à jour' : 'installé'} (agent v${agent.version}, ${view.status === 'paused' ? 'en pause' : 'planifié'})`);
        this.reschedule(1_000);
      } catch (error) {
        this.error =
          step === 'pause' && this.deployment?.state === 'active'
            ? this.t(
                'Installé, mais la suspension a échoué : le déploiement est actif et planifié. Suspendez-le.',
                'Installed, but the pause failed: the deployment is active and scheduled. Pause it.',
                'Instalado, pero la suspensión falló: el despliegue está activo y planificado. Suspéndalo.',
              )
            : `${this.stepLabel(step)} · ${this.explain(error)}`;
        this.deps.log(`agent cloud · installation en échec (${step}) : ${error instanceof CloudApiError ? `${error.status} ${error.type}` : 'erreur'}`);
        this.reschedule(1_000);
      }
    });
  }

  /** Exécution immédiate du déploiement (même en pause) : dialogue, Annuler par défaut. */
  async runNow(): Promise<AgentCloudStatus> {
    const id = this.config.deploymentId;
    if (!this.config.key || !id) return this.refuse('Installez ou indiquez d’abord un déploiement.', 'Install or enter a deployment first.', 'Instale o indique primero un despliegue.');
    return this.control('run', async () => {
      const cap = await this.capText(id);
      const choice = await this.ask({
        type: 'question',
        title: 'CΛNTO',
        message: this.t('Lancer une analyse maintenant ?', 'Run an analysis now?', '¿Lanzar un análisis ahora?'),
        detail: this.t(
          `Une session démarre tout de suite dans le bac à sable d’Anthropic, facturée sur les crédits API ; ${cap}. Le rapport arrive dans le dossier quand elle finit.`,
          `A session starts right away in Anthropic’s sandbox, billed to API credits; ${cap}. The report lands in the folder when it finishes.`,
          `Una sesión empieza enseguida en el entorno aislado de Anthropic, facturada a los créditos API; ${cap}. El informe llega a la carpeta al terminar.`,
        ),
        buttons: [this.t('Lancer', 'Run', 'Lanzar'), this.t('Annuler', 'Cancel', 'Cancelar')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice !== 0) return;
      const run = await this.api.runDeployment(id);
      if (run.errorType || !run.sessionId) {
        const cause = run.errorType ?? '?';
        this.error = this.t(`Exécution refusée par Anthropic : ${cause}`, `Run refused by Anthropic: ${cause}`, `Ejecución rechazada por Anthropic: ${cause}`);
        this.deps.log(`agent cloud · exécution manuelle refusée : ${cause}`);
        return;
      }
      this.error = null;
      this.pending = Math.max(this.pending, 1);
      this.deps.log('agent cloud · exécution manuelle lancée');
      this.reschedule(PULL_PENDING_MS);
    });
  }

  /** Suspendre la planification ne coûte rien : pas de dialogue. */
  async pause(): Promise<AgentCloudStatus> {
    const id = this.config.deploymentId;
    if (!this.config.key || !id) return this.status();
    if (!this.config.managed) return this.refuseExternal();
    return this.control('pause', async () => {
      this.deployment = deploymentState(await this.api.pauseDeployment(id));
      this.error = null;
      this.deps.log('agent cloud · planification suspendue');
    });
  }

  /** Reprendre la planification dépense chaque jour : dialogue, Annuler par défaut. */
  async unpause(): Promise<AgentCloudStatus> {
    const id = this.config.deploymentId;
    if (!this.config.key || !id) return this.status();
    if (!this.config.managed) return this.refuseExternal();
    return this.control('unpause', async () => {
      const cap = await this.capText(id);
      const choice = await this.ask({
        type: 'question',
        title: 'CΛNTO',
        message: this.t('Reprendre la planification ?', 'Resume the schedule?', '¿Reanudar la planificación?'),
        detail: this.t(
          `Le déploiement repart à la prochaine échéance (aucun rattrapage), facturé sur les crédits API ; ${cap}.`,
          `The deployment resumes at the next occurrence (no backfill), billed to API credits; ${cap}.`,
          `El despliegue se reanuda en el próximo vencimiento (sin recuperación), facturado a los créditos API; ${cap}.`,
        ),
        buttons: [this.t('Reprendre', 'Resume', 'Reanudar'), this.t('Annuler', 'Cancel', 'Cancelar')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice !== 0) return;
      this.deployment = deploymentState(await this.api.unpauseDeployment(id));
      this.error = null;
      this.deps.log('agent cloud · planification reprise');
    });
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

  private stepLabel(step: ProvisionStep): string {
    switch (step) {
      case 'environment':
        return this.t('Environnement', 'Environment', 'Entorno');
      case 'agent':
        return this.t('Agent', 'Agent', 'Agente');
      case 'deployment':
        return this.t('Déploiement', 'Deployment', 'Despliegue');
      case 'pause':
        return this.t('Suspension', 'Pause', 'Suspensión');
      case 'resume':
        return this.t('Reprise', 'Resume', 'Reanudación');
    }
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
      added = await this.collect(await this.sessionsToSee(deploymentId));
      try {
        const since = new Date(this.now() - FAILED_RUNS_WINDOW_MS).toISOString();
        const runs = await this.api.listFailedRuns(deploymentId, since, FAILURES_SHOWN);
        this.runFailures = runs.filter((r) => r.errorType).map((r) => ({ at: r.createdAt ?? this.now(), kind: 'run' as const, detail: `${r.errorType}${r.errorMessage ? ` · ${r.errorMessage}` : ''}`.slice(0, 200) }));
      } catch {
        /* les échecs de déclenchement sont un plus : le relevé tient sans eux */
      }
      this.error = null;
      // Le déploiement répond : une clé refusée un temps (403 d'un mauvais espace de travail) ne bloque plus le relevé.
      this.authBlocked = false;
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

  /** Les sessions à examiner : la première page, puis les suivantes tant qu'aucune n'est déjà connue (5 pages au plus). */
  private async sessionsToSee(deploymentId: string): Promise<SessionView[]> {
    const seen: SessionView[] = [];
    let page: string | undefined;
    for (let i = 0; i < SESSION_PAGES; i += 1) {
      const result = await this.api.listSessions(deploymentId, { limit: SESSIONS_PER_PULL, page });
      seen.push(...result.sessions);
      const reached = result.sessions.some((s) => this.config.collected[s.id] || this.reports().has(s.id));
      if (reached || !result.nextPage) break;
      page = result.nextPage;
    }
    return seen;
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
      if (session.status === 'running' || session.status === 'rescheduling') {
        pending += 1;
        continue;
      }
      // Finie (idle ou terminated). Une évaluation restée ouverte (plafond atteint, erreurs) n'est attendue que 30 min ;
      // sinon, 60 s suffisent à l'index des fichiers.
      const age = this.now() - (session.updatedAt ?? session.createdAt ?? 0);
      if (age < (session.outcomePending ? NO_REPORT_AFTER_MS : SETTLE_MS)) {
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
        const why = session.outcomePending ? `${session.status} · outcome ouvert` : session.outcomeResult ? `outcome ${session.outcomeResult}` : session.status;
        this.mark(session.id, false, 'no_report', why);
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
      if (!isDateNear(parsed.report.date, session.createdAt ?? this.now())) {
        this.mark(session.id, false, 'invalid', `date ${parsed.report.date}`);
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
