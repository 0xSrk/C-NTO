/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoBar, CryptoFeedEvent, CryptoMarketId, CryptoSeriesId, CryptoTimeframe } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import type { CryptoMainStatus } from '@/lib/desk';

/*
 * Le process principal simulé derrière `window.canto.crypto`, posé avant tout import (le desk le lit au chargement).
 * - `main.enabled` est l'interrupteur qu'il tient : éteint, il refuse tout abonnement (`crypto_disabled`), comme le vrai.
 * - `main.refuse` : les séries dont il refuse l'abonnement, avec son code (`rate_limited`, `blocked`…).
 * - `open` : les abonnements ouverts de son côté, par identifiant ; `unsubscribe` les retire.
 * - `histories` : les historiques demandés, sans réponse tant que le test ne répond pas (`answer`).
 * - `temperatures` : les lectures initiales de la température, sans réponse tant que le test ne répond pas.
 * Les écoutes (`onEvent`, `onTemperature`, `onStatus`) sont gardées : le test pousse ce que le process principal pousserait.
 */
const fake = vi.hoisted(() => {
  type SubscribeReq = { series: string; kind: 'ticker' | 'bars'; timeframe?: number };
  type HistoryReq = { series: string; timeframe: number };
  type HistoryReply = { ok: true; bars: unknown[] } | { ok: false; detail: string };
  const main = { enabled: true, refuse: new Map<string, string>() };
  const status = (): CryptoMainStatus => {
    const state = main.enabled ? 'live' : 'off';
    return { enabled: main.enabled, venues: { coinbase: state, binance: state, bybit: state } };
  };
  const listeners = {
    event: new Set<(e: unknown) => void>(),
    temperature: new Set<(r: unknown) => void>(),
    status: new Set<(s: CryptoMainStatus) => void>(),
  };
  const open = new Map<string, SubscribeReq>();
  const histories: { req: HistoryReq; resolve: (reply: HistoryReply) => void }[] = [];
  const temperatures: ((reading: unknown) => void)[] = [];
  let n = 0;
  const api = {
    status: vi.fn(async () => status()),
    enable: vi.fn(async () => status()),
    disable: vi.fn(async () => status()),
    history: vi.fn((req: HistoryReq) => new Promise<HistoryReply>((resolve) => histories.push({ req: { ...req }, resolve }))),
    subscribe: vi.fn(async (req: SubscribeReq) => {
      if (!main.enabled) return { ok: false as const, detail: 'crypto_disabled' };
      const refusal = main.refuse.get(req.series);
      if (refusal) return { ok: false as const, detail: refusal };
      const subscriptionId = `sub-${++n}`;
      open.set(subscriptionId, { ...req });
      return { ok: true as const, subscriptionId };
    }),
    unsubscribe: vi.fn(async (id: string) => ({ ok: open.delete(id) })),
    temperature: vi.fn(() => new Promise<unknown>((resolve) => temperatures.push(resolve))),
    onEvent: vi.fn((cb: (e: unknown) => void) => {
      listeners.event.add(cb);
      return () => listeners.event.delete(cb);
    }),
    onTemperature: vi.fn((cb: (r: unknown) => void) => {
      listeners.temperature.add(cb);
      return () => listeners.temperature.delete(cb);
    }),
    onStatus: vi.fn((cb: (s: CryptoMainStatus) => void) => {
      listeners.status.add(cb);
      return () => listeners.status.delete(cb);
    }),
  };
  (window as unknown as { canto: unknown }).canto = { crypto: api };
  return {
    api,
    main,
    open,
    histories,
    temperatures,
    listeners,
    /** Le process principal change d'interrupteur et le pousse au renderer. */
    pushStatus(enabled: boolean) {
      main.enabled = enabled;
      for (const cb of [...listeners.status]) cb(status());
    },
    /** Un test neuf : rien d'ouvert, rien en attente, compteurs à zéro. L'écoute du statut, posée une fois par le store, reste. */
    reset() {
      main.enabled = true;
      main.refuse.clear();
      open.clear();
      histories.length = 0;
      temperatures.length = 0;
      for (const fn of [api.status, api.history, api.subscribe, api.unsubscribe, api.temperature, api.onEvent, api.onTemperature]) fn.mockClear();
    },
  };
});

