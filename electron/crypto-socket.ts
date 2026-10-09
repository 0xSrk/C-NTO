import type { CryptoVenue, VenueState } from './crypto/markets';
import { VenueHttpError, type VenueGate } from './crypto-net';

/**
 * Une WebSocket d'exchange tenue en vie, côté process principal (`docs/ONGLET-CRYPTO.md` § 5, « Voyants »).
 * La vie d'une connexion se juge à son activité, jamais à l'arrivée de trades : toute trame ou tout pong compte. Un
 * ping de protocole part toutes les 15 s, plus un ping applicatif quand la venue en demande un (Bybit, toutes les 20 s).
 * 30 s sans activité : `stale`, puis fermeture et reconnexion, après 1 s, 2 s, 4 s… plafonné à 60 s, remis à 1 s à
 * chaque ouverture réussie. La porte de la venue (`VenueGate`) décide avant chaque tentative : bloquée (418) ou hôte
 * refusé, la socket passe `blocked` et ne se reconnecte plus ; en pause (429), elle attend.
 * Aucun import d'Electron ni de `ws` : la fabrique de sockets, les minuteurs, l'horloge et la porte sont injectés
 * (CRY2.5 lie le client `ws`), ce qui garde le module testable avec une fausse socket et de faux minuteurs.
 * Tout ce qui vient du réseau est tenu pour suspect : un texte journalisé est borné, et une URL n'y laisse que son hôte.
 */

/** Ce que le module attend d'une WebSocket : le sous-ensemble du client `ws` qu'il utilise. */
export interface WsLike {
  send(data: string): void;
  ping(): void;
  close(): void;
  on(event: 'open' | 'close' | 'pong', cb: () => void): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
  on(event: 'unexpected-response', cb: (req: unknown, res: { statusCode?: number }) => void): void;
}

export type WsFactory = (url: string) => WsLike;

export interface Timers {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

/** Ping de protocole, toutes les 15 s. */
export const PING_EVERY_MS = 15_000;
/** Sans trame ni pong pendant 30 s, la connexion est périmée. */
export const STALE_AFTER_MS = 30_000;
/** Ping applicatif (`appPing`), toutes les 20 s : la cadence que Bybit demande. */
export const BYBIT_PING_EVERY_MS = 20_000;
/** Plafond de l'attente entre deux tentatives. */
export const RECONNECT_MAX_MS = 60_000;

const RECONNECT_START_MS = 1_000;
/** Une trame plus lourde n'est pas lue : les messages de ces flux pèsent quelques Kio. */
const FRAME_MAX = 1024 * 1024;
/** Borne d'un texte venu du réseau (message d'erreur, refus de la venue). */
const TEXT_MAX = 200;
/** Borne d'une ligne de journal. */
const LINE_MAX = 400;

export interface ManagedSocketOptions {
  url: string;
  venue: CryptoVenue;
  ws: WsFactory;
  hostOk: (url: string) => boolean;
  timers: Timers;
  now: () => number;
  gate: VenueGate;
  /** Chaque trame, en texte. */
  onMessage: (raw: string) => void;
  /** Chaque changement d'état. */
  onState: (s: VenueState) => void;
  /** Chaque ouverture réussie, la première comme les suivantes : l'appelant y (ré)abonne ses flux. */
  onOpen: () => void;
  /** Le ping applicatif de la venue (Bybit : `{"op":"ping"}`) ; `null` : rien à envoyer. */
  appPing?: () => string | null;
  log: (l: string) => void;
}

/** Ce que `clearTimeout` et `clearInterval` acceptent, quel que soit le jeu de types (Node, DOM) qui les déclare. */
type TimerHandle = Parameters<Timers['clearTimeout']>[0];

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** Le texte sur une ligne : chaque caractère de contrôle ou séparateur de ligne devient une espace, pour qu'une ligne de journal n'en fabrique pas une autre. */
function flatten(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  }
  return out;
}

/** Le texte borné à `max` unités, sans laisser en bout la moitié haute d'une paire de substitution. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** Un texte venu du réseau, prêt pour un journal ou un détail : une URL réduite à son hôte, sur une ligne, borné. */
export function safeText(text: string, max = TEXT_MAX): string {
  const hosts = text.replace(URL_IN_TEXT, (url) => {
    try {
      return new URL(url).host || 'URL';
    } catch {
      return 'URL';
    }
  });
  return clip(flatten(hosts), max);
}

