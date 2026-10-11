import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

/** Le `net.fetch` d’Electron, simulé : le runtime le lie quand le test ne lui donne pas de `fetchImpl`. */
const electron = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: electron.fetch } }));

import type { BrowserWindow } from 'electron';
import type { CryptoBar, CryptoFeedEvent } from '@/engine/crypto/markets';
import { emptyReading, type TemperatureReading } from '@/engine/crypto/temperature';
import { FORCE_ORDER_URL, PREMIUM_INDEX_URL, TICKER_24H_URL, openInterestUrl } from '@/engine/crypto/venues';
import type { CryptoApi, CryptoMainStatus as DeskCryptoStatus } from '@/lib/desk';
import { createCryptoRuntime, cryptoWebSocket, type CryptoMainStatus, type CryptoRuntime } from '../electron/crypto-electron';
import { fakeFetch, fakeNet, jsonResponse, nth, settle, type FakeWs } from './helpers/cryptoFakes';

/** Un instant du 11 octobre 2026 (UTC) en millisecondes : `at('10:00:20')`. */
const at = (hms: string): number => Date.parse(`2026-10-11T${hms}Z`);
/** Le même instant en secondes, l’unité de `CryptoBar.time`. */
const sec = (hms: string): number => at(hms) / 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com';
const BINANCE_WS = 'wss://stream.binance.com:9443/ws';
const OFF_VENUES = { coinbase: 'off', binance: 'off', bybit: 'off' } as const;
const OFF: CryptoMainStatus = { enabled: false, venues: { ...OFF_VENUES } };
const ON: CryptoMainStatus = { enabled: true, venues: { ...OFF_VENUES } };
const BINANCE_BLOCKED = { coinbase: 'off', binance: 'blocked', bybit: 'off' } as const;

// Messages des venues, aux formes relevées en direct (CRY1.3).
const CB_SUBSCRIBED_MATCHES = '{"type":"subscriptions","channels":[{"name":"heartbeat","product_ids":["BTC-USD"],"account_ids":null},{"name":"matches","product_ids":["BTC-USD"],"account_ids":null}]}';
const cbTicker = (price: string, ms: number): string =>
  JSON.stringify({ type: 'ticker', sequence: 137481121996, product_id: 'BTC-USD', price, open_24h: '81100.00', side: 'sell', time: iso(ms), last_size: '0.001' });
/** Le maker vend : l’agresseur achète. */
const cbMatch = (price: string, size: string, ms: number): string =>
  JSON.stringify({ type: 'match', trade_id: 1104206116, side: 'sell', size, price, product_id: 'BTC-USD', sequence: 137481122465, time: iso(ms) });
const bnTicker = (close: string, E: number): string => JSON.stringify({ e: '24hrMiniTicker', E, s: 'ONEUSDT', c: close, o: '0.00223400', h: '0.00225300', l: '0.00200600', v: '1582084367.3', q: '3365266.96' });
/** Une bougie 1 min du flux `@kline_1m` de ONEUSDT ; `final` : elle est close. */
const bnKline1m = (t: number, close: string, final: boolean): string =>
  JSON.stringify({ e: 'kline', E: t + 1_000, s: 'ONEUSDT', k: { t, T: t + 59_999, s: 'ONEUSDT', i: '1m', o: '0.002142', c: close, h: '0.002217', l: '0.002139', v: '87072165.8', x: final, V: '46488643.3' } });
/** Une ligne de `/api/v3/klines` : ouverture, OHLC, volume, fermeture, volume en quote, trades, volume acheteur, quote acheteur. */
const bnKline = (open: number, close: string): unknown[] => [open, '0.002142', '0.002217', '0.002139', close, '87072165.8', open + 3_599_999, '187000.1', 1234, '46488643.3', '100000.2', '0'];
/** `premiumIndex` : deux perps USDT, funding 0,01 % et 0,005 %. */
const PREMIUM_REPLY = [
  { symbol: 'BTCUSDT', markPrice: '82625.70000000', lastFundingRate: '0.00010000', time: 1791539845000 },
  { symbol: 'ETHUSDT', markPrice: '2412.10000000', lastFundingRate: '0.00005000', time: 1791539845000 },
];

type Channel = 'crypto:event' | 'crypto:temperature' | 'crypto:status';

interface HarnessOptions {
  /** `userData/crypto.json` à `{ "enabled": true }` avant la création : le module était allumé au dernier lancement. */
  enabled?: boolean;
  /** Réponse du dialogue d’activation : 0 = Activer (par défaut), 1 = Annuler. */
  answer?: number;
  /** Réponse du faux exchange à chaque URL (une liste vide en JSON par défaut). */
  reply?: (url: string) => Response | Promise<Response>;
  /** Sans `fetchImpl` : le runtime lie `net.fetch`. */
  defaultFetch?: boolean;
  log?: (line: string) => void;
  send?: (channel: Channel, payload: unknown) => void;
}

