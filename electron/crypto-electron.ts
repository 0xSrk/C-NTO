import { net, type BrowserWindow } from 'electron';
import { WebSocket } from 'ws';
import { cryptoHostAllowed, type CryptoBar, type CryptoFeedEvent, type CryptoVenue, type VenueState } from './crypto/markets';
import type { TemperatureReading } from './crypto/temperature';
import { CryptoFeedHost } from './crypto-feeds';
import { isSubscriptionId, parseHistoryRequest, parseSubscribeRequest } from './crypto-ipc';
import { cryptoFetchJson, VenueGate, type FetchLike, type VenueHttpError } from './crypto-net';
import { errorText, FRAME_MAX, type Timers, type WsFactory, type WsLike } from './crypto-socket';
import { CryptoSwitchHost, type CryptoSwitchDeps } from './crypto-switch';
import { TemperatureHost } from './crypto-temperature';
import type { AppLocale } from './locale';

/**
 * Le module crypto (onglet 09 · CRY) branché au process principal : le seul fichier crypto qui importe `electron` et `ws`.
 * Il lie le `net.fetch` d'Electron et le client `ws` réel (remplaçables dans les tests), crée l'interrupteur, une seule porte
 * de venue (`VenueGate`, partagée par les flux et la température : un 418 dure jusqu'au redémarrage du desk, extinction et
 * rallumage compris), les flux (`CryptoFeedHost`) et la température (`TemperatureHost`), et sert les sept appels IPC de
 * `main.ts` après validation de forme (`crypto-ipc.ts`). Interrupteur éteint : rien ne part, tout est refusé sans appel.
 * Vers le renderer, trois canaux : `crypto:event` (au plus un envoi toutes les 250 ms par série et timeframe, ou par
 * marché), `crypto:temperature` et `crypto:status` (à chaque changement de l'interrupteur ou d'une venue).
 */

/** Les trois canaux que le runtime pousse au renderer. */
export type CryptoChannel = 'crypto:event' | 'crypto:temperature' | 'crypto:status';

/** L'interrupteur et l'état des trois venues, tels que le renderer les lit. */
export interface CryptoMainStatus {
  enabled: boolean;
  venues: Record<CryptoVenue, VenueState>;
}

type HistoryResult = { ok: true; bars: CryptoBar[] } | { ok: false; detail: string };
type SubscribeResult = { ok: true; subscriptionId: string } | { ok: false; detail: string };

export interface CryptoRuntime {
  enabled(): boolean;
  status(): CryptoMainStatus;
  /** Dialogue du process principal (Annuler par défaut) ; rend l'état obtenu. */
  enable(): Promise<CryptoMainStatus>;
  /** Sans dialogue : flux et relevés fermés, interrupteur éteint. */
  disable(): CryptoMainStatus;
  history(raw: unknown): Promise<HistoryResult>;
  subscribe(raw: unknown): SubscribeResult;
  unsubscribe(raw: unknown): { ok: boolean };
  temperature(): TemperatureReading | null;
  /** Fenêtre fermée : ferme tout sans changer l'interrupteur. */
  shutdown(): void;
}

export interface CryptoRuntimeDeps {
  userDataDir: string;
  locale: () => AppLocale;
  window: () => BrowserWindow | null;
  showMessageBox: CryptoSwitchDeps['showMessageBox'];
  send: (channel: CryptoChannel, payload: unknown) => void;
  log: (l: string) => void;
  /** La fabrique de sockets ; le client `ws` réel (`cryptoWebSocket`) par défaut. */
  ws?: WsFactory;
  /** Le fetch des exchanges ; `net.fetch` d'Electron par défaut. */
  fetchImpl?: FetchLike;
}

const CRYPTO_UA = 'CANTO-Desk (crypto)';
/** Au plus un envoi `crypto:event` par file dans cet intervalle. */
const EVENT_EVERY_MS = 250;

/**
 * Le client `ws` réel, fabrique par défaut : aucune redirection suivie (un 3xx reste une `unexpected-response`, que
 * `ManagedSocket` traite), trames bornées à `FRAME_MAX` (1 Mio, le plafond de `crypto-socket.ts` : `ws` coupe en 1009 une
 * trame plus lourde avant de la garder en mémoire), aucune compression, l'en-tête du desk. Il expose `terminate()`, qui
 * coupe net une socket jugée morte.
 */
export function cryptoWebSocket(url: string): WsLike {
  return new WebSocket(url, {
    headers: { 'User-Agent': CRYPTO_UA },
    followRedirects: false,
    maxPayload: FRAME_MAX,
    perMessageDeflate: false,
  });
}