/** Le message d'une erreur, quel qu'en soit le royaume, passé par `safeText` ; jamais vide. */
export function errorText(error: unknown): string {
  const message = typeof error === 'string' ? error : (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.trim() !== '' ? safeText(message) : 'sans détail';
}

/** L'hôte (et le port) de l'URL, seul autorisé dans un journal. */
function hostOf(url: string): string {
  try {
    return clip(new URL(url).host, 100) || 'hôte inconnu';
  } catch {
    return 'URL illisible';
  }
}

const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';

/** Le poids d'une trame : octets, ou unités de texte pour une chaîne. */
function frameSize(data: unknown): number {
  if (typeof data === 'string') return data.length;
  if (ArrayBuffer.isView(data) || isArrayBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum: number, part: unknown) => sum + (ArrayBuffer.isView(part) ? part.byteLength : 0), 0);
  return 0;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Le texte d'une trame (`string`, octets de toute vue, `ArrayBuffer`, fragments) ; `null` : autre chose, ou pas de l'UTF-8. */
function frameText(data: unknown): string | null {
  try {
    if (typeof data === 'string') return data;
    if (ArrayBuffer.isView(data)) return UTF8.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (isArrayBuffer(data)) return UTF8.decode(new Uint8Array(data));
    if (Array.isArray(data) && data.every((part): part is ArrayBufferView => ArrayBuffer.isView(part))) {
      const bytes = new Uint8Array(frameSize(data));
      let offset = 0;
      for (const part of data) {
        bytes.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
        offset += part.byteLength;
      }
      return UTF8.decode(bytes);
    }
  } catch {
    // UTF-8 invalide : la trame est écartée.
  }
  return null;
}

function closeReason(code: unknown): string {
  return typeof code === 'number' && Number.isInteger(code) ? `fermée par la venue (code ${code})` : 'fermée par la venue';
}

/**
 * Une WebSocket d'exchange tenue en vie : `open()` la lance, `close()` l'arrête pour de bon. `send` n'envoie que sur
 * une connexion ouverte (`live`) : l'appelant (ré)abonne ses flux dans `onOpen`, à chaque ouverture.
 * Les événements d'une socket remplacée (périmée, fermée, abandonnée) sont ignorés : seule la socket courante parle.
 * États : `off` avant `open()` et après `close()` ; `connecting` à la première tentative ; `live` ouverte ; `stale` à
 * 30 s sans activité, aussitôt suivi de `reconnecting` jusqu'à la prochaine ouverture ; `blocked` sans reconnexion
 * (hôte refusé, 418, porte bloquée). Une tentative qui ne s'ouvre pas en 30 s est abandonnée comme une socket périmée.
 */
export class ManagedSocket {
  private socket: WsLike | null = null;
  private current: VenueState = 'off';
  private running = false;
  private delayMs = RECONNECT_START_MS;
  private retryTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private appPingTimer: TimerHandle | null = null;
  private watchdog: TimerHandle | null = null;
  private lastActivity = 0;
  private oversizeLogged = false;
  private readonly where: string;

  constructor(private readonly opts: ManagedSocketOptions) {
    this.where = hostOf(opts.url);
  }

  get state(): VenueState {
    return this.current;
  }

  open(): void {
    if (this.running) return;
    this.running = true;
    this.delayMs = RECONNECT_START_MS;
    this.connect();
  }

  send(data: string): void {
    const socket = this.socket;
    if (socket === null || this.current !== 'live') return;
    try {
      socket.send(data);
    } catch (error) {
      this.lost(`envoi impossible : ${errorText(error)}`);
    }
  }

  close(): void {
    this.running = false;
    this.stopTimers();
    this.cancelRetry();
    this.release();
    this.setState('off');
  }

  private connect(): void {
    this.retryTimer = null;
    if (!this.running) return;
    const { venue, gate, url } = this.opts;
    if (gate.blocked(venue)) {
      this.block('venue coupée par sa porte (418) jusqu’au redémarrage');
      return;
    }
    if (!this.hostAllowed()) {
      this.block(`hôte refusé (${this.where})`);
      return;
    }
    if (!gate.allowed(venue)) {
      if (this.current === 'off') this.setState('connecting');
      this.log(`venue en pause (429) ; nouvel essai dans ${this.delayMs / 1000} s`);
      this.retry();
      return;
    }
    let socket: WsLike;
    try {
      socket = this.opts.ws(url);
    } catch (error) {
      this.lost(`ouverture impossible : ${errorText(error)}`);
      return;
    }
    this.socket = socket;
    // Les écouteurs d'abord : `ws` émet `error` sur une socket fermée en pleine poignée de main, et un `error` sans
    // écouteur lève dans le process principal. Ceux d'une socket remplacée ne font plus rien.
    socket.on('open', () => this.opened(socket));
    socket.on('message', (data) => this.frame(socket, data));
    socket.on('pong', () => {
      if (socket === this.socket) this.touch();
    });
    socket.on('close', (...args: unknown[]) => {
      if (socket === this.socket) this.lost(closeReason(args[0]));
    });
    socket.on('error', (error) => {
      if (socket === this.socket) this.lost(`erreur : ${errorText(error)}`);
    });
    socket.on('unexpected-response', (_req: unknown, res: { statusCode?: number } | undefined) => {
      if (socket === this.socket) this.refused(res?.statusCode);
    });
    this.touch();
    this.armWatchdog(STALE_AFTER_MS);
    if (this.current !== 'reconnecting') this.setState('connecting');
  }

  private opened(socket: WsLike): void {
    if (socket !== this.socket || this.current === 'live') return;
    this.delayMs = RECONNECT_START_MS;
    this.touch();
    this.pingTimer = this.opts.timers.setInterval(() => this.ping(), PING_EVERY_MS);
    if (this.opts.appPing) this.appPingTimer = this.opts.timers.setInterval(() => this.sendAppPing(), BYBIT_PING_EVERY_MS);
    this.setState('live');
    if (socket !== this.socket) return;
    this.guard(() => this.opts.onOpen());
  }

  private frame(socket: WsLike, data: unknown): void {
    if (socket !== this.socket) return;
    this.touch();
    const size = frameSize(data);
    if (size > FRAME_MAX) {
      if (!this.oversizeLogged) this.log(`trame de ${size} octets écartée (plus de 1 Mio)`);
      this.oversizeLogged = true;
      return;
    }
    const raw = frameText(data);
    if (raw !== null) this.guard(() => this.opts.onMessage(raw));
  }

  /** Réponse HTTP au lieu du passage en WebSocket : 418 et 429 vont à la porte ; 418 bloque, le reste relance. */
  private refused(statusCode: unknown): void {
    const status = typeof statusCode === 'number' && Number.isInteger(statusCode) ? statusCode : null;
    if (status === 418 || status === 429) {
      this.guard(() => this.opts.gate.onHttpError(this.opts.venue, new VenueHttpError(status, `HTTP ${status} (${this.where})`)));
    }
    if (status === 418) {
      this.block(`HTTP 418 (${this.where}) : venue coupée jusqu’au redémarrage`);
      return;
    }
    this.lost(status === null ? 'réponse inattendue' : `HTTP ${status} (${this.where})`);
  }

  /** Fermeture non demandée : la socket est abandonnée, une nouvelle tentative suit après le délai courant. */
  private lost(reason: string): void {
    if (!this.running) return;
    this.stopTimers();
    this.release();
    this.log(`connexion perdue (${reason}) ; nouvel essai dans ${this.delayMs / 1000} s`);
    this.setState('reconnecting');
    this.retry();
  }

  private block(reason: string): void {
    this.running = false;
    this.stopTimers();
    this.cancelRetry();
    this.release();
    this.log(reason);
    this.setState('blocked');
  }

  private retry(): void {
    if (!this.running || this.retryTimer !== null) return;
    const wait = this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, RECONNECT_MAX_MS);
    this.retryTimer = this.opts.timers.setTimeout(() => this.connect(), wait);
  }

  private armWatchdog(ms: number): void {
    this.watchdog = this.opts.timers.setTimeout(() => this.checkActivity(), ms);
  }

  /** Échéance de la veille : relancée pour le temps qui reste depuis la dernière activité, sinon la socket est abandonnée. */
  private checkActivity(): void {
    this.watchdog = null;
    if (this.socket === null) return;
    const now = this.opts.now();
    let idle = now - this.lastActivity;
    if (!(idle >= 0)) {
      // Horloge revenue en arrière (ou illisible) : la veille repart de maintenant.
      this.lastActivity = now;
      idle = 0;
    }
    if (idle < STALE_AFTER_MS) {
      this.armWatchdog(STALE_AFTER_MS - idle);
      return;
    }
    const seconds = Math.round(idle / 1000);
    if (this.current === 'live') {
      this.setState('stale');
      this.lost(`aucune activité depuis ${seconds} s`);
    } else {
      this.lost(`pas d’ouverture en ${seconds} s`);
    }
  }

  private touch(): void {
    this.lastActivity = this.opts.now();
  }

  private ping(): void {
    const socket = this.socket;
    if (socket === null || this.current !== 'live') return;
    try {
      socket.ping();
    } catch (error) {
      this.lost(`ping impossible : ${errorText(error)}`);
    }
  }

  private sendAppPing(): void {
    let message: string | null = null;
    try {
      message = this.opts.appPing?.() ?? null;
    } catch {
      message = null;
    }
    if (typeof message === 'string' && message !== '') this.send(message);
  }

  /** Lâche la socket courante : ses événements ne comptent plus, et elle est fermée (une poignée de main est abandonnée). */
  private release(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    try {
      socket.close();
    } catch {
      // déjà fermée
    }
  }

  private stopTimers(): void {
    const { timers } = this.opts;
    if (this.pingTimer !== null) timers.clearInterval(this.pingTimer);
    if (this.appPingTimer !== null) timers.clearInterval(this.appPingTimer);
    if (this.watchdog !== null) timers.clearTimeout(this.watchdog);
    this.pingTimer = null;
    this.appPingTimer = null;
    this.watchdog = null;
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.opts.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private hostAllowed(): boolean {
    try {
      return this.opts.hostOk(this.opts.url) === true;
    } catch {
      return false;
    }
  }

  private setState(next: VenueState): void {
    if (next === this.current) return;
    this.current = next;
    this.guard(() => this.opts.onState(next));
  }

  /** Un rappel de l'appelant qui lève ne casse pas la socket : il est journalisé. */
  private guard(call: () => void): void {
    try {
      call();
    } catch (error) {
      this.log(`rappel en échec : ${errorText(error)}`);
    }
  }

  private log(text: string): void {
    try {
      this.opts.log(clip(`crypto ${this.opts.venue}: ${text}`, LINE_MAX));
    } catch {
      // un journal en panne ne doit pas arrêter la socket
    }
  }
}
