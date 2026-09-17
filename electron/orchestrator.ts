import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { tokensMatch } from './secure-token';

export interface OrchestratorStatus {
  running: boolean;
  port: number;
  clients: number;
  error?: string;
}

interface Client {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  window: { start: number; count: number };
  inflight: number;
}

const MAX_PAYLOAD = 1024 * 1024;
const MAX_CLIENTS = 8;
const MAX_INFLIGHT = 8;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 40;
const OPEN = 1;

const ORCH_READ_METHODS = new Set([
  'desk.auth',
  'desk.describe',
  'desk.ping',
  'desk_overview',
  'list_sessions',
  'get_session',
  'search_notes',
  'read_note',
  'calendar_events',
  'propfirm_status',
]);
const ORCH_WRITE_METHODS = new Set(['create_note', 'annotate_session']);

/** Miroir de src/engine/agent/ports.ts `orchMethodAllowed`. */
export function orchMethodAllowed(method: string, allowWrites: boolean): boolean {
  const name = method.replace(/^tool\./, '');
  if (ORCH_READ_METHODS.has(method) || ORCH_READ_METHODS.has(name)) return true;
  if (allowWrites && ORCH_WRITE_METHODS.has(name)) return true;
  return false;
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* structure non sérialisable ou socket fermée entre-temps */
  }
}

/**
 * Passerelle JSON-RPC 2.0 sur WebSocket (127.0.0.1 uniquement).
 * Un orchestrateur IA externe s'y connecte pour interroger et piloter le desk ;
 * chaque requête est transmise au renderer qui exécute l'outil natif correspondant.
 *
 * Garde-fous : jeton de session obligatoire, refus des origines navigateur (anti-hijack
 * WebSocket inter-sites), taille de trame bornée, limitation de débit par client.
 */
export class Orchestrator {
  private server: WebSocketServer | null = null;
  private clients = new Map<string, Client>();
  private win: BrowserWindow | null = null;
  private port = 0;
  private error: string | undefined;
  private seq = 0;
  private token = randomBytes(18).toString('base64url');
  private allowWrites = false;

  attach(win: BrowserWindow): void {
    this.win = win;
  }

  status(): OrchestratorStatus {
    return { running: !!this.server, port: this.port, clients: this.clients.size, error: this.error };
  }

  /** One-shot : le jeton n'est pas renvoyé par status(). */
  copyToken(): string {
    return this.token;
  }

  /** Régénère le jeton (déconnecte les clients en cours). */
  rotateToken(): OrchestratorStatus {
    this.token = randomBytes(18).toString('base64url');
    for (const c of this.clients.values()) c.socket.close(1008, 'Jeton renouvelé');
    this.clients.clear();
    this.emitStatus();
    return this.status();
  }