function harness(opts: HarnessOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'canto-crypto-runtime-'));
  const file = path.join(dir, 'crypto.json');
  if (opts.enabled) writeFileSync(file, JSON.stringify({ enabled: true }));
  const { sockets, ws } = fakeNet();
  const fetch = fakeFetch(opts.reply);
  const sent: [Channel, unknown][] = [];
  const logs: string[] = [];
  /** L’heure de chaque envoi, dans l’ordre de `sent`. */
  const stamps: number[] = [];
  const dialogs = vi.fn(async () => ({ response: opts.answer ?? 0 }));
  const win = { isDestroyed: () => false } as unknown as BrowserWindow;
  const runtime = createCryptoRuntime({
    userDataDir: dir,
    locale: () => 'fr',
    window: () => win,
    showMessageBox: dialogs,
    send:
      opts.send ??
      ((channel, payload) => {
        sent.push([channel, payload]);
        stamps.push(Date.now());
      }),
    log: opts.log ?? ((line) => logs.push(line)),
    ws,
    fetchImpl: opts.defaultFetch ? undefined : fetch.fetchImpl,
  });
  const on = (channel: Channel): unknown[] => sent.filter(([c]) => c === channel).map(([, payload]) => payload);
  return {
    runtime,
    file,
    sockets,
    fetch,
    sent,
    logs,
    dialogs,
    statuses: () => on('crypto:status') as CryptoMainStatus[],
    events: () => on('crypto:event') as CryptoFeedEvent[],
    /** L’heure de chaque envoi de `crypto:event`. */
    eventTimes: (): number[] => stamps.filter((_, i) => sent[i]?.[0] === 'crypto:event'),
    readings: () => on('crypto:temperature') as TemperatureReading[],
    /** La dernière socket ouverte vers cette URL. */
    socket: (url: string): FakeWs => nth(sockets.filter((s) => s.url === url), -1),
  };
}

const switchFile = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

function idOf(result: { ok: true; subscriptionId: string } | { ok: false; detail: string }): string {
  if (!result.ok) throw new Error(`abonnement refusé : ${result.detail}`);
  return result.subscriptionId;
}

/** Une bougie BTC-USD 1 min de Coinbase, telle que `crypto:event` la porte. */
const cbBar = (hms: string, b: Omit<CryptoBar, 'time'>, final: boolean): CryptoFeedEvent => ({ kind: 'bar', series: 'coinbase:BTC-USD', timeframe: 1, bar: { time: sec(hms), ...b }, final });

