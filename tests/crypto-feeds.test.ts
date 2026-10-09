import { readFileSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cryptoHostAllowed,
  type CryptoBar,
  type CryptoFeedEvent,
  type CryptoSeriesId,
  type CryptoTimeframe,
  type CryptoVenue,
  type VenueState,
} from '@/engine/crypto/markets';
import { HISTORY_BARS, historyRequests, historyTarget } from '@/engine/crypto/venues';
import { VenueGate, VenueHttpError } from '../electron/crypto-net';
import {
  BYBIT_PING_EVERY_MS,
  CryptoFeedHost,
  ManagedSocket,
  PING_EVERY_MS,
  RECONNECT_MAX_MS,
  STALE_AFTER_MS,
  type Timers,
  type WsFactory,
  type WsLike,
} from '../electron/crypto-feeds';

const HOUR = 3600;
const ONE_DAY = 86400;
/** 9 octobre 2026, 00:00 UTC, en secondes. */
const DAY = 1791504000;
/** 00:00 UTC de la veille (8 octobre 2026) : le début de la fenêtre que l’historique doit couvrir le 9. */
const WINDOW_START = DAY - ONE_DAY;
/** Un instant du 9 octobre 2026 (UTC) en millisecondes : `at('10:00:20')`, `at('10:00:59.500')`. */
const at = (hms: string): number => Date.parse(`2026-10-09T${hms}Z`);
/** Le même instant en secondes, l’unité de `CryptoBar.time`. */
const sec = (hms: string): number => at(hms) / 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}

/** Un écouteur de la fausse socket : `any` pour couvrir chaque surcharge de `WsLike.on` (paramètres de rappel vérifiés strictement). */
type Listener = (...args: any[]) => void;

/** Fausse socket : ce que le desk envoie est noté ; le « serveur » du test pousse ses événements par `emit`. */
class FakeWs implements WsLike {
  readonly sent: string[] = [];
  pings = 0;
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pings += 1;
  }

  close(): void {
    this.closed = true;
  }

  on(event: string, cb: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  open(): void {
    this.emit('open');
  }

  message(raw: string | Uint8Array): void {
    this.emit('message', raw);
  }

  pong(): void {
    this.emit('pong');
  }

  /** La venue ferme la connexion, ou la tentative échoue avant de s’ouvrir (ws : `close` avec un code). */
  drop(code = 1006): void {
    this.emit('close', code, Buffer.from(''));
  }

  /** Réponse HTTP à la place du passage en WebSocket. */
  refuse(statusCode: number): void {
    this.emit('unexpected-response', {}, { statusCode });
  }

  /** Les messages envoyés, décodés. */
  json(): unknown[] {
    return this.sent.map((m) => JSON.parse(m) as unknown);
  }
}

function fakeNet(): { sockets: FakeWs[]; ws: WsFactory } {
  const sockets: FakeWs[] = [];
  return {
    sockets,
    ws: (url) => {
      const socket = new FakeWs(url);
      sockets.push(socket);
      return socket;
    },
  };
}

/** Les minuteurs du moment : appelée après `vi.useFakeTimers()`, elle rend les faux. */
const timers = (): Timers => ({ setTimeout, clearTimeout, setInterval, clearInterval });

/**
 * Coinbase simulé : chaque socket s’ouvre aussitôt, et la venue la ferme si aucun `subscribe` n’arrive dans les 5 s
 * (règle documentée de Coinbase). Minuteurs du test, donc faux.
 */
function coinbaseNet(): { sockets: FakeWs[]; ws: WsFactory } {
  const net = fakeNet();
  return {
    sockets: net.sockets,
    ws: (url) => {
      const socket = net.ws(url) as FakeWs;
      setTimeout(() => {
        if (socket.closed) return;
        socket.open();
        setTimeout(() => {
          if (!socket.closed && !socket.sent.some((m) => m.includes('"type":"subscribe"'))) socket.drop(1000);
        }, 5_000);
      }, 0);
      return socket;
    },
  };
}

interface HarnessOptions {
  fetch?: (url: string) => Promise<unknown>;
  now?: () => number;
  net?: { sockets: FakeWs[]; ws: WsFactory };
}

function harness(options: HarnessOptions = {}) {
  const { sockets, ws } = options.net ?? fakeNet();
  const events: CryptoFeedEvent[] = [];
  const statuses: [CryptoVenue, VenueState][] = [];
  const logs: string[] = [];
  const gate = new VenueGate(() => Date.now());
  const fetchJson = vi.fn(options.fetch ?? (async (): Promise<unknown> => Promise.reject(new Error('aucun réseau dans ce test'))));
  const host = new CryptoFeedHost({
    ws,
    hostOk: (url) => cryptoHostAllowed(url, 'wss:'),
    timers: timers(),
    now: options.now ?? (() => Date.now()),
    gate,
    fetchJson,
    emit: (event) => events.push(event),
    status: (venue, state) => statuses.push([venue, state]),
    log: (line) => logs.push(line),
  });
  return { host, sockets, events, statuses, logs, gate, fetchJson };
}

const statesOf = (statuses: readonly [CryptoVenue, VenueState][], venue: CryptoVenue): VenueState[] => statuses.filter(([v]) => v === venue).map(([, s]) => s);

function idOf(result: { ok: true; subscriptionId: string } | { ok: false; detail: string }): string {
  if (!result.ok) throw new Error(`abonnement refusé : ${result.detail}`);
  return result.subscriptionId;
}

function barsOf(result: { ok: true; bars: CryptoBar[] } | { ok: false; detail: string }): CryptoBar[] {
  if (!result.ok) throw new Error(`historique refusé : ${result.detail}`);
  return result.bars;
}

/** Laisse filer les promesses en cours (une page d’historique résolue, la suivante demandée). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Messages des venues, aux formes relevées en direct (CRY1.3).
const CB_SUBSCRIBE_TICKER = { type: 'subscribe', channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }, { name: 'heartbeat', product_ids: ['BTC-USD'] }] };
const CB_SUBSCRIBED = '{"type":"subscriptions","channels":[{"name":"heartbeat","product_ids":["BTC-USD"],"account_ids":null},{"name":"ticker","product_ids":["BTC-USD"],"account_ids":null}]}';
const CB_SUBSCRIBED_ALL =
  '{"type":"subscriptions","channels":[{"name":"heartbeat","product_ids":["BTC-USD"],"account_ids":null},{"name":"ticker","product_ids":["BTC-USD"],"account_ids":null},{"name":"matches","product_ids":["BTC-USD"],"account_ids":null}]}';
const cbHeartbeat = (ms: number): string => JSON.stringify({ type: 'heartbeat', last_trade_id: 69152544, product_id: 'BTC-USD', sequence: 17330104222, time: iso(ms) });
const cbTicker = (price: string, ms: number): string =>
  JSON.stringify({ type: 'ticker', sequence: 137481121996, product_id: 'BTC-USD', price, open_24h: '81100.00', side: 'sell', time: iso(ms), last_size: '0.001' });
/** Coinbase donne dans `side` le côté du maker : l’agresseur est l’autre côté. */
const cbMatch = (side: 'buy' | 'sell', price: string, size: string, ms: number): string =>
  JSON.stringify({ type: 'match', trade_id: 1104206116, side, size, price, product_id: 'BTC-USD', sequence: 137481122465, time: iso(ms) });
const cbError = (message: string, reason: string): string => JSON.stringify({ type: 'error', message, reason });

const bnAck = (id: number): string => JSON.stringify({ result: null, id });
const bnRefused = (id: number): string => JSON.stringify({ error: { code: 2, msg: 'Invalid request: streams must be an array' }, id });
const bnTicker = (symbol: string, E: number): string => JSON.stringify({ e: '24hrMiniTicker', E, s: symbol, c: '0.00216300', o: '0.00223400', h: '0.00225300', l: '0.00200600', v: '1582084367.3', q: '3365266.96' });
const bnKline = (t: number, interval: string, final: boolean): string =>
  JSON.stringify({ e: 'kline', E: t + 1_000, s: 'ONEUSDT', k: { t, T: t + 59_999, s: 'ONEUSDT', i: interval, o: '0.002142', c: '0.002158', h: '0.002217', l: '0.002139', v: '87072165.8', x: final, V: '46488643.3' } });

const BY_ACK = '{"success":true,"ret_msg":"subscribe","conn_id":"d9avrremonceh80v85sg-gbvsb","op":"subscribe"}';
const byRefused = (topic: string): string => JSON.stringify({ success: false, ret_msg: `Invalid symbol :[${topic}]`, conn_id: 'd9avtftc9enb83116hvg-gozf5', op: 'subscribe' });
const byTrade = (T: number, side: 'Buy' | 'Sell', p: string, v: string): string =>
  JSON.stringify({ topic: 'publicTrade.ZIGUSDT', ts: T + 5, type: 'snapshot', data: [{ i: '2290000001228943833', T, p, v, S: side, s: 'ZIGUSDT', BT: false }] });

