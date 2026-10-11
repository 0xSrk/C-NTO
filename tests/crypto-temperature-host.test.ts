import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cryptoHostAllowed } from '@/engine/crypto/markets';
import { emptyReading, type TemperatureReading } from '@/engine/crypto/temperature';
import { FORCE_ORDER_URL, PREMIUM_INDEX_URL, TICKER_24H_URL, openInterestUrl } from '@/engine/crypto/venues';
import { VenueGate, VenueHttpError } from '../electron/crypto-net';
import type { Timers, WsFactory, WsLike } from '../electron/crypto-socket';
import { TemperatureHost } from '../electron/crypto-temperature';

const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
/** Un instant du 11 octobre 2026 (UTC) en millisecondes : `at('13:30:00')`. */
const at = (hms: string): number => Date.parse(`2026-10-11T${hms}Z`);
const START = at('13:30:00');
const BTC_OI_URL = openInterestUrl('BTCUSDT');
const ETH_OI_URL = openInterestUrl('ETHUSDT');
const ALL_URLS = [PREMIUM_INDEX_URL, TICKER_24H_URL, BTC_OI_URL, ETH_OI_URL];

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}

function some<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} : rien`);
  return value;
}

/** Un écouteur de la fausse socket : `any` pour couvrir chaque surcharge de `WsLike.on`. */
type Listener = (...args: any[]) => void;

/** Fausse socket : le « serveur » du test pousse ses événements par `emit`. */
class FakeWs implements WsLike {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {}

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

  message(raw: string): void {
    this.emit('message', raw);
  }

  /** La venue ferme la connexion (ws : `close` avec un code). */
  drop(code = 1006): void {
    this.emit('close', code, Buffer.from(''));
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

/** Laisse filer les promesses en cours : une réponse reçue, fusionnée, émise. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Les formes relevées chez Binance (le 9 et le 11 octobre 2026) ; seuls les champs lus par le moteur comptent.

function premium(symbol: string, lastFundingRate: unknown): Record<string, unknown> {
  return {
    symbol,
    markPrice: '82625.70000000',
    indexPrice: '82660.40565217',
    estimatedSettlePrice: '82635.31882983',
    lastFundingRate,
    interestRate: '0.00010000',
    nextFundingTime: 1791561600000,
    time: 1791539845000,
  };
}

function ticker(symbol: string, priceChangePercent: string, count: number): Record<string, unknown> {
  return { symbol, priceChange: '-0.00007100', priceChangePercent, weightedAvgPrice: '0.00218000', lastPrice: '0.00216300', count };
}

/** 25 points horaires de `first` à `last`, ce que rend `openInterestHist` (`period=1h`, `limit=25`). */
function oiSeries(symbol: string, first: number, last: number): Record<string, unknown>[] {
  return Array.from({ length: 25 }, (_, i) => ({
    symbol,
    sumOpenInterest: (first + ((last - first) * i) / 24).toFixed(3),
    sumOpenInterestValue: '6712345678.9',
    timestamp: 1791637200000 + i * HOUR,
  }));
}

/** Funding : −0,005 %, 0,002929 %, 0,0075 %, 0,01 % (USDT) → médiane 0,0052145 % ; BTCUSDC et le contrat à livraison sont écartés. */
const PREMIUM_REPLY = [
  premium('BTCUSDT', '0.00002929'),
  premium('ETHUSDT', '0.00010000'),
  premium('SOLUSDT', '-0.00005000'),
  premium('ONEUSDT', '0.00007500'),
  premium('BTCUSDC', '0.00005000'),
  premium('BTCUSDT_261225', ''),
];
/** Largeur : BTC et ETH montent, ONE baisse, USDC est plat (4 paires, 2 en hausse) ; LUNA n'a pas un trade, ETHBTC n'est pas en USDT. */
const TICKER_REPLY = [
  ticker('BTCUSDT', '1.204', 912345),
  ticker('ETHUSDT', '0.412', 701234),
  ticker('ONEUSDT', '-3.178', 4407),
  ticker('ETHBTC', '-0.310', 1203),
  ticker('LUNAUSDT', '0.000', 0),
  ticker('USDCUSDT', '0.000', 55000),
];
const BTC_OI_REPLY = oiSeries('BTCUSDT', 81234.123, 83183.742); // +2,4 %
const ETH_OI_REPLY = oiSeries('ETHUSDT', 2412345.678, 2315000.1); // −4 %

/**
 * Trois trames brutes du flux public `!forceOrder@arr`, relevées le 11 octobre 2026 vers 13:30 UTC (lecture seule, sans
 * identifiant), telles que la socket les a livrées : des objets nus, sans enveloppe `{ stream, data }`, avec les champs
 * `ps` et `st` que la documentation de Binance ne cite pas dans l'ordre. Relevées sur le chemin routé `/market/ws/` ;
 * le chemin sans route `/ws/` n'a livré aucune trame pendant 220 s.
 */
const REAL_SELL =
  '{"e":"forceOrder","E":1791725413099,"o":{"s":"STRKUSDT","S":"SELL","o":"LIMIT","f":"IOC","q":"1040.2","p":"0.1068700","ap":"0.1077608","X":"FILLED","l":"750.8","z":"1040.2","T":1791725412178,"ps":"STRKUSDT","st":1}}';
const REAL_BUY_CKB =
  '{"e":"forceOrder","E":1791725413209,"o":{"s":"CKBUSDT","S":"BUY","o":"LIMIT","f":"IOC","q":"75972","p":"0.0018555","ap":"0.0018391","X":"FILLED","l":"21598","z":"75972","T":1791725412203,"ps":"CKBUSDT","st":1}}';
const REAL_BUY_NIL =
  '{"e":"forceOrder","E":1791725415159,"o":{"s":"NILUSDT","S":"BUY","o":"LIMIT","f":"IOC","q":"5357.8","p":"0.098820","ap":"0.097429","X":"FILLED","l":"1813.6","z":"5357.8","T":1791725414208,"ps":"NILUSDT","st":1}}';

/** Un message du flux `!forceOrder@arr` daté de l'instant courant (faux) ; une valeur de `over` remplace un champ de l'ordre. */
function force(over: Record<string, unknown> = {}): string {
  const now = Date.now();
  return JSON.stringify({
    e: 'forceOrder',
    E: now + 23,
    o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '0.014', p: '82500.10', ap: '82512.30', X: 'FILLED', l: '0.014', z: '0.014', T: now, ...over },
  });
}

type FetchJson = Mock<(url: string) => Promise<unknown>>;
const called = (fetchJson: FetchJson): string[] => fetchJson.mock.calls.map(([url]) => url);
const countOf = (fetchJson: FetchJson, url: string): number => called(fetchJson).filter((u) => u === url).length;

interface HarnessOptions {
  /** Réponses par URL, en remplacement des fixtures : une valeur, ou une fonction qui rend la promesse de la réponse. */
  replies?: Record<string, unknown>;
  gate?: VenueGate;
  hostOk?: (url: string) => boolean;
  emit?: (reading: TemperatureReading) => void;
}

function harness(options: HarnessOptions = {}) {
  const replies: Record<string, unknown> = {
    [PREMIUM_INDEX_URL]: PREMIUM_REPLY,
    [TICKER_24H_URL]: TICKER_REPLY,
    [BTC_OI_URL]: BTC_OI_REPLY,
    [ETH_OI_URL]: ETH_OI_REPLY,
    ...options.replies,
  };
  const { sockets, ws } = fakeNet();
  const emitted: TemperatureReading[] = [];
  const stamps: number[] = [];
  const logs: string[] = [];
  const gate = options.gate ?? new VenueGate(() => Date.now());
  const fetchJson: FetchJson = vi.fn(async (url: string): Promise<unknown> => {
    if (!(url in replies)) throw new Error(`aucune réponse prévue pour ${url}`);
    const reply = replies[url];
    return typeof reply === 'function' ? (reply as () => Promise<unknown>)() : reply;
  });
  const host = new TemperatureHost({
    fetchJson,
    ws,
    hostOk: options.hostOk ?? ((url) => cryptoHostAllowed(url, 'wss:')),
    timers: timers(),
    now: () => Date.now(),
    gate,
    emit:
      options.emit ??
      ((reading) => {
        emitted.push(reading);
        stamps.push(Date.now());
      }),
    log: (line) => logs.push(line),
  });
  return { host, replies, sockets, emitted, stamps, logs, gate, fetchJson };
}

type Harness = ReturnType<typeof harness>;

/** Les lignes que l'hôte écrit lui-même sur une source (pas celles de la socket). */
const linesAbout = (h: Harness, label: string): string[] => h.logs.filter((line) => line.includes(label));

/** Ouvre la socket des liquidations que l'hôte vient de lancer. */
function openSocket(h: Harness): FakeWs {
  const socket = nth(h.sockets, -1);
  socket.open();
  return socket;
}

describe('TemperatureHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('relevés', () => {
    it('relève tout de suite premiumIndex, ticker/24hr et l’open interest de BTC et d’ETH, puis émet funding, largeur et OI', async () => {
      const h = harness();
      h.host.start();
      expect([...called(h.fetchJson)].sort()).toEqual([...ALL_URLS].sort());
      await settle();

      const reading = some(h.host.current(), 'lecture');
      expect(reading.funding?.median).toBeCloseTo(0.000052145, 12);
      expect(reading.funding).toMatchObject({ btc: 0.00002929, symbols: 4, at: START });
      expect(reading.breadth).toEqual({ upShare: 0.5, pairs: 4, at: START });
      expect(reading.openInterest?.btc).toBeCloseTo(0.024, 6);
      expect(reading.openInterest?.eth).toBeCloseTo(2315000.1 / 2412345.678 - 1, 6);
      expect(reading.openInterest?.at).toBe(START);
      expect(reading.liquidations).toEqual({ long: 0, short: 0, since: START, at: START, lowerBound: true });

      // Chaque relevé fusionne dans la lecture courante puis émet : quatre réponses, quatre émissions, jamais moins de lectures.
      const filled = (r: TemperatureReading): number => [r.funding, r.breadth, r.openInterest].filter((part) => part !== null).length;
      expect(h.emitted).toHaveLength(4);
      const counts = h.emitted.map(filled);
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
      expect(counts[0]).toBe(1);
      expect(nth(counts, -1)).toBe(3);
      expect(nth(h.emitted, -1)).toEqual(reading);
    });

    it('relève premiumIndex toutes les 60 s, et le reste toutes les 5 min', async () => {
      const h = harness();
      h.host.start();
      await settle();
      h.fetchJson.mockClear();

      await vi.advanceTimersByTimeAsync(MINUTE - 1);
      expect(h.fetchJson).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(called(h.fetchJson)).toEqual([PREMIUM_INDEX_URL]);

      // 4 min : premiumIndex à 2, 3 et 4 min, rien d'autre.
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(countOf(h.fetchJson, PREMIUM_INDEX_URL)).toBe(4);
      expect(called(h.fetchJson)).toHaveLength(4);

      // 5 min : premiumIndex, et aussi ticker/24hr et l'open interest des deux marchés.
      h.fetchJson.mockClear();
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect([...called(h.fetchJson)].sort()).toEqual([...ALL_URLS].sort());

      // 6 min : premiumIndex seulement, de nouveau.
      h.fetchJson.mockClear();
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(called(h.fetchJson)).toEqual([PREMIUM_INDEX_URL]);
    });

    it('ne modifie jamais une lecture déjà émise : chaque relevé en produit une neuve', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const first = nth(h.emitted, 0);
      const frozen = structuredClone(first);
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(h.emitted.length).toBeGreaterThan(4);
      expect(first).toEqual(frozen);
      expect(nth(h.emitted, -1)).not.toEqual(first);
    });

    it('current() : null avant start() et après stop(), la lecture vide juste après start(), et rien n’est émis avant le premier relevé', async () => {
      const waiting = Object.fromEntries(ALL_URLS.map((url) => [url, () => new Promise<unknown>(() => {})]));
      const h = harness({ replies: waiting });
      expect(h.host.current()).toBeNull();
      h.host.start();
      expect(h.host.current()).toEqual(emptyReading(START));
      await vi.advanceTimersByTimeAsync(30 * SECOND);
      expect(h.host.current()).toEqual(emptyReading(START));
      expect(h.emitted).toHaveLength(0);
      h.host.stop();
      expect(h.host.current()).toBeNull();
    });

    it('garde la valeur et l’heure précédentes quand un relevé échoue ou ne se lit pas : jamais de lecture effacée', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const good = some(h.host.current(), 'lecture');
      const emissions = h.emitted.length;

      // Plus aucun relevé ne réussit, à aucun tour : cinq minutes de premiumIndex, puis les relevés lents du tour de 5 min.
      const broken = (): Promise<unknown> => Promise.reject(new Error('Réseau indisponible (fapi.binance.com, ECONNRESET)'));
      h.replies[TICKER_24H_URL] = broken;
      h.replies[BTC_OI_URL] = broken;
      h.replies[ETH_OI_URL] = broken;
      const failures: [string, () => Promise<unknown>][] = [
        ['un rejet', broken],
        ['une liste vide', () => Promise.resolve([])],
        ['un objet d’erreur', () => Promise.resolve({ code: -1003, msg: 'Too many requests' })],
        ['du texte', () => Promise.resolve('maintenance')],
        ['null', () => Promise.resolve(null)],
      ];
      for (const [label, reply] of failures) {
        h.replies[PREMIUM_INDEX_URL] = reply;
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(some(h.host.current(), label), label).toEqual(good);
      }
      expect(Date.now()).toBe(START + 5 * MINUTE);
      expect(some(h.host.current(), 'lecture').funding?.at).toBe(START);
      // Une panne ne fait rien émettre : rien n'a changé.
      expect(h.emitted).toHaveLength(emissions);

      // Les autres sources reviennent, premiumIndex reste en panne : la prochaine lecture émise garde le funding d'avant.
      h.replies[TICKER_24H_URL] = TICKER_REPLY;
      h.replies[BTC_OI_URL] = BTC_OI_REPLY;
      h.replies[ETH_OI_URL] = ETH_OI_REPLY;
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(h.emitted.length).toBeGreaterThan(emissions);
      const later = some(h.host.current(), 'lecture');
      expect(later.funding).toEqual(good.funding);
      expect(later.breadth?.at).toBe(START + 10 * MINUTE);
      expect(later.openInterest?.at).toBe(START + 10 * MINUTE);
    });

    it('fusionne l’open interest symbole par symbole : openInterest.at est l’heure du dernier relevé réussi', async () => {
      const h = harness({ replies: { [ETH_OI_URL]: () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)')) } });
      h.host.start();
      await settle();
      const first = some(some(h.host.current(), 'lecture').openInterest, 'open interest');
      expect(first.btc).toBeCloseTo(0.024, 6);
      expect(first.eth).toBeNull();
      expect(first.at).toBe(START);

      // 5 min plus tard, l'inverse : BTC échoue, ETH répond. La variation de BTC reste, celle d'ETH arrive, l'heure suit ETH.
      h.replies[BTC_OI_URL] = () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)'));
      h.replies[ETH_OI_URL] = ETH_OI_REPLY;
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      const second = some(some(h.host.current(), 'lecture').openInterest, 'open interest');
      expect(second.btc).toBeCloseTo(0.024, 6);
      expect(second.eth).toBeCloseTo(2315000.1 / 2412345.678 - 1, 6);
      expect(second.at).toBe(START + 5 * MINUTE);

      // BTC répond de nouveau (+1 %), ETH échoue : la nouvelle valeur de BTC arrive, celle d'ETH reste, l'heure suit BTC.
      h.replies[BTC_OI_URL] = oiSeries('BTCUSDT', 80000, 80800);
      h.replies[ETH_OI_URL] = () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)'));
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      const third = some(some(h.host.current(), 'lecture').openInterest, 'open interest');
      expect(third.btc).toBeCloseTo(0.01, 6);
      expect(third.eth).toBe(second.eth);
      expect(third.at).toBe(START + 10 * MINUTE);
      // Pendant ce tour, aucune lecture émise n'a perdu la variation d'ETH, même entre le relevé de BTC et celui d'ETH.
      for (const reading of h.emitted.filter((r) => r.openInterest !== null && r.openInterest.at >= START + 5 * MINUTE)) {
        expect(reading.openInterest?.eth).not.toBeNull();
      }

      // Les deux échouent : ni valeur ni heure ne bougent.
      h.replies[BTC_OI_URL] = () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)'));
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(some(h.host.current(), 'lecture').openInterest).toEqual(third);
    });

    it('une source en panne ne gêne pas les autres', async () => {
      const h = harness({
        replies: { [PREMIUM_INDEX_URL]: () => Promise.reject(new Error('x')), [TICKER_24H_URL]: () => Promise.reject(new Error('x')) },
      });
      h.host.start();
      await settle();
      const reading = some(h.host.current(), 'lecture');
      expect(reading.funding).toBeNull();
      expect(reading.breadth).toBeNull();
      expect(reading.openInterest?.btc).toBeCloseTo(0.024, 6);
      expect(reading.openInterest?.eth).toBeLessThan(0);
    });
  });

  describe('porte de la venue', () => {
    it('avertit la porte d’un succès seulement après une réponse lue', async () => {
      const gate = new VenueGate(() => Date.now());
      const onSuccess = vi.spyOn(gate, 'onSuccess');
      const h = harness({
        gate,
        replies: {
          [PREMIUM_INDEX_URL]: [],
          [TICKER_24H_URL]: { code: -1003 },
          [BTC_OI_URL]: [{}],
          [ETH_OI_URL]: () => Promise.reject(new Error('Réseau indisponible (fapi.binance.com, ECONNRESET)')),
        },
      });
      h.host.start();
      await settle();
      expect(onSuccess).not.toHaveBeenCalled();

      h.replies[PREMIUM_INDEX_URL] = PREMIUM_REPLY;
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('binance');
    });

    it('porte bloquée (418) : aucun appel, aucune socket, aucune émission, tant que le desk reste ouvert', async () => {
      const gate = new VenueGate(() => Date.now());
      gate.onHttpError('binance', new VenueHttpError(418, 'HTTP 418 (fapi.binance.com)'));
      const h = harness({ gate });
      h.host.start();
      await settle();
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(h.fetchJson).not.toHaveBeenCalled();
      expect(h.sockets).toHaveLength(0);
      expect(h.emitted).toHaveLength(0);
      expect(h.host.current()).toEqual(emptyReading(START));
      h.host.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('porte en pause (429) : le tour est sauté sans appel, les minuteurs continuent, le premier tour qui trouve la porte ouverte appelle', async () => {
      const gate = new VenueGate(() => Date.now());
      gate.onHttpError('binance', new VenueHttpError(429, 'HTTP 429 (fapi.binance.com)', 90));
      const h = harness({ gate });
      h.host.start();
      await settle();
      expect(h.fetchJson).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(h.fetchJson).not.toHaveBeenCalled(); // 60 s : la pause court jusqu'à 90 s
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(called(h.fetchJson)).toEqual([PREMIUM_INDEX_URL]); // 120 s : la porte est ouverte, premiumIndex seulement

      // Pas de rattrapage : les relevés lents attendent leur propre tour, à 5 min.
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(countOf(h.fetchJson, TICKER_24H_URL)).toBe(1);
      expect(countOf(h.fetchJson, BTC_OI_URL)).toBe(1);
      expect(countOf(h.fetchJson, ETH_OI_URL)).toBe(1);
    });

    it('transmet à la porte un 429 avec son Retry-After, et n’appelle plus avant la fin de la pause', async () => {
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: () => Promise.reject(new VenueHttpError(429, 'HTTP 429 (fapi.binance.com)', 120)) } });
      h.host.start();
      await settle();
      expect(h.gate.allowed('binance')).toBe(false);
      expect(h.gate.blocked('binance')).toBe(false);

      h.fetchJson.mockClear();
      h.replies[PREMIUM_INDEX_URL] = PREMIUM_REPLY;
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(h.fetchJson).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(called(h.fetchJson)).toEqual([PREMIUM_INDEX_URL]);
      expect(some(h.host.current(), 'lecture').funding?.at).toBe(START + 2 * MINUTE);
    });

    it('un 418 reçu en REST coupe la venue : plus aucun appel, et la socket des liquidations se ferme sans se reconnecter', async () => {
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: () => Promise.reject(new VenueHttpError(418, 'HTTP 418 (fapi.binance.com)')) } });
      h.host.start();
      const socket = nth(h.sockets, 0);
      socket.open();
      await settle();
      expect(h.gate.blocked('binance')).toBe(true);
      expect(socket.closed).toBe(true);

      h.fetchJson.mockClear();
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(h.fetchJson).not.toHaveBeenCalled();
      expect(h.sockets).toHaveLength(1);
      h.host.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('journal', () => {
    it('journalise une panne une fois, son changement de cause, et son rétablissement une fois : jamais une ligne par relevé', async () => {
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: () => Promise.reject(new Error('Réseau indisponible (fapi.binance.com, ENOTFOUND)')) } });
      h.host.start();
      await settle();
      const lines = (): string[] => linesAbout(h, 'premiumIndex');
      expect(lines()).toHaveLength(1);
      expect(nth(lines(), 0)).toContain('ENOTFOUND');

      // Cinq relevés de plus, même cause : aucune ligne.
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(lines()).toHaveLength(1);

      // Une autre cause : une ligne de plus.
      h.replies[PREMIUM_INDEX_URL] = () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)'));
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(lines()).toHaveLength(2);
      expect(nth(lines(), 1)).toContain('Délai dépassé');
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(lines()).toHaveLength(2);

      // Rétablie : une ligne, puis le silence.
      h.replies[PREMIUM_INDEX_URL] = PREMIUM_REPLY;
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(lines()).toHaveLength(3);
      expect(nth(lines(), 2)).toContain('rétabli');
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(lines()).toHaveLength(3);

      // Une nouvelle panne, même cause que la première, se journalise de nouveau.
      h.replies[PREMIUM_INDEX_URL] = () => Promise.reject(new Error('Réseau indisponible (fapi.binance.com, ENOTFOUND)'));
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(lines()).toHaveLength(4);
    });

    it('journalise chaque source à part, par son nom', async () => {
      const failing = () => Promise.reject(new Error('Délai dépassé (fapi.binance.com)'));
      const h = harness({ replies: { [TICKER_24H_URL]: failing, [BTC_OI_URL]: failing } });
      h.host.start();
      await settle();
      expect(linesAbout(h, 'ticker/24hr')).toHaveLength(1);
      expect(linesAbout(h, 'openInterestHist BTCUSDT')).toHaveLength(1);
      expect(linesAbout(h, 'openInterestHist ETHUSDT')).toHaveLength(0);
      expect(linesAbout(h, 'premiumIndex')).toHaveLength(0);
    });

    it('journalise une réponse illisible comme une panne, une fois', async () => {
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: [] } });
      h.host.start();
      await settle();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(linesAbout(h, 'premiumIndex')).toHaveLength(1);
    });

    it('borne et nettoie ce qu’il journalise : une ligne, 400 caractères au plus, une URL réduite à son hôte', async () => {
      const hostile = `boom\nhttps://fapi.binance.com/fapi/v1/premiumIndex?apikey=SECRET\r\n${'x'.repeat(5000)}`;
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: () => Promise.reject(new Error(hostile)) } });
      h.host.start();
      await settle();
      const line = nth(linesAbout(h, 'premiumIndex'), 0);
      expect(line.length).toBeLessThanOrEqual(400);
      expect(line).not.toMatch(/[\r\n]/);
      expect(line).not.toContain('SECRET');
      expect(line).not.toContain('apikey');
      expect(line).toContain('fapi.binance.com');
    });

    it('un emit qui lève ne casse pas l’hôte, et n’est journalisé qu’une fois par panne', async () => {
      const h = harness({
        emit: () => {
          throw new Error('fenêtre fermée');
        },
      });
      h.host.start();
      await settle();
      await vi.advanceTimersByTimeAsync(2 * MINUTE);
      expect(linesAbout(h, 'fenêtre fermée')).toHaveLength(1);
      expect(some(h.host.current(), 'lecture').funding).not.toBeNull();
      h.host.stop();
    });
  });

  describe('une requête à la fois par source', () => {
    it.each(ALL_URLS)('une réponse qui tarde (%s) fait sauter ses tours, sans gêner les autres sources', async (slowUrl) => {
      const h = harness({ replies: { [slowUrl]: () => new Promise<unknown>(() => {}) } });
      h.host.start();
      await settle();
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(countOf(h.fetchJson, slowUrl)).toBe(1);
      for (const url of ALL_URLS.filter((u) => u !== slowUrl)) {
        // tout de suite, puis à chaque tour : 11 fois en 10 min pour premiumIndex, 3 pour les autres.
        expect(countOf(h.fetchJson, url), url).toBe(url === PREMIUM_INDEX_URL ? 11 : 3);
      }
    });

    it('rappelle dès qu’une réponse est arrivée', async () => {
      const slow = deferred();
      const h = harness({ replies: { [PREMIUM_INDEX_URL]: () => slow.promise } });
      h.host.start();
      await settle();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(countOf(h.fetchJson, PREMIUM_INDEX_URL)).toBe(1);

      slow.resolve(PREMIUM_REPLY);
      await settle();
      expect(some(h.host.current(), 'lecture').funding).not.toBeNull();
      h.replies[PREMIUM_INDEX_URL] = PREMIUM_REPLY;
      await vi.advanceTimersByTimeAsync(MINUTE);
      expect(countOf(h.fetchJson, PREMIUM_INDEX_URL)).toBe(2);
    });
  });

  describe('liquidations', () => {
    it('ouvre une socket sur FORCE_ORDER_URL, après contrôle de l’hôte', () => {
      const seen: string[] = [];
      const h = harness({
        hostOk: (url) => {
          seen.push(url);
          return cryptoHostAllowed(url, 'wss:');
        },
      });
      h.host.start();
      expect(h.sockets).toHaveLength(1);
      expect(nth(h.sockets, 0).url).toBe(FORCE_ORDER_URL);
      expect(seen).toContain(FORCE_ORDER_URL);
    });

    it('un message forceOrder met à jour liquidations.long, au plus une seconde plus tard', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      const before = h.emitted.length;

      socket.message(force({ S: 'SELL', ap: '100', z: '2' }));
      expect(h.emitted).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(SECOND - 1);
      expect(h.emitted).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.emitted).toHaveLength(before + 1);
      expect(nth(h.emitted, -1).liquidations).toEqual({ long: 200, short: 0, since: START, at: START + SECOND, lowerBound: true });
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(200);

      socket.message(force({ S: 'BUY', ap: '50', z: '4' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations).toMatchObject({ long: 200, short: 200 });
    });

    it('50 messages dans la même seconde ne font qu’une émission', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      const before = h.emitted.length;

      for (let i = 0; i < 50; i++) socket.message(force({ ap: '100', z: '2' }));
      expect(h.emitted).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(SECOND - 1);
      expect(h.emitted).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.emitted).toHaveLength(before + 1);
      expect(nth(h.emitted, -1).liquidations.long).toBe(50 * 200);
      await vi.advanceTimersByTimeAsync(5 * SECOND);
      expect(h.emitted).toHaveLength(before + 1);
    });

    it('émet au plus une fois par seconde, quel que soit le rythme des messages', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      const before = h.emitted.length;

      // Un message toutes les 100 ms pendant 5 s : une émission par seconde, jamais deux à moins d'une seconde d'écart.
      for (let i = 0; i < 50; i++) {
        socket.message(force({ ap: '100', z: '2' }));
        await vi.advanceTimersByTimeAsync(100);
      }
      const stamps = h.stamps.slice(before);
      expect(stamps).toHaveLength(5);
      for (let i = 1; i < stamps.length; i++) expect(nth(stamps, i) - nth(stamps, i - 1)).toBeGreaterThanOrEqual(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(50 * 200);
    });

    it('date chaque message à l’horloge de l’hôte : une heure d’ordre lointaine ne fige pas la fenêtre', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);

      socket.message(force({ T: Date.now() + 10 * 24 * HOUR, ap: '100', z: '2' }));
      socket.message(force({ ap: '10', z: '3' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(30);
    });

    it('écarte un montant aberrant et les trames illisibles, sans lever et sans rien perdre des autres', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);

      for (const junk of ['', '{', 'null', '[]', '{"e":"forceOrder"}', force({ ap: '1e154', z: '1e154' }), force({ S: 'HOLD' })]) {
        expect(() => socket.message(junk), junk).not.toThrow();
      }
      socket.message(force({ ap: '100', z: '2' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations).toMatchObject({ long: 200, short: 0 });
    });

    it('lit des trames réelles du flux, livrées en octets comme le fait ws', async () => {
      vi.setSystemTime(at('13:30:13.100'));
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);

      socket.emit('message', Buffer.from(REAL_SELL));
      await vi.advanceTimersByTimeAsync(100);
      socket.emit('message', Buffer.from(REAL_BUY_CKB));
      await vi.advanceTimersByTimeAsync(1_900);
      socket.emit('message', Buffer.from(REAL_BUY_NIL));
      await vi.advanceTimersByTimeAsync(SECOND);

      const { liquidations } = some(h.host.current(), 'lecture');
      // STRKUSDT SELL : 0,1077608 × 1 040,2 = 112,09278416 $ de longues ; CKBUSDT BUY : 139,7201052 $ et NILUSDT BUY : 522,0050962 $ de courtes.
      expect(liquidations.long).toBeCloseTo(112.09278416, 8);
      expect(liquidations.short).toBeCloseTo(661.7252014, 7);
      expect(liquidations.since).toBe(at('13:30:13.100'));
      expect(liquidations.at).toBe(at('13:30:16.100'));
      expect(liquidations.lowerBound).toBe(true);
    });

    it('fait glisser l’heure à chaque émission, même sans nouvelle liquidation', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      await vi.advanceTimersByTimeAsync(10 * SECOND);
      socket.message(force({ ap: '100', z: '2' })); // 200 $, à START + 10 s
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(200);

      // À START + 1 h, elle a tout juste une heure : elle compte encore.
      await vi.advanceTimersByTimeAsync(HOUR - 11 * SECOND);
      await settle();
      expect(Date.now()).toBe(START + HOUR);
      expect(nth(h.emitted, -1).liquidations).toEqual({ long: 200, short: 0, since: START, at: START + HOUR, lowerBound: true });

      // Une minute plus tard, le relevé suivant de premiumIndex la fait sortir de l'heure : aucun message n'a été reçu.
      await vi.advanceTimersByTimeAsync(MINUTE);
      await settle();
      expect(nth(h.emitted, -1).liquidations).toEqual({ long: 0, short: 0, since: START + MINUTE, at: START + HOUR + MINUTE, lowerBound: true });
    });

    it('garde la fenêtre à travers une reconnexion de la socket', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const first = openSocket(h);
      first.message(force({ S: 'SELL', ap: '100', z: '2' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(200);

      first.drop(); // la venue ferme : nouvel essai après 1 s
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(h.sockets).toHaveLength(2);
      const second = openSocket(h);
      second.message(force({ S: 'BUY', ap: '10', z: '3' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations).toMatchObject({ long: 200, short: 30, since: START });
    });

    it('un hôte de socket refusé laisse les relevés REST courir, sans socket', async () => {
      const h = harness({ hostOk: () => false });
      h.host.start();
      await settle();
      expect(h.sockets).toHaveLength(0);
      expect(some(h.host.current(), 'lecture').funding).not.toBeNull();
      expect(h.logs.some((line) => line.includes('hôte refusé'))).toBe(true);
    });
  });

  describe('cycle de vie', () => {
    it('stop() arrête les minuteurs et la socket, efface la lecture, et plus aucun appel ne part', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      h.host.stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(socket.closed).toBe(true);
      expect(h.host.current()).toBeNull();

      h.fetchJson.mockClear();
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(h.fetchJson).not.toHaveBeenCalled();
      expect(h.sockets).toHaveLength(1); // aucune reconnexion
    });

    it('stop() efface aussi le minuteur d’une émission de liquidations en attente, et rien n’est émis ensuite', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      socket.message(force({ ap: '100', z: '2' }));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const emissions = h.emitted.length;

      h.host.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * SECOND);
      expect(h.emitted).toHaveLength(emissions);
    });

    it('ignore les trames d’une socket que stop() a fermée', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const socket = openSocket(h);
      h.host.stop();
      const emissions = h.emitted.length;

      socket.message(force({ ap: '100', z: '2' }));
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5 * SECOND);
      expect(h.emitted).toHaveLength(emissions);
      expect(h.host.current()).toBeNull();
    });

    it('stop() sans start() ne fait rien, et stop() deux fois non plus', () => {
      const h = harness();
      expect(() => h.host.stop()).not.toThrow();
      h.host.start();
      h.host.stop();
      expect(() => h.host.stop()).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('start() deux fois ne change rien : ni appel, ni socket, ni minuteur de plus', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const calls = h.fetchJson.mock.calls.length;
      const timersBefore = vi.getTimerCount();
      const emissions = h.emitted.length;

      h.host.start();
      await settle();
      expect(h.fetchJson.mock.calls).toHaveLength(calls);
      expect(h.sockets).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(timersBefore);
      expect(h.emitted).toHaveLength(emissions);
    });

    it('stop() puis start() repart d’une fenêtre et d’une lecture neuves, sur une socket neuve', async () => {
      const h = harness();
      h.host.start();
      await settle();
      const first = openSocket(h);
      first.message(force({ ap: '100', z: '2' }));
      await vi.advanceTimersByTimeAsync(SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(200);

      h.host.stop();
      await vi.advanceTimersByTimeAsync(5 * SECOND);
      const restartedAt = Date.now();
      h.fetchJson.mockClear();
      h.host.start();
      expect(h.host.current()).toEqual(emptyReading(restartedAt));
      expect(called(h.fetchJson).sort()).toEqual([...ALL_URLS].sort());
      expect(h.sockets).toHaveLength(2);
      expect(nth(h.sockets, 1)).not.toBe(first);

      await settle();
      const reading = some(h.host.current(), 'lecture');
      expect(reading.liquidations).toEqual({ long: 0, short: 0, since: restartedAt, at: restartedAt, lowerBound: true });
      expect(reading.funding).not.toBeNull();
      // Les trames de l'ancienne socket ne comptent plus.
      first.message(force({ ap: '100', z: '2' }));
      await vi.advanceTimersByTimeAsync(2 * SECOND);
      expect(some(h.host.current(), 'lecture').liquidations.long).toBe(0);
    });

    it('écarte une réponse qui arrive après stop() : ni fusion, ni émission, et la porte n’y voit pas un succès', async () => {
      const pending: Deferred[] = [];
      const gate = new VenueGate(() => Date.now());
      const onSuccess = vi.spyOn(gate, 'onSuccess');
      const h = harness({
        gate,
        replies: {
          [PREMIUM_INDEX_URL]: () => {
            const next = deferred();
            pending.push(next);
            return next.promise;
          },
        },
      });
      h.host.start();
      await settle();
      h.host.stop();
      const emissions = h.emitted.length;
      onSuccess.mockClear();

      nth(pending, 0).resolve(PREMIUM_REPLY);
      await settle();
      expect(h.emitted).toHaveLength(emissions);
      expect(h.host.current()).toBeNull();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('écarte une réponse de l’ancien lancement qui arrive après stop() puis start()', async () => {
      const pending: Deferred[] = [];
      const h = harness({
        replies: {
          [PREMIUM_INDEX_URL]: () => {
            const next = deferred();
            pending.push(next);
            return next.promise;
          },
        },
      });
      h.host.start();
      await settle();
      h.host.stop();
      h.host.start();
      await settle();
      // Le nouveau lancement a fait sa propre demande, malgré la première restée en l'air.
      expect(pending).toHaveLength(2);
      const emissions = h.emitted.length;

      // L'ancienne réponse (un funding de 0,5 : visible si elle fuyait) n'est ni fusionnée ni émise.
      nth(pending, 0).resolve([premium('BTCUSDT', '0.5')]);
      await settle();
      expect(h.emitted).toHaveLength(emissions);
      expect(some(h.host.current(), 'lecture').funding).toBeNull();

      nth(pending, 1).resolve(PREMIUM_REPLY);
      await settle();
      expect(some(h.host.current(), 'lecture').funding?.btc).toBe(0.00002929);
      expect(h.emitted).toHaveLength(emissions + 1);
    });

    it('un 418 reçu par l’ancien lancement coupe aussi la socket du lancement courant', async () => {
      const pending: Deferred[] = [];
      const h = harness({
        replies: {
          [PREMIUM_INDEX_URL]: () => {
            const next = deferred();
            pending.push(next);
            return next.promise;
          },
        },
      });
      h.host.start();
      await settle();
      h.host.stop();
      h.host.start();
      await settle();
      const current = nth(h.sockets, -1);
      current.open();
      expect(h.sockets).toHaveLength(2);
      expect(current.closed).toBe(false);

      nth(pending, 0).reject(new VenueHttpError(418, 'HTTP 418 (fapi.binance.com)'));
      await settle();
      expect(h.gate.blocked('binance')).toBe(true);
      expect(current.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(h.sockets).toHaveLength(2); // aucune reconnexion
    });

    it('une panne qui arrive après stop() informe quand même la porte, sans rien journaliser', async () => {
      const pending: Deferred[] = [];
      const h = harness({
        replies: {
          [PREMIUM_INDEX_URL]: () => {
            const next = deferred();
            pending.push(next);
            return next.promise;
          },
        },
      });
      h.host.start();
      await settle();
      h.host.stop();
      const lines = h.logs.length;

      nth(pending, 0).reject(new VenueHttpError(418, 'HTTP 418 (fapi.binance.com)'));
      await settle();
      expect(h.gate.blocked('binance')).toBe(true);
      expect(h.logs).toHaveLength(lines);
    });
  });
});

describe('module du process principal', () => {
  const source = readFileSync('electron/crypto-temperature.ts', 'utf8');

  it('n’importe ni electron ni ws : la socket, les minuteurs, l’horloge, le fetch et la porte sont injectés', () => {
    expect(source).not.toMatch(/from\s+['"](electron|ws)['"]/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\bnew\s+WebSocket\b/);
    expect(source).not.toMatch(/(?<![.\w])(fetch|setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/);
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
  });

  it('ne dépend que des modules du moteur partagés avec le main et des modules réseau déjà gardés', () => {
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect([...specifiers].sort()).toEqual(['./crypto-net', './crypto-socket', './crypto/temperature', './crypto/venues']);
  });

  it('expose ce que le plan produit : TemperatureHost avec start, stop et current', () => {
    expect(source).toMatch(/export class TemperatureHost\b/);
    const host = new TemperatureHost({
      fetchJson: () => Promise.resolve(null),
      ws: () => {
        throw new Error('aucune socket dans ce test');
      },
      hostOk: () => false,
      timers: timers(),
      now: () => Date.now(),
      gate: new VenueGate(() => Date.now()),
      emit: () => undefined,
      log: () => undefined,
    });
    expect([typeof host.start, typeof host.stop, typeof host.current]).toEqual(['function', 'function', 'function']);
  });
});