/** La table `settings` du renderer, en mémoire. */
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/store/db', () => ({
  getSetting: vi.fn(async (key: string, fallback: unknown) => (rows.has(key) ? structuredClone(rows.get(key)) : fallback)),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    rows.set(key, structuredClone(value));
  }),
}));

import { useCrypto } from '@/store/crypto';
import { getSetting } from '@/store/db';

const BTC: CryptoMarketId = 'coinbase:BTC-USD';
const ONDO: CryptoMarketId = 'coinbase:ONDO-USD';
const ONE: CryptoMarketId = 'binance:ONEUSDT';
const ZIG: CryptoMarketId = 'bybit:ZIGUSDT';
const BTC_PROXY: CryptoSeriesId = 'binance:BTCUSDT';
const ONDO_PROXY: CryptoSeriesId = 'binance:ONDOUSDT';

/** Le 11 octobre 2026, midi UTC : en secondes pour les bougies, en millisecondes pour les tickers. */
const T = Date.UTC(2026, 9, 11, 12) / 1000;
const NOW_MS = T * 1000;
const H = 3600;

/** Les valeurs du brief, à la lettre : temporisation des changements et plafond de `mergeLiveBar`. */
const DEBOUNCE_MS = 300;
const BARS_MAX = 3000;

const TICKERS = [`ticker ${BTC}`, `ticker ${ONDO}`, `ticker ${ONE}`, `ticker ${ZIG}`].sort();

const s = () => useCrypto.getState();

/** Laisse passer les réponses du faux process principal et les suites du port (plusieurs tours de microtâches). */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Les abonnements ouverts côté process principal, lisibles et triés : `ticker coinbase:BTC-USD`, `bars binance:ONEUSDT 15`. */
const opened = (): string[] => [...fake.open.values()].map((r) => (r.kind === 'bars' ? `bars ${r.series} ${r.timeframe}` : `ticker ${r.series}`)).sort();

/** L'identifiant, côté process principal, de l'abonnement ouvert sous ce libellé. */
function idOf(label: string): string {
  for (const [id, r] of fake.open) if ((r.kind === 'bars' ? `bars ${r.series} ${r.timeframe}` : `ticker ${r.series}`) === label) return id;
  throw new Error(`aucun abonnement ouvert : ${label}`);
}

/** Répond à la plus ancienne demande d'historique de cette série et de ce timeframe encore sans réponse. */
async function answer(series: CryptoSeriesId, timeframe: CryptoTimeframe, reply: CryptoBar[] | { detail: string }) {
  const at = fake.histories.findIndex((h) => h.req.series === series && h.req.timeframe === timeframe);
  if (at < 0) throw new Error(`aucun historique demandé : ${series} ${timeframe}`);
  const [call] = fake.histories.splice(at, 1);
  call!.resolve(Array.isArray(reply) ? { ok: true, bars: reply } : { ok: false, detail: reply.detail });
  await flush();
}

/** Le process principal pousse un événement de flux : chaque écoute ouverte le reçoit. */
function emit(event: CryptoFeedEvent) {
  for (const cb of [...fake.listeners.event]) cb(event);
}
const emitBar = (series: CryptoSeriesId, timeframe: CryptoTimeframe, b: CryptoBar, final = false) => emit({ kind: 'bar', series, timeframe, bar: b, final });

/** Une bougie ; sans `buyVolume`, la clé est absente (c'est ainsi qu'une bougie partielle se reconnaît). */
function bar(time: number, close: number, volume: number, buyVolume?: number, range: { high?: number; low?: number; open?: number } = {}): CryptoBar {
  const b: CryptoBar = { time, open: range.open ?? close, high: range.high ?? close, low: range.low ?? close, close, volume };
  return buyVolume === undefined ? b : { ...b, buyVolume };
}