/** Avance l’horloge seconde par seconde jusqu’à `until` (ms), avec un heartbeat Coinbase à chaque seconde, comme la venue. */
function heartbeatsUntil(socket: FakeWs, until: number): void {
  while (Date.now() < until) {
    vi.advanceTimersByTime(Math.min(1_000, until - Date.now()));
    socket.message(cbHeartbeat(Date.now()));
  }
}

describe('ManagedSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function managed(over: Partial<ConstructorParameters<typeof ManagedSocket>[0]> = {}) {
    const { sockets, ws } = fakeNet();
    const states: VenueState[] = [];
    const logs: string[] = [];
    const received: string[] = [];
    let opened = 0;
    const gate = new VenueGate(() => Date.now());
    const socket = new ManagedSocket({
      url: 'wss://stream.binance.com:9443/ws',
      venue: 'binance',
      ws,
      hostOk: (url) => cryptoHostAllowed(url, 'wss:'),
      timers: timers(),
      now: () => Date.now(),
      gate,
      onMessage: (raw) => received.push(raw),
      onState: (state) => states.push(state),
      onOpen: () => {
        opened += 1;
      },
      log: (line) => logs.push(line),
      ...over,
    });
    return { socket, sockets, states, logs, received, gate, opened: () => opened };
  }

  it('contrôle l’hôte avant d’ouvrir : refusé → blocked, journalisé par son hôte seul, sans socket ni minuteur', () => {
    const { socket, sockets, states, logs } = managed({ url: 'wss://evil.example.com:9443/ws?token=SECRET' });
    expect(socket.state).toBe('off');
    socket.open();
    expect(socket.state).toBe('blocked');
    expect(states).toEqual(['blocked']);
    expect(sockets).toHaveLength(0);
    const journal = logs.join('\n');
    expect(journal).toContain('evil.example.com');
    for (const leak of ['SECRET', 'token', '?', 'wss://']) expect(journal).not.toContain(leak);
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un hostOk qui lève bloque aussi : la garde échoue fermée', () => {
    const { socket, sockets } = managed({
      hostOk: () => {
        throw new Error('boum');
      },
    });
    socket.open();
    expect(socket.state).toBe('blocked');
    expect(sockets).toHaveLength(0);
  });

  it('connecting puis live à l’ouverture ; lit les trames en texte ; n’envoie rien avant l’ouverture', () => {
    const { socket, sockets, states, received, opened } = managed();
    socket.open();
    expect(socket.state).toBe('connecting');
    const ws = nth(sockets, 0);
    expect(ws.url).toBe('wss://stream.binance.com:9443/ws');
    socket.send('{"tôt":1}');
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(socket.state).toBe('live');
    expect(states).toEqual(['connecting', 'live']);
    expect(opened()).toBe(1);
    ws.message('{"a":1}');
    ws.message(Buffer.from('{"b":"é"}'));
    ws.message(new TextEncoder().encode('{"c":3}'));
    expect(received).toEqual(['{"a":1}', '{"b":"é"}', '{"c":3}']);
    socket.send('{"x":1}');
    expect(ws.sent).toEqual(['{"x":1}']);
  });

  it('ping de protocole toutes les 15 s, et ping applicatif toutes les 20 s quand la venue le demande', () => {
    const { socket, sockets } = managed({ venue: 'bybit', url: 'wss://stream.bybit.com/v5/public/spot', appPing: () => '{"op":"ping"}' });
    socket.open();
    const ws = nth(sockets, 0);
    vi.advanceTimersByTime(10_000);
    expect(ws.pings).toBe(0); // rien avant l’ouverture
    expect(ws.sent).toEqual([]);
    ws.open();
    vi.advanceTimersByTime(PING_EVERY_MS - 1);
    expect(ws.pings).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ws.pings).toBe(1);
    ws.pong();
    vi.advanceTimersByTime(BYBIT_PING_EVERY_MS - PING_EVERY_MS - 1);
    expect(ws.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ws.sent).toEqual(['{"op":"ping"}']);
  });

  it('un ping applicatif nul n’envoie rien, et sans appPing rien d’autre que le ping de protocole ne part', () => {
    const quiet = managed({ appPing: () => null });
    quiet.socket.open();
    nth(quiet.sockets, 0).open();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(PING_EVERY_MS);
      nth(quiet.sockets, 0).pong();
    }
    expect(nth(quiet.sockets, 0).sent).toEqual([]);
    expect(nth(quiet.sockets, 0).pings).toBe(4);
  });

  it('close() demandé : minuteurs arrêtés, socket fermée, plus aucune reconnexion', () => {
    const { socket, sockets, states } = managed();
    socket.open();
    const ws = nth(sockets, 0);
    ws.open();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    socket.close();
    expect(socket.state).toBe('off');
    expect(states).toEqual(['connecting', 'live', 'off']);
    expect(ws.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    ws.emit('error', new Error('reset'));
    ws.drop();
    ws.message('{"tard":1}');
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(socket.state).toBe('off');
    socket.send('{"x":1}');
    expect(ws.sent).toEqual([]);
  });

  it('une ouverture qui ne vient pas est abandonnée au bout de 30 s, puis retentée', () => {
    const { socket, sockets, states } = managed();
    socket.open();
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    expect(nth(sockets, 0).closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(nth(sockets, 0).closed).toBe(true);
    expect(states).toEqual(['connecting', 'reconnecting']);
    nth(sockets, 0).open(); // trop tard : cette socket ne compte plus
    expect(socket.state).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    nth(sockets, 1).open();
    expect(socket.state).toBe('live');
  });

  it('close() pendant l’attente d’une nouvelle tentative l’annule', () => {
    const { socket, sockets } = managed();
    socket.open();
    nth(sockets, 0).drop();
    expect(socket.state).toBe('reconnecting');
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it('fermeture non demandée : nouvel essai après 1 s, 2 s, 4 s… plafonné à 60 s, remis à 1 s après 30 s de connexion vivante', () => {
    const { socket, sockets } = managed();
    socket.open();
    nth(sockets, 0).open();
    nth(sockets, 0).drop();
    expect(socket.state).toBe('reconnecting');
    for (const wait of [1, 2, 4, 8, 16, 32, 60, 60]) {
      const before = sockets.length;
      vi.advanceTimersByTime(wait * 1000 - 1);
      expect(sockets.length, `${wait} s : rien juste avant`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(sockets.length, `${wait} s : nouvelle socket à l’échéance`).toBe(before + 1);
      expect(socket.state).toBe('reconnecting');
      nth(sockets, -1).drop(); // la tentative échoue avant de s’ouvrir
    }
    expect(RECONNECT_MAX_MS).toBe(60_000);
    vi.advanceTimersByTime(60_000);
    const lasting = nth(sockets, -1);
    lasting.open();
    expect(socket.state).toBe('live');
    vi.advanceTimersByTime(PING_EVERY_MS);
    lasting.pong();
    vi.advanceTimersByTime(STALE_AFTER_MS - PING_EVERY_MS); // 30 s vivante et active : le délai retombe à 1 s
    lasting.pong();
    lasting.drop();
    const before = sockets.length;
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1);
  });

  it('une venue qui accepte puis ferme aussitôt : 1, 2, 4, 8 s, sans retomber à 1 s à chaque ouverture', () => {
    const { socket, sockets } = managed();
    socket.open();
    for (const wait of [1, 2, 4, 8]) {
      nth(sockets, -1).open();
      expect(socket.state).toBe('live');
      nth(sockets, -1).drop(); // acceptée puis fermée aussitôt
      const before = sockets.length;
      vi.advanceTimersByTime(wait * 1000 - 1);
      expect(sockets.length, `${wait} s : rien juste avant`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(sockets.length, `${wait} s : nouvelle socket à l’échéance`).toBe(before + 1);
    }
  });

  it('une connexion restée muette 30 s ne compte pas comme vivante : le délai continue de doubler', () => {
    const { socket, sockets } = managed();
    socket.open();
    nth(sockets, 0).drop(); // 1 s
    vi.advanceTimersByTime(1_000);
    nth(sockets, 1).drop(); // 2 s
    vi.advanceTimersByTime(2_000);
    const silent = nth(sockets, 2);
    vi.advanceTimersByTime(2_000);
    silent.open(); // ouverte 2 s après sa création, puis plus rien
    vi.advanceTimersByTime(STALE_AFTER_MS);
    expect(socket.state).toBe('reconnecting'); // périmée
    const before = sockets.length;
    vi.advanceTimersByTime(3_999);
    expect(sockets).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1); // 4 s, pas 1 s
  });

  it('une erreur de socket ferme et relance, sans lever, et son texte est borné, sans URL complète', () => {
    const { socket, sockets, logs } = managed();
    socket.open();
    const ws = nth(sockets, 0);
    ws.open();
    expect(() => ws.emit('error', new Error(`getaddrinfo ENOTFOUND https://stream.binance.com/ws?listenKey=SECRET ${'x'.repeat(500)}`))).not.toThrow();
    expect(socket.state).toBe('reconnecting');
    expect(ws.closed).toBe(true);
    ws.drop(); // ws envoie close après error : déjà pris en compte
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    const journal = logs.join('\n');
    expect(journal).toContain('stream.binance.com');
    for (const leak of ['SECRET', 'listenKey', 'https://']) expect(journal).not.toContain(leak);
    for (const line of logs) expect(line.length).toBeLessThanOrEqual(400);
  });

  it('429 à la poignée de main : la porte se ferme, la socket attend sa réouverture ; 418 : bloquée sans reconnexion', () => {
    const { socket, sockets, gate } = managed();
    socket.open();
    nth(sockets, 0).refuse(429);
    expect(nth(sockets, 0).closed).toBe(true); // poignée de main abandonnée
    expect(gate.allowed('binance')).toBe(false);
    expect(gate.blocked('binance')).toBe(false);
    expect(socket.state).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    nth(sockets, 1).refuse(429); // la porte double son backoff : 2 s, comme la socket
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    nth(sockets, 2).refuse(418);
    expect(socket.state).toBe('blocked');
    expect(gate.blocked('binance')).toBe(true);
    nth(sockets, 2).drop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attend la porte : aucune connexion tant qu’un 429 du REST tient la venue en pause', () => {
    const { socket, sockets, gate } = managed();
    gate.onHttpError('binance', new VenueHttpError(429, 'HTTP 429 (api.binance.com)', 10));
    socket.open();
    expect(socket.state).toBe('connecting');
    expect(sockets).toHaveLength(0);
    vi.advanceTimersByTime(9_999);
    expect(sockets).toHaveLength(0);
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1);
  });

  it('une venue bloquée par la porte (418 du REST) ne s’ouvre pas', () => {
    const { socket, sockets, gate } = managed();
    gate.onHttpError('binance', new VenueHttpError(418, 'HTTP 418 (api.binance.com)'));
    socket.open();
    expect(socket.state).toBe('blocked');
    expect(sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('une autre réponse HTTP (451, 503) relance avec le backoff, sans toucher la porte', () => {
    const { socket, sockets, gate } = managed();
    socket.open();
    nth(sockets, 0).refuse(451);
    expect(gate.allowed('binance')).toBe(true);
    expect(socket.state).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('écarte une trame de plus de 1 Mio sans la lire, mais elle compte comme activité', () => {
    const { socket, sockets, received } = managed();
    socket.open();
    const ws = nth(sockets, 0);
    ws.open();
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    ws.message(`"${'a'.repeat(1024 * 1024)}"`);
    expect(received).toEqual([]);
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    expect(socket.state).toBe('live');
  });
});

describe('CryptoFeedHost · sockets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one socket per venue and subscribes after open', () => {
    const { host, sockets, statuses } = harness();
    const a = host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const b = host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    expect(idOf(a)).not.toBe(idOf(b));
    for (const id of [idOf(a), idOf(b)]) expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(sockets.map((s) => s.url)).toEqual(['wss://ws-feed.exchange.coinbase.com']);
    const coinbase = nth(sockets, 0);
    expect(coinbase.sent).toEqual([]); // rien avant l’ouverture
    coinbase.open();
    expect(coinbase.json()).toEqual([CB_SUBSCRIBE_TICKER]);
    // Une clé déjà active n’est pas redemandée.
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    expect(coinbase.sent).toHaveLength(1);
    // Une autre venue a sa propre socket.
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    expect(sockets.map((s) => s.url)).toEqual(['wss://ws-feed.exchange.coinbase.com', 'wss://stream.binance.com:9443/ws']);
    expect(host.states()).toEqual({ coinbase: 'live', binance: 'connecting', bybit: 'off' });
    expect(statuses).toEqual([
      ['coinbase', 'connecting'],
      ['coinbase', 'live'],
      ['binance', 'connecting'],
    ]);
  });

  it('compte les références par clé : seul le dernier désabonnement d’une clé envoie l’unsubscribe ; le dernier abonnement de la venue la ferme', () => {
    const { host, sockets, statuses } = harness();
    const a = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }));
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED);
    const b = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }));
    const c = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }));
    // Le heartbeat du produit est déjà tenu par le ticker : seul `matches` est demandé.
    expect(socket.json()).toEqual([CB_SUBSCRIBE_TICKER, { type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] }]);
    expect(host.unsubscribe(a)).toBe(true);
    expect(socket.sent).toHaveLength(2); // b tient encore le ticker
    expect(host.unsubscribe(b)).toBe(true);
    expect(nth(socket.json(), -1)).toEqual({ type: 'unsubscribe', channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }] }); // le heartbeat reste à c
    expect(socket.closed).toBe(false);
    expect(host.unsubscribe(c)).toBe(true);
    expect(socket.closed).toBe(true);
    expect(host.states().coinbase).toBe('off');
    expect(nth(statesOf(statuses, 'coinbase'), -1)).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
    expect(host.unsubscribe(c)).toBe(false);
    expect(host.unsubscribe('sub-inconnu')).toBe(false);
    socket.drop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it('un désabonnement pendant la reconnexion est laissé hors du réabonnement', () => {
    const { host, sockets } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const ondo = idOf(host.subscribe({ series: 'coinbase:ONDO-USD', kind: 'ticker' }));
    const first = nth(sockets, 0);
    first.open();
    expect(first.json()).toEqual([
      { type: 'subscribe', channels: [{ name: 'ticker', product_ids: ['BTC-USD', 'ONDO-USD'] }, { name: 'heartbeat', product_ids: ['BTC-USD', 'ONDO-USD'] }] },
    ]);
    first.drop();
    expect(host.states().coinbase).toBe('reconnecting');
    expect(host.unsubscribe(ondo)).toBe(true);
    expect(first.sent).toHaveLength(1); // rien ne part sur une socket qui n’est pas ouverte
    vi.advanceTimersByTime(1_000);
    const second = nth(sockets, 1);
    second.open();
    expect(second.json()).toEqual([CB_SUBSCRIBE_TICKER]);
  });

  it('refuse un flux que streamKeys ne connaît pas : unknown_stream, sans socket ni état', () => {
    const { host, sockets, statuses } = harness();
    const refused = { ok: false, detail: 'unknown_stream' };
    expect(host.subscribe({ series: 'kraken:BTC-USD' as CryptoSeriesId, kind: 'ticker' })).toEqual(refused);
    expect(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'book' as 'ticker' })).toEqual(refused);
    expect(host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars' })).toEqual(refused);
    expect(host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 30 as CryptoTimeframe })).toEqual(refused);
    // Coinbase et Bybit ont une clé de trades sans timeframe, mais une bougie ne se construit pas sans lui.
    expect(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars' })).toEqual(refused);
    expect(host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'bars', timeframe: 7 as CryptoTimeframe })).toEqual(refused);
    expect(sockets).toHaveLength(0);
    expect(statuses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.states()).toEqual({ coinbase: 'off', binance: 'off', bybit: 'off' });
  });

  it('stays live without trades', () => {
    const { host, sockets, statuses, events } = harness();
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' });
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    expect(socket.json()).toEqual([{ op: 'subscribe', args: ['tickers.ZIGUSDT', 'publicTrade.ZIGUSDT'] }]);
    socket.message(BY_ACK);
    // Dix minutes sans un trade : seuls les pongs répondent aux pings de protocole.
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(PING_EVERY_MS);
      socket.pong();
    }
    expect(host.states().bybit).toBe('live');
    expect(statesOf(statuses, 'bybit')).toEqual(['connecting', 'live']);
    expect(sockets).toHaveLength(1);
    expect(socket.pings).toBe(40);
    expect(socket.sent.filter((m) => m === '{"op":"ping"}')).toHaveLength(30); // ping de Bybit, toutes les 20 s
    expect(events).toEqual([]);
  });

  it('un heartbeat Coinbase par seconde suffit à rester live, même sans pong', () => {
    const { host, sockets, statuses } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    heartbeatsUntil(socket, at('10:10:20'));
    expect(host.states().coinbase).toBe('live');
    expect(statesOf(statuses, 'coinbase')).toEqual(['connecting', 'live']);
    expect(sockets).toHaveLength(1);
  });

  it('goes stale then reconnects with backoff', () => {
    const { host, sockets, statuses } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const first = nth(sockets, 0);
    first.open();
    first.message(CB_SUBSCRIBED);
    vi.advanceTimersByTime(STALE_AFTER_MS - 1);
    expect(host.states().coinbase).toBe('live');
    vi.advanceTimersByTime(1);
    expect(statesOf(statuses, 'coinbase')).toEqual(['connecting', 'live', 'stale', 'reconnecting']);
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // après 1 s
    nth(sockets, 1).drop(); // cette tentative échoue avant de s’ouvrir
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3); // puis 2 s
    const third = nth(sockets, 2);
    third.open();
    expect(third.json()).toEqual([CB_SUBSCRIBE_TICKER]); // réabonnement à l’ouverture
    expect(host.states().coinbase).toBe('live');
    expect(statesOf(statuses, 'coinbase')).toEqual(['connecting', 'live', 'stale', 'reconnecting', 'live']);
    // L’ancienne socket ne parle plus pour la venue.
    first.message(cbTicker('1', Date.now()));
    first.drop();
    expect(host.states().coinbase).toBe('live');
  });

  it('blocks on 418 without reconnecting', async () => {
    const { host, sockets, statuses, gate, logs, fetchJson } = harness();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.refuse(418);
    expect(host.states().binance).toBe('blocked');
    expect(statesOf(statuses, 'binance')).toEqual(['connecting', 'blocked']);
    expect(gate.blocked('binance')).toBe(true);
    expect(socket.closed).toBe(true);
    // ws signale ensuite l’abandon de la poignée de main : rien ne repart.
    socket.emit('error', new Error('WebSocket was closed before the connection was established'));
    socket.drop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(logs.some((line) => line.includes('418'))).toBe(true);
    // La porte coupe aussi le REST de la venue, sans appel.
    await expect(host.history({ series: 'binance:ONEUSDT', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'blocked' });
    expect(fetchJson).not.toHaveBeenCalled();
    // Jusqu’au redémarrage : ni closeAll ni un nouvel abonnement ne rouvrent la venue.
    host.closeAll();
    expect(host.states().binance).toBe('blocked');
    expect(host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 }).ok).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(host.states().binance).toBe('blocked');
    // Les autres venues ne sont pas touchées.
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    expect(sockets).toHaveLength(2);
    expect(host.states().coinbase).toBe('connecting');
  });

  it('closeAll stops everything', async () => {
    let answer: (json: unknown) => void = () => undefined;
    const { host, sockets, events, fetchJson } = harness({
      fetch: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const bars = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }));
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' });
    nth(sockets, 0).open();
    nth(sockets, 0).message(CB_SUBSCRIBED);
    nth(sockets, 1).open();
    nth(sockets, 1).drop(); // Binance attend sa nouvelle tentative ; Bybit est encore en connexion
    const pending = host.history({ series: 'binance:ONEUSDT', timeframe: 1 }); // trois pages : la première est en route
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    host.closeAll();
    expect(vi.getTimerCount()).toBe(0);
    expect(sockets.every((s) => s.closed)).toBe(true);
    expect(host.states()).toEqual({ coinbase: 'off', binance: 'off', bybit: 'off' });
    // Les faux serveurs ferment à leur tour, une trame arrive en retard : rien ne repart, rien n’est émis.
    for (const socket of sockets) {
      socket.message(cbMatch('sell', '82500.10', '0.25', Date.now()));
      socket.emit('error', new Error('reset'));
      socket.drop();
    }
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(3);
    expect(events).toEqual([]);
    // L’historique en route s’arrête à sa page : aucune page suivante.
    answer([]);
    await expect(pending).resolves.toEqual({ ok: false, detail: 'closed' });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // Les abonnements sont oubliés ; l’hôte reste utilisable.
    expect(host.unsubscribe(bars)).toBe(false);
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    expect(sockets).toHaveLength(4);
    nth(sockets, 3).open();
    expect(nth(sockets, 3).json()).toEqual([CB_SUBSCRIBE_TICKER]);
  });

  it('closeAll : une page qui échoue ensuite répond closed, pas son erreur', async () => {
    let fail: (error: Error) => void = () => undefined;
    const { host, fetchJson } = harness({
      fetch: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    const pending = host.history({ series: 'coinbase:BTC-USD', timeframe: 60 });
    host.closeAll();
    fail(new Error('Délai dépassé (api.exchange.coinbase.com)'));
    await expect(pending).resolves.toEqual({ ok: false, detail: 'closed' });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('relaie tickers et bougies Binance aux abonnements actifs seulement', () => {
    const { host, sockets, events } = harness();
    const ticker = idOf(host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' }));
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    const [subscribe] = socket.json() as [{ method: string; params: string[]; id: number }];
    expect(subscribe.method).toBe('SUBSCRIBE');
    expect(subscribe.params).toEqual(['oneusdt@miniTicker', 'oneusdt@kline_1m']);
    socket.message(bnAck(subscribe.id));
    socket.message(bnTicker('ONEUSDT', at('10:00:21')));
    socket.message(bnKline(at('10:00:00'), '1m', false));
    socket.message(bnKline(at('10:00:00'), '1h', false)); // aucun abonnement 1 h
    socket.message(bnTicker('BTCUSDT', at('10:00:22'))); // aucun abonnement ticker BTCUSDT
    expect(events).toEqual([
      { kind: 'ticker', ticker: { market: 'binance:ONEUSDT', last: 0.002163, change24hPct: (0.002163 / 0.002234 - 1) * 100, time: at('10:00:21') } },
      {
        kind: 'bar',
        series: 'binance:ONEUSDT',
        timeframe: 1,
        bar: { time: sec('10:00:00'), open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 },
        final: false,
      },
    ]);
    host.unsubscribe(ticker);
    expect(nth(socket.json(), -1)).toMatchObject({ method: 'UNSUBSCRIBE', params: ['oneusdt@miniTicker'] });
    socket.message(bnTicker('ONEUSDT', at('10:00:25')));
    expect(events).toHaveLength(2);
  });

  it('écarte une bougie Binance datée de plus d’un seau en avance', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(bnKline(Date.parse('2030-01-01T00:00:00Z'), '1m', false));
    socket.message(bnKline(at('10:02:00'), '1m', false)); // deux seaux d’avance
    expect(events).toEqual([]);
    socket.message(bnKline(at('10:01:00'), '1m', false)); // un seau d’avance : une horloge un peu en retard
    socket.message(bnKline(at('10:00:00'), '1m', true));
    expect(events.map((e) => (e.kind === 'bar' ? [e.bar.time, e.final] : null))).toEqual([
      [sec('10:01:00'), false],
      [sec('10:00:00'), true],
    ]);
  });
});

describe('CryptoFeedHost · refus de la venue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Bybit refuse le seul abonnement : journalisé, venue bloquée, aucune reconnexion ; il se retire ensuite normalement', () => {
    const { host, sockets, statuses, logs } = harness();
    const id = idOf(host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' }));
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(byRefused('tickers.ZIGUSDT'));
    expect(logs.join('\n')).toContain('Invalid symbol :[tickers.ZIGUSDT]');
    expect(host.states().bybit).toBe('blocked');
    expect(statesOf(statuses, 'bybit')).toEqual(['connecting', 'live', 'blocked']);
    expect(socket.closed).toBe(true);
    socket.drop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.unsubscribe(id)).toBe(true);
    expect(host.states().bybit).toBe('off');
    // Un nouvel abonnement rouvre la venue.
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' });
    expect(sockets).toHaveLength(2);
  });

  it('Bybit refuse un abonnement parmi d’autres : il est abandonné, les autres continuent, et il n’est jamais redemandé', () => {
    const { host, sockets, events, logs } = harness();
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(BY_ACK);
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'bars', timeframe: 1 });
    expect(nth(socket.json(), -1)).toEqual({ op: 'subscribe', args: ['publicTrade.ZIGUSDT'] });
    socket.message(byRefused('publicTrade.ZIGUSDT'));
    expect(logs.join('\n')).toContain('Invalid symbol :[publicTrade.ZIGUSDT]');
    expect(host.states().bybit).toBe('live');
    expect(socket.closed).toBe(false);
    socket.message(byTrade(at('10:00:30'), 'Buy', '0.05932', '61'));
    expect(events).toEqual([]);
    // Une reconnexion ne redemande que ce qui n’a pas été refusé.
    socket.drop();
    vi.advanceTimersByTime(1_000);
    nth(sockets, 1).open();
    expect(nth(sockets, 1).json()).toEqual([{ op: 'subscribe', args: ['tickers.ZIGUSDT'] }]);
  });

  it('Binance refuse puis ferme (1008) : la clé refusée n’est pas redemandée, sans boucle de reconnexion', () => {
    const { host, sockets, logs } = harness();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    const first = nth(sockets, 0);
    first.open();
    const [ticker] = first.json() as [{ id: number }];
    first.message(bnAck(ticker.id));
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 60 });
    const kline = nth(first.json(), -1) as { method: string; params: string[]; id: number };
    expect(kline).toMatchObject({ method: 'SUBSCRIBE', params: ['oneusdt@kline_1h'] });
    expect(kline.id).not.toBe(ticker.id);
    first.message(bnRefused(kline.id));
    first.drop(1008);
    expect(logs.join('\n')).toContain('Invalid request: streams must be an array');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    const second = nth(sockets, 1);
    second.open();
    const [again] = second.json() as [{ method: string; params: string[]; id: number }];
    expect(again).toMatchObject({ method: 'SUBSCRIBE', params: ['oneusdt@miniTicker'] });
    second.message(bnAck(again.id));
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(PING_EVERY_MS);
      second.pong();
    }
    expect(sockets).toHaveLength(2);
    expect(host.states().binance).toBe('live');
  });

  it('Binance : une réponse est rapprochée de sa demande par son id, pas par sa place dans la file', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 60 }); // deux demandes en attente
    const [ticker, kline] = socket.json() as [{ id: number; params: string[] }, { id: number; params: string[] }];
    expect([ticker.params, kline.params]).toEqual([['oneusdt@miniTicker'], ['oneusdt@kline_1h']]);
    socket.message(bnRefused(kline.id)); // le refus vise la seconde
    socket.message(bnAck(ticker.id));
    socket.message(bnAck(424242)); // un id inconnu ne répond à rien
    socket.message(bnTicker('ONEUSDT', at('10:00:21')));
    socket.message(bnKline(at('10:00:00'), '1h', false));
    expect(events.map((e) => e.kind)).toEqual(['ticker']); // le ticker reste suivi, la bougie 1 h est abandonnée
    expect(host.states().binance).toBe('live');
  });

  it('Binance refuse le seul abonnement puis ferme : venue bloquée, aucune nouvelle socket après 5 min', () => {
    const { host, sockets, statuses } = harness();
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    const [request] = socket.json() as [{ id: number }];
    socket.message(bnRefused(request.id));
    socket.drop(1008);
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(host.states().binance).toBe('blocked');
    expect(statesOf(statuses, 'binance')).toEqual(['connecting', 'live', 'blocked']);
  });

  it('Coinbase : bougies refusées puis ticker retiré → la socket ferme, aucune reconnexion pendant 10 min, journal borné', () => {
    const { host, sockets, logs, statuses } = harness({ net: coinbaseNet() });
    const ticker = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }));
    vi.advanceTimersByTime(0); // la venue ouvre la socket
    const socket = nth(sockets, 0);
    expect(socket.json()).toEqual([CB_SUBSCRIBE_TICKER]);
    socket.message(CB_SUBSCRIBED);
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    expect(nth(socket.json(), -1)).toEqual({ type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] });
    socket.message(cbError('Failed to subscribe', 'matches is not available for BTC-USD'));
    expect(host.states().coinbase).toBe('live'); // le ticker suit toujours
    expect(host.unsubscribe(ticker)).toBe(true);
    // Il ne reste qu’un abonnement refusé : aucune socket sans flux, la venue passe blocked.
    expect(socket.closed).toBe(true);
    expect(host.states().coinbase).toBe('blocked');
    socket.drop(1000);
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(logs.length).toBeLessThanOrEqual(5);
    expect(statesOf(statuses, 'coinbase')).toEqual(['connecting', 'live', 'blocked']);
  });

  it('une erreur qui ne répond à aucune demande en attente est seulement journalisée', () => {
    const { host, sockets, logs, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED);
    socket.message(cbError('Slow consumer', `buffer full ${'x'.repeat(400)}`));
    expect(logs.join('\n')).toContain('Slow consumer');
    for (const line of logs) expect(line.length).toBeLessThanOrEqual(400);
    expect(host.states().coinbase).toBe('live');
    expect(socket.closed).toBe(false);
    socket.message(cbTicker('82595.17', Date.now()));
    expect(events).toHaveLength(1);
  });
});

