/**
 * Serveur WebSocket du pont NT8. Écoute uniquement 127.0.0.1.
 * Une connexion AddOn à la fois : la suivante ferme la précédente (4409).
 */
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { tokensMatch } from '../secure-token';
import { guardAccountCommand, guardSubmit, killSwitchAccounts, type GuardPolicy, type LinkState } from './guards';
import {
  CLOSE,
  ERR,
  HEARTBEAT_LOST_MS,
  HEARTBEAT_STALE_MS,
  HISTORY_BAR_CAP,
  MAX_FRAME_BYTES,
  parseFrame,
  rpcError,
  rpcNotify,
  validateAddonCall,
  validateOrderSubmit,
  validateSubscribe,
  type AccountSnapshot,
  type AddonCall,
  type ExecutionPayload,
  type HelloParams,
  type OrderSubmitParams,
  type RpcId,
} from './protocol';

export interface BridgeClock {
  now(): number;
  delay(ms: number, fn: () => void): () => void;
}

export function systemClock(): BridgeClock {
  return {
    now: () => Date.now(),
    delay(ms, fn) {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  };
}

/** Horloge factice : `advance` déclenche les échéances dues, dans l'ordre. */
export class ManualClock implements BridgeClock {
  t = 0;
  private queue: { at: number; fn: () => void }[] = [];

  now(): number {
    return this.t;
  }

  delay(ms: number, fn: () => void): () => void {
    const item = { at: this.t + ms, fn };
    this.queue.push(item);
    return () => {
      const i = this.queue.indexOf(item);
      if (i >= 0) this.queue.splice(i, 1);
    };
  }

  advance(ms: number): void {
    this.t += ms;
    for (let guard = 0; guard < 50; guard++) {
      const due = this.queue.filter((item) => item.at <= this.t).sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next) return;
      const i = this.queue.indexOf(next);
      this.queue.splice(i, 1);
      next.fn();
    }
  }
}

export interface NtBridgeStatus {
  link: LinkState;
  port: number;
  addonVersion: string | null;
  ntVersion: string | null;
  accounts: AccountSnapshot[];
  accountNames: string[];
  heartbeatLatencyMs: number | null;
  ordersOpen: boolean;
  hasToken: boolean;
}

export interface NtBridgeServerOptions {
  token: string;
  port?: number;
  clock?: BridgeClock;
  /** Toute valeur autre que 127.0.0.1 est refusée. */
  host?: string;
  policy?: GuardPolicy;
  log?: (message: string) => void;
  onExecution?: (payload: ExecutionPayload) => void;
  onStatus?: (status: NtBridgeStatus) => void;
  onMarket?: (event: NtMarketEvent) => void;
}

export type NtMarketEvent =
  | { kind: 'bar'; instrument: string; timeframe: number; bar: { time: number; open: number; high: number; low: number; close: number; volume: number }; final: boolean }
  | { kind: 'tick'; tick: { instrument: string; time: number; price: number; size: number; side?: 'buy' | 'sell' } }
  | { kind: 'quote'; quote: { instrument: string; time: number; bid: number; ask: number; last?: number } }
  | { kind: 'status'; state: 'live' | 'stale' | 'closed' | 'connecting'; detail?: string };

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; cancel: () => void };

export class NtBridgeServer {
  private readonly clock: BridgeClock;
  private readonly log: (message: string) => void;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private token: string;
  private policy: GuardPolicy;
  private link: LinkState = 'absent';
  private helloOk = false;
  private hello: HelloParams | null = null;
  private accounts: AccountSnapshot[] = [];
  private accountNames: string[] = [];
  private ordersClosed = false;
  private nextId = 0;
  private pending = new Map<string, Pending>();
  private cancelStale: (() => void) | null = null;
  private cancelLost: (() => void) | null = null;
  private beatSamples: number[] = [];
  private boundPort = 0;
  private readonly requestedPort: number;
  private readonly onExecution?: (payload: ExecutionPayload) => void;
  private readonly onStatus?: (status: NtBridgeStatus) => void;
  private readonly onMarket?: (event: NtMarketEvent) => void;