const reading = (median: number): TemperatureReading => ({
  funding: { median, btc: 0.0001, symbols: 312, at: NOW_MS },
  breadth: { upShare: 0.42, pairs: 380, at: NOW_MS },
  liquidations: { long: 1_200_000, short: 800_000, since: NOW_MS - 3_600_000, at: NOW_MS, lowerBound: true },
  openInterest: null,
});

/** Le store comme à l'ouverture de l'onglet : réglages posés dans la table, interrupteur du process principal, puis `load()`. */
async function boot(opts: { enabled?: boolean; rows?: Record<string, unknown> } = {}) {
  fake.main.enabled = opts.enabled ?? true;
  rows.clear();
  for (const [key, value] of Object.entries(opts.rows ?? {})) rows.set(key, structuredClone(value));
  await s().load();
  await flush();
}

/** Ouvre le chart sur un store chargé et laisse passer l'abonnement. */
async function openChart() {
  s().openChart();
  await flush();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  useCrypto.setState(useCrypto.getInitialState(), true);
  await flush();
  fake.reset();
  rows.clear();
});

afterEach(async () => {
  // Le store revient à son état initial (`ready` faux) : les deux flux s'arrêtent et ne laissent ni écoute ni minuterie.
  useCrypto.setState(useCrypto.getInitialState(), true);
  await flush();
  expect(fake.listeners.event.size).toBe(0);
  expect(fake.listeners.temperature.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe('flux léger : tickers de la watchlist et température', () => {
  it('allumé : un ticker par marché de la watchlist, sans historique ni bougie', async () => {
    await boot();
    expect(opened()).toEqual(TICKERS);
    expect(fake.api.subscribe).toHaveBeenCalledTimes(4);
    expect(fake.api.history).not.toHaveBeenCalled();
    expect(s().chartOpen).toBe(false);
  });

  it('un ticker poussé arrive dans tickers, avec sa variation sur 24 h', async () => {
    await boot();
    emit({ kind: 'ticker', ticker: { market: ONE, last: 0.002163, change24hPct: -3.5, time: NOW_MS } });
    emit({ kind: 'ticker', ticker: { market: BTC, last: 82_528, change24hPct: null, time: NOW_MS + 1 } });
    expect(s().tickers).toEqual({
      [ONE]: { market: ONE, last: 0.002163, change24hPct: -3.5, time: NOW_MS },
      [BTC]: { market: BTC, last: 82_528, change24hPct: null, time: NOW_MS + 1 },
    });
  });

  it('changer la watchlist ajoute ou retire l’abonnement ticker correspondant', async () => {
    await boot();
    const zig = idOf(`ticker ${ZIG}`);
    emit({ kind: 'ticker', ticker: { market: ZIG, last: 0.0123, change24hPct: 1.2, time: NOW_MS } });
    expect(s().tickers[ZIG]).toBeDefined();

    expect(await s().removeFromWatchlist(ZIG)).toEqual({ ok: true });
    await flush();
    expect(fake.api.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.api.unsubscribe).toHaveBeenCalledWith(zig);
    expect(opened()).toEqual(TICKERS.filter((label) => label !== `ticker ${ZIG}`));
    // Le dernier prix d'un marché qu'on ne suit plus ne reste pas dans l'état.
    expect(s().tickers[ZIG]).toBeUndefined();
    emit({ kind: 'ticker', ticker: { market: ZIG, last: 0.0124, change24hPct: 1.3, time: NOW_MS + 1 } });
    expect(s().tickers[ZIG]).toBeUndefined();

    expect(await s().addToWatchlist(ZIG)).toEqual({ ok: true });
    await flush();
    expect(opened()).toEqual(TICKERS);
    expect(fake.api.subscribe).toHaveBeenCalledTimes(5);
    expect(fake.api.subscribe).toHaveBeenLastCalledWith({ series: ZIG, kind: 'ticker' });
    // Une écriture qui laisse la watchlist telle quelle n'ouvre rien de plus.
    await s().addToWatchlist(BTC);
    await flush();
    expect(fake.api.subscribe).toHaveBeenCalledTimes(5);
  });

  it('la température : écoute posée avant la lecture initiale, lecture initiale puis lectures poussées dans l’état', async () => {
    await boot();
    expect(fake.api.onTemperature).toHaveBeenCalledTimes(1);
    expect(fake.api.temperature).toHaveBeenCalledTimes(1);
    expect(fake.api.onTemperature.mock.invocationCallOrder[0]).toBeLessThan(fake.api.temperature.mock.invocationCallOrder[0]!);
    expect(s().temperature).toBeNull();
    fake.temperatures.shift()!(reading(0.0001));
    await flush();
    expect(s().temperature).toEqual(reading(0.0001));
    for (const cb of [...fake.listeners.temperature]) cb(reading(0.00011));
    expect(s().temperature).toEqual(reading(0.00011));
  });

  it('une lecture initiale qui revient après une lecture poussée ne la remplace pas', async () => {
    await boot();
    for (const cb of [...fake.listeners.temperature]) cb(reading(0.00011));
    fake.temperatures.shift()!(reading(0.00009));
    await flush();
    expect(s().temperature).toEqual(reading(0.00011));
  });

  /*
   * Le flux léger part au démarrage du desk (`App`), puis l'onglet rappelle `load()` à son montage : le second appel ne
   * doit rien ajouter. `onStatus` n'est jamais remis à zéro par `fake.reset()` (le store pose son écoute une fois pour
   * toutes) : un seul appel à `onStatus` en tout, et une seule écoute en vie, quel que soit le nombre de `load()`.
   */
  async function expectOneLightFlow() {
    expect(fake.api.onStatus).toHaveBeenCalledTimes(1);
    expect(fake.listeners.status.size).toBe(1);
    expect(opened()).toEqual(TICKERS);
    expect(fake.api.subscribe).toHaveBeenCalledTimes(4);
    // Le port écoute les événements du process principal une fois par abonnement : quatre tickers, quatre écoutes, pas huit.
    expect(fake.api.onEvent).toHaveBeenCalledTimes(4);
    expect(fake.listeners.event.size).toBe(4);
    expect(fake.api.onTemperature).toHaveBeenCalledTimes(1);
    expect(fake.listeners.temperature.size).toBe(1);
    expect(fake.api.temperature).toHaveBeenCalledTimes(1);
    expect(fake.api.history).not.toHaveBeenCalled();
    // Les réglages ne sont lus qu'une fois : les quatre lignes du premier `load()`.
    expect(vi.mocked(getSetting)).toHaveBeenCalledTimes(4);
  }

  it('load() appelé deux fois, le démarrage du desk puis l’onglet : une écoute du statut, un seul flux léger, une seule lecture des réglages', async () => {
    vi.mocked(getSetting).mockClear();
    await boot();
    await s().load();
    await flush();
    expect(s()).toMatchObject({ ready: true, enabled: true });
    await expectOneLightFlow();
    // Le statut est relu à chaque appel (inchangé) : cela ne ferme ni ne rouvre aucun flux.
    expect(fake.api.status).toHaveBeenCalledTimes(2);
    expect(fake.api.unsubscribe).not.toHaveBeenCalled();
  });

  it('load() appelé deux fois sans attendre le premier : même résultat', async () => {
    vi.mocked(getSetting).mockClear();
    fake.main.enabled = true;
    rows.clear();
    await Promise.all([s().load(), s().load()]);
    await flush();
    expect(s()).toMatchObject({ ready: true, enabled: true });
    await expectOneLightFlow();
    expect(fake.api.unsubscribe).not.toHaveBeenCalled();
  });

  it('éteint, ou tant que le store n’est pas prêt : rien n’est abonné, rien n’est lu', async () => {
    await boot({ enabled: false });
    await openChart();
    expect(s()).toMatchObject({ ready: true, enabled: false, chartOpen: true });
    for (const fn of [fake.api.subscribe, fake.api.history, fake.api.temperature, fake.api.onEvent, fake.api.onTemperature]) expect(fn).not.toHaveBeenCalled();
    // Allumé mais pas prêt (réglages et statut pas encore lus) : rien non plus.
    useCrypto.setState(useCrypto.getInitialState(), true);
    useCrypto.setState({ enabled: true, chartOpen: true });
    await flush();
    for (const fn of [fake.api.subscribe, fake.api.history, fake.api.temperature, fake.api.onEvent, fake.api.onTemperature]) expect(fn).not.toHaveBeenCalled();
  });

  it('l’extinction désabonne tout, vide les données vivantes et ne laisse aucune minuterie', async () => {
    await boot();
    expect((await s().addIndicator('cvd-binance')).ok).toBe(true);
    await openChart();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`, `bars ${BTC_PROXY} 60`].sort());
    await answer(BTC, 60, [bar(T, 82_500, 5)]);
    await answer(BTC_PROXY, 60, [bar(T, 82_400, 30, 18)]);
    emit({ kind: 'ticker', ticker: { market: BTC, last: 82_528, change24hPct: 0.4, time: NOW_MS } });
    for (const cb of [...fake.listeners.temperature]) cb(reading(0.0001));
    // Un changement de marché en attente de sa temporisation : l'extinction ne le laisse pas partir ensuite.
    await s().setMarket(ONE);
    expect(vi.getTimerCount()).toBe(1);

    fake.pushStatus(false);
    await flush();
    expect(opened()).toEqual([]);
    expect(fake.listeners.event.size).toBe(0);
    expect(fake.listeners.temperature.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(s()).toMatchObject({ enabled: false, chartOpen: true, bars: [], proxyBars: [], cvdAnchoredAt: null, tickers: {}, tickerErrors: {}, temperature: null, chartError: null, proxyError: null });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(opened()).toEqual([]);
    expect(fake.api.subscribe).toHaveBeenCalledTimes(6);
  });

  it('rallumé : tout est réabonné, y compris ce que le process principal avait refusé', async () => {
    fake.main.refuse.set(ZIG, 'rate_limited');
    await boot();
    await openChart();
    // Le refus garde le code du process principal tel quel : l'écran le traduit.
    expect(s().tickerErrors).toEqual({ [ZIG]: 'rate_limited' });
    expect(opened()).toEqual([...TICKERS.filter((label) => label !== `ticker ${ZIG}`), `bars ${BTC} 60`].sort());

    fake.pushStatus(false);
    await flush();
    expect(opened()).toEqual([]);
    expect(s().tickerErrors).toEqual({});

    fake.main.refuse.clear();
    fake.pushStatus(true);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`].sort());
    expect(s().tickerErrors).toEqual({});
    expect(fake.api.temperature).toHaveBeenCalledTimes(2);
    expect(fake.api.history).toHaveBeenCalledTimes(2);
  });
});

describe('flux lourd : bougies du chart', () => {
  it('openChart : abonnement bars du marché et du timeframe, puis historique ; closeChart désabonne', async () => {
    await boot();
    fake.api.subscribe.mockClear();
    await openChart();
    expect(fake.api.subscribe).toHaveBeenCalledTimes(1);
    expect(fake.api.subscribe).toHaveBeenCalledWith({ series: BTC, kind: 'bars', timeframe: 60 });
    expect(fake.api.history).toHaveBeenCalledTimes(1);
    expect(fake.api.history).toHaveBeenCalledWith({ series: BTC, timeframe: 60 });
    expect(fake.api.subscribe.mock.invocationCallOrder[0]).toBeLessThan(fake.api.history.mock.invocationCallOrder[0]!);
    const chart = idOf(`bars ${BTC} 60`);
    const history = [bar(T, 82_000, 5), bar(T + H, 82_500, 7)];
    await answer(BTC, 60, history);
    expect(s().bars).toEqual(history);

    s().closeChart();
    await flush();
    expect(s().chartOpen).toBe(false);
    expect(fake.api.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.api.unsubscribe).toHaveBeenCalledWith(chart);
    expect(opened()).toEqual(TICKERS);
    expect(s()).toMatchObject({ bars: [], proxyBars: [], cvdAnchoredAt: null });
    // Plus rien n'arrive du chart fermé ; le flux léger continue.
    emitBar(BTC, 60, bar(T + H, 83_000, 1, 1));
    expect(s().bars).toEqual([]);
    emit({ kind: 'ticker', ticker: { market: BTC, last: 83_000, change24hPct: 0.6, time: NOW_MS } });
    expect(s().tickers[BTC]?.last).toBe(83_000);
  });

  it('ignores a stale history response', async () => {
    await boot();
    await openChart();
    await answer(BTC, 60, [bar(T, 82_528, 5)]);
    await s().setMarket(ONE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fake.api.history).toHaveBeenLastCalledWith({ series: ONE, timeframe: 60 });
    await s().setMarket(ZIG);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fake.api.history).toHaveBeenLastCalledWith({ series: ZIG, timeframe: 60 });

    const zig = [bar(T, 0.0123, 1_000), bar(T + H, 0.0125, 1_200)];
    await answer(ZIG, 60, zig);
    expect(s().bars).toEqual(zig);
    // L'historique de ONE revient après celui de ZIG : il porte un jeton périmé, il est ignoré.
    await answer(ONE, 60, [bar(T, 0.002163, 50_000, 20_000)]);
    expect(s().market).toBe(ZIG);
    expect(s().bars).toEqual(zig);
    expect(s().cvdAnchoredAt).toBeNull();
  });

  it('une bougie partielle ne change pas le volume ; le CVD s’ancre à la première bougie complète', async () => {
    await boot();
    await openChart();
    // Coinbase : l'historique ne porte pas de volume acheteur.
    await answer(BTC, 60, [bar(T, 100, 10), bar(T + H, 101, 12, undefined, { open: 100.5, high: 102, low: 100 })]);
    expect(s().cvdAnchoredAt).toBeNull();

    emitBar(BTC, 60, bar(T + H, 104, 2, undefined, { open: 101.5, high: 105, low: 99.5 }));
    expect(s().bars.at(-1)).toStrictEqual({ time: T + H, open: 100.5, high: 105, low: 99.5, close: 104, volume: 12 });
    expect(s().cvdAnchoredAt).toBeNull();

    // La bougie suivante, vue en entier, porte son volume acheteur : ajoutée, et le CVD s'y ancre.
    emitBar(BTC, 60, bar(T + 2 * H, 103, 1, 1));
    expect(s().bars).toHaveLength(3);
    expect(s().cvdAnchoredAt).toBe(T + 2 * H);
    // Même instant, complète, volume acheteur 0 : elle remplace (un volume acheteur nul compte).
    emitBar(BTC, 60, bar(T + 2 * H, 102, 3, 0, { high: 103.5, low: 101 }));
    expect(s().bars.at(-1)).toStrictEqual(bar(T + 2 * H, 102, 3, 0, { high: 103.5, low: 101 }));
    expect(s().cvdAnchoredAt).toBe(T + 2 * H);
  });

  it('les bougies arrivées avant l’historique sont rangées par-dessus quand il arrive', async () => {
    await boot();
    await openChart();
    emitBar(BTC, 60, bar(T + H, 104, 2, undefined, { high: 105, low: 103 }));
    emitBar(BTC, 60, bar(T + H, 103.5, 3, undefined, { high: 104, low: 99 }));
    expect(s().bars).toEqual([]);
    await answer(BTC, 60, [bar(T, 100, 10), bar(T + H, 101, 12, undefined, { open: 100.5, high: 102, low: 100 })]);
    expect(s().bars).toStrictEqual([bar(T, 100, 10), { time: T + H, open: 100.5, high: 105, low: 99, close: 103.5, volume: 12 }]);
  });

  it('mergeLiveBar garde 3000 bougies, jamais le plafond par défaut de 1000', async () => {
    await boot({ rows: { 'crypto.chart': { market: ONE, timeframe: 1, indicators: [] } } });
    await openChart();
    // 1m : jusqu'à 2 880 bougies d'historique pour remonter à la veille UTC.
    const history = Array.from({ length: 2_880 }, (_, i) => bar(T + 60 * i, 0.002, 100, 40));
    await answer(ONE, 1, history);
    expect(s().bars).toHaveLength(2_880);
    emitBar(ONE, 1, bar(T + 60 * 2_880, 0.0021, 100, 50));
    expect(s().bars).toHaveLength(2_881);
    expect(s().bars[0]?.time).toBe(T);
    for (let i = 2_881; i <= 3_000; i++) emitBar(ONE, 1, bar(T + 60 * i, 0.0021, 100, 50));
    expect(s().bars).toHaveLength(BARS_MAX);
    expect(s().bars[0]?.time).toBe(T + 60);
    expect(s().bars.at(-1)?.time).toBe(T + 60 * 3_000);
    // Binance : l'historique porte le volume acheteur, l'ancre suit la première bougie gardée.
    expect(s().cvdAnchoredAt).toBe(T + 60);
  });

  it('temporise les changements de marché et de timeframe : 300 ms après le dernier, qui gagne', async () => {
    await boot();
    await openChart();
    await answer(BTC, 60, [bar(T, 82_500, 5)]);
    const chart = idOf(`bars ${BTC} 60`);
    fake.api.subscribe.mockClear();
    fake.api.history.mockClear();

    await s().setMarket(ONE);
    // Les bougies de l'ancien choix sont vidées tout de suite ; celles qui arrivent encore de l'ancien flux sont ignorées.
    expect(s().bars).toEqual([]);
    emitBar(BTC, 60, bar(T + H, 82_600, 1, 1));
    expect(s().bars).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await s().setTimeframe(15);
    await vi.advanceTimersByTimeAsync(200);
    await s().setMarket(ZIG);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(fake.api.subscribe).not.toHaveBeenCalled();
    expect(fake.api.unsubscribe).not.toHaveBeenCalled();
    expect(fake.api.history).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fake.api.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.api.unsubscribe).toHaveBeenCalledWith(chart);
    expect(fake.api.subscribe).toHaveBeenCalledTimes(1);
    expect(fake.api.subscribe).toHaveBeenCalledWith({ series: ZIG, kind: 'bars', timeframe: 15 });
    expect(fake.api.history).toHaveBeenCalledTimes(1);
    expect(fake.api.history).toHaveBeenCalledWith({ series: ZIG, timeframe: 15 });
    expect(opened()).toEqual([...TICKERS, `bars ${ZIG} 15`].sort());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un aller-retour de marché pendant la temporisation redemande le flux du marché revenu', async () => {
    await boot();
    await openChart();
    await answer(BTC, 60, [bar(T, 82_500, 5)]);
    const chart = idOf(`bars ${BTC} 60`);
    await s().setMarket(ONE);
    await s().setMarket(BTC);
    expect(s().bars).toEqual([]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(fake.api.unsubscribe).toHaveBeenCalledWith(chart);
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`].sort());
    expect(fake.api.history).toHaveBeenCalledTimes(2);
    await answer(BTC, 60, [bar(T, 82_700, 6)]);
    expect(s().bars).toEqual([bar(T, 82_700, 6)]);
  });

  it('vide les bougies à tout changement de marché, même venu de reloadSettings', async () => {
    await boot();
    await openChart();
    await answer(BTC, 60, [bar(T, 82_500, 5, 2)]);
    expect(s().cvdAnchoredAt).toBe(T);

    // La restauration d'un coffre a réécrit la ligne du chart ; le store la relit.
    rows.set('crypto.chart', { market: ONE, timeframe: 60, indicators: [] });
    await s().reloadSettings();
    expect(s().market).toBe(ONE);
    expect(s()).toMatchObject({ bars: [], proxyBars: [], cvdAnchoredAt: null });
    emitBar(BTC, 60, bar(T + H, 82_600, 1, 1));
    expect(s().bars).toEqual([]);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${ONE} 60`].sort());
    await answer(ONE, 60, [bar(T, 0.002163, 50_000, 20_000)]);
    expect(s().bars).toEqual([bar(T, 0.002163, 50_000, 20_000)]);
  });

  it('le CVD Binance suit l’indicateur, pour BTC et ONDO seulement', async () => {
    await boot();
    await openChart();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`].sort());
    await answer(BTC, 60, [bar(T, 82_500, 5)]);

    const added = await s().addIndicator('cvd-binance');
    if (!added.ok || !added.id) throw new Error('indicateur refusé');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`, `bars ${BTC_PROXY} 60`].sort());
    expect(fake.api.history).toHaveBeenLastCalledWith({ series: BTC_PROXY, timeframe: 60 });
    const proxy = [bar(T, 82_400, 30, 18)];
    await answer(BTC_PROXY, 60, proxy);
    expect(s().proxyBars).toEqual(proxy);
    emitBar(BTC_PROXY, 60, bar(T + H, 82_450, 4, 3));
    expect(s().proxyBars).toEqual([...proxy, bar(T + H, 82_450, 4, 3)]);
    // Les bougies du chart et leur ancre ne bougent pas.
    expect(s().bars).toEqual([bar(T, 82_500, 5)]);
    expect(s().cvdAnchoredAt).toBeNull();

    // Masqué : la série Binance est lâchée.
    await s().toggleIndicator(added.id);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`].sort());
    expect(s().proxyBars).toEqual([]);
    expect(s().bars).toEqual([bar(T, 82_500, 5)]);
    // Remontré : redemandée.
    await s().toggleIndicator(added.id);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`, `bars ${BTC_PROXY} 60`].sort());

    // ZIG et ONE n'ont pas de CVD Binance ; ONDO a le sien.
    await s().setMarket(ZIG);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${ZIG} 60`].sort());
    await s().setMarket(ONE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${ONE} 60`].sort());
    await s().setMarket(ONDO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${ONDO} 60`, `bars ${ONDO_PROXY} 60`].sort());
  });

  it('un refus du process principal reste un code dans l’état ; les bougies en direct continuent', async () => {
    await boot();
    await openChart();
    await answer(BTC, 60, { detail: 'no_history' });
    expect(s().chartError).toBe('no_history');
    emitBar(BTC, 60, bar(T + H, 82_600, 2, 1));
    expect(s().bars).toEqual([bar(T + H, 82_600, 2, 1)]);
    expect(s().cvdAnchoredAt).toBe(T + H);

    // Un changement de marché efface le refus de l'ancien.
    fake.main.refuse.set(ONE, 'blocked');
    await s().setMarket(ONE);
    expect(s().chartError).toBeNull();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();
    expect(s().chartError).toBe('blocked');
    await answer(ONE, 60, [bar(T, 0.002163, 50_000, 20_000)]);
    expect(s().bars).toEqual([bar(T, 0.002163, 50_000, 20_000)]);
    expect(s().chartError).toBe('blocked');
  });

  it('chart ouvert pendant que l’interrupteur est éteint : le flux lourd part à l’allumage', async () => {
    await boot({ enabled: false });
    await openChart();
    expect(fake.api.subscribe).not.toHaveBeenCalled();
    fake.pushStatus(true);
    await flush();
    expect(opened()).toEqual([...TICKERS, `bars ${BTC} 60`].sort());
    expect(fake.api.history).toHaveBeenCalledWith({ series: BTC, timeframe: 60 });
  });

  it('closeChart pendant une temporisation : aucune minuterie, rien n’est abonné ensuite', async () => {
    await boot();
    await openChart();
    await s().setMarket(ONE);
    expect(vi.getTimerCount()).toBe(1);
    s().closeChart();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(opened()).toEqual(TICKERS);
    expect(fake.api.history).toHaveBeenCalledTimes(1);
  });
});