describe('createCryptoRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:00:20'));
    electron.fetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('interrupteur', () => {
    it('éteint : history, subscribe et temperature refusent crypto_disabled, sans appel, sans socket ni minuteur', async () => {
      const h = harness();
      expect(h.runtime.enabled()).toBe(false);
      expect(h.runtime.status()).toEqual(OFF);
      await expect(h.runtime.history({ series: 'coinbase:BTC-USD', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'crypto_disabled' });
      expect(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' })).toEqual({ ok: false, detail: 'crypto_disabled' });
      expect(h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 })).toEqual({ ok: false, detail: 'crypto_disabled' });
      expect(h.runtime.temperature()).toBeNull();
      expect(h.runtime.unsubscribe('sub-1')).toEqual({ ok: false });
      // L’interrupteur répond avant la forme : même une requête illisible reçoit crypto_disabled.
      await expect(h.runtime.history('n’importe quoi')).resolves.toEqual({ ok: false, detail: 'crypto_disabled' });
      await settle();
      vi.advanceTimersByTime(10 * 60_000);
      expect(h.fetch.fetchImpl).not.toHaveBeenCalled();
      expect(electron.fetch).not.toHaveBeenCalled();
      expect(h.sockets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.dialogs).not.toHaveBeenCalled();
      expect(h.sent).toEqual([]);
    });

    it('dialogue accepté : crypto:status envoyé avec enabled: true, premiumIndex demandé, la lecture part au renderer', async () => {
      const h = harness({ answer: 0, reply: (url) => jsonResponse(url === PREMIUM_INDEX_URL ? PREMIUM_REPLY : []) });
      expect(await h.runtime.enable()).toEqual(ON);
      expect(h.dialogs).toHaveBeenCalledTimes(1);
      expect(h.runtime.enabled()).toBe(true);
      expect(switchFile(h.file)).toEqual({ enabled: true });
      expect(h.statuses()).toEqual([ON]);
      expect(h.fetch.urls()).toContain(PREMIUM_INDEX_URL);
      expect(h.sockets.map((s) => s.url)).toEqual([FORCE_ORDER_URL]);
      // La réponse passe par le fetch gardé, puis la lecture part sur crypto:temperature.
      await settle();
      const reading = nth(h.readings(), -1);
      expect(reading.funding).toMatchObject({ btc: 0.0001, symbols: 2, at: at('10:00:20') });
      expect(reading.funding?.median).toBeCloseTo(0.000075, 12);
      expect(h.runtime.temperature()).toEqual(reading);
    });

    it('dialogue annulé : le module reste éteint, sans appel ni socket ni minuteur', async () => {
      const h = harness({ answer: 1 });
      expect(await h.runtime.enable()).toEqual(OFF);
      expect(h.dialogs).toHaveBeenCalledTimes(1);
      expect(h.runtime.enabled()).toBe(false);
      expect(h.fetch.fetchImpl).not.toHaveBeenCalled();
      expect(h.sockets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.statuses().some((status) => status.enabled)).toBe(false);
    });

    it('crypto.json allumé au lancement : les relevés partent sans dialogue, et un premier crypto:status', () => {
      const h = harness({ enabled: true });
      expect(h.dialogs).not.toHaveBeenCalled();
      expect(h.runtime.enabled()).toBe(true);
      expect([...h.fetch.urls()].sort()).toEqual([PREMIUM_INDEX_URL, TICKER_24H_URL, openInterestUrl('BTCUSDT'), openInterestUrl('ETHUSDT')].sort());
      expect(h.sockets.map((s) => s.url)).toEqual([FORCE_ORDER_URL]);
      expect(h.statuses()).toEqual([ON]);
      expect(h.runtime.temperature()).toEqual(emptyReading(at('10:00:20')));
    });

    it('disable() : plus aucune socket ni aucun minuteur, rien ne repart, plus rien d’autre que l’état n’est envoyé', async () => {
      const h = harness({ enabled: true });
      expect(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }).ok).toBe(true);
      expect(h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 }).ok).toBe(true);
      expect(h.runtime.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' }).ok).toBe(true);
      const coinbase = h.socket(COINBASE_WS);
      coinbase.open();
      coinbase.message(cbTicker('82500.00', Date.now()));
      coinbase.message(cbTicker('82501.00', Date.now())); // attend l’échéance de son intervalle
      h.socket(BINANCE_WS).open();
      h.socket(BINANCE_WS).drop(); // Binance attend sa nouvelle tentative ; Bybit est encore en connexion
      expect(h.events()).toHaveLength(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const sentBefore = h.sent.length;

      expect(h.runtime.disable()).toEqual(OFF);
      expect(h.runtime.enabled()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.sockets.every((s) => s.gone)).toBe(true);
      expect(switchFile(h.file)).toEqual({ enabled: false });
      expect(nth(h.statuses(), -1)).toEqual(OFF);
      expect(h.runtime.temperature()).toBeNull();

      // Les faux serveurs répondent en retard puis ferment : rien ne repart, rien d’autre que l’état n’est envoyé.
      const count = h.sockets.length;
      const fetches = h.fetch.fetchImpl.mock.calls.length;
      for (const socket of h.sockets) {
        socket.message(cbTicker('82600.00', Date.now()));
        socket.emit('error', new Error('reset'));
        socket.drop();
      }
      await settle();
      vi.advanceTimersByTime(10 * 60_000);
      expect(h.sockets).toHaveLength(count);
      expect(h.fetch.fetchImpl.mock.calls.length).toBe(fetches);
      expect(h.sent.slice(sentBefore).every(([channel]) => channel === 'crypto:status')).toBe(true);
      expect(h.events()).toHaveLength(1); // le ticker qui attendait son intervalle ne part pas
      expect(vi.getTimerCount()).toBe(0);
    });

    it('disable() va jusqu’au bout quand le journal lève : rien ne reste ouvert', () => {
      const h = harness({
        enabled: true,
        log: () => {
          throw new Error('disque plein');
        },
      });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      h.socket(COINBASE_WS).open();
      let status: CryptoMainStatus | undefined;
      expect(() => {
        status = h.runtime.disable(); // l’interrupteur journalise « crypto désactivé » : le journal lève
      }).not.toThrow();
      expect(status).toEqual(OFF);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.sockets.every((s) => s.gone)).toBe(true);
      expect(switchFile(h.file)).toEqual({ enabled: false });
    });

    it('418 de Binance : disable() puis enable() → la venue reste blocked, sans appel ni socket vers elle', async () => {
      const h = harness({ enabled: true, reply: (url) => (url === PREMIUM_INDEX_URL ? new Response(null, { status: 418 }) : jsonResponse([])) });
      await settle();
      expect(h.runtime.status()).toEqual({ enabled: true, venues: BINANCE_BLOCKED });
      // Le voyant suit aussitôt, même quand le 418 vient d’un relevé de température.
      expect(nth(h.statuses(), -1)).toEqual({ enabled: true, venues: BINANCE_BLOCKED });
      expect(h.socket(FORCE_ORDER_URL).gone).toBe(true);

      expect(h.runtime.disable()).toEqual({ enabled: false, venues: BINANCE_BLOCKED });
      const fetches = h.fetch.fetchImpl.mock.calls.length;
      const sockets = h.sockets.length;
      expect(await h.runtime.enable()).toEqual({ enabled: true, venues: BINANCE_BLOCKED });
      expect(h.dialogs).toHaveBeenCalledTimes(1);
      await settle();
      vi.advanceTimersByTime(10 * 60_000);
      // Jusqu’au redémarrage du desk : ni relevé, ni socket des liquidations, ni flux, ni historique chez Binance.
      expect(h.fetch.fetchImpl.mock.calls.length).toBe(fetches);
      expect(h.sockets).toHaveLength(sockets);
      expect(h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' }).ok).toBe(true);
      expect(h.sockets).toHaveLength(sockets);
      await expect(h.runtime.history({ series: 'binance:ONEUSDT', timeframe: 60 })).resolves.toEqual({ ok: false, detail: 'blocked' });
      expect(h.runtime.status().venues).toEqual(BINANCE_BLOCKED);
      // Les autres venues ne sont pas touchées.
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      expect(h.runtime.status().venues).toEqual({ coinbase: 'connecting', binance: 'blocked', bybit: 'off' });
    });

    it('shutdown() : tout se ferme sans toucher l’interrupteur ; la lecture suivante de temperature() relance les relevés', () => {
      const h = harness({ enabled: true });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      h.socket(COINBASE_WS).open();
      h.runtime.shutdown();
      expect(vi.getTimerCount()).toBe(0);
      expect(h.sockets.every((s) => s.gone)).toBe(true);
      expect(h.runtime.enabled()).toBe(true);
      expect(switchFile(h.file)).toEqual({ enabled: true });
      expect(h.runtime.status()).toEqual(ON);
      vi.advanceTimersByTime(10 * 60_000);
      expect(h.sockets).toHaveLength(2);
      h.fetch.fetchImpl.mockClear();

      // macOS garde le process et recrée la fenêtre : la première lecture du renderer relance la température.
      expect(h.runtime.temperature()).toEqual(emptyReading(Date.now()));
      expect(h.fetch.urls()).toContain(PREMIUM_INDEX_URL);
      expect(h.sockets.slice(2).map((s) => s.url)).toEqual([FORCE_ORDER_URL]);
      expect(h.dialogs).not.toHaveBeenCalled();
    });

    it('shutdown() : un abonnement suivant relance aussi les relevés, une seule fois', () => {
      const h = harness({ enabled: true });
      h.runtime.shutdown();
      h.fetch.fetchImpl.mockClear();
      expect(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }).ok).toBe(true);
      expect(h.fetch.urls().filter((url) => url === PREMIUM_INDEX_URL)).toHaveLength(1);
      expect(h.runtime.temperature()).not.toBeNull();
      expect(h.runtime.subscribe({ series: 'bybit:ZIGUSDT', kind: 'ticker' }).ok).toBe(true);
      expect(h.fetch.urls().filter((url) => url === PREMIUM_INDEX_URL)).toHaveLength(1);
      expect(h.sockets.filter((s) => s.url === FORCE_ORDER_URL)).toHaveLength(2);
    });

    it('crypto:status suit chaque changement d’état d’une venue ou de l’interrupteur, sans doublon', async () => {
      const h = harness({ enabled: true });
      const id = idOf(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }));
      h.socket(COINBASE_WS).open();
      h.socket(COINBASE_WS).drop();
      vi.advanceTimersByTime(1_000);
      h.socket(COINBASE_WS).open();
      expect(h.runtime.unsubscribe(id)).toEqual({ ok: true });
      expect(h.statuses().map((status) => status.venues.coinbase)).toEqual(['off', 'connecting', 'live', 'reconnecting', 'live', 'off']);
      expect(h.statuses().every((status) => status.enabled && status.venues.binance === 'off' && status.venues.bybit === 'off')).toBe(true);
      // Déjà allumé : ni dialogue ni nouvel envoi. L’extinction part une fois, une seconde extinction ne renvoie rien.
      expect(await h.runtime.enable()).toEqual(ON);
      expect(h.dialogs).not.toHaveBeenCalled();
      expect(h.statuses()).toHaveLength(6);
      h.runtime.disable();
      h.runtime.disable();
      expect(h.statuses().slice(6)).toEqual([OFF]);
    });

    it('une venue est blocked dès que la porte la coupe, même quand sa socket de flux est encore ouverte', async () => {
      let answer: (res: Response) => void = () => undefined;
      const h = harness({
        enabled: true,
        reply: (url) =>
          url === PREMIUM_INDEX_URL
            ? new Promise<Response>((resolve) => {
                answer = resolve;
              })
            : jsonResponse([]),
      });
      h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
      h.socket(BINANCE_WS).open();
      expect(h.runtime.status().venues.binance).toBe('live');
      answer(new Response(null, { status: 418 })); // le relevé de funding revient en 418
      await settle();
      expect(h.runtime.status()).toEqual({ enabled: true, venues: BINANCE_BLOCKED });
      expect(nth(h.statuses(), -1)).toEqual({ enabled: true, venues: BINANCE_BLOCKED });
    });
  });

  describe('requêtes', () => {
    it('mal formées : invalid_request, sans socket, sans appel, sans relancer la température', async () => {
      const h = harness({ enabled: true });
      h.runtime.shutdown();
      h.fetch.fetchImpl.mockClear();
      const sockets = h.sockets.length;
      const invalid = { ok: false, detail: 'invalid_request' };
      expect(h.runtime.subscribe({ series: 'binance:BTCUSDT', kind: 'ticker' })).toEqual(invalid); // une source du CVD n’a pas de ticker
      expect(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars' })).toEqual(invalid);
      expect(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 30 })).toEqual(invalid);
      expect(h.runtime.subscribe({ series: 'kraken:BTC-USD', kind: 'ticker' })).toEqual(invalid);
      expect(h.runtime.subscribe(null)).toEqual(invalid);
      await expect(h.runtime.history({ series: 'coinbase:BTC-USD', timeframe: 30 })).resolves.toEqual(invalid);
      await expect(h.runtime.history({ series: 'coinbase:BTC-USD' })).resolves.toEqual(invalid);
      expect(h.runtime.unsubscribe('x'.repeat(65))).toEqual({ ok: false });
      expect(h.runtime.unsubscribe(42)).toEqual({ ok: false });
      expect(h.runtime.unsubscribe('sub-999')).toEqual({ ok: false });
      expect(h.sockets).toHaveLength(sockets);
      expect(h.fetch.fetchImpl).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('history passe par le fetch gardé (en-tête du desk, sans redirection ni cookie) et rend les bougies de la venue', async () => {
      const h = harness({
        enabled: true,
        reply: (url) => jsonResponse(url.startsWith('https://api.binance.com/api/v3/klines?') ? [bnKline(at('08:00:00'), '0.002150'), bnKline(at('09:00:00'), '0.002160'), bnKline(at('10:00:00'), '0.002170')] : []),
      });
      const result = await h.runtime.history({ series: 'binance:ONEUSDT', timeframe: 60 });
      if (!result.ok) throw new Error(result.detail);
      expect(result.bars.map((bar) => bar.time)).toEqual([sec('08:00:00'), sec('09:00:00'), sec('10:00:00')]);
      expect(nth(result.bars, -1)).toMatchObject({ close: 0.00217, volume: 87072165.8, buyVolume: 46488643.3 });
      const [url, init] = nth(
        h.fetch.fetchImpl.mock.calls.filter(([called]) => called.includes('/klines?')),
        0,
      );
      expect(new URL(url).host).toBe('api.binance.com');
      expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': 'CANTO-Desk (crypto)' } });
    });

    it('unsubscribe : un identifiant rendu par subscribe se retire une fois ; la socket sans flux ferme par close()', () => {
      const h = harness({ enabled: true });
      const id = idOf(h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' }));
      expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
      h.socket(COINBASE_WS).open();
      expect(h.runtime.unsubscribe(id)).toEqual({ ok: true });
      expect(h.runtime.unsubscribe(id)).toEqual({ ok: false });
      expect(h.socket(COINBASE_WS)).toMatchObject({ closed: true, terminated: false });
    });
  });

  describe('cadence de crypto:event', () => {
    /** Un abonnement BTC-USD 1 min sur une socket Coinbase ouverte et accusée à 10:00:20 (le seau de 10:00 reste incomplet). */
    function barsOpen() {
      const h = harness({ enabled: true });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 1 });
      const socket = h.socket(COINBASE_WS);
      socket.open();
      socket.message(CB_SUBSCRIBED_MATCHES);
      return { h, socket };
    }

    /** 50 trades du seau de 10:00 en 100 ms, de 82 500 à 82 549, d’une unité chacun. */
    function fiftyTrades(socket: FakeWs): void {
      for (let i = 0; i < 50; i++) {
        socket.message(cbMatch(String(82_500 + i), '1', Date.now()));
        vi.advanceTimersByTime(2);
      }
    }

    const FIRST = cbBar('10:00:00', { open: 82_500, high: 82_500, low: 82_500, close: 82_500, volume: 1 }, false);
    const FIFTY = { open: 82_500, high: 82_549, low: 82_500, close: 82_549, volume: 50 };

    it('50 trades en 100 ms : au plus un envoi bar, puis la finale, que la bougie suivante n’écrase pas', () => {
      const { h, socket } = barsOpen();
      fiftyTrades(socket);
      expect(Date.now()).toBe(at('10:00:20.100'));
      expect(h.events()).toEqual([FIRST]);
      // Le premier trade de la minute suivante clôt la bougie de 10:00 : la finale part aussitôt, avec ses 50 trades.
      socket.message(cbMatch('82600', '2', at('10:01:00')));
      const closed = cbBar('10:00:00', FIFTY, true);
      expect(h.events()).toEqual([FIRST, closed]);
      // La bougie de 10:01 attend l’échéance de l’intervalle (10:00:20.250) ; elle part après la finale, sans l’écraser.
      vi.advanceTimersByTime(149);
      expect(h.events()).toEqual([FIRST, closed]);
      vi.advanceTimersByTime(1);
      expect(h.events()).toEqual([FIRST, closed, cbBar('10:01:00', { open: 82_600, high: 82_600, low: 82_600, close: 82_600, volume: 2, buyVolume: 2 }, false)]);
      vi.advanceTimersByTime(10_000);
      expect(h.events()).toHaveLength(3);
    });

    it('le dernier gagne : à l’échéance de l’intervalle, une seule bougie part, celle du dernier trade ; puis l’envoi redevient immédiat', () => {
      const { h, socket } = barsOpen();
      fiftyTrades(socket);
      expect(h.events()).toEqual([FIRST]);
      vi.advanceTimersByTime(149);
      expect(h.events()).toEqual([FIRST]);
      vi.advanceTimersByTime(1);
      expect(h.events()).toEqual([FIRST, cbBar('10:00:00', FIFTY, false)]);
      vi.advanceTimersByTime(10_000);
      expect(h.events()).toHaveLength(2);
      socket.message(cbMatch('82400', '1', Date.now()));
      expect(h.events()).toEqual([FIRST, cbBar('10:00:00', FIFTY, false), cbBar('10:00:00', { ...FIFTY, low: 82_400, close: 82_400, volume: 51 }, false)]);
    });

    it('flux continu (un trade toutes les 2 ms pendant 1 s) : jamais deux envois à moins de 250 ms, le dernier état part toujours', () => {
      const { h, socket } = barsOpen();
      for (let i = 0; i < 500; i++) {
        socket.message(cbMatch(String(82_000 + i), '1', Date.now()));
        vi.advanceTimersByTime(2);
      }
      vi.advanceTimersByTime(10_000);
      // Le premier part aussitôt, puis un envoi à chaque échéance ; le dernier trade (à 10:00:20.998) part à 10:00:21.
      expect(h.eventTimes()).toEqual([at('10:00:20'), at('10:00:20.250'), at('10:00:20.500'), at('10:00:20.750'), at('10:00:21')]);
      expect(nth(h.events(), -1)).toEqual(cbBar('10:00:00', { open: 82_000, high: 82_499, low: 82_000, close: 82_499, volume: 500 }, false));
    });

    it('deux timeframes d’une même série ont chacun leur cadence : un trade envoie aussitôt la bougie de chacun', () => {
      const { h, socket } = barsOpen();
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 5 }); // clés déjà actives : sa première trame le confirme
      socket.message(cbMatch('82500', '1', Date.now()));
      expect(h.events().map((e) => (e.kind === 'bar' ? e.timeframe : null))).toEqual([1, 5]);
    });

    it('bougie Binance close : elle part aussitôt et remplace la version partielle qui attendait, qui ne part plus ensuite', () => {
      const h = harness({ enabled: true });
      h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 });
      const binance = h.socket(BINANCE_WS);
      binance.open();
      const t = at('10:00:00');
      binance.message(bnKline1m(t, '0.002150', false));
      vi.advanceTimersByTime(100);
      binance.message(bnKline1m(t, '0.002160', false)); // attend l’échéance de l’intervalle
      vi.advanceTimersByTime(50);
      binance.message(bnKline1m(t, '0.002170', true));
      const closes = (): [number, boolean][] => h.events().flatMap((e): [number, boolean][] => (e.kind === 'bar' ? [[e.bar.close, e.final]] : []));
      expect(closes()).toEqual([
        [0.00215, false],
        [0.00217, true],
      ]);
      vi.advanceTimersByTime(10_000);
      expect(closes()).toEqual([
        [0.00215, false],
        [0.00217, true],
      ]);
    });

    it('tickers : au plus un par marché toutes les 250 ms, le dernier gagne ; chaque marché a sa propre cadence', () => {
      const h = harness({ enabled: true });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
      const coinbase = h.socket(COINBASE_WS);
      const binance = h.socket(BINANCE_WS);
      coinbase.open();
      binance.open();
      for (let i = 0; i < 50; i++) {
        coinbase.message(cbTicker(String(82_500 + i), Date.now()));
        if (i === 25) binance.message(bnTicker('0.00216300', Date.now()));
        vi.advanceTimersByTime(2);
      }
      const lasts = (): [string, number][] => h.events().flatMap((e): [string, number][] => (e.kind === 'ticker' ? [[e.ticker.market, e.ticker.last]] : []));
      expect(lasts()).toEqual([
        ['coinbase:BTC-USD', 82_500],
        ['binance:ONEUSDT', 0.002163],
      ]);
      vi.advanceTimersByTime(150);
      expect(lasts()).toEqual([
        ['coinbase:BTC-USD', 82_500],
        ['binance:ONEUSDT', 0.002163],
        ['coinbase:BTC-USD', 82_549],
      ]);
      vi.advanceTimersByTime(10_000);
      expect(h.events()).toHaveLength(3);
    });
  });

  describe('journal, envois et sockets', () => {
    it('les lignes de la température, socket des liquidations comprise, portent « température · » ; celles des flux non', async () => {
      const h = harness({ enabled: true, reply: () => new Response(null, { status: 503 }) });
      await settle();
      expect(h.logs).toContain('température · crypto binance: température premiumIndex indisponible · HTTP 503 (fapi.binance.com)');
      const liquidations = h.socket(FORCE_ORDER_URL);
      liquidations.open();
      liquidations.drop();
      h.runtime.subscribe({ series: 'binance:ONEUSDT', kind: 'ticker' });
      const spot = h.socket(BINANCE_WS);
      spot.open();
      spot.drop();
      expect(h.logs.filter((line) => line.includes('connexion perdue'))).toEqual([
        'température · crypto binance: connexion perdue (fermée par la venue (code 1006)) ; nouvel essai dans 1 s',
        'crypto binance: connexion perdue (fermée par la venue (code 1006)) ; nouvel essai dans 1 s',
      ]);
    });

    it('un envoi qui lève (fenêtre détruite) est journalisé une fois ; le module continue et s’éteint sans lever', () => {
      const h = harness({
        enabled: true,
        send: () => {
          throw new Error('Object has been destroyed');
        },
      });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      const coinbase = h.socket(COINBASE_WS);
      coinbase.open();
      for (let i = 0; i < 3; i++) {
        coinbase.message(cbTicker(String(82_500 + i), Date.now()));
        vi.advanceTimersByTime(300);
      }
      expect(h.logs.filter((line) => line.includes('non transmis'))).toHaveLength(1);
      expect(h.runtime.status().venues.coinbase).toBe('live');
      expect(() => h.runtime.disable()).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('une socket jugée morte (30 s sans activité) est coupée par terminate() ; une socket qu’on ferme l’est par close()', () => {
      const h = harness({ enabled: true });
      h.runtime.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
      const first = h.socket(COINBASE_WS);
      first.open();
      vi.advanceTimersByTime(30_000);
      expect(first).toMatchObject({ terminated: true, closed: false });
      expect(h.runtime.status().venues.coinbase).toBe('reconnecting');
      vi.advanceTimersByTime(1_000);
      const second = h.socket(COINBASE_WS);
      expect(second).not.toBe(first);
      second.open();
      h.runtime.disable();
      expect(second).toMatchObject({ closed: true, terminated: false });
    });

    it('sans fetchImpl, les relevés partent par net.fetch d’Electron, à travers le fetch gardé', async () => {
      electron.fetch.mockImplementation(async () => new Response(null, { status: 503 }));
      const h = harness({ enabled: true, defaultFetch: true });
      expect(electron.fetch).toHaveBeenCalledWith(PREMIUM_INDEX_URL, expect.objectContaining({ redirect: 'manual', credentials: 'omit' }));
      expect(h.fetch.fetchImpl).not.toHaveBeenCalled();
      await settle();
      expect(h.logs).toContain('température · crypto binance: température premiumIndex indisponible · HTTP 503 (fapi.binance.com)');
    });
  });
});