  constructor(options: NtBridgeServerOptions) {
    const host = options.host ?? '127.0.0.1';
    if (host !== '127.0.0.1') throw new Error('Écoute refusée hors 127.0.0.1');
    this.token = options.token;
    this.requestedPort = options.port ?? 0;
    this.clock = options.clock ?? systemClock();
    this.log = options.log ?? (() => {});
    this.policy = options.policy ?? { extraAccounts: [], maxContractsPerOrder: 20 };
    this.onExecution = options.onExecution;
    this.onStatus = options.onStatus;
    this.onMarket = options.onMarket;
  }

  async start(): Promise<number> {
    if (this.wss) return this.boundPort;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: this.requestedPort, maxPayload: MAX_FRAME_BYTES });
    this.wss = wss;
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', () => resolve());
      wss.once('error', reject);
    });
    const addr = wss.address();
    this.boundPort = typeof addr === 'object' && addr ? addr.port : this.requestedPort;
    wss.on('connection', (socket, req) => this.onConnection(socket, req));
    this.emitStatus();
    return this.boundPort;
  }

  async stop(): Promise<void> {
    this.clearWatchdog();
    this.failPending('pont arrêté');
    this.socket?.close(1001, 'arrêt');
    this.socket = null;
    this.link = 'absent';
    this.helloOk = false;
    const wss = this.wss;
    this.wss = null;
    if (wss) await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  setToken(token: string): void {
    this.token = token;
    this.socket?.close(CLOSE.BAD_TOKEN, 'jeton régénéré');
  }

  setPolicy(policy: GuardPolicy): void {
    this.policy = policy;
    this.emitStatus();
  }

  status(): NtBridgeStatus {
    const samples = this.beatSamples;
    const heartbeatLatencyMs = samples.length ? Math.round(samples.reduce((sum, n) => sum + n, 0) / samples.length) : null;
    return {
      link: this.link,
      port: this.boundPort,
      addonVersion: this.hello?.addonVersion ?? null,
      ntVersion: this.hello?.ntVersion ?? null,
      accounts: this.accounts,
      accountNames: this.accountNames,
      heartbeatLatencyMs,
      ordersOpen: this.link === 'live' && !this.ordersClosed,
      hasToken: this.token.length > 0,
    };
  }

  async submit(raw: Record<string, unknown>): Promise<{ ok: true; orderId: string; latencyMs: number } | { ok: false; code: number; message: string }> {
    const parsed = validateOrderSubmit(raw);
    if (!parsed.ok) return parsed;
    const verdict = guardSubmit(parsed.order, this.policy, { link: this.link, ordersClosed: this.ordersClosed });
    if (!verdict.ok) {
      this.logOrder(parsed.order, verdict.message);
      return verdict;
    }
    const started = this.clock.now();
    try {
      const result = asRecord(await this.rpc('order.submit', parsed.order));
      const orderId = result && typeof result.orderId === 'string' ? result.orderId : '';
      if (!orderId) return { ok: false, code: ERR.GENERIC, message: 'réponse order.submit sans orderId' };
      const latencyMs = Math.max(0, this.clock.now() - started);
      this.logOrder(parsed.order, `ok ${orderId} latence=${latencyMs}ms`);
      return { ok: true, orderId, latencyMs };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'échec order.submit';
      this.logOrder(parsed.order, message);
      if (this.ordersClosed || this.link !== 'live') return { ok: false, code: ERR.LOST, message: 'pont perdu, ordre non réémis' };
      return { ok: false, code: ERR.GENERIC, message };
    }
  }

  async cancel(account: string, orderId: string): Promise<{ ok: true } | { ok: false; code: number; message: string }> {
    const verdict = guardAccountCommand(account, this.policy, { link: this.link, ordersClosed: this.ordersClosed });
    if (!verdict.ok) return verdict;
    try {
      await this.rpc('order.cancel', { account, orderId });
      this.log(`annulation ${account} ${orderId}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: ERR.GENERIC, message: err instanceof Error ? err.message : 'échec order.cancel' };
    }
  }

  async flatten(account: string): Promise<{ ok: true; closed: number } | { ok: false; code: number; message: string }> {
    const verdict = guardAccountCommand(account, this.policy, { link: this.link, ordersClosed: this.ordersClosed });
    if (!verdict.ok) return verdict;
    return this.emitFlatten(account);
  }

  /**
   * Aplatit chaque compte autorisé puis ferme le canal d'ordres.
   * Les envois partent avant le premier await, pour tenir l'objectif < 200 ms.
   */
  killSwitch(): { accounts: string[] } {
    const accounts = killSwitchAccounts(this.accountNames, this.policy.extraAccounts);
    this.ordersClosed = true;
    for (const account of accounts) {
      void this.rpc('order.flatten', { account }).catch(() => {});
    }
    this.log(`kill switch · ${accounts.join(', ') || 'aucun compte'}`);
    this.emitStatus();
    return { accounts };
  }

  async subscribe(raw: Record<string, unknown>): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string; code?: number }> {
    if (this.link !== 'live') return { ok: false, detail: 'aucune source live' };
    const parsed = validateSubscribe(raw);
    if (!parsed.ok) return { ok: false, detail: parsed.message, code: parsed.code };
    try {
      const result = asRecord(await this.rpc('marketdata.subscribe', parsed.req));
      const subscriptionId = result && typeof result.subscriptionId === 'string' ? result.subscriptionId : '';
      if (!subscriptionId) return { ok: false, detail: 'abonnement refusé' };
      return { ok: true, subscriptionId };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'abonnement impossible' };
    }
  }

  async unsubscribe(subscriptionId: string): Promise<{ ok: boolean }> {
    if (this.link !== 'live') return { ok: false };
    try {
      await this.rpc('marketdata.unsubscribe', { subscriptionId });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async history(raw: Record<string, unknown>): Promise<{ ok: true; bars: unknown[] } | { ok: false; detail: string }> {
    if (this.link !== 'live') return { ok: false, detail: 'aucune source live' };
    try {
      const result = asRecord(await this.rpc('marketdata.history', raw));
      const bars = result && Array.isArray(result.bars) ? result.bars.slice(0, HISTORY_BAR_CAP) : [];
      return { ok: true, bars };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'historique impossible' };
    }
  }

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const token = readToken(req.url);
    if (!tokensMatch(token, this.token)) {
      socket.close(CLOSE.BAD_TOKEN, 'jeton invalide');
      return;
    }
    const previous = this.socket;
    this.socket = socket;
    this.helloOk = false;
    this.hello = null;
    this.beatSamples = [];
    this.link = 'connecting';
    this.clearWatchdog();
    this.failPending('connexion remplacée');
    if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) previous.close(CLOSE.REPLACED, 'remplacé');
    this.emitStatus();
    socket.on('message', (data, isBinary) => this.onMessage(socket, data, isBinary));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      if (this.link === 'live' || this.link === 'stale' || this.link === 'connecting') this.enterLost('socket fermé');
    });
    socket.on('error', () => {
      if (this.socket !== socket) return;
      this.enterLost('erreur socket');
    });
  }

  private onMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (this.socket !== socket) return;
    if (isBinary) {
      socket.close(CLOSE.TOO_BIG, 'binaire');
      return;
    }
    const raw = rawToString(data);
    if (frameByteLength(data) > MAX_FRAME_BYTES) {
      socket.close(CLOSE.TOO_BIG, 'trame trop grande');
      return;
    }
    const parsed = parseFrame(raw);
    if (!parsed.ok) {
      if (parsed.close) socket.close(parsed.close, parsed.message);
      else if (parsed.id !== undefined) socket.send(rpcError(parsed.id, parsed.code, parsed.message));
      else if (!this.helloOk) socket.close(CLOSE.NO_HELLO, 'bridge.hello requis');
      return;
    }
    if (parsed.kind === 'response') {
      this.takeResponse(parsed.id, parsed.result, parsed.error);
      return;
    }
    const call = validateAddonCall(parsed.method, parsed.params, this.helloOk);
    if (!call.ok) {
      if (call.close) socket.close(call.close, call.message);
      else if (parsed.id !== undefined) socket.send(rpcError(parsed.id, call.code, call.message));
      return;
    }
    this.dispatch(socket, parsed.id, call.call);
  }

  private dispatch(socket: WebSocket, id: RpcId | undefined, call: AddonCall): void {
    switch (call.method) {
      case 'bridge.hello':
        this.helloOk = true;
        this.hello = call.params;
        this.accountNames = [...call.params.accounts];
        this.link = 'live';
        this.armWatchdog();
        this.onMarket?.({ kind: 'status', state: 'live' });
        if (id !== undefined) socket.send(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }));
        this.emitStatus();
        return;
      case 'bridge.heartbeat':
        this.onHeartbeat(call.params.at);
        return;
      case 'bridge.accounts':
        this.accounts = call.params.accounts;
        this.accountNames = call.params.accounts.map((row) => row.name);
        this.emitStatus();
        return;
      case 'bridge.execution':
        this.onExecution?.(call.params);
        return;
      case 'bridge.order':
        return;
      case 'marketdata.bar':
        this.onMarket?.({ kind: 'bar', instrument: call.params.instrument, timeframe: call.params.timeframe, bar: call.params.bar, final: call.params.final });
        return;
      case 'marketdata.tick':
        this.onMarket?.({ kind: 'tick', tick: call.params });
        return;
      case 'marketdata.quote':
        this.onMarket?.({ kind: 'quote', quote: call.params });
        return;
      default:
        return;
    }
  }

  private onHeartbeat(at: number): void {
    const now = this.clock.now();
    this.beatSamples.push(Math.max(0, now - at));
    if (this.beatSamples.length > 3) this.beatSamples.shift();
    const wasDown = this.link !== 'live';
    this.link = 'live';
    this.armWatchdog();
    if (wasDown) this.onMarket?.({ kind: 'status', state: 'live' });
    this.emitStatus();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.cancelStale = this.clock.delay(HEARTBEAT_STALE_MS, () => {
      if (this.link !== 'live') return;
      this.link = 'stale';
      this.onMarket?.({ kind: 'status', state: 'stale', detail: 'battement en retard' });
      this.emitStatus();
    });
    this.cancelLost = this.clock.delay(HEARTBEAT_LOST_MS, () => {
      if (this.link !== 'live' && this.link !== 'stale') return;
      this.enterLost('silence');
    });
  }

  private enterLost(reason: string): void {
    if (this.link === 'lost' || this.link === 'absent') return;
    this.link = 'lost';
    this.clearWatchdog();
    this.failPending('pont perdu, ordre non réémis');
    this.onMarket?.({ kind: 'status', state: 'stale', detail: reason });
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(rpcNotify('bridge.lost', { at: this.clock.now(), reason }));
    }
    this.log(`pont perdu (${reason})`);
    this.emitStatus();
  }

  private clearWatchdog(): void {
    this.cancelStale?.();
    this.cancelLost?.();
    this.cancelStale = null;
    this.cancelLost = null;
  }

  private rpc(method: string, params: unknown, timeoutMs = 8_000): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.helloOk) {
      return Promise.reject(new Error('pont indisponible'));
    }
    const id = ++this.nextId;
    const key = idKey(id);
    return new Promise((resolve, reject) => {
      const cancel = this.clock.delay(timeoutMs, () => {
        if (!this.pending.delete(key)) return;
        reject(new Error('délai dépassé'));
      });
      this.pending.set(key, { resolve, reject, cancel });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private takeResponse(id: RpcId, result: unknown, error?: { code: number; message: string }): void {
    const key = idKey(id);
    const pending = this.pending.get(key);
    if (!pending) return;
    pending.cancel();
    this.pending.delete(key);
    if (error) pending.reject(new Error(error.message));
    else pending.resolve(result);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) {
      pending.cancel();
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private async emitFlatten(account: string): Promise<{ ok: true; closed: number } | { ok: false; code: number; message: string }> {
    try {
      const result = asRecord(await this.rpc('order.flatten', { account }));
      const closed = result && typeof result.closed === 'number' ? result.closed : 0;
      this.log(`flatten ${account} closed=${closed}`);
      return { ok: true, closed };
    } catch (err) {
      return { ok: false, code: ERR.GENERIC, message: err instanceof Error ? err.message : 'échec order.flatten' };
    }
  }

  private logOrder(order: OrderSubmitParams, result: string): void {
    this.log(`ordre tag=${order.tag} compte=${order.account} instrument=${order.instrument} qty=${order.quantity} ${result}`);
  }

  private emitStatus(): void {
    this.onStatus?.(this.status());
  }
}

function idKey(id: RpcId): string {
  return `${typeof id}:${id}`;
}

function readToken(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').searchParams.get('token') ?? '';
  } catch {
    return '';
  }
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function frameByteLength(data: RawData): number {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, buf) => sum + buf.length, 0);
  return data.byteLength;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