/**
 * La porte de `crypto-net.ts`, qui prévient en plus quand une venue passe bloquée (418) : `crypto:status` suit aussitôt,
 * même quand le 418 vient d'un relevé de température, dont la socket ne remonte pas d'état.
 */
class WatchedGate extends VenueGate {
  constructor(
    now: () => number,
    private readonly onBlocked: () => void,
  ) {
    super(now);
  }

  override onHttpError(venue: CryptoVenue, err: VenueHttpError): void {
    const before = this.blocked(venue);
    super.onHttpError(venue, err);
    if (!before && this.blocked(venue)) this.onBlocked();
  }
}

/** Ce que `clearTimeout` accepte, quel que soit le jeu de types (Node, DOM) qui le déclare. */
type TimerHandle = Parameters<Timers['clearTimeout']>[0];

/** Une file ouverte : l'échéance de son intervalle, et le dernier événement qui l'attend. */
interface Lane {
  timer: TimerHandle;
  pending: CryptoFeedEvent | null;
}

/**
 * La cadence de `crypto:event`, une file par série et timeframe (bougies) ou par marché (tickers) : au plus un envoi toutes
 * les 250 ms. Le premier événement d'une file au repos part tout de suite et ouvre un intervalle ; pendant l'intervalle,
 * chaque événement remplace celui qui attend (le dernier gagne), et l'échéance envoie celui qui reste, en rouvrant un
 * intervalle, ou referme la file. Une bougie close (`final: true`) part toujours, tout de suite : elle remplace la version
 * partielle de la même bougie (ou d'une plus ancienne) qui attendait, et aucune bougie ne l'écrase.
 */
class EventCadence {
  private readonly lanes = new Map<string, Lane>();

  constructor(
    private readonly timers: Timers,
    private readonly deliver: (event: CryptoFeedEvent) => void,
  ) {}

  push(event: CryptoFeedEvent): void {
    const key = event.kind === 'ticker' ? `ticker ${event.ticker.market}` : `bar ${event.series} ${event.timeframe}`;
    const lane = this.lanes.get(key);
    if (event.kind === 'bar' && event.final) {
      if (lane?.pending?.kind === 'bar' && lane.pending.bar.time <= event.bar.time) lane.pending = null;
      this.deliver(event);
      return;
    }
    if (lane !== undefined) {
      lane.pending = event;
      return;
    }
    this.lanes.set(key, { timer: this.arm(key), pending: null });
    this.deliver(event);
  }

  /** Toutes les files fermées, aucun minuteur vivant : rien de ce qui attendait ne part. */
  clear(): void {
    for (const lane of this.lanes.values()) this.timers.clearTimeout(lane.timer);
    this.lanes.clear();
  }

  private arm(key: string): TimerHandle {
    return this.timers.setTimeout(() => this.due(key), EVENT_EVERY_MS);
  }

  private due(key: string): void {
    const lane = this.lanes.get(key);
    if (lane === undefined) return;
    const pending = lane.pending;
    if (pending === null) {
      this.lanes.delete(key);
      return;
    }
    lane.pending = null;
    lane.timer = this.arm(key);
    this.deliver(pending);
  }
}

/**
 * Le runtime du module crypto. À la création, l'interrupteur est relu sur le disque : déjà allumé, les relevés de
 * température partent aussitôt, sans dialogue, et un premier `crypto:status` est envoyé (`onChange` de l'interrupteur ne
 * rejoue pas l'état lu au démarrage). Ensuite :
 * - `enable()` ouvre le dialogue de l'interrupteur ; allumé, la température démarre et `crypto:status` part ;
 * - `disable()` éteint l'interrupteur puis, directement et quoi qu'il arrive, ferme flux, relevés et envois en attente ;
 * - `shutdown()` (dernière fenêtre fermée) ferme la même chose sans toucher l'interrupteur ; tant qu'il reste allumé, le
 *   prochain `temperature()` ou `subscribe()` relance la température (macOS garde le process et recrée la fenêtre) ;
 * - `history`, `subscribe`, `unsubscribe` et `temperature` sont refusés sans aucun appel tant que l'interrupteur est éteint
 *   (`crypto_disabled`, `{ ok: false }`, `null`), puis sans effet si la forme est mauvaise (`invalid_request`).
 * Une venue est `blocked` dès que la porte la bloque (418), sinon dans l'état de sa socket de flux. Le journal fourni est
 * enveloppé : un journal qui lève n'arrête ni l'extinction ni les flux. Les lignes de la température, socket des
 * liquidations comprise, portent le préfixe `température · `.
 */
