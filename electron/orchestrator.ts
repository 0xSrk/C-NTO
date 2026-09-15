import type { BrowserWindow } from 'electron';
import { WebSocket, WebSocketServer } from 'ws';

export interface OrchestratorStatus {
  running: boolean;
  port: number;
  clients: number;
  error?: string;
}

interface Client {
  id: string;
  socket: WebSocket;
}

/**
 * Passerelle JSON-RPC 2.0 sur WebSocket (127.0.0.1 uniquement).
 * Un orchestrateur IA externe s'y connecte pour interroger et piloter le desk ;
 * chaque requête est transmise au renderer qui exécute l'outil natif correspondant.
 */
export class Orchestrator {
  private server: WebSocketServer | null = null;
  private clients = new Map<string, Client>();
  private win: BrowserWindow | null = null;
  private port = 0;
  private error: string | undefined;
  private seq = 0;

  attach(win: BrowserWindow): void {
    this.win = win;
  }

  status(): OrchestratorStatus {
    return { running: !!this.server, port: this.port, clients: this.clients.size, error: this.error };
  }

  start(port: number): Promise<OrchestratorStatus> {
    if (this.server) return Promise.resolve(this.status());
    this.error = undefined;
    return new Promise((resolve) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port });
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
      server.on('connection', (socket) => {
        const id = `c${++this.seq}`;
        this.clients.set(id, { id, socket });
        this.emitStatus();
        socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'desk.hello', params: { artefact: 'CΛNTO', version: '0.1.0', clientId: id } }));
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
    for (const c of this.clients.values()) if (c.socket.readyState === WebSocket.OPEN) c.socket.send(msg);
  }

  private onMessage(clientId: string, raw: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      client.socket.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }));
      return;
    }
    if (!msg.method || typeof msg.method !== 'string') {
      client.socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Requête invalide : method manquant' } }));
      return;
    }
    if (!this.win || this.win.isDestroyed()) {
      client.socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Desk indisponible' } }));
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
