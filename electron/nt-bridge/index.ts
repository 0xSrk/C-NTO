/**
 * Façade du pont pour le process principal : jeton, politique, journal d'ordres.
 * Le jeton vit dans `userData/nt-bridge.json`, jamais dans le coffre exporté.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { NinjaBridge } from '../bridge';
import { mainLog } from '../main-log';
import { executionPayloadToCsv } from './execution-csv';
import { DEFAULT_MAX_CONTRACTS } from './guards';
import { DEFAULT_PORT, type ExecutionPayload } from './protocol';
import { NtBridgeServer, type NtBridgeStatus, type NtMarketEvent } from './server';

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

/** Écrit `bridge.json` (port + jeton) pour l'AddOn. Le jeton n'est pas renvoyé au renderer. */
export async function writeAddonConfig(folder: string, port: number, token: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'bridge.json');
  await writeFile(file, `${JSON.stringify({ port, token }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return file;
}

export class NtBridgeHost {
  private policy: NtPolicy | null = null;
  private server: NtBridgeServer | null = null;
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
      onExecution: (payload) => this.onExecution(payload),
      onStatus: () => this.pushStatus(),
      onMarket: (event) => this.onMarket(event),
    });
    this.server = server;
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
    this.pushStatus();
  }

  async dispose(): Promise<void> {
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

  async writeConfig(): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    if (!this.policy) return { ok: false, error: 'pont non démarré' };
    const folder = this.fileBridge?.status().folder || this.exportFolder();
    try {
      const file = await writeAddonConfig(folder, this.server?.status().port || this.policy.port, this.policy.token);
      mainLog('info', `nt-bridge configuration écrite (${path.basename(file)})`);
      return { ok: true, path: file };
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

  killSwitch(): { accounts: string[] } {
    return this.server?.killSwitch() ?? { accounts: [] };
  }

  private async persistPolicy(): Promise<void> {
    if (!this.policy) return;
    this.server?.setPolicy({ extraAccounts: this.policy.extraAccounts, maxContractsPerOrder: this.policy.maxContractsPerOrder });
    await savePolicy(this.userDataDir, this.policy);
    this.pushStatus();
  }

  private onExecution(payload: ExecutionPayload): void {
    if (payload.id) this.fileBridge?.noteExecution(payload.id);
    this.send('ntbridge:execution', { csv: executionPayloadToCsv([payload]), executionId: payload.id });
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
