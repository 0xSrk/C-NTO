/**
 * Façade du pont pour le process principal : jeton, politique, journal d'ordres.
 * Le jeton vit dans `userData/nt-bridge.json`, jamais dans le coffre exporté.
 */
import { execFile as execFileCb } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { NinjaBridge } from '../bridge';
import { mainLog } from '../main-log';
import { uiText, type AppLocale } from '../locale';
import { CopierHost, type CopierCutReport, type CopierHostStatus } from './copier-host';
import { executionFill, executionPayloadToCsv } from './execution-csv';
import { Nt8ExecutionPort } from './execution-port';
import { DEFAULT_MAX_CONTRACTS } from './guards';
import { DEFAULT_PORT, type ExecutionPayload } from './protocol';
import { NtBridgeServer, type KillSwitchOutcome, type KillSwitchSent, type NtBridgeStatus, type NtMarketEvent } from './server';

export interface NtPolicy {
  port: number;
  token: string;
  extraAccounts: string[];
  maxContractsPerOrder: number;
}

export interface NtPublicStatus extends NtBridgeStatus {
  extraAccounts: string[];
  maxContractsPerOrder: number;
  killSwitchShortcut: string;
}

export const KILL_SWITCH_SHORTCUT = 'CommandOrControl+Shift+K';

export function newSessionToken(): string {
  return randomBytes(18).toString('base64url');
}

function policyPath(userDataDir: string): string {
  return path.join(userDataDir, 'nt-bridge.json');
}

export async function loadPolicy(userDataDir: string): Promise<NtPolicy> {
  const fresh = (): NtPolicy => ({ port: DEFAULT_PORT, token: newSessionToken(), extraAccounts: [], maxContractsPerOrder: DEFAULT_MAX_CONTRACTS });
  try {
    const raw = JSON.parse(await readFile(policyPath(userDataDir), 'utf8')) as Partial<NtPolicy>;
    const policy = fresh();
    if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65535) policy.port = raw.port;
    if (typeof raw.token === 'string' && raw.token.length >= 8) policy.token = raw.token;
    if (Array.isArray(raw.extraAccounts)) {
      policy.extraAccounts = raw.extraAccounts.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 128);
    }
    if (typeof raw.maxContractsPerOrder === 'number' && Number.isInteger(raw.maxContractsPerOrder) && raw.maxContractsPerOrder >= 1 && raw.maxContractsPerOrder <= 1000) {
      policy.maxContractsPerOrder = raw.maxContractsPerOrder;
    }
    return policy;
  } catch {
    const policy = fresh();
    await savePolicy(userDataDir, policy);
    return policy;
  }
}

