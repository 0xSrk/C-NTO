import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { DESK_TOOL_KINDS, isDeskEventKind, orchMethodAllowed } from './agent/catalog';
import { uiText, type AppLocale } from './locale';
import { tokensMatch } from './secure-token';

export { orchMethodAllowed };

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
  authTimer?: ReturnType<typeof setTimeout>;
}

const MAX_PAYLOAD = 1024 * 1024;
const MAX_CLIENTS = 8;
const AUTH_GRACE_MS = 5000;
const MAX_INFLIGHT = 8;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 40;
const OPEN = 1;

/** Taille maximale d'une trame `desk.event`. */
export const BROADCAST_MAX_BYTES = 16_384;

/**
 * Préfixe de l'identifiant interne d'un `desk.describe` : sa réponse passe par le filtre crypto du process principal.
 * Un appel d'outil ne le porte jamais (`number:…`, `string:…` ou `n<seq>`), même s'il reprend l'`id` JSON-RPC de la description.
 */
const DESCRIBE_ID = 'd/';

/**
 * Borne de l'identifiant interne qu'`orch:respond` accepte du renderer (`electron/main.ts`) : les 64 signes d'avant, plus le
 * préfixe d'une description. Un `desk.describe` sert ainsi les mêmes identifiants JSON-RPC qu'un appel d'outil.
 */
export const ORCH_RESPONSE_ID_MAX = 64 + DESCRIBE_ID.length;

/** Un outil du module crypto (onglet 09 · CRY) : un nom `crypto_*` du catalogue. */
function isCryptoTool(name: string): boolean {
  return name.startsWith('crypto_') && Object.hasOwn(DESK_TOOL_KINDS, name);
}