describe('CryptoFeedHost · bougies depuis les trades', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const CB_SUBSCRIBED_MATCHES = '{"type":"subscriptions","channels":[{"name":"heartbeat","product_ids":["BTC-USD"],"account_ids":null},{"name":"matches","product_ids":["BTC-USD"],"account_ids":null}]}';
  const bar = (series: CryptoSeriesId, timeframe: CryptoTimeframe, b: CryptoBar, final: boolean): CryptoFeedEvent => ({ kind: 'bar', series, timeframe, bar: b, final });

  it('builds Coinbase bars from matches', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    expect(socket.json()).toEqual([{ type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }, { name: 'heartbeat', product_ids: ['BTC-USD'] }] }]);
    socket.message(CB_SUBSCRIBED_MATCHES); // accusé à 10:00:20 : le seau de 10:01 sera vu en entier
    heartbeatsUntil(socket, at('10:01:05'));
    socket.message(cbMatch('sell', '82500.10', '0.25', at('10:01:05'))); // le maker vend : l’agresseur achète
    heartbeatsUntil(socket, at('10:01:30'));
    socket.message(cbMatch('buy', '82490.00', '0.125', at('10:01:30'))); // l’agresseur vend
    heartbeatsUntil(socket, at('10:02:01'));
    socket.message(cbMatch('sell', '82510.00', '0.5', at('10:02:01')));
    const ten01 = { time: sec('10:01:00'), open: 82500.1, high: 82500.1, low: 82490, close: 82490, volume: 0.375, buyVolume: 0.25 };
    expect(events).toEqual([
      bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 82500.1, high: 82500.1, low: 82500.1, close: 82500.1, volume: 0.25, buyVolume: 0.25 }, false),
      bar('coinbase:BTC-USD', 1, ten01, false),
      bar('coinbase:BTC-USD', 1, ten01, true),
      bar('coinbase:BTC-USD', 1, { time: sec('10:02:00'), open: 82510, high: 82510, low: 82510, close: 82510, volume: 0.5, buyVolume: 0.5 }, false),
    ]);
  });

  it('builds Bybit bars from publicTrade, côté du taker', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'bybit:ZIGUSDT', kind: 'bars', timeframe: 5 });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(BY_ACK); // 10:00:20 : le seau de 10:05 sera complet
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(PING_EVERY_MS);
      socket.pong();
    }
    expect(Date.now()).toBe(at('10:05:20'));
    socket.message(byTrade(at('10:05:10'), 'Buy', '0.05932', '61'));
    socket.message(byTrade(at('10:05:15'), 'Sell', '0.05931', '120.5'));
    expect(events).toEqual([
      bar('bybit:ZIGUSDT', 5, { time: sec('10:05:00'), open: 0.05932, high: 0.05932, low: 0.05932, close: 0.05932, volume: 61, buyVolume: 61 }, false),
      bar('bybit:ZIGUSDT', 5, { time: sec('10:05:00'), open: 0.05932, high: 0.05932, low: 0.05931, close: 0.05931, volume: 181.5, buyVolume: 61 }, false),
    ]);
  });

  it('startedAtMs : premier message confirmé + 1 s ; une bougie entamée avant n’est jamais complète', () => {
    vi.setSystemTime(at('10:00:59.500'));
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED_MATCHES); // accusé à 10:00:59.500 → startedAtMs 10:01:00.500
    heartbeatsUntil(socket, at('10:01:10'));
    socket.message(cbMatch('sell', '100', '1', at('10:01:10')));
    heartbeatsUntil(socket, at('10:02:05'));
    socket.message(cbMatch('sell', '101', '2', at('10:02:05')));
    expect(events).toEqual([
      bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false), // entamée : sans buyVolume
      bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, true),
      bar('coinbase:BTC-USD', 1, { time: sec('10:02:00'), open: 101, high: 101, low: 101, close: 101, volume: 2, buyVolume: 2 }, false),
    ]);
  });

  it('startedAtMs ne vient pas de l’abonnement : une socket ouverte 25 s plus tard laisse la bougie en cours incomplète', () => {
    vi.setSystemTime(at('10:00:00'));
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }); // pile au début du seau de 10:00
    vi.advanceTimersByTime(25_000);
    const socket = nth(sockets, 0);
    socket.open();
    // Pas d’accusé : la première trame confirme (10:00:25), le seau de 10:00 a commencé avant.
    socket.message(cbMatch('sell', '100', '1', at('10:00:25')));
    expect(events).toEqual([bar('coinbase:BTC-USD', 1, { time: sec('10:00:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false)]);
  });

  it('une trame étrangère à l’abonnement ne le confirme pas : startedAtMs vient de son accusé, même arrivé tard', () => {
    vi.setSystemTime(at('10:00:50'));
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED);
    heartbeatsUntil(socket, at('10:00:58.900'));
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }); // demande de `matches` à 10:00:58.900
    expect(nth(socket.json(), -1)).toEqual({ type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] });
    vi.advanceTimersByTime(50);
    socket.message(cbHeartbeat(Date.now())); // 10:00:58.950 : le heartbeat que tient le ticker, pas une trame de l’abonnement
    socket.message(cbTicker('82500.00', Date.now())); // même marché, autre flux
    vi.advanceTimersByTime(1_550);
    socket.message(CB_SUBSCRIBED_ALL); // son accusé, à 10:01:00.500 → startedAtMs 10:01:01.500
    heartbeatsUntil(socket, at('10:01:05'));
    socket.message(cbMatch('sell', '100', '1', at('10:01:05')));
    heartbeatsUntil(socket, at('10:02:01'));
    socket.message(cbMatch('sell', '101', '2', at('10:02:01')));
    const ten01 = { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }; // des trades de 10:01 ont pu manquer
    expect(events.filter((e) => e.kind === 'bar')).toEqual([
      bar('coinbase:BTC-USD', 1, ten01, false),
      bar('coinbase:BTC-USD', 1, ten01, true),
      bar('coinbase:BTC-USD', 1, { time: sec('10:02:00'), open: 101, high: 101, low: 101, close: 101, volume: 2, buyVolume: 2 }, false),
    ]);
  });

  it('un abonnement qui attend deux demandes (la sienne et une plus ancienne pour une clé partagée) n’est confirmé qu’au dernier accusé', () => {
    vi.setSystemTime(at('10:00:57'));
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const socket = nth(sockets, 0);
    socket.open(); // demande du ticker et du heartbeat, pas encore accusée
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }); // demande de `matches` ; le heartbeat est partagé
    vi.advanceTimersByTime(1_000);
    socket.message(CB_SUBSCRIBED); // 10:00:58 : accusé de la première demande seulement
    vi.advanceTimersByTime(2_500);
    socket.message(CB_SUBSCRIBED_ALL); // 10:01:00.500 : accusé de la sienne → startedAtMs 10:01:01.500
    heartbeatsUntil(socket, at('10:01:05'));
    socket.message(cbMatch('sell', '100', '1', at('10:01:05')));
    expect(events.filter((e) => e.kind === 'bar')).toEqual([bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false)]);
  });

  it('un abonnement sur un flux déjà actif et accusé est confirmé par sa première trame, pas par celle d’un autre flux', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 5 });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED_MATCHES); // accusé à 10:00:20
    heartbeatsUntil(socket, at('10:00:58.500'));
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }); // clés déjà actives et accusées : rien à envoyer
    expect(socket.sent).toHaveLength(1);
    vi.advanceTimersByTime(100);
    socket.message(cbHeartbeat(Date.now())); // 10:00:58.600 : heartbeat, autre flux
    heartbeatsUntil(socket, at('10:01:05'));
    socket.message(cbMatch('sell', '100', '1', at('10:01:05'))); // sa première trame → startedAtMs 10:01:06
    expect(events).toEqual([
      bar('coinbase:BTC-USD', 5, { time: sec('10:00:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false),
      bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false),
    ]);
  });

  it('un flux redemandé pendant son désabonnement : une trame en vol de l’activation précédente ne confirme pas, seul l’accusé', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }); // tient la socket et le heartbeat
    const oneMinute = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }));
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED_ALL); // 10:00:20
    heartbeatsUntil(socket, at('10:04:57'));
    host.unsubscribe(oneMinute); // le désabonnement de `matches` part…
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 5 }); // … et `matches` est redemandé aussitôt
    expect(socket.json().slice(-2)).toEqual([
      { type: 'unsubscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] },
      { type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] },
    ]);
    vi.advanceTimersByTime(1_000);
    socket.message(cbMatch('sell', '99', '1', at('10:04:58'))); // envoyée avant le désabonnement : ne prouve rien pour le nouveau
    vi.advanceTimersByTime(2_500);
    socket.message(CB_SUBSCRIBED); // 10:05:00.500 : accusé du désabonnement
    vi.advanceTimersByTime(100);
    socket.message(CB_SUBSCRIBED_ALL); // 10:05:00.600 : accusé de la nouvelle demande → startedAtMs 10:05:01.600
    heartbeatsUntil(socket, at('10:05:10'));
    socket.message(cbMatch('sell', '100', '1', at('10:05:10')));
    expect(events.filter((e) => e.kind === 'bar')).toEqual([
      bar('coinbase:BTC-USD', 5, { time: sec('10:05:00'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, false),
    ]);
  });

  it('une reconnexion recrée le constructeur : le seau qui chevauche la coupure n’est pas complet', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    const first = nth(sockets, 0);
    first.open();
    first.message(CB_SUBSCRIBED_MATCHES);
    heartbeatsUntil(first, at('10:01:05'));
    first.message(cbMatch('sell', '100', '1', at('10:01:05')));
    expect(nth(events, -1)).toEqual(bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 100, high: 100, low: 100, close: 100, volume: 1, buyVolume: 1 }, false));
    first.drop();
    vi.advanceTimersByTime(1_000);
    const second = nth(sockets, 1);
    second.open();
    expect(second.json()).toEqual([{ type: 'subscribe', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }, { name: 'heartbeat', product_ids: ['BTC-USD'] }] }]);
    second.message(CB_SUBSCRIBED_MATCHES); // 10:01:06 → startedAtMs 10:01:07
    second.message(cbMatch('sell', '102', '3', at('10:01:06')));
    expect(nth(events, -1)).toEqual(bar('coinbase:BTC-USD', 1, { time: sec('10:01:00'), open: 102, high: 102, low: 102, close: 102, volume: 3 }, false));
  });

  it('écarte un trade daté de plus d’un seau en avance : un horodatage lointain ne bloque pas le constructeur', () => {
    const { host, sockets, events } = harness();
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED_MATCHES);
    heartbeatsUntil(socket, at('10:00:30'));
    socket.message(cbMatch('sell', '100', '1', Date.parse('2030-01-01T00:00:00.000Z')));
    socket.message(cbMatch('sell', '100', '1', at('10:02:00'))); // deux seaux d’avance
    expect(events).toEqual([]);
    socket.message(cbMatch('sell', '99', '1', at('10:00:31')));
    expect(events).toEqual([bar('coinbase:BTC-USD', 1, { time: sec('10:00:00'), open: 99, high: 99, low: 99, close: 99, volume: 1 }, false)]);
  });

  it('deux abonnements au même marché et au même timeframe : une seule bougie émise par trade', () => {
    const { host, sockets, events } = harness();
    const first = idOf(host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 }));
    const socket = nth(sockets, 0);
    socket.open();
    socket.message(CB_SUBSCRIBED_MATCHES);
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
    host.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 5 });
    heartbeatsUntil(socket, at('10:01:05'));
    socket.message(cbMatch('sell', '100', '1', at('10:01:05')));
    expect(events.map((e) => (e.kind === 'bar' ? [e.timeframe, e.bar.time] : null))).toEqual([
      [1, sec('10:01:00')],
      [5, sec('10:00:00')],
    ]);
    // Le premier retiré, le second prend le relais.
    host.unsubscribe(first);
    socket.message(cbMatch('sell', '101', '1', at('10:01:06')));
    expect(events.filter((e) => e.kind === 'bar' && e.timeframe === 1)).toHaveLength(2);
  });
});