export async function savePolicy(userDataDir: string, policy: NtPolicy): Promise<void> {
  const file = policyPath(userDataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(policy), { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}

export interface AddonWriteIO {
  platform?: NodeJS.Platform;
  /** `execFile` sans shell. Le test injecte un faux pour vérifier les arguments. */
  execFile?: (cmd: string, args: readonly string[], cb: (err: Error | null) => void) => void;
  username?: string;
  log?: (level: 'info' | 'warn', message: string) => void;
}

function runExec(exec: NonNullable<AddonWriteIO['execFile']>, cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}

function defaultExec(cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, [...args], { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Ce que l'AddOn lit dans `bridge.json` : où se connecter, et sa propre garde d'ordres. */
export interface AddonConfig {
  port: number;
  token: string;
  /** Comptes réels autorisés par le dialogue du process principal. Les `Sim*` le sont toujours. */
  extraAccounts: readonly string[];
  maxContractsPerOrder: number;
}

/**
 * Écrit `bridge.json` pour l'AddOn : port, jeton et politique d'ordres (comptes, plafond), que
 * l'AddOn applique lui-même avant tout `order.submit`. Le jeton n'est pas renvoyé au renderer.
 * Sur Windows, Node ignore le mode POSIX : on retire l'héritage et on n'accorde que le compte courant.
 */
export async function writeAddonConfig(folder: string, config: AddonConfig, io: AddonWriteIO = {}): Promise<{ path: string; aclRestricted: boolean }> {
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'bridge.json');
  const body = { port: config.port, token: config.token, extraAccounts: [...config.extraAccounts], maxContractsPerOrder: config.maxContractsPerOrder };
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  const platform = io.platform ?? process.platform;
  if (platform !== 'win32') return { path: file, aclRestricted: true };
  const log = io.log ?? ((level, message) => mainLog(level, message));
  const username = io.username ?? process.env.USERNAME;
  if (!username) {
    log('warn', `bridge.json ACL non restreintes (${path.basename(file)})`);
    return { path: file, aclRestricted: false };
  }
  const args = [file, '/inheritance:r', '/grant:r', `${username}:F`] as const;
  try {
    if (io.execFile) await runExec(io.execFile, 'icacls', args);
    else await defaultExec('icacls', args);
    log('info', `bridge.json ACL restreintes (${path.basename(file)})`);
    return { path: file, aclRestricted: true };
  } catch {
    log('warn', `bridge.json ACL non restreintes (${path.basename(file)})`);
    return { path: file, aclRestricted: false };
  }
}

export interface RealAccountDialogOptions {
  type: 'warning';
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
  noLink: true;
  title: string;
  message: string;
}

/** Libellés du dialogue d'autorisation. Annuler est le bouton par défaut (index 1). */
export function realAccountDialog(account: string, locale: AppLocale): RealAccountDialogOptions {
  const allow = uiText(locale, `Autoriser les ordres réels sur ${account}`, `Allow real orders on ${account}`, `Autorizar órdenes reales en ${account}`);
  const cancel = uiText(locale, 'Annuler', 'Cancel', 'Cancelar');
  const message = uiText(
    locale,
    `Les ordres réels seront autorisés sur ${account}.`,
    `Real orders will be allowed on ${account}.`,
    `Las órdenes reales se autorizarán en ${account}.`,
  );
  return { type: 'warning', title: 'CΛNTO', message, buttons: [allow, cancel], defaultId: 1, cancelId: 1, noLink: true };
}

/**
 * N'appelle `allow` que si une fenêtre est attachée et que l'opérateur confirme dans le process principal.
 * Le dialogue du renderer ne suffit pas. Le journal ne contient pas le jeton.
 */
export async function authorizeLiveAccount<T>(args: {
  win: { isDestroyed(): boolean } | null;
  account: string;
  locale: AppLocale;
  showMessageBox: (win: { isDestroyed(): boolean }, options: RealAccountDialogOptions) => Promise<{ response: number }>;
  allow: (name: string) => Promise<T>;
  log: (line: string) => void;
  now?: Date;
}): Promise<T | null> {
  const name = args.account.trim();
  if (!args.win || args.win.isDestroyed() || !name || name.length > 128) return null;
  const choice = await args.showMessageBox(args.win, realAccountDialog(name, args.locale));
  if (choice.response !== 0) return null;
  const at = (args.now ?? new Date()).toISOString();
  args.log(`nt-bridge compte réel autorisé ${name} ${at}`);
  return args.allow(name);
}

/** Dialogue du relèvement du plafond. Annuler est le bouton par défaut (index 1). */
export function maxContractsDialog(from: number, to: number, locale: AppLocale): RealAccountDialogOptions {
  const allow = uiText(locale, `Relever à ${to} contrats par ordre`, `Raise to ${to} contracts per order`, `Subir a ${to} contratos por orden`);
  const cancel = uiText(locale, 'Annuler', 'Cancel', 'Cancelar');
  const message = uiText(
    locale,
    `Le plafond par ordre passera de ${from} à ${to} contrats, sur tous les comptes autorisés.`,
    `The per-order ceiling will go from ${from} to ${to} contracts, on every allowed account.`,
    `El tope por orden pasará de ${from} a ${to} contratos, en todas las cuentas autorizadas.`,
  );
  return { type: 'warning', title: 'CΛNTO', message, buttons: [allow, cancel], defaultId: 1, cancelId: 1, noLink: true };
}

/**
 * Baisser le plafond réduit le risque : appliqué sans dialogue. Le relever n'est appliqué qu'après
 * confirmation dans le process principal, fenêtre attachée. Hors 1–1000 ou non entier : rien.
 */
export async function changeMaxContracts<T>(args: {
  win: { isDestroyed(): boolean } | null;
  current: number;
  requested: number;
  locale: AppLocale;
  showMessageBox: (win: { isDestroyed(): boolean }, options: RealAccountDialogOptions) => Promise<{ response: number }>;
  apply: (n: number) => Promise<T>;
  log: (line: string) => void;
}): Promise<T | null> {
  const n = args.requested;
  if (!Number.isInteger(n) || n < 1 || n > 1000) return null;
  if (n > args.current) {
    if (!args.win || args.win.isDestroyed()) return null;
    const choice = await args.showMessageBox(args.win, maxContractsDialog(args.current, n, args.locale));
    if (choice.response !== 0) return null;
  }
  args.log(`nt-bridge plafond ${args.current} → ${n} contrats`);
  return args.apply(n);
}

export class NtBridgeHost {
  private policy: NtPolicy | null = null;
  private server: NtBridgeServer | null = null;
  private execution: Nt8ExecutionPort | null = null;
  private copier: CopierHost | null = null;
  private win: BrowserWindow | null = null;
  private fileBridge: NinjaBridge | null = null;
  private exportFolder: () => string;

  constructor(
    private readonly userDataDir: string,
    exportFolder: () => string,
  ) {
    this.exportFolder = exportFolder;
  }

  async start(): Promise<void> {
    this.policy = await loadPolicy(this.userDataDir);
    const policy = this.policy;
    const server = new NtBridgeServer({
      token: policy.token,
      port: policy.port,
      policy: { extraAccounts: policy.extraAccounts, maxContractsPerOrder: policy.maxContractsPerOrder },
      log: (message) => mainLog('info', `nt-bridge ${message}`),
      onExecution: (payload) => {
        this.onExecution(payload);
        this.execution?.ingestExecution(payload);
      },
      onOrder: (order) => this.execution?.ingestOrder(order),
      onAccounts: (accounts) => this.execution?.ingestAccounts(accounts),
      onStatus: () => {
        this.pushStatus();
        this.execution?.ingestLink(server.status().link);
      },
      onMarket: (event) => this.onMarket(event),
    });
    this.server = server;
    this.execution = new Nt8ExecutionPort(server);
    this.copier = new CopierHost(this.execution, this.userDataDir, (line) => mainLog('info', line), () => this.pushCopier());
    this.copier.open();
    try {
      await server.start();
      mainLog('info', `nt-bridge écoute 127.0.0.1:${server.status().port}`);
    } catch (err) {
      mainLog('error', `nt-bridge démarrage impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  attach(win: BrowserWindow, fileBridge: NinjaBridge): void {
    this.win = win;
    this.fileBridge = fileBridge;
    // Un bridge.json écrit par une version précédente n'a pas la politique d'ordres : on la lui ajoute.
    void this.syncAddonConfig();
    this.pushStatus();
  }

  async dispose(): Promise<void> {
    this.copier?.dispose();
    this.copier = null;
    this.execution?.dispose();
    this.execution = null;
    await this.server?.stop();
    this.server = null;
  }

  publicStatus(): NtPublicStatus | null {
    const policy = this.policy;
    const server = this.server;
    if (!policy || !server) return null;
    return {
      ...server.status(),
      extraAccounts: policy.extraAccounts,
      maxContractsPerOrder: policy.maxContractsPerOrder,
      killSwitchShortcut: KILL_SWITCH_SHORTCUT,
    };
  }

  async rotateToken(): Promise<{ hasToken: true }> {
    if (!this.policy) return { hasToken: true };
    this.policy.token = newSessionToken();
    this.server?.setToken(this.policy.token);
    await savePolicy(this.userDataDir, this.policy);
    this.pushStatus();
    return { hasToken: true };
  }

  async writeConfig(): Promise<{ ok: true; path: string; aclRestricted: boolean } | { ok: false; error: string }> {
    if (!this.policy) return { ok: false, error: 'pont non démarré' };
    const folder = this.fileBridge?.status().folder || this.exportFolder();
    try {
      const written = await writeAddonConfig(folder, this.addonConfig(this.policy));
      mainLog('info', `nt-bridge configuration écrite (${path.basename(written.path)})`);
      return { ok: true, path: written.path, aclRestricted: written.aclRestricted };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async allowAccount(name: string): Promise<NtPublicStatus | null> {
    const trimmed = name.trim();
    if (!this.policy || !trimmed || trimmed.length > 128) return this.publicStatus();
    if (!this.policy.extraAccounts.includes(trimmed)) this.policy.extraAccounts.push(trimmed);
    await this.persistPolicy();
    return this.publicStatus();
  }

  maxContracts(): number {
    return this.policy?.maxContractsPerOrder ?? DEFAULT_MAX_CONTRACTS;
  }

  /** Applique sans dialogue : passer par `changeMaxContracts`, qui confirme un relèvement. */
  async setMaxContracts(n: number): Promise<NtPublicStatus | null> {
    if (!this.policy || !Number.isInteger(n) || n < 1 || n > 1000) return this.publicStatus();
    this.policy.maxContractsPerOrder = n;
    await this.persistPolicy();
    return this.publicStatus();
  }

  subscribe(raw: unknown): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string; code?: number }> {
    if (!this.server || !isRecord(raw)) return Promise.resolve({ ok: false, detail: 'aucune source live' });
    return this.server.subscribe(raw);
  }

  unsubscribe(id: unknown): Promise<{ ok: boolean }> {
    if (!this.server || typeof id !== 'string') return Promise.resolve({ ok: false });
    return this.server.unsubscribe(id);
  }

  history(raw: unknown): Promise<{ ok: true; bars: unknown[] } | { ok: false; detail: string }> {
    if (!this.server || !isRecord(raw)) return Promise.resolve({ ok: false, detail: 'aucune source live' });
    return this.server.history(raw);
  }

  order(raw: unknown): Promise<{ ok: boolean; code?: number; message?: string; orderId?: string; latencyMs?: number; closed?: number }> {
    if (!this.server || !isRecord(raw)) return Promise.resolve({ ok: false, code: -32011, message: 'pont indisponible' });
    const op = raw.op;
    if (op === 'submit') return this.server.submit(raw);
    if (op === 'cancel' && typeof raw.account === 'string' && typeof raw.orderId === 'string') return this.server.cancel(raw.account, raw.orderId);
    if (op === 'flatten' && typeof raw.account === 'string') return this.server.flatten(raw.account);
    return Promise.resolve({ ok: false, code: -32602, message: 'opération inconnue' });
  }

  killSwitch(): KillSwitchSent {
    this.copier?.disarm();
    return this.server?.killSwitch() ?? { accounts: [], sent: false, settled: Promise.resolve([]) };
  }

  /** Kill switch puis réponses de l'AddOn, pour un message qui ne dit « aplati » que sur confirmation. */
  async killSwitchReport(): Promise<{ accounts: string[]; sent: boolean; results: KillSwitchOutcome[] }> {
    const { accounts, sent, settled } = this.killSwitch();
    return { accounts, sent, results: await settled };
  }

  configureCopier(raw: unknown): boolean {
    return this.copier?.configure(raw) ?? false;
  }

  armCopier(): void {
    this.copier?.arm();
  }

  cutCopier(): CopierCutReport {
    return this.copier?.cut() ?? { cancelled: [], open: [], flattened: [] };
  }

  copierStatus(): CopierHostStatus {
    return this.copier?.status() ?? { armed: false, link: 'absent', routed: 0, lastRefusal: null, flattenOnCut: false };
  }

  private async persistPolicy(): Promise<void> {
    if (!this.policy) return;
    this.server?.setPolicy({ extraAccounts: this.policy.extraAccounts, maxContractsPerOrder: this.policy.maxContractsPerOrder });
    await savePolicy(this.userDataDir, this.policy);
    await this.syncAddonConfig();
    this.pushStatus();
  }

  private addonConfig(policy: NtPolicy): AddonConfig {
    return { port: this.server?.status().port || policy.port, token: policy.token, extraAccounts: policy.extraAccounts, maxContractsPerOrder: policy.maxContractsPerOrder };
  }

  /**
   * L'AddOn applique la politique de `bridge.json` : un compte autorisé ou un plafond changé dans le desk
   * doit l'y rejoindre. Réécrit seulement un fichier déjà écrit par le trader ; n'en crée jamais.
   */
  async syncAddonConfig(): Promise<void> {
    if (!this.policy) return;
    const folder = this.fileBridge?.status().folder || this.exportFolder();
    if (!existsSync(path.join(folder, 'bridge.json'))) return;
    try {
      await writeAddonConfig(folder, this.addonConfig(this.policy));
    } catch (err) {
      mainLog('warn', `nt-bridge bridge.json non resynchronisé : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private onExecution(payload: ExecutionPayload): void {
    if (payload.id) this.fileBridge?.noteExecution(payload.id);
    this.send('ntbridge:execution', { csv: executionPayloadToCsv([payload]), executionId: payload.id, fill: executionFill(payload) });
  }

  private onMarket(event: NtMarketEvent): void {
    this.syncFileBridge();
    this.send('marketdata:event', event);
    if (event.kind === 'status') this.pushStatus();
  }

  private pushStatus(): void {
    this.syncFileBridge();
    const status = this.publicStatus();
    if (status) this.send('ntbridge:status', status);
  }

  private pushCopier(): void {
    this.send('copier:status', this.copierStatus());
  }

  private syncFileBridge(): void {
    const link = this.server?.status().link;
    this.fileBridge?.setSocketLive(link === 'live' || link === 'stale');
  }

  private send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