/** La description du desk sans aucun outil `crypto_*` : le module est éteint, quoi qu'en dise le renderer. */
function withoutCryptoTools(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return result;
  const kept = tools.filter((t) => !(typeof t === 'object' && t !== null && typeof (t as { name?: unknown }).name === 'string' && (t as { name: string }).name.startsWith('crypto_')));
  return { ...result, tools: kept };
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
  /** Réservations entre verifyClient et l'ajout dans `clients` — ferme la course TOCTOU. */
  private pending = 0;

  /**
   * `locale` : langue du desk (`userData/locale.json`), relue à chaque message ; français par défaut.
   * `cryptoEnabled` : interrupteur du module crypto tenu par le process principal, relu à chaque requête et à chaque
   * description ; éteint par défaut. Éteint, les outils `crypto_*` sont refusés ici et retirés de `desk.describe`.
   */
  constructor(
    private readonly locale: () => AppLocale = () => 'fr',
    private readonly cryptoEnabled: () => boolean = () => false,
  ) {}

  /** Refus et motifs de fermeture dans la langue du desk. */
  private say(fr: string, en: string, es: string): string {
    return uiText(this.locale(), fr, en, es);
  }

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
    for (const c of this.clients.values()) c.socket.close(1008, this.say('Jeton renouvelé', 'Token renewed', 'Token renovado'));
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
          if (this.clients.size + this.pending >= MAX_CLIENTS) return false;
          this.pending++;
          // Si la poignée de main échoue après la réservation, le slot est rendu à la fermeture du socket.
          const reserved = req as IncomingMessage & { cantoReserved?: boolean };
          reserved.cantoReserved = true;
          req.socket.once('close', () => {
            if (reserved.cantoReserved) {
              reserved.cantoReserved = false;
              this.pending = Math.max(0, this.pending - 1);
            }
          });
          return true;
        },
      });
      server.on('listening', () => {
        this.server = server;
        const addr = server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : port;
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
        const reserved = req as IncomingMessage & { cantoReserved?: boolean };
        const release = () => {
          if (reserved.cantoReserved) {
            reserved.cantoReserved = false;
            this.pending = Math.max(0, this.pending - 1);
          }
        };
        const url = new URL(req.url ?? '/', 'ws://127.0.0.1');
        const q = url.searchParams.get('token');
        // Jeton présent mais faux : fermeture immédiate, le slot n'est pas occupé.
        if (q !== null && !tokensMatch(q, this.token)) {
          release();
          socket.close(1008, this.say('Jeton invalide', 'Invalid token', 'Token inválido'));
          return;
        }
        const id = `c${++this.seq}`;
        const authenticated = q !== null && tokensMatch(q, this.token);
        const client: Client = { id, socket, authenticated, window: { start: Date.now(), count: 0 }, inflight: 0 };
        if (!authenticated) {
          client.authTimer = setTimeout(() => {
            const current = this.clients.get(id);
            if (current && !current.authenticated) current.socket.close(1008, this.say('Authentification requise', 'Authentication required', 'Autenticación requerida'));
          }, AUTH_GRACE_MS);
        }
        this.clients.set(id, client);
        release();
        this.emitStatus();
        safeSend(socket, { jsonrpc: '2.0', method: 'desk.hello', params: { artefact: 'CΛNTO', version: app.getVersion(), clientId: id, authenticated } });
        socket.on('message', (raw) => this.onMessage(id, raw.toString()));
        const drop = () => {
          const current = this.clients.get(id);
          if (current?.authTimer) clearTimeout(current.authTimer);
          this.clients.delete(id);
          this.emitStatus();
        };
        socket.on('close', drop);
        socket.on('error', drop);
      });
    });
  }

  stop(): OrchestratorStatus {
    for (const c of this.clients.values()) c.socket.close(1001, this.say('CΛNTO ferme la passerelle', 'CΛNTO is closing the gateway', 'CΛNTO cierra la pasarela'));
    this.clients.clear();
    this.pending = 0;
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
    // Double verrou : la liste d'outils servie suit l'interrupteur du process principal, pas la description du renderer.
    const served = id.startsWith(DESCRIBE_ID) && this.cryptoEnabled() !== true ? withoutCryptoTools(result) : result;
    safeSend(client.socket, error ? { jsonrpc: '2.0', id: rpcId, error: { code: -32000, message: error, data: served } } : { jsonrpc: '2.0', id: rpcId, result: served });
  }

  /** Pousse un événement du desk aux clients authentifiés. Types du catalogue seulement, 16 Ko au plus. */
  broadcast(event: string, payload: unknown): boolean {
    if (!isDeskEventKind(event)) return false;
    let frame: string;
    try {
      frame = JSON.stringify({ jsonrpc: '2.0', method: 'desk.event', params: { event, payload, at: Date.now() } });
    } catch {
      return false;
    }
    if (Buffer.byteLength(frame) > BROADCAST_MAX_BYTES) return false;
    for (const c of this.clients.values()) {
      if (!c.authenticated || c.socket.readyState !== OPEN) continue;
      try {
        c.socket.send(frame);
      } catch {
        /* socket fermée entre-temps */
      }
    }
    return true;
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
      this.reply(client, null, { code: -32005, message: this.say('Débit trop élevé', 'Rate too high', 'Demasiadas solicitudes') });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.reply(client, null, { code: -32700, message: this.say('JSON invalide', 'Invalid JSON', 'JSON no válido') });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.reply(client, null, { code: -32600, message: this.say('Requête invalide : objet attendu', 'Invalid request: object expected', 'Solicitud no válida: se espera un objeto') });
      return;
    }
    const msg = parsed as { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
    const rpcId = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    if (!msg.method || typeof msg.method !== 'string' || msg.method.length > 64) {
      this.reply(client, rpcId, { code: -32600, message: this.say('Requête invalide : method manquant', 'Invalid request: method is missing', 'Solicitud no válida: falta method') });
      return;
    }

    if (msg.method === 'desk.auth') {
      const token = msg.params && typeof msg.params === 'object' ? (msg.params as { token?: unknown }).token : undefined;
      if (client.authTimer) {
        clearTimeout(client.authTimer);
        client.authTimer = undefined;
      }
      client.authenticated = typeof token === 'string' && tokensMatch(token, this.token);
      const refused = this.say('Jeton invalide', 'Invalid token', 'Token inválido');
      safeSend(client.socket, client.authenticated ? { jsonrpc: '2.0', id: rpcId, result: { authenticated: true } } : { jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: refused } });
      if (!client.authenticated) client.socket.close(1008, refused);
      return;
    }
    if (!client.authenticated) {
      this.reply(client, rpcId, { code: -32001, message: this.say('Authentification requise : desk.auth { token } ou ?token=', 'Authentication required: desk.auth { token } or ?token=', 'Autenticación requerida: desk.auth { token } o ?token=') });
      return;
    }
    if (!orchMethodAllowed(msg.method, this.allowWrites)) {
      this.reply(client, rpcId, { code: -32601, message: this.say('Méthode introuvable', 'Method not found', 'Método no encontrado') });
      return;
    }
    // Module crypto éteint : refusé ici, sans relayer, lecture comme écriture (le double verrou de la passerelle MCP).
    if (isCryptoTool(msg.method.replace(/^tool\./, '')) && this.cryptoEnabled() !== true) {
      safeSend(client.socket, {
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: this.say(
            'Module crypto éteint dans CΛNTO : le trader l’allume dans l’onglet 09 · CRY.',
            'Crypto module off in CΛNTO: the trader turns it on in tab 09 · CRY.',
            'Módulo cripto apagado en CΛNTO: el trader lo enciende en la pestaña 09 · CRY.',
          ),
          data: { ok: false, reason: 'crypto_disabled' },
        },
      });
      return;
    }
    if (!this.win || this.win.isDestroyed()) {
      this.reply(client, rpcId, { code: -32002, message: this.say('Desk indisponible', 'Desk unavailable', 'Desk no disponible') });
      return;
    }
    if (client.inflight >= MAX_INFLIGHT) {
      this.reply(client, rpcId, { code: -32005, message: this.say('Trop de requêtes en attente', 'Too many pending requests', 'Demasiadas solicitudes pendientes') });
      return;
    }
    client.inflight++;
    const base = msg.id === undefined ? `n${++this.seq}` : `${typeof msg.id}:${msg.id}`;
    const id = msg.method === 'desk.describe' ? `${DESCRIBE_ID}${base}` : base;
    this.win.webContents.send('orch:request', { id, clientId, method: msg.method, params: msg.params ?? {} });
  }

  private parseId(raw: string): string | number | null {
    const id = raw.startsWith(DESCRIBE_ID) ? raw.slice(DESCRIBE_ID.length) : raw;
    if (id.startsWith('number:')) return Number(id.slice(7));
    if (id.startsWith('string:')) return id.slice(7);
    return null;
  }

  private emitStatus(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('orch:status', this.status());
  }
}