/** Coinbase simulé (relevé du 9 octobre 2026) : les bougies dont l’ouverture tombe dans [start, end] et pas après `nowSec`, plus récentes d’abord. */
function fakeCoinbase(url: string, nowSec: number): number[][] {
  const query = new URL(url).searchParams;
  const g = Number(query.get('granularity'));
  const start = Date.parse(query.get('start') ?? '') / 1000;
  const end = Date.parse(query.get('end') ?? '') / 1000;
  const rows: number[][] = [];
  for (let t = Math.ceil(start / g) * g; t <= end && t <= nowSec; t += g) rows.unshift([t, t - 1, t + 1, t, t, 1]);
  return rows;
}

const BINANCE_STEP: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

/**
 * Binance et Bybit simulés (relevé du 9 octobre 2026) : sans point de départ, les `limit` dernières bougies ; avec, les
 * `limit` premières depuis ce départ ; jusqu’à la bougie entamée à `nowMs` comprise. Chaque venue dans sa langue.
 */
function fakeKlines(url: string, nowMs: number): unknown {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  const interval = query.get('interval') ?? '';
  const step = parsed.hostname === 'api.binance.com' ? BINANCE_STEP[interval] : interval === 'D' ? 86400 : Number(interval) * 60;
  const limit = Number(query.get('limit'));
  if (step === undefined || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error(`requête simulée invalide : ${url}`);
  const current = Math.floor(nowMs / 1000 / step) * step;
  const from = query.get('startTime') ?? query.get('start');
  const first = from === null ? current - (limit - 1) * step : Math.ceil(Number(from) / 1000 / step) * step;
  const times: number[] = [];
  for (let t = first; t <= current && times.length < limit; t += step) times.push(t);
  if (parsed.hostname === 'api.binance.com') return times.map((t) => [t * 1000, '2', '10', '1', '5', '7', (t + step) * 1000 - 1, '0', 0, '4']);
  return { retCode: 0, retMsg: 'OK', result: { list: times.reverse().map((t) => [String(t * 1000), '2', '10', '1', '5', '7', '0']) } };
}

describe('CryptoFeedHost · history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Deux bougies 1 h réelles de Binance ONEUSDT, le 9 octobre 2026 à 09:00 et 10:00 UTC.
  const BINANCE_ROWS = [
    [1791536400000, '0.00214200', '0.00221700', '0.00213900', '0.00215800', '87072165.80000000', 1791539999999, '190392.81755970', 4407, '46488643.30000000', '101648.64787700', '0'],
    [1791540000000, '0.00215800', '0.00216900', '0.00215000', '0.00216300', '1203.00000000', 1791543599999, '2.6', 12, '600.50000000', '1.3', '0'],
  ];

  it('history : fixture Binance → bougies analysées', async () => {
    const { host, fetchJson, gate } = harness({ fetch: async () => BINANCE_ROWS });
    const success = vi.spyOn(gate, 'onSuccess');
    const result = await host.history({ series: 'binance:ONEUSDT', timeframe: 60 });
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1h&limit=500']);
    expect(result).toEqual({
      ok: true,
      bars: [
        { time: 1791536400, open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 },
        { time: 1791540000, open: 0.002158, high: 0.002169, low: 0.00215, close: 0.002163, volume: 1203, buyVolume: 600.5 },
      ],
    });
    expect(success).toHaveBeenCalledWith('binance');
  });

  it('history : une page Bybit en erreur (retCode) ne remet pas le backoff de la porte à 1 s', async () => {
    const { host, gate } = harness({ fetch: async () => ({ retCode: 10006, retMsg: 'Too many visits!' }) });
    const success = vi.spyOn(gate, 'onSuccess');
    gate.onHttpError('bybit', new VenueHttpError(429, 'HTTP 429 (api.bybit.com)')); // 1 s ; le backoff passe à 2 s
    vi.advanceTimersByTime(1_000);
    await expect(host.history({ series: 'bybit:ZIGUSDT', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'Too many visits!' });
    expect(success).not.toHaveBeenCalled();
    gate.onHttpError('bybit', new VenueHttpError(429, 'HTTP 429 (api.bybit.com)')); // pause suivante : toujours 2 s
    vi.advanceTimersByTime(1_999);
    expect(gate.allowed('bybit')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(gate.allowed('bybit')).toBe(true);
  });

  it('history : Coinbase 240 → quatre appels en séquence, puis des bougies 4 h regroupées depuis l’heure', async () => {
    const answers: (() => void)[] = [];
    const { host, fetchJson } = harness({
      fetch: (url) =>
        new Promise((resolve) => {
          answers.push(() => resolve(fakeCoinbase(url, Date.now() / 1000)));
        }),
    });
    const pending = host.history({ series: 'coinbase:BTC-USD', timeframe: 240 });
    for (let page = 1; page <= 4; page++) {
      expect(fetchJson, `page ${page}`).toHaveBeenCalledTimes(page); // une page à la fois
      nth(answers, page - 1)();
      await flush();
    }
    const bars = barsOf(await pending);
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual(historyRequests('coinbase:BTC-USD', 240, Date.now() / 1000).urls);
    // 4 pages × 300 heures = 1 200 heures, 300 bougies 4 h alignées sur l’epoch, la plus récente ouverte à 08:00 UTC.
    expect(bars).toHaveLength(300);
    expect(nth(bars, -1).time).toBe(sec('08:00:00'));
    bars.forEach((b, i) => {
      if (i > 0) expect(b.time - nth(bars, i - 1).time).toBe(4 * HOUR);
    });
    expect(bars.slice(0, -1).every((b) => b.volume === 4)).toBe(true); // quatre bougies 1 h chacune
    expect(nth(bars, -1).volume).toBe(3); // 08:00, 09:00 et 10:00 : la bougie entamée
    expect(nth(bars, -1)).toMatchObject({ open: sec('08:00:00'), close: sec('10:00:00'), low: sec('08:00:00') - 1, high: sec('10:00:00') + 1 });
  });

  it('history : porte fermée → rate_limited ; venue bloquée → blocked ; sans aucun appel', async () => {
    const { host, gate, fetchJson } = harness({ fetch: async () => BINANCE_ROWS });
    gate.onHttpError('coinbase', new VenueHttpError(429, 'HTTP 429 (api.exchange.coinbase.com)', 30));
    await expect(host.history({ series: 'coinbase:BTC-USD', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'rate_limited' });
    gate.onHttpError('bybit', new VenueHttpError(418, 'HTTP 418 (api.bybit.com)'));
    await expect(host.history({ series: 'bybit:ZIGUSDT', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'blocked' });
    expect(fetchJson).not.toHaveBeenCalled();
    await expect(host.history({ series: 'binance:ONEUSDT', timeframe: 60 })).resolves.toMatchObject({ ok: true });
  });

  it('history : aucune URL à interroger → no_history, sans appel', async () => {
    const { host, fetchJson } = harness({ fetch: async () => [] });
    await expect(host.history({ series: 'binance:ONEUSDT', timeframe: 30 as CryptoTimeframe })).resolves.toEqual({ ok: false, detail: 'no_history' });
    await expect(host.history({ series: 'kraken:BTC-USD' as CryptoSeriesId, timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'no_history' });
    const broken = harness({ fetch: async () => [], now: () => Number.NaN });
    await expect(broken.host.history({ series: 'coinbase:BTC-USD', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'no_history' });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(broken.fetchJson).not.toHaveBeenCalled();
  });

  it('history : une page illisible fait échouer la requête, avec un détail borné', async () => {
    const longRefusal = harness({ fetch: async () => ({ retCode: 10001, retMsg: `Not supported symbols ${'x'.repeat(500)}` }) });
    const refused = await longRefusal.host.history({ series: 'bybit:ZIGUSDT', timeframe: 60 });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.detail.startsWith('Not supported symbols')).toBe(true);
    expect(refused.detail.length).toBeLessThanOrEqual(200);
    for (const reply of ['texte', null, [], { retCode: 'x' }]) {
      const odd = harness({ fetch: async () => reply });
      await expect(odd.host.history({ series: 'bybit:ZIGUSDT', timeframe: 60 }), JSON.stringify(reply)).resolves.toMatchObject({ ok: false });
    }
  });

  it('history : 429 en cours de pagination → la porte se ferme, rate_limited, aucune page suivante', async () => {
    let calls = 0;
    const { host, gate, fetchJson } = harness({
      fetch: async (url) => {
        calls += 1;
        if (calls === 2) throw new VenueHttpError(429, 'HTTP 429 (api.binance.com)', 5);
        return fakeKlines(url, Date.now());
      },
    });
    await expect(host.history({ series: 'binance:ONEUSDT', timeframe: 1 })).resolves.toEqual({ ok: false, detail: 'rate_limited' });
    expect(fetchJson).toHaveBeenCalledTimes(2); // trois pages prévues
    expect(gate.allowed('binance')).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('history : 418 → la venue est coupée, REST et socket', async () => {
    const { host, gate, sockets, statuses } = harness({
      fetch: async () => {
        throw new VenueHttpError(418, 'HTTP 418 (api.binance.com)');
      },
    });
    host.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
    nth(sockets, 0).open();
    await expect(host.history({ series: 'binance:ONEUSDT', timeframe: 1 })).resolves.toEqual({ ok: false, detail: 'blocked' });
    expect(gate.blocked('binance')).toBe(true);
    expect(nth(sockets, 0).closed).toBe(true);
    expect(host.states().binance).toBe('blocked');
    expect(statesOf(statuses, 'binance')).toEqual(['connecting', 'live', 'blocked']);
    nth(sockets, 0).drop();
    vi.advanceTimersByTime(5 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it('history : une erreur de transport rend son message, borné et sans URL au-delà de l’hôte', async () => {
    const network = harness({
      fetch: async () => {
        throw new Error('Réseau indisponible (api.exchange.coinbase.com, ENOTFOUND)');
      },
    });
    await expect(network.host.history({ series: 'coinbase:BTC-USD', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'Réseau indisponible (api.exchange.coinbase.com, ENOTFOUND)' });
    const leaky = harness({
      fetch: async () => {
        throw new Error(`boom https://api.binance.com/api/v3/klines?symbol=ONEUSDT&signature=SECRET ${'y'.repeat(400)}`);
      },
    });
    const result = await leaky.host.history({ series: 'binance:ONEUSDT', timeframe: 60 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('api.binance.com');
    for (const leak of ['SECRET', 'signature', '?', 'https://', '/api/v3']) expect(result.detail).not.toContain(leak);
    expect(result.detail.length).toBeLessThanOrEqual(200);
    for (const line of leaky.logs) for (const leak of ['SECRET', 'signature']) expect(line).not.toContain(leak);
  });
});

describe('CryptoFeedHost · fenêtre gardée : par l’heure, jamais par le nombre', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1 m en pages : une bascule de minute pendant la pagination rend une bougie de plus, et 00:00 UTC de la veille reste', async () => {
    vi.setSystemTime(at('10:00:59'));
    const target = historyTarget(1, Date.now() / 1000);
    expect(target).toBe(2041);
    let calls = 0;
    const { host, fetchJson } = harness({
      fetch: async (url) => {
        calls += 1;
        if (calls === 2) vi.setSystemTime(at('10:01:00.500')); // la minute bascule entre deux pages
        return fakeKlines(url, Date.now());
      },
    });
    const bars = barsOf(await host.history({ series: 'binance:ONEUSDT', timeframe: 1 }));
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(bars).toHaveLength(target + 1);
    expect(nth(bars, 0).time).toBe(WINDOW_START);
    expect(nth(bars, -1).time).toBe(sec('10:01:00'));
    bars.forEach((b, i) => {
      if (i > 0) expect(b.time - nth(bars, i - 1).time).toBe(60);
    });
    // Couper par le nombre aurait perdu la bougie de 00:00 UTC de la veille.
    expect(nth(bars.slice(-target), 0).time).toBeGreaterThan(WINDOW_START);
  });

  it('1 m sur Bybit : même règle, pages par `start`', async () => {
    vi.setSystemTime(at('10:00:59'));
    let calls = 0;
    const { host } = harness({
      fetch: async (url) => {
        calls += 1;
        if (calls === 3) vi.setSystemTime(at('10:01:00.100'));
        return fakeKlines(url, Date.now());
      },
    });
    const bars = barsOf(await host.history({ series: 'bybit:ZIGUSDT', timeframe: 1 }));
    expect(nth(bars, 0).time).toBe(WINDOW_START);
    expect(nth(bars, -1).time).toBe(sec('10:01:00'));
  });

  it('5 m en un seul appel : la marge d’une bougie garde 00:00 UTC de la veille quand le seau bascule pendant l’appel', async () => {
    vi.setSystemTime(at('23:54:59'));
    const target = historyTarget(5, Date.now() / 1000);
    expect(target).toBe(575);
    const { host, fetchJson } = harness({
      fetch: async (url) => {
        vi.setSystemTime(at('23:55:00.200')); // la venue répond après la bascule du seau
        return fakeKlines(url, Date.now());
      },
    });
    const bars = barsOf(await host.history({ series: 'binance:ONEUSDT', timeframe: 5 }));
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([`https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=${target + 1}`]);
    expect(bars).toHaveLength(target + 1);
    expect(nth(bars, 0).time).toBe(WINDOW_START);
    expect(nth(bars, -1).time).toBe(sec('23:55:00'));
  });

  it('5 m à 17:39:59 (500 bougies pile depuis 00:00 UTC de la veille) : la marge joue déjà, 00:00 de la veille reste après une bascule', async () => {
    vi.setSystemTime(at('17:39:59'));
    expect(historyTarget(5, Date.now() / 1000)).toBe(HISTORY_BARS);
    const { host, fetchJson } = harness({
      fetch: async (url) => {
        vi.setSystemTime(at('17:40:00.200')); // la venue répond après la bascule du seau
        return fakeKlines(url, Date.now());
      },
    });
    const bars = barsOf(await host.history({ series: 'binance:ONEUSDT', timeframe: 5 }));
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=501']);
    expect(bars).toHaveLength(HISTORY_BARS + 1);
    expect(nth(bars, 0).time).toBe(WINDOW_START);
    expect(nth(bars, -1).time).toBe(sec('17:40:00'));
  });

  it('5 m sans bascule : la bougie de marge tombe avant la fenêtre, et la coupe par l’heure l’écarte', async () => {
    vi.setSystemTime(at('23:55:30'));
    const target = historyTarget(5, Date.now() / 1000);
    expect(target).toBe(576);
    const { host } = harness({ fetch: async (url) => fakeKlines(url, Date.now()) });
    const bars = barsOf(await host.history({ series: 'bybit:ZIGUSDT', timeframe: 5 }));
    expect(bars).toHaveLength(target);
    expect(nth(bars, 0).time).toBe(WINDOW_START);
    expect(nth(bars, -1).time).toBe(sec('23:55:00'));
  });

  it('au plancher de 500 : la fenêtre garde 500 bougies, les pages Coinbase en rendent davantage', async () => {
    vi.setSystemTime(at('10:00:20'));
    const { host, fetchJson } = harness({ fetch: async (url) => fakeCoinbase(url, Date.now() / 1000) });
    const bars = barsOf(await host.history({ series: 'coinbase:BTC-USD', timeframe: 60 }));
    expect(fetchJson).toHaveBeenCalledTimes(2); // 600 bougies reçues
    expect(bars).toHaveLength(HISTORY_BARS);
    expect(nth(bars, 0).time).toBe(sec('10:00:00') - (HISTORY_BARS - 1) * HOUR);
    expect(nth(bars, -1).time).toBe(sec('10:00:00'));
  });

  it('écarte une bougie à plus d’un seau en avance, garde celle du seau suivant', async () => {
    vi.setSystemTime(at('10:00:20'));
    const rows = [
      [sec('09:59:00') * 1000, '2', '10', '1', '5', '7', 0, '0', 0, '4'],
      [sec('10:00:00') * 1000, '2', '10', '1', '5', '7', 0, '0', 0, '4'],
      [sec('10:01:00') * 1000, '2', '10', '1', '5', '7', 0, '0', 0, '4'],
      [sec('10:02:00') * 1000, '2', '10', '1', '5', '7', 0, '0', 0, '4'],
      [Date.parse('2030-01-01T00:00:00Z'), '2', '10', '1', '5', '7', 0, '0', 0, '4'],
    ];
    const { host } = harness({ fetch: async () => rows });
    const bars = barsOf(await host.history({ series: 'binance:ONEUSDT', timeframe: 1 }));
    expect(bars.map((b) => b.time)).toEqual([sec('09:59:00'), sec('10:00:00'), sec('10:01:00')]);
  });
});

/** Le client `ws` derrière l’interface du module, comme le branchera CRY2.5. */
function realWs(url: string): WsLike {
  const socket = new WebSocket(url);
  const on = (event: string, cb: Listener): void => {
    socket.on(event, cb);
  };
  return { send: (data: string) => socket.send(data), ping: () => socket.ping(), close: () => socket.close(), on };
}

describe('intégration : un vrai serveur ws sur 127.0.0.1', () => {
  it('un ticker du serveur atteint emit ; la fermeture côté serveur déclenche une reconnexion avec réabonnement', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const connections: WebSocket[] = [];
    const received: string[][] = [];
    server.on('connection', (socket) => {
      const index = connections.push(socket) - 1;
      received[index] = [];
      socket.on('message', (data) => {
        received[index]?.push(String(data));
        socket.send(CB_SUBSCRIBED);
        socket.send(cbTicker('82595.17', Date.now()));
      });
    });
    const events: CryptoFeedEvent[] = [];
    const statuses: [CryptoVenue, VenueState][] = [];
    const host = new CryptoFeedHost({
      ws: realWs,
      hostOk: () => true, // permissif dans ce test seulement : l’URL est locale
      timers: { setTimeout, clearTimeout, setInterval, clearInterval },
      now: () => Date.now(),
      gate: new VenueGate(() => Date.now()),
      fetchJson: async () => Promise.reject(new Error('pas de REST ici')),
      emit: (event) => events.push(event),
      status: (venue, state) => statuses.push([venue, state]),
      log: () => undefined,
      urlFor: () => `ws://127.0.0.1:${port}`,
    });
    try {
      host.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 3_000 });
      expect(nth(events, 0)).toMatchObject({ kind: 'ticker', ticker: { market: 'coinbase:BTC-USD', last: 82595.17 } });
      expect(JSON.parse(nth(nth(received, 0), 0))).toEqual(CB_SUBSCRIBE_TICKER);
      nth(connections, 0).close(1001, 'maintenance');
      await vi.waitFor(() => expect(received[1]?.length ?? 0).toBeGreaterThan(0), { timeout: 4_000 });
      expect(connections).toHaveLength(2);
      expect(JSON.parse(nth(nth(received, 1), 0))).toEqual(CB_SUBSCRIBE_TICKER); // réabonnement après la reconnexion
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(1), { timeout: 2_000 });
      expect(statesOf(statuses, 'coinbase')).toEqual(['connecting', 'live', 'reconnecting', 'live']);
    } finally {
      host.closeAll();
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});

describe('module du process principal', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');
  const FILES = ['electron/crypto-feeds.ts', 'electron/crypto-socket.ts'];

  it('n’importe ni electron ni ws : la socket, les minuteurs, l’horloge, le fetch et la porte sont injectés', () => {
    for (const file of FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\s+['"](electron|ws)['"]/);
      expect(source, file).not.toMatch(/\brequire\s*\(/);
      expect(source, file).not.toMatch(/\bimport\s*\(/);
      expect(source, file).not.toMatch(/\bnew\s+WebSocket\b/);
      expect(source, file).not.toMatch(/(?<![.\w])(fetch|setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/);
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/);
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, file).toMatch(/^\.\/(crypto\/(markets|venues|tradeBars)|crypto-net|crypto-socket)$/);
    }
  });

  it('crypto-feeds expose ce que le plan produit, ManagedSocket compris', () => {
    const source = read('electron/crypto-feeds.ts');
    for (const name of ['WsLike', 'WsFactory', 'Timers', 'ManagedSocket', 'CryptoFeedHost', 'PING_EVERY_MS', 'STALE_AFTER_MS', 'BYBIT_PING_EVERY_MS', 'RECONNECT_MAX_MS']) {
      expect(source, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect([PING_EVERY_MS, STALE_AFTER_MS, BYBIT_PING_EVERY_MS, RECONNECT_MAX_MS]).toEqual([15_000, 30_000, 20_000, 60_000]);
  });

  it('electron/main.ts ne change pas : toujours aucun net.fetch', () => {
    expect(read('electron/main.ts').includes('net.fetch')).toBe(false);
  });
});
