import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export interface OrchestratorStatus {
  running: boolean;
  port: number;
  clients: number;
  /** Jeton d'accès de la session (à fournir en `?token=` ou via `desk.auth`) */
  token: string;
  error?: string;
}

interface Client {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  window: { start: number; count: number };
}

const MAX_PAYLOAD = 1024 * 1024;
const MAX_CLIENTS = 8;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 40;

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

  attach(win: BrowserWindow): void {
    this.win = win;
  }

  status(): OrchestratorStatus {
    return { running: !!this.server, port: this.port, clients: this.clients.size, token: this.token, error: this.error };
  }

  /** Régénère le jeton (déconnecte les clients en cours). */
  rotateToken(): OrchestratorStatus {
    this.token = randomBytes(18).toString('base64url');
    for (const c of this.clients.values()) c.socket.close(1008, 'Jeton renouvelé');
    this.clients.clear();
    this.emitStatus();
    return this.status();
  }

  start(port: number): Promise<OrchestratorStatus> {
    if (this.server) return Promise.resolve(this.status());
    this.error = undefined;
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
        const authenticated = url.searchParams.get('token') === this.token;
        this.clients.set(id, { id, socket, authenticated, window: { start: Date.now(), count: 0 } });
        this.emitStatus();
        socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'desk.hello', params: { artefact: 'CΛNTO', version: '0.1.0', clientId: id, authenticated } }));
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
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;
    const rpcId = this.parseId(id);
    const payload = error ? { jsonrpc: '2.0', id: rpcId, error: { code: -32000, message: error, data: result } } : { jsonrpc: '2.0', id: rpcId, result };
    client.socket.send(JSON.stringify(payload));
  }

  broadcast(event: string, payload: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method: 'desk.event', params: { event, payload, at: Date.now() } });
    for (const c of this.clients.values()) if (c.authenticated && c.socket.readyState === WebSocket.OPEN) c.socket.send(msg);
  }

  private reply(client: Client, id: string | number | null, error: { code: number; message: string }): void {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify({ jsonrpc: '2.0', id, error }));
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

    let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.reply(client, null, { code: -32700, message: 'JSON invalide' });
      return;
    }
    const rpcId = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    if (!msg.method || typeof msg.method !== 'string' || msg.method.length > 64) {
      this.reply(client, rpcId, { code: -32600, message: 'Requête invalide : method manquant' });
      return;
    }

    if (msg.method === 'desk.auth') {
      const token = msg.params && typeof msg.params === 'object' ? (msg.params as { token?: unknown }).token : undefined;
      client.authenticated = token === this.token;
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify(client.authenticated ? { jsonrpc: '2.0', id: rpcId, result: { authenticated: true } } : { jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: 'Jeton invalide' } }));
      }
      if (!client.authenticated) client.socket.close(1008, 'Jeton invalide');
      return;
    }
    if (!client.authenticated) {
      this.reply(client, rpcId, { code: -32001, message: 'Authentification requise : desk.auth { token } ou ?token=' });
      return;
    }
    if (!this.win || this.win.isDestroyed()) {
      this.reply(client, rpcId, { code: -32002, message: 'Desk indisponible' });
      return;
    }
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
