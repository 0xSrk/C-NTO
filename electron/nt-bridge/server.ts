/**
 * Serveur WebSocket du pont NT8. Écoute uniquement 127.0.0.1.
 * Une connexion AddOn à la fois : la suivante ferme la précédente (4409).
 */
import { createHmac, randomBytes } from 'node:crypto';
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
  HISTORY_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  parseFrame,
  rpcError,
  rpcNotify,
  validateAddonCall,
  validateHistory,
  validateOrderSubmit,
  validateSubscribe,
  type AccountSnapshot,
  type AddonCall,
  type ExecutionPayload,
  type HelloParams,
  type OrderNotice,
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

/** Délai laissé à l'AddOn pour prouver qu'il connaît le jeton. */
export const AUTH_TIMEOUT_MS = 5_000;
/** Connexions en attente de preuve : au-delà, refusées (un client local ne peut pas saturer le pont). */
export const MAX_PENDING_AUTH = 4;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Preuve du défi-réponse (protocole 2). Chaque côté prouve qu'il connaît le jeton sans l'envoyer :
 * l'AddOn signe `canto-addon|<défi du desk>|<son défi>`, le desk `canto-desk|<défi de l'AddOn>|<son défi>`.
 * HMAC-SHA256, clé = jeton en UTF-8, sortie hexadécimale minuscule. Le C# de l'AddOn calcule la même chose.
 */
export function authProof(token: string, role: 'addon' | 'desk', first: string, second: string): string {
  return createHmac('sha256', Buffer.from(token, 'utf8')).update(`canto-${role}|${first}|${second}`, 'utf8').digest('hex');
}

export interface NtBridgeStatus {
  link: LinkState;
  port: number;
  addonVersion: string | null;
  ntVersion: string | null;
  accounts: AccountSnapshot[];
  /** Réception des derniers comptes (`bridge.accounts`), epoch ms ; `null` avant le premier envoi. */
  accountsAt: number | null;
  accountNames: string[];
  heartbeatLatencyMs: number | null;
  ordersOpen: boolean;
  /** Kill switch engagé : le canal d'ordres reste fermé jusqu'au redémarrage du desk, lien vivant ou non. */
  ordersClosed: boolean;
  hasToken: boolean;
  /** `mutual` : défi-réponse, le jeton ne circule pas. `token` : ancien AddOn, jeton dans l'URL. */
  auth: 'mutual' | 'token' | null;
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
  onOrder?: (order: OrderNotice) => void;
  onAccounts?: (accounts: AccountSnapshot[]) => void;
  onStatus?: (status: NtBridgeStatus) => void;
  onMarket?: (event: NtMarketEvent) => void;
}

export type NtMarketEvent =
  | { kind: 'bar'; instrument: string; timeframe: number; bar: { time: number; open: number; high: number; low: number; close: number; volume: number }; final: boolean }
  | { kind: 'tick'; tick: { instrument: string; time: number; price: number; size: number; side?: 'buy' | 'sell' } }
  | { kind: 'quote'; quote: { instrument: string; time: number; bid: number; ask: number; last?: number } }
  | { kind: 'status'; state: 'live' | 'stale' | 'closed' | 'connecting'; detail?: string };

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; cancel: () => void };

/** Réponse de l'AddOn à un `order.flatten` du kill switch. */
export interface KillSwitchOutcome {
  account: string;
  ok: boolean;
  closed?: number;
  error?: string;
}

export interface KillSwitchSent {
  accounts: string[];
  /** Faux si aucune trame ne pouvait partir (pont hors ligne). */
  sent: boolean;
  settled: Promise<KillSwitchOutcome[]>;
}

/** Délai de réponse d'un aplatissement du kill switch (l'envoi, lui, part tout de suite). */
export const KILL_SWITCH_TIMEOUT_MS = 3_000;

export class NtBridgeServer {
  private readonly clock: BridgeClock;
  private readonly log: (message: string) => void;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private auth: 'mutual' | 'token' | null = null;
  private readonly pendingAuth = new Map<WebSocket, { nonce: string; cancel: () => void }>();
  private token: string;
  private policy: GuardPolicy;
  private link: LinkState = 'absent';
  private helloOk = false;
  private hello: HelloParams | null = null;
  private accounts: AccountSnapshot[] = [];
  private accountsAt: number | null = null;
  private accountNames: string[] = [];
  private ordersClosed = false;
  private nextId = 0;
  private pending = new Map<string, Pending>();
  /**
   * Abonnements de marché que l'AddOn tient pour la page du desk : il les garde à travers une reconnexion, jusqu'à leur
   * `marketdata.unsubscribe`. Fermés au départ de la page (`releaseSubscriptions`).
   */
  private readonly marketSubs = new Set<string>();
  private cancelStale: (() => void) | null = null;
  private cancelLost: (() => void) | null = null;
  private beatSamples: number[] = [];
  private boundPort = 0;
  private readonly requestedPort: number;
  private readonly onExecution?: (payload: ExecutionPayload) => void;
  private readonly onOrder?: (order: OrderNotice) => void;
  private readonly onAccounts?: (accounts: AccountSnapshot[]) => void;
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
    this.onOrder = options.onOrder;
    this.onAccounts = options.onAccounts;
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
    for (const [pending, state] of this.pendingAuth) {
      state.cancel();
      pending.close(1001, 'arrêt');
    }
    this.pendingAuth.clear();
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
      accountsAt: this.accountsAt,
      accountNames: this.accountNames,
      heartbeatLatencyMs,
      ordersOpen: this.link === 'live' && !this.ordersClosed,
      // le kill switch ferme le canal jusqu'au redémarrage, lien vivant ou non : le renderer le lit ici
      ordersClosed: this.ordersClosed,
      hasToken: this.token.length > 0,
      auth: this.socket ? this.auth : null,
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
      // La garde de l'AddOn répond avec les codes du desk : on les garde (compte, plafond, tag).
      const rpcCode = (err as { rpcCode?: unknown }).rpcCode;
      const code = rpcCode === ERR.ACCOUNT || rpcCode === ERR.QUANTITY || rpcCode === ERR.TAG ? rpcCode : ERR.GENERIC;
      return { ok: false, code, message };
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
   * Les envois partent avant le premier await, pour tenir l'objectif < 200 ms. `settled` rend la
   * réponse de l'AddOn pour chaque compte (ou l'erreur), au plus `KILL_SWITCH_TIMEOUT_MS` après.
   */
  killSwitch(): KillSwitchSent {
    const accounts = killSwitchAccounts(this.accountNames, this.policy.extraAccounts);
    this.ordersClosed = true;
    const sent = this.canSend();
    const replies = accounts.map((account) =>
      this.rpc('order.flatten', { account }, KILL_SWITCH_TIMEOUT_MS).then(
        (result): KillSwitchOutcome => {
          const rec = asRecord(result);
          return { account, ok: true, closed: rec && typeof rec.closed === 'number' ? rec.closed : 0 };
        },
        (err: unknown): KillSwitchOutcome => ({ account, ok: false, error: err instanceof Error ? err.message : 'échec order.flatten' }),
      ),
    );
    this.log(`kill switch · ${accounts.join(', ') || 'aucun compte'}${sent ? '' : ' · pont hors ligne, rien envoyé'}`);
    this.emitStatus();
    const settled = Promise.all(replies).then((results) => {
      if (results.length) this.log(`kill switch · ${results.map((r) => (r.ok ? `${r.account} aplati closed=${r.closed}` : `${r.account} non confirmé (${r.error})`)).join(' · ')}`);
      return results;
    });
    return { accounts, sent, settled };
  }

  async subscribe(raw: Record<string, unknown>): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string; code?: number }> {
    if (this.link !== 'live') return { ok: false, detail: 'aucune source live' };
    const parsed = validateSubscribe(raw);
    if (!parsed.ok) return { ok: false, detail: parsed.message, code: parsed.code };
    try {
      const result = asRecord(await this.rpc('marketdata.subscribe', parsed.req));
      const subscriptionId = result && typeof result.subscriptionId === 'string' ? result.subscriptionId : '';
      if (!subscriptionId) return { ok: false, detail: 'abonnement refusé' };
      this.marketSubs.add(subscriptionId);
      return { ok: true, subscriptionId };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'abonnement impossible' };
    }
  }

  async unsubscribe(subscriptionId: string): Promise<{ ok: boolean }> {
    if (this.link !== 'live') return { ok: false };
    try {
      await this.rpc('marketdata.unsubscribe', { subscriptionId });
      this.marketSubs.delete(subscriptionId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /**
   * La page du desk s'en va (rechargement, navigation, rendu perdu) : chaque abonnement de marché qu'elle avait ouvert est
   * fermé chez l'AddOn ; la page suivante se réabonne. Pont hors ligne, ou désabonnement sans réponse : l'identifiant reste
   * noté et part au départ suivant. Rend le nombre d'abonnements fermés.
   */
  async releaseSubscriptions(): Promise<number> {
    const results = await Promise.all([...this.marketSubs].map((id) => this.unsubscribe(id)));
    return results.filter((r) => r.ok).length;
  }

  /** Fenêtre validée avant tout envoi : l'AddOn ne reçoit qu'une borne qu'il sait convertir. */
  async history(raw: Record<string, unknown>): Promise<{ ok: true; bars: unknown[] } | { ok: false; detail: string }> {
    const parsed = validateHistory(raw);
    if (!parsed.ok) return { ok: false, detail: parsed.message };
    if (this.link !== 'live') return { ok: false, detail: 'aucune source live' };
    try {
      const result = asRecord(await this.rpc('marketdata.history', parsed.req, HISTORY_TIMEOUT_MS));
      const bars = result && Array.isArray(result.bars) ? result.bars.slice(0, HISTORY_BAR_CAP) : [];
      return { ok: true, bars };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'historique impossible' };
    }
  }

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    socket.on('error', () => {
      /* la fermeture suit ; une connexion adoptée a son propre suivi */
    });
    socket.on('message', (data, isBinary) => {
      if (this.pendingAuth.has(socket)) this.onAuthMessage(socket, data, isBinary);
      else this.onMessage(socket, data, isBinary);
    });
    // Ancien AddOn (≤ 2.1) : jeton dans l'URL. Accepté, signalé dans le statut (`auth: 'token'`).
    const legacy = readToken(req.url);
    if (legacy) {
      if (!tokensMatch(legacy, this.token)) {
        socket.close(CLOSE.BAD_TOKEN, 'jeton invalide');
        return;
      }
      this.adopt(socket, 'token');
      return;
    }
    // Protocole 2 : défi-réponse. La connexion n'est adoptée (et ne remplace l'AddOn en place) qu'après la preuve.
    if (this.pendingAuth.size >= MAX_PENDING_AUTH) {
      socket.close(CLOSE.BAD_TOKEN, 'trop de connexions en attente');
      return;
    }
    const nonce = randomBytes(32).toString('hex');
    const cancel = this.clock.delay(AUTH_TIMEOUT_MS, () => {
      if (!this.pendingAuth.delete(socket)) return;
      socket.close(CLOSE.BAD_TOKEN, 'authentification expirée');
    });
    this.pendingAuth.set(socket, { nonce, cancel });
    socket.on('close', () => {
      const state = this.pendingAuth.get(socket);
      if (!state) return;
      state.cancel();
      this.pendingAuth.delete(socket);
    });
    socket.send(rpcNotify('bridge.challenge', { nonce, protocol: 2 }));
  }

  /** Seule trame admise avant la preuve : `bridge.auth { nonce, proof }`. Tout le reste ferme en 4401. */
  private onAuthMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    const state = this.pendingAuth.get(socket);
    if (!state) return;
    const refuse = (reason: string) => {
      state.cancel();
      this.pendingAuth.delete(socket);
      socket.close(CLOSE.BAD_TOKEN, reason);
    };
    if (isBinary || frameByteLength(data) > 4096) return refuse('authentification invalide');
    const parsed = parseFrame(rawToString(data));
    if (!parsed.ok || parsed.kind === 'response' || parsed.method !== 'bridge.auth') return refuse('bridge.auth requis');
    const nonce = parsed.params.nonce;
    const proof = parsed.params.proof;
    if (typeof nonce !== 'string' || typeof proof !== 'string' || !HEX64.test(nonce) || !HEX64.test(proof) || nonce === state.nonce) return refuse('authentification invalide');
    if (!tokensMatch(proof, authProof(this.token, 'addon', state.nonce, nonce))) return refuse('preuve invalide');
    state.cancel();
    this.pendingAuth.delete(socket);
    socket.send(rpcNotify('bridge.welcome', { proof: authProof(this.token, 'desk', nonce, state.nonce) }));
    this.log('AddOn authentifié (défi-réponse)');
    this.adopt(socket, 'mutual');
  }

  private adopt(socket: WebSocket, auth: 'mutual' | 'token'): void {
    const previous = this.socket;
    this.socket = socket;
    this.auth = auth;
    this.helloOk = false;
    this.hello = null;
    this.beatSamples = [];
    this.link = 'connecting';
    this.clearWatchdog();
    this.failPending('connexion remplacée');
    if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) previous.close(CLOSE.REPLACED, 'remplacé');
    this.emitStatus();
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
        this.accountsAt = this.clock.now();
        this.accountNames = call.params.accounts.map((row) => row.name);
        this.onAccounts?.(call.params.accounts);
        this.emitStatus();
        return;
      case 'bridge.execution':
        this.onExecution?.(call.params);
        return;
      case 'bridge.order':
        this.onOrder?.(call.params);
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

  /** Une trame peut partir vers l'AddOn (socket ouverte, `bridge.hello` reçu). */
  private canSend(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN && this.helloOk;
  }

  private rpc(method: string, params: unknown, timeoutMs = 8_000): Promise<unknown> {
    const socket = this.socket;
    if (!socket || !this.canSend()) {
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
    if (error) pending.reject(Object.assign(new Error(error.message), { rpcCode: error.code }));
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