  async start(port: number, allowWrites = false): Promise<OrchestratorStatus> {
    this.allowWrites = allowWrites === true;
    if (this.server) return this.status();
    this.error = undefined;
    // `ws` n'est chargé qu'à l'ouverture de la passerelle : le démarrage du shell n'en dépend pas.
    const { WebSocketServer } = await import('ws');
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port,
        maxPayload: MAX_PAYLOAD,
        verifyClient: ({ req }: { req: IncomingMessage }) => {
          // Un navigateur envoie toujours Origin : on n'accepte que les clients natifs (aucune origine).
          if (req.headers.origin) return false;
          return this.clients.size < MAX_CLIENTS;
        },
      });
      server.on('listening', () => {
        this.server = server;
        this.port = port;
        this.emitStatus();
        resolve(this.status());
      });
      server.on('error', (err: Error) => {
        this.error = err.message;
        if (!this.server) {
          server.close();
          this.emitStatus();
          resolve(this.status());
        }
      });
      server.on('connection', (socket, req) => {
        const id = `c${++this.seq}`;
        const url = new URL(req.url ?? '/', 'ws://127.0.0.1');
        const q = url.searchParams.get('token') ?? '';
        const authenticated = tokensMatch(q, this.token);
        this.clients.set(id, { id, socket, authenticated, window: { start: Date.now(), count: 0 }, inflight: 0 });
        this.emitStatus();
        safeSend(socket, { jsonrpc: '2.0', method: 'desk.hello', params: { artefact: 'CΛNTO', version: '1.1.1', clientId: id, authenticated } });
        socket.on('message', (raw) => this.onMessage(id, raw.toString()));
        socket.on('close', () => {
          this.clients.delete(id);
          this.emitStatus();
        });
        socket.on('error', () => {
          this.clients.delete(id);
          this.emitStatus();
        });
      });
    });
  }

  stop(): OrchestratorStatus {
    for (const c of this.clients.values()) c.socket.close(1001, 'CΛNTO ferme la passerelle');
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this.emitStatus();
    return this.status();
  }

  respond(id: string, clientId: string, result: unknown, error?: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.inflight = Math.max(0, client.inflight - 1);
    const rpcId = this.parseId(id);
    safeSend(client.socket, error ? { jsonrpc: '2.0', id: rpcId, error: { code: -32000, message: error, data: result } } : { jsonrpc: '2.0', id: rpcId, result });
  }

  broadcast(event: string, payload: unknown): void {
    const msg = { jsonrpc: '2.0', method: 'desk.event', params: { event, payload, at: Date.now() } };
    for (const c of this.clients.values()) if (c.authenticated) safeSend(c.socket, msg);
  }

  private reply(client: Client, id: string | number | null, error: { code: number; message: string }): void {
    safeSend(client.socket, { jsonrpc: '2.0', id, error });
  }

  private onMessage(clientId: string, raw: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const now = Date.now();
    if (now - client.window.start > RATE_WINDOW_MS) client.window = { start: now, count: 0 };
    if (++client.window.count > RATE_MAX) {
      this.reply(client, null, { code: -32005, message: 'Débit trop élevé' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.reply(client, null, { code: -32700, message: 'JSON invalide' });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.reply(client, null, { code: -32600, message: 'Requête invalide : objet attendu' });
      return;
    }
    const msg = parsed as { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
    const rpcId = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    if (!msg.method || typeof msg.method !== 'string' || msg.method.length > 64) {
      this.reply(client, rpcId, { code: -32600, message: 'Requête invalide : method manquant' });
      return;
    }

    if (msg.method === 'desk.auth') {
      const token = msg.params && typeof msg.params === 'object' ? (msg.params as { token?: unknown }).token : undefined;
      client.authenticated = typeof token === 'string' && tokensMatch(token, this.token);
      safeSend(client.socket, client.authenticated ? { jsonrpc: '2.0', id: rpcId, result: { authenticated: true } } : { jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: 'Jeton invalide' } });
      if (!client.authenticated) client.socket.close(1008, 'Jeton invalide');
      return;
    }
    if (!client.authenticated) {
      this.reply(client, rpcId, { code: -32001, message: 'Authentification requise : desk.auth { token } ou ?token=' });
      return;
    }
    if (!orchMethodAllowed(msg.method, this.allowWrites)) {
      this.reply(client, rpcId, { code: -32601, message: 'Méthode introuvable' });
      return;
    }
    if (!this.win || this.win.isDestroyed()) {
      this.reply(client, rpcId, { code: -32002, message: 'Desk indisponible' });
      return;
    }
    if (client.inflight >= MAX_INFLIGHT) {
      this.reply(client, rpcId, { code: -32005, message: 'Trop de requêtes en attente' });
      return;
    }
    client.inflight++;
    const id = msg.id === undefined ? `n${++this.seq}` : `${typeof msg.id}:${msg.id}`;
    this.win.webContents.send('orch:request', { id, clientId, method: msg.method, params: msg.params ?? {} });
  }

  private parseId(id: string): string | number | null {
    if (id.startsWith('number:')) return Number(id.slice(7));
    if (id.startsWith('string:')) return id.slice(7);
    return null;
  }

  private emitStatus(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('orch:status', this.status());
  }
}