describe('cryptoWebSocket : le client ws réel, contre un serveur local', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  async function wsServer(options: ConstructorParameters<typeof WebSocketServer>[0] = {}): Promise<{ server: WebSocketServer; url: string }> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, ...options });
    await once(server, 'listening');
    closers.push(async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return { server, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/` };
  }

  async function httpServer(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    closers.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return { server, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/` };
  }

  it('envoie l’en-tête du desk, ne propose aucune compression, et expose terminate()', async () => {
    const { server, url } = await wsServer({ perMessageDeflate: true });
    const headers = new Promise<IncomingHttpHeaders>((resolve) => server.once('connection', (_socket, req) => resolve(req.headers)));
    const socket = cryptoWebSocket(url);
    socket.on('error', () => undefined);
    const opened = new Promise<void>((resolve) => socket.on('open', () => resolve()));
    const seen = await headers;
    await opened;
    expect(seen['user-agent']).toBe('CANTO-Desk (crypto)');
    expect(seen['sec-websocket-extensions']).toBeUndefined();
    expect(typeof socket.terminate).toBe('function');
    const closed = new Promise<unknown>((resolve) => socket.on('close', (...args: unknown[]) => resolve(args[0])));
    socket.terminate?.();
    expect(await closed).toBe(1006);
  });

  it('ne suit pas une redirection : la 302 reste une unexpected-response, et la cible ne reçoit rien', async () => {
    const target = await wsServer();
    let reached = 0;
    target.server.on('connection', () => {
      reached += 1;
    });
    const { url } = await httpServer((_req, res) => {
      res.writeHead(302, { Location: target.url });
      res.end();
    });
    const socket = cryptoWebSocket(url);
    socket.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => socket.on('unexpected-response', (_req, res) => resolve(res.statusCode)));
    expect(status).toBe(302);
    socket.close(); // ce que fait ManagedSocket : la poignée de main est abandonnée
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reached).toBe(0);
  });

  it('borne une trame à 1 Mio : 1 Mio passe, une trame plus lourde coupe la socket (1009) sans être lue', async () => {
    const { server, url } = await wsServer();
    const serverClose = new Promise<number>((resolve) =>
      server.once('connection', (peer) => {
        peer.on('close', (code) => resolve(code));
        peer.send(Buffer.alloc(1024 * 1024, 0x61));
        peer.send(Buffer.alloc(1024 * 1024 + 1, 0x61));
      }),
    );
    const socket = cryptoWebSocket(url);
    const sizes: number[] = [];
    const errors: unknown[] = [];
    socket.on('message', (data) => sizes.push((data as Buffer).byteLength));
    socket.on('error', (error) => errors.push(error));
    expect(await serverClose).toBe(1009);
    expect(sizes).toEqual([1024 * 1024]);
    expect(errors).toEqual([expect.objectContaining({ code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' })]);
  });
});

describe('branchement dans le process principal', () => {
  const read = (file: string): string => readFileSync(file, 'utf8');
  const CHANNELS = ['status', 'enable', 'disable', 'history', 'subscribe', 'unsubscribe', 'temperature'];

  it('electron/main.ts : sept ipcMain.handle crypto:, chacun derrière trusted(e) et le runtime, avec un repli ; toujours aucun net.fetch', () => {
    const main = read('electron/main.ts');
    const handlers = [...main.matchAll(/ipcMain\.(\w+)\('crypto:([a-z-]+)'/g)];
    expect(handlers.map((m) => m[2])).toEqual(CHANNELS);
    for (const handler of handlers) {
      expect(handler[1], handler[2]).toBe('handle');
      const start = handler.index ?? 0;
      const next = main.indexOf('ipcMain.', start + 1);
      const body = main.slice(start, next < 0 ? undefined : next);
      expect(body, handler[2]).toMatch(/^ipcMain\.handle\('crypto:[a-z-]+', \(e(, \w+: unknown)?\) => \(trusted\(e\) && cryptoRuntime \? cryptoRuntime\.\w+\(\w*\) : [^)]/);
    }
    expect(main.includes('net.fetch')).toBe(false);
  });

  it('electron/main.ts : le runtime naît dans app.whenReady ; la fermeture de la dernière fenêtre le coupe', () => {
    const main = read('electron/main.ts');
    expect(main).toContain('let cryptoRuntime: CryptoRuntime | null = null;');
    const ready = main.slice(main.indexOf('app.whenReady()'), main.indexOf("app.on('window-all-closed'"));
    expect(ready).toContain('cryptoRuntime = createCryptoRuntime({');
    const closed = main.slice(main.indexOf("app.on('window-all-closed'"), main.indexOf("app.on('will-quit'"));
    expect(closed).toContain('cryptoRuntime?.shutdown();');
  });

  it('electron/preload.ts : window.canto.crypto expose les dix méthodes, chacune sur son canal', () => {
    const preload = read('electron/preload.ts');
    const block = preload.slice(preload.indexOf('  crypto: {'), preload.indexOf('\n  },', preload.indexOf('  crypto: {')));
    for (const channel of CHANNELS) expect(block, channel).toMatch(new RegExp(`\\n    ${channel}: \\([^\\n]*ipcRenderer\\.invoke\\('crypto:${channel}'`));
    for (const [name, channel] of [
      ['onEvent', 'event'],
      ['onTemperature', 'temperature'],
      ['onStatus', 'status'],
    ]) {
      expect(block, name).toMatch(new RegExp(`\\n    ${name}: \\(cb[^\\n]*subscribe\\('crypto:${channel}', cb\\)`));
    }
  });

  it('crypto-electron.ts est le seul fichier crypto du process principal qui importe electron ou ws', () => {
    const files = readdirSync('electron').filter((name) => /^crypto-.*\.ts$/.test(name));
    expect(files).toEqual(expect.arrayContaining(['crypto-electron.ts', 'crypto-ipc.ts', 'crypto-feeds.ts', 'crypto-socket.ts', 'crypto-net.ts', 'crypto-switch.ts', 'crypto-temperature.ts']));
    for (const name of files) {
      const source = read(`electron/${name}`);
      expect(/\bfrom\s+['"](electron|ws)['"]/.test(source), name).toBe(name === 'crypto-electron.ts');
    }
  });

  it('les types du renderer sont ceux du main et du moteur (R7)', () => {
    expectTypeOf<DeskCryptoStatus>().toEqualTypeOf<CryptoMainStatus>();
    expectTypeOf<Awaited<ReturnType<CryptoApi['history']>>>().toEqualTypeOf<Awaited<ReturnType<CryptoRuntime['history']>>>();
    expectTypeOf<Awaited<ReturnType<CryptoApi['subscribe']>>>().toEqualTypeOf<ReturnType<CryptoRuntime['subscribe']>>();
    expectTypeOf<Awaited<ReturnType<CryptoApi['unsubscribe']>>>().toEqualTypeOf<ReturnType<CryptoRuntime['unsubscribe']>>();
    expectTypeOf<Awaited<ReturnType<CryptoApi['temperature']>>>().toEqualTypeOf<TemperatureReading | null>();
    expectTypeOf<Parameters<Parameters<CryptoApi['onEvent']>[0]>[0]>().toEqualTypeOf<CryptoFeedEvent>();
    expectTypeOf<Parameters<Parameters<CryptoApi['onTemperature']>[0]>[0]>().toEqualTypeOf<TemperatureReading>();
    const desk = read('src/lib/desk.ts');
    expect(desk).toMatch(/import type \{[^}]*\bVenueState\b[^}]*\} from '@\/engine\/crypto\/markets';/);
    expect(desk).toMatch(/import type \{[^}]*\bTemperatureReading\b[^}]*\} from '@\/engine\/crypto\/temperature';/);
    expect(desk).not.toContain("'reconnecting'");
  });
});