export function createCryptoRuntime(deps: CryptoRuntimeDeps): CryptoRuntime {
  const log = (line: string): void => {
    try {
      deps.log(line);
    } catch {
      // un journal en panne n'arrête ni l'extinction ni les flux
    }
  };
  // Lus à la création : les minuteurs du process (les faux, dans un test qui les a installés avant).
  const timers: Timers = { setTimeout, clearTimeout, setInterval, clearInterval };
  const now = (): number => Date.now();
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => net.fetch(url, init));
  const ws: WsFactory = deps.ws ?? cryptoWebSocket;
  const hostOk = (url: string): boolean => cryptoHostAllowed(url, url.startsWith('wss:') ? 'wss:' : 'https:');
  const fetchJson = (url: string): Promise<unknown> => cryptoFetchJson(url, { fetchImpl, hostOk });

  let sendFailing = false;
  const transmit = (channel: CryptoChannel, payload: unknown): void => {
    try {
      deps.send(channel, payload);
      sendFailing = false;
    } catch (error) {
      // Journalisé une fois par panne : une fenêtre partie ne doit pas noyer le journal.
      if (!sendFailing) log(`crypto : ${channel} non transmis · ${errorText(error)}`);
      sendFailing = true;
    }
  };

  let lastStatus: string | null = null;
  const switchHost = new CryptoSwitchHost({ userDataDir: deps.userDataDir, locale: deps.locale, window: deps.window, showMessageBox: deps.showMessageBox, log });
  // Une seule porte, avec le runtime : jamais recréée, un 418 survit à l'extinction. Horloge monotone : un saut de
  // l'horloge du poste ne raccourcit ni n'allonge une pause.
  const gate = new WatchedGate(
    () => performance.now(),
    () => publishStatus(),
  );
  const cadence = new EventCadence(timers, (event) => {
    if (switchHost.enabled) transmit('crypto:event', event);
  });
  const feeds = new CryptoFeedHost({ ws, hostOk, timers, now, gate, fetchJson, emit: (event) => cadence.push(event), status: () => publishStatus(), log });
  const thermometer = new TemperatureHost({
    fetchJson,
    ws,
    hostOk,
    timers,
    now,
    gate,
    emit: (reading) => {
      if (switchHost.enabled) transmit('crypto:temperature', reading);
    },
    log: (line) => log(`température · ${line}`),
  });

  function status(): CryptoMainStatus {
    const states = feeds.states();
    const venue = (v: CryptoVenue): VenueState => (gate.blocked(v) ? 'blocked' : states[v]);
    return { enabled: switchHost.enabled, venues: { coinbase: venue('coinbase'), binance: venue('binance'), bybit: venue('bybit') } };
  }

  /** Envoie l'état s'il a changé depuis le dernier envoi. */
  function publishStatus(): void {
    const current = status();
    const key = JSON.stringify(current);
    if (key === lastStatus) return;
    lastStatus = key;
    transmit('crypto:status', current);
  }

  function stopAll(): void {
    feeds.closeAll();
    thermometer.stop();
    cadence.clear();
  }

  if (switchHost.enabled) {
    thermometer.start();
    publishStatus();
  }

  return {
    enabled: () => switchHost.enabled,
    status,

    async enable() {
      await switchHost.requestEnable();
      if (switchHost.enabled) thermometer.start();
      publishStatus();
      return status();
    },

    disable() {
      try {
        switchHost.disable();
      } finally {
        // Hors de tout abonné de l'interrupteur, et même s'il a levé : rien ne reste ouvert.
        stopAll();
        publishStatus();
      }
      return status();
    },

    async history(raw) {
      if (!switchHost.enabled) return { ok: false, detail: 'crypto_disabled' };
      const req = parseHistoryRequest(raw);
      if (req === null) return { ok: false, detail: 'invalid_request' };
      return feeds.history(req);
    },

    subscribe(raw) {
      if (!switchHost.enabled) return { ok: false, detail: 'crypto_disabled' };
      const req = parseSubscribeRequest(raw);
      if (req === null) return { ok: false, detail: 'invalid_request' };
      thermometer.start(); // sans effet s'il tourne ; relancé après `shutdown()`
      return feeds.subscribe(req);
    },

    unsubscribe(raw) {
      if (!switchHost.enabled || !isSubscriptionId(raw)) return { ok: false };
      return { ok: feeds.unsubscribe(raw) };
    },

    temperature() {
      if (!switchHost.enabled) return null;
      thermometer.start(); // sans effet s'il tourne ; relancé après `shutdown()`
      return thermometer.current();
    },

    shutdown() {
      stopAll();
    },
  };
}
