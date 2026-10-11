/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUNDING_STALE_MS, SLOW_STALE_MS, alertEvaluability, type CryptoAlert } from '@/engine/crypto/alerts';
import type { CryptoMarketId, CryptoTicker, CryptoVenue, VenueState } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { useI18n } from '@/i18n';
import { fmtPrice } from '@/lib/format';

/*
 * Le process principal simulé derrière `window.canto`, posé avant tout import (le desk le lit au chargement). Trois venues `live`
 * par défaut ; le test change leur état par `fake.pushStatus()`. Les abonnements s'ouvrent sans rien pousser : le test pousse ce
 * que le process principal pousserait (`emit`, `fake.listeners.temperature`). `broadcast` est la diffusion de l'orchestrateur.
 */
const fake = vi.hoisted(() => {
  type Venues = Record<'coinbase' | 'binance' | 'bybit', string>;
  const main = { enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } as Venues };
  const status = () => ({ enabled: main.enabled, venues: { ...main.venues } });
  const listeners = {
    event: new Set<(e: unknown) => void>(),
    temperature: new Set<(r: unknown) => void>(),
    status: new Set<(s: unknown) => void>(),
  };
  let n = 0;
  const api = {
    status: vi.fn(async () => status()),
    enable: vi.fn(async () => status()),
    disable: vi.fn(async () => status()),
    history: vi.fn(() => new Promise<never>(() => {})),
    subscribe: vi.fn(async () => ({ ok: true as const, subscriptionId: `sub-${++n}` })),
    unsubscribe: vi.fn(async () => ({ ok: true })),
    temperature: vi.fn(async () => null),
    onEvent: vi.fn((cb: (e: unknown) => void) => {
      listeners.event.add(cb);
      return () => listeners.event.delete(cb);
    }),
    onTemperature: vi.fn((cb: (r: unknown) => void) => {
      listeners.temperature.add(cb);
      return () => listeners.temperature.delete(cb);
    }),
    onStatus: vi.fn((cb: (s: unknown) => void) => {
      listeners.status.add(cb);
      return () => listeners.status.delete(cb);
    }),
  };
  const broadcast = vi.fn();
  (window as unknown as { canto: unknown }).canto = { crypto: api, orchestrator: { broadcast } };
  return {
    api,
    broadcast,
    main,
    listeners,
    /** Le process principal pousse son statut courant (interrupteur et venues) au renderer. */
    pushStatus() {
      for (const cb of [...listeners.status]) cb(status());
    },
  };
});

/** La table `settings` du renderer, en mémoire. `failing` : les clés dont l'écriture est refusée par la base ; `hanging` : celles dont elle n'aboutit jamais. */
const db = vi.hoisted(() => ({ rows: new Map<string, unknown>(), failing: new Set<string>(), hanging: new Set<string>() }));
vi.mock('@/store/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/db')>();
  return {
    ...actual,
    getSetting: vi.fn(async (key: string, fallback: unknown) => (db.rows.has(key) ? structuredClone(db.rows.get(key)) : fallback)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (db.failing.has(key)) throw new Error('QuotaExceededError');
      if (db.hanging.has(key)) return new Promise<void>(() => {});
      db.rows.set(key, structuredClone(value));
    }),
  };
});

import { CryptoAlertRunner } from '@/store/cryptoAlerts';
import { useCrypto } from '@/store/crypto';
import { deskEventLog } from '@/store/deskEvents';
import { useUi } from '@/store/ui';

const BTC: CryptoMarketId = 'coinbase:BTC-USD';
const ONDO: CryptoMarketId = 'coinbase:ONDO-USD';
const ONE: CryptoMarketId = 'binance:ONEUSDT';

/** Le 11 octobre 2026, midi UTC, en millisecondes. */
const NOW = Date.UTC(2026, 9, 11, 12);
const s = () => useCrypto.getState();

const LIVE: Record<CryptoVenue, VenueState> = { coinbase: 'live', binance: 'live', bybit: 'live' };

/** Une alerte armée de prix sur BTC-USD ; `over` écrase les champs. */
function alert(over: Partial<CryptoAlert> = {}): CryptoAlert {
  return { id: 'a1', target: BTC, kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW, ...over };
}
const tempAlert = (over: Partial<CryptoAlert> = {}): CryptoAlert => alert({ id: 'f1', target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm', ...over });

const tick = (market: CryptoMarketId, last: number, time = NOW): CryptoTicker => ({ market, last, change24hPct: null, time });

/** Une lecture de la température relevée à `at` ; chaque lecture peut avoir son propre âge. */
function reading(over: { median?: number | null; upShare?: number | null; long?: number; short?: number; fundingAt?: number; breadthAt?: number; liquidationsAt?: number } = {}): TemperatureReading {
  const { median = 0.00009, upShare = 0.42, long = 1_200_000, short = 800_000, fundingAt = NOW, breadthAt = NOW, liquidationsAt = NOW } = over;
  return {
    funding: median === null ? null : { median, btc: null, symbols: 312, at: fundingAt },
    breadth: upShare === null ? null : { upShare, pairs: 380, at: breadthAt },
    liquidations: { long, short, since: NOW - 3_600_000, at: liquidationsAt, lowerBound: true },
    openInterest: null,
  };
}

describe('alertEvaluability · la règle « non évaluée » partagée', () => {
  const data = (over: Partial<Parameters<typeof alertEvaluability>[1]> = {}): Parameters<typeof alertEvaluability>[1] => ({
    venues: LIVE,
    tickers: { [BTC]: tick(BTC, 85_000) },
    temperature: reading(),
    now: NOW,
    ...over,
  });

  it('un prix est évaluable sur une venue en direct qui a un prix', () => {
    expect(alertEvaluability(alert(), data())).toEqual({ ok: true });
  });

  it('la venue du marché visé décide : les autres venues n’y changent rien', () => {
    expect(alertEvaluability(alert(), data({ venues: { ...LIVE, bybit: 'blocked', binance: 'stale' } }))).toEqual({ ok: true });
    expect(alertEvaluability(alert(), data({ venues: { ...LIVE, coinbase: 'stale' } }))).toEqual({ ok: false, reason: { code: 'venue', venue: 'coinbase', state: 'stale' } });
    expect(alertEvaluability(alert({ target: ONE }), data({ venues: { ...LIVE, binance: 'blocked' }, tickers: { [ONE]: tick(ONE, 0.002163) } }))).toEqual({
      ok: false,
      reason: { code: 'venue', venue: 'binance', state: 'blocked' },
    });
  });

  it('un prix sans ticker n’est pas évalué : aucun prix reçu', () => {
    expect(alertEvaluability(alert(), data({ tickers: { [ONDO]: tick(ONDO, 0.8) } }))).toEqual({ ok: false, reason: { code: 'no_price' } });
  });

  it('la température sans lecture n’est pas évaluée', () => {
    expect(alertEvaluability(tempAlert(), data({ temperature: null }))).toEqual({ ok: false, reason: { code: 'no_temperature' } });
  });

  it('la température est évaluable quand Binance est en direct et la lecture fraîche', () => {
    for (const kind of ['funding_median_above', 'funding_median_below', 'liquidations_long_1h_above', 'liquidations_short_1h_above', 'breadth_above', 'breadth_below'] as const) {
      expect(alertEvaluability(tempAlert({ kind }), data()), kind).toEqual({ ok: true });
    }
  });

  it('Binance bloquée ou périmée : aucune alerte de température n’est évaluée, même sur une lecture fraîche', () => {
    for (const state of ['blocked', 'stale'] as const) {
      expect(alertEvaluability(tempAlert(), data({ venues: { ...LIVE, binance: state } })), state).toEqual({ ok: false, reason: { code: 'venue', venue: 'binance', state } });
      expect(alertEvaluability(tempAlert({ kind: 'breadth_below', level: 40 }), data({ venues: { ...LIVE, binance: state } })), state).toEqual({
        ok: false,
        reason: { code: 'venue', venue: 'binance', state },
      });
    }
    // Les autres venues n’y sont pour rien.
    expect(alertEvaluability(tempAlert(), data({ venues: { ...LIVE, coinbase: 'blocked', bybit: 'stale' } }))).toEqual({ ok: true });
  });

  it('le funding vieilli de plus de 120 s n’est plus évalué, à la milliseconde près', () => {
    expect(FUNDING_STALE_MS).toBe(120_000);
    const at = (age: number) => data({ temperature: reading({ fundingAt: NOW - age }) });
    expect(alertEvaluability(tempAlert(), at(FUNDING_STALE_MS))).toEqual({ ok: true });
    expect(alertEvaluability(tempAlert(), at(FUNDING_STALE_MS + 1))).toEqual({ ok: false, reason: { code: 'stale_reading', source: 'funding' } });
  });

  it('les liquidations vieillies de plus de 120 s, longues comme courtes, ne sont plus évaluées', () => {
    const old = data({ temperature: reading({ liquidationsAt: NOW - FUNDING_STALE_MS - 1 }) });
    for (const kind of ['liquidations_long_1h_above', 'liquidations_short_1h_above'] as const) {
      expect(alertEvaluability(tempAlert({ kind, level: 5_000_000 }), old), kind).toEqual({ ok: false, reason: { code: 'stale_reading', source: 'liquidations' } });
    }
  });

  it('la largeur vieillie de plus de 10 min n’est plus évaluée', () => {
    expect(SLOW_STALE_MS).toBe(600_000);
    const at = (age: number) => data({ temperature: reading({ breadthAt: NOW - age }) });
    expect(alertEvaluability(tempAlert({ kind: 'breadth_above', level: 40 }), at(SLOW_STALE_MS))).toEqual({ ok: true });
    expect(alertEvaluability(tempAlert({ kind: 'breadth_above', level: 40 }), at(SLOW_STALE_MS + 1))).toEqual({ ok: false, reason: { code: 'stale_reading', source: 'breadth' } });
  });

  it('une lecture absente est dite absente, jamais périmée', () => {
    expect(alertEvaluability(tempAlert(), data({ temperature: reading({ median: null }) }))).toEqual({ ok: false, reason: { code: 'no_reading', source: 'funding' } });
    expect(alertEvaluability(tempAlert({ kind: 'breadth_below', level: 40 }), data({ temperature: reading({ upShare: null }) }))).toEqual({ ok: false, reason: { code: 'no_reading', source: 'breadth' } });
    // Une heure de relevé qui n’en est pas une ne passe pas pour fraîche.
    expect(alertEvaluability(tempAlert(), data({ temperature: reading({ fundingAt: Number.NaN }) }))).toEqual({ ok: false, reason: { code: 'no_reading', source: 'funding' } });
  });

  it('chaque genre lit sa propre lecture : un funding périmé n’éteint pas la largeur', () => {
    const mixed = data({ temperature: reading({ fundingAt: NOW - 10 * 60_000 }) });
    expect(alertEvaluability(tempAlert(), mixed)).toEqual({ ok: false, reason: { code: 'stale_reading', source: 'funding' } });
    expect(alertEvaluability(tempAlert({ kind: 'breadth_above', level: 40 }), mixed)).toEqual({ ok: true });
    expect(alertEvaluability(tempAlert({ kind: 'liquidations_long_1h_above', level: 5_000_000 }), mixed)).toEqual({ ok: true });
  });
});

describe('CryptoAlertRunner', () => {
  const prices = (runner: CryptoAlertRunner, values: readonly number[], fresh = true, market: CryptoMarketId = BTC): number[] =>
    values.flatMap((v) => (runner.onTicker(tick(market, v), fresh).length > 0 ? [v] : []));

  it('signale une seule fois le franchissement d’un prix, la première lecture ne posant que le côté', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert()]);
    expect(runner.onTicker(tick(BTC, 95_000), true)).toEqual([]);
    expect(runner.onTicker(tick(BTC, 96_000), true)).toEqual([]);

    const fresh = new CryptoAlertRunner();
    fresh.sync([alert()]);
    expect(fresh.onTicker(tick(BTC, 89_000), true)).toEqual([]);
    expect(fresh.onTicker(tick(BTC, 90_100), true)).toEqual([alert()]);
    expect(fresh.onTicker(tick(BTC, 90_200), true)).toEqual([]);
    expect(fresh.onTicker(tick(BTC, 90_300), true)).toEqual([]);
  });

  it('n’évalue pas une donnée non fraîche : ni franchissement, ni côté posé', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert({ mode: 'rearm' })]);
    expect(prices(runner, [89_000], true)).toEqual([]);
    // Franchi pendant que la venue n’est pas en direct : rien n’est signalé.
    expect(prices(runner, [91_000, 92_000], false)).toEqual([]);
    // Dès que la donnée est fraîche, le franchissement manqué est signalé une fois.
    expect(prices(runner, [91_500, 91_600], true)).toEqual([91_500]);

    const blind = new CryptoAlertRunner();
    blind.sync([alert()]);
    // Le premier pas fraîche pose le côté : un prix déjà au-dessus ne déclenche pas.
    expect(prices(blind, [95_000], false)).toEqual([]);
    expect(prices(blind, [96_000], true)).toEqual([]);
  });

  it('rearm : se redéclenche après un retour au-delà de la bande d’hystérésis, pas avant', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert({ mode: 'rearm' })]);
    // Bande de 0,1 % de 90 000 = 90 : 89 950 reste dans la bande, 89 000 la quitte.
    expect(prices(runner, [89_000, 90_100, 89_950, 90_200, 89_000, 90_100])).toEqual([90_100, 90_100]);
  });

  it('once : une fois signalée, elle ne l’est plus, même si le store n’a pas encore enregistré son état', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert({ mode: 'once' })]);
    expect(prices(runner, [89_000, 90_100, 89_000, 90_100])).toEqual([90_100]);
    // Le store repasse l’alerte à triggered : sa veille tombe. Réarmée à la main, elle repart d’une première lecture.
    runner.sync([alert({ mode: 'once', state: 'triggered', lastTriggeredAt: NOW })]);
    runner.sync([alert({ mode: 'once' })]);
    expect(prices(runner, [95_000, 89_000, 90_100])).toEqual([90_100]);
  });

  it('un prix n’est évalué que sur le ticker de son marché', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert(), alert({ id: 'a2', target: ONDO, level: 1 })]);
    // Le ticker d’ONDO ne touche pas l’alerte de BTC, ni l’inverse.
    expect(runner.onTicker(tick(ONDO, 0.9), true)).toEqual([]);
    expect(runner.onTicker(tick(ONDO, 1.1), true).map((a) => a.id)).toEqual(['a2']);
    expect(runner.onTicker(tick(BTC, 85_000), true)).toEqual([]);
    expect(runner.onTicker(tick(BTC, 90_500), true).map((a) => a.id)).toEqual(['a1']);
  });

  it('une alerte en pause ou déjà déclenchée n’est pas évaluée', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert({ id: 'p', state: 'paused' }), alert({ id: 't', state: 'triggered', lastTriggeredAt: NOW })]);
    expect(prices(runner, [85_000, 91_000, 85_000, 91_000])).toEqual([]);
    // Réarmée, elle est évaluée comme une alerte neuve.
    runner.sync([alert({ id: 'p', state: 'armed' })]);
    expect(runner.onTicker(tick(BTC, 91_000), true)).toEqual([]);
    expect(runner.onTicker(tick(BTC, 85_000), true)).toEqual([]);
    expect(runner.onTicker(tick(BTC, 91_000), true).map((a) => a.id)).toEqual(['p']);
  });

  it('un prix non fini n’est pas évalué', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert()]);
    expect(runner.onTicker(tick(BTC, Number.NaN), true)).toEqual([]);
    // Le NaN n’a pas posé le côté : 89 000 le pose, 90 100 franchit.
    expect(prices(runner, [89_000, 90_100])).toEqual([90_100]);
  });

  it('funding à 0,01 : se déclenche quand la médiane passe de 0,00009 à 0,00011', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([tempAlert()]);
    expect(runner.onTemperature(reading({ median: 0.00009 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00011 }), true)).toEqual([tempAlert()]);
    // 0,0099 % reste dans la bande de 0,0005 point : pas de nouveau déclenchement au retour.
    expect(runner.onTemperature(reading({ median: 0.000099 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00011 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00009 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00011 }), true)).toEqual([tempAlert()]);
  });

  it('n’évalue pas une lecture de température non fraîche', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([tempAlert()]);
    expect(runner.onTemperature(reading({ median: 0.00009 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00011 }), false)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00012 }), true)).toEqual([tempAlert()]);
  });

  it('juge la fraîcheur alerte par alerte quand l’appelant donne une fonction : un funding périmé n’éteint pas la largeur', () => {
    const runner = new CryptoAlertRunner();
    const funding = tempAlert();
    const breadth = tempAlert({ id: 'b1', kind: 'breadth_above', level: 40 });
    runner.sync([funding, breadth]);
    const onlyBreadth = (a: CryptoAlert) => a.kind === 'breadth_above';
    expect(runner.onTemperature(reading({ median: 0.00009, upShare: 0.38 }), onlyBreadth)).toEqual([]);
    expect(runner.onTemperature(reading({ median: 0.00011, upShare: 0.42 }), onlyBreadth)).toEqual([breadth]);
  });

  it('lit les liquidations et la largeur dans leur unité', () => {
    const runner = new CryptoAlertRunner();
    const long = tempAlert({ id: 'l', kind: 'liquidations_long_1h_above', level: 5_000_000 });
    const short = tempAlert({ id: 's', kind: 'liquidations_short_1h_above', level: 2_000_000 });
    const down = tempAlert({ id: 'd', kind: 'breadth_below', level: 40 });
    runner.sync([long, short, down]);
    expect(runner.onTemperature(reading({ long: 4_000_000, short: 1_000_000, upShare: 0.42 }), true)).toEqual([]);
    expect(runner.onTemperature(reading({ long: 5_100_000, short: 1_500_000, upShare: 0.39 }), true)).toEqual([long, down]);
  });

  it('garde sa veille d’un sync à l’autre quand l’alerte ne change pas', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert({ mode: 'rearm' })]);
    expect(prices(runner, [89_000])).toEqual([]);
    // Le store réécrit l’alerte (lastTriggeredAt, autre alerte ajoutée) : son niveau, son genre, son mode, sa cible sont les mêmes.
    runner.sync([alert({ mode: 'rearm', lastTriggeredAt: NOW }), alert({ id: 'a2', target: ONE, level: 0.0025 })]);
    expect(prices(runner, [90_100])).toEqual([90_100]);
  });

  it('remplace la veille d’une alerte dont le niveau, le genre, le mode ou la cible change', () => {
    const changed: Partial<CryptoAlert>[] = [{ level: 88_000 }, { kind: 'price_below' }, { mode: 'rearm' }, { target: ONDO }];
    for (const over of changed) {
      const runner = new CryptoAlertRunner();
      runner.sync([alert()]);
      expect(runner.onTicker(tick(BTC, 89_000), true)).toEqual([]);
      runner.sync([alert(over)]);
      // La veille neuve repart d’une première lecture : 91 000 pose le côté sans signaler, là où l’ancienne, restée sous 90 000, aurait franchi.
      expect(runner.onTicker(tick((over.target ?? BTC) as CryptoMarketId, 91_000), true), JSON.stringify(over)).toEqual([]);
    }
    // Le niveau neuf est celui qui compte : 87 000 pose le côté sous 88 000, 88 100 franchit (l’ancien niveau, 90 000, ne l’aurait pas fait).
    const runner = new CryptoAlertRunner();
    runner.sync([alert()]);
    runner.sync([alert({ level: 88_000 })]);
    expect(prices(runner, [87_000, 88_100])).toEqual([88_100]);
  });

  it('abandonne la veille d’une alerte supprimée', () => {
    const runner = new CryptoAlertRunner();
    runner.sync([alert()]);
    expect(prices(runner, [89_000])).toEqual([]);
    runner.sync([]);
    expect(prices(runner, [91_000])).toEqual([]);
    runner.sync([alert()]);
    // Recréée : première lecture, 91 000 pose le côté au-dessus du niveau sans signaler.
    expect(prices(runner, [91_000, 89_000, 90_100])).toEqual([90_100]);
  });
});

// --- Le store : le flux léger nourrit l'évaluation, onglet fermé -------------------------------------------------------------

/** Laisse passer les réponses du faux process principal et les suites du port (plusieurs tours de microtâches). */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Le process principal pousse un ticker : chaque écoute ouverte le reçoit. */
function emitTicker(market: CryptoMarketId, last: number, time = Date.now()) {
  for (const cb of [...fake.listeners.event]) cb({ kind: 'ticker', ticker: { market, last, change24hPct: null, time } });
}

/** Le process principal pousse une lecture de la température. */
function emitReading(r: TemperatureReading) {
  for (const cb of [...fake.listeners.temperature]) cb(r);
}

/** Change l'état des venues chez le process principal et le pousse au renderer. */
async function venues(over: Partial<Record<CryptoVenue, VenueState>>) {
  Object.assign(fake.main.venues, over);
  fake.pushStatus();
  await flush();
}

/** Le desk à l'ouverture : réglages dans la table, interrupteur allumé, `load()`. Aucun composant de l'onglet n'est monté. */
async function boot(alerts: CryptoAlert[] = []) {
  db.rows.clear();
  if (alerts.length > 0) db.rows.set('crypto.alerts', alerts);
  await s().load();
  await flush();
}

let baseline = 0;
const events = () => deskEventLog.read({ kinds: ['crypto_alert'], limit: 200 }).events.filter((e) => e.seq > baseline);
const toasts = () => useUi.getState().toasts;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  useI18n.setState({ locale: 'fr' });
  useUi.setState({ toasts: [] });
  db.failing.clear();
  db.hanging.clear();
  Object.assign(fake.main, { enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } });
  fake.broadcast.mockClear();
  useCrypto.setState(useCrypto.getInitialState(), true);
  await flush();
  baseline = deskEventLog.last()?.seq ?? 0;
});

afterEach(async () => {
  useCrypto.setState(useCrypto.getInitialState(), true);
  await flush();
  expect(fake.listeners.event.size).toBe(0);
  expect(fake.listeners.temperature.size).toBe(0);
  vi.clearAllTimers();
  vi.useRealTimers();
  useUi.setState({ toasts: [] });
});

describe('le store signale les alertes, onglet fermé', () => {
  it('prix once : un toast warn, un événement crypto_alert, l’alerte passe à triggered', async () => {
    await boot([alert({ level: 85_000 })]);
    emitTicker(BTC, 84_000);
    expect(toasts()).toEqual([]);
    expect(events()).toEqual([]);

    emitTicker(BTC, 85_100);
    await flush();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.tone).toBe('warn');
    const text = toasts()[0]!.text;
    expect(text).toContain('BTC-USD');
    expect(text).toContain(fmtPrice(85_000, 2));
    expect(text).toContain(fmtPrice(85_100, 2));
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ kind: 'crypto_alert', data: { alertId: 'a1', target: BTC, kind: 'price_above', level: 85_000, value: 85_100, author: 'trader' } });
    // L'orchestrateur diffuse le même événement.
    expect(fake.broadcast).toHaveBeenCalledWith('crypto_alert', expect.objectContaining({ data: expect.objectContaining({ alertId: 'a1', value: 85_100 }) }));
    // L'état est enregistré : triggered, avec l'instant du franchissement.
    expect(s().alerts).toMatchObject([{ id: 'a1', state: 'triggered', lastTriggeredAt: NOW }]);
    expect(db.rows.get('crypto.alerts')).toMatchObject([{ id: 'a1', state: 'triggered', lastTriggeredAt: NOW }]);

    // Pas de seconde alerte, même si le prix repasse et franchit de nouveau.
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_200);
    await flush();
    expect(toasts()).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('prix rearm : reste armée avec lastTriggeredAt, puis se redéclenche après son retour', async () => {
    await boot([alert({ level: 85_000, mode: 'rearm', author: 'agent' })]);
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    await flush();
    expect(events()).toHaveLength(1);
    expect(events()[0]!.data).toMatchObject({ author: 'agent' });
    expect(s().alerts).toMatchObject([{ state: 'armed', lastTriggeredAt: NOW }]);

    emitTicker(BTC, 85_150);
    emitTicker(BTC, 84_950);
    await flush();
    expect(events()).toHaveLength(1);

    vi.setSystemTime(NOW + 60_000);
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_300);
    await flush();
    expect(events()).toHaveLength(2);
    expect(toasts()).toHaveLength(2);
    expect(s().alerts).toMatchObject([{ state: 'armed', lastTriggeredAt: NOW + 60_000 }]);
  });

  it('formate le niveau à la précision du marché : ONEUSDT à six décimales', async () => {
    await boot([alert({ id: 'o', target: ONE, level: 0.002163, mode: 'rearm' })]);
    emitTicker(ONE, 0.00215);
    emitTicker(ONE, 0.002171);
    await flush();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.text).toContain(fmtPrice(0.002163, 6));
    expect(toasts()[0]!.text).toContain(fmtPrice(0.002171, 6));
    expect(events()[0]!.data).toMatchObject({ target: ONE, level: 0.002163, value: 0.002171 });
  });

  it('température : le funding à 0,01 se déclenche quand la médiane passe de 0,00009 à 0,00011', async () => {
    await boot([tempAlert()]);
    emitReading(reading({ median: 0.00009 }));
    expect(events()).toEqual([]);
    emitReading(reading({ median: 0.00011 }));
    await flush();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ kind: 'crypto_alert', data: { alertId: 'f1', target: 'temperature', kind: 'funding_median_above', level: 0.01, author: 'trader' } });
    // La valeur est dans l'unité du niveau : la médiane en pourcentage, arrondie à la précision affichée (4 décimales),
    // sans le bruit du produit 0,00011 × 100 = 0,011000000000000001 que l'agent lirait par `desk_events`.
    expect(events()[0]!.data.value).toBe(0.011);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.tone).toBe('warn');
    expect(toasts()[0]!.text).toContain('0,0100 %');
    expect(s().alerts).toMatchObject([{ state: 'armed', lastTriggeredAt: NOW }]);
  });

  it('la valeur de l’événement est arrondie à la précision affichée de l’alerte : largeur 1 décimale, liquidations au dollar', async () => {
    await boot([tempAlert({ id: 'b1', kind: 'breadth_above', level: 40, mode: 'once' }), tempAlert({ id: 'l1', kind: 'liquidations_long_1h_above', level: 5_000_000, mode: 'once' })]);
    emitReading(reading({ upShare: 0.39, long: 4_000_000 }));
    emitReading(reading({ upShare: 0.40567, long: 5_000_123.456 }));
    await flush();
    const byId = Object.fromEntries(events().map((e) => [e.data.alertId, e.data.value]));
    expect(byId).toEqual({ b1: 40.6, l1: 5_000_123 });
  });

  it('texte du toast dans les trois langues', async () => {
    await boot([alert({ level: 85_000, mode: 'rearm' })]);
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    await flush();
    useI18n.setState({ locale: 'en' });
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    useI18n.setState({ locale: 'es' });
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    await flush();
    const [fr, en, es] = toasts().map((t) => t.text);
    expect(fr).toMatch(/Alerte crypto/);
    expect(en).toMatch(/Crypto alert/);
    expect(en).toMatch(/Price above/);
    expect(es).toMatch(/Alerta cripto/);
    expect(es).toMatch(/Precio por encima de/);
  });

  it('une alerte créée après le dernier prix part de ce prix : le franchissement suivant la déclenche', async () => {
    await boot();
    emitTicker(BTC, 84_000);
    expect(await s().createAlert({ target: BTC, kind: 'price_above', level: 85_000, mode: 'once' })).toMatchObject({ ok: true });
    await flush();
    expect(events()).toEqual([]);
    emitTicker(BTC, 85_100);
    await flush();
    expect(events()).toHaveLength(1);
  });

  it('une donnée qui n’est pas en direct n’est pas évaluée : venue périmée, relevé périmé, Binance bloquée', async () => {
    await boot([alert({ level: 85_000, mode: 'rearm' }), tempAlert()]);
    emitTicker(BTC, 84_000);
    emitReading(reading({ median: 0.00009 }));

    await venues({ coinbase: 'stale' });
    emitTicker(BTC, 90_000);
    expect(events()).toEqual([]);
    await venues({ coinbase: 'live' });

    // Un relevé du funding plus vieux que deux cadences.
    emitReading(reading({ median: 0.00011, fundingAt: NOW - FUNDING_STALE_MS - 1 }));
    expect(events().map((e) => e.data.alertId)).toEqual([]);

    // Un relevé frais, mais Binance bloquée : la température n'est pas évaluée.
    await venues({ binance: 'blocked' });
    emitReading(reading({ median: 0.00012 }));
    expect(events()).toEqual([]);
    await venues({ binance: 'live' });

    // Tout redevient évaluable : le prochain pas signale.
    emitReading(reading({ median: 0.00013 }));
    emitTicker(BTC, 90_100);
    await flush();
    expect(events().map((e) => e.data.alertId).sort()).toEqual(['a1', 'f1']);
  });

  it('juge chaque lecture à sa cadence : le funding périmé n’empêche pas la largeur', async () => {
    await boot([tempAlert(), tempAlert({ id: 'b1', kind: 'breadth_above', level: 40 })]);
    emitReading(reading({ median: 0.00009, upShare: 0.38 }));
    emitReading(reading({ median: 0.00011, upShare: 0.42, fundingAt: NOW - FUNDING_STALE_MS - 1 }));
    await flush();
    expect(events().map((e) => e.data.alertId)).toEqual(['b1']);
  });

  it('éteindre le module arrête l’évaluation', async () => {
    await boot([alert({ level: 85_000, mode: 'rearm' })]);
    emitTicker(BTC, 84_000);
    fake.main.enabled = false;
    fake.pushStatus();
    await flush();
    expect(s().enabled).toBe(false);
    useCrypto.setState({ tickers: { [BTC]: tick(BTC, 90_000) } });
    useCrypto.setState({ tickers: { [BTC]: tick(BTC, 90_100) } });
    await flush();
    expect(events()).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('une base qui refuse l’écriture de l’état : l’alerte est signalée une fois, un toast warn le dit, aucun rejet non géré', async () => {
    await boot([alert({ level: 85_000 })]);
    db.failing.add('crypto.alerts');
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    await flush();
    expect(events()).toHaveLength(1);
    const warn = toasts().filter((t) => t.tone === 'warn');
    expect(warn).toHaveLength(2);
    expect(warn.some((t) => t.text.includes('base du desk'))).toBe(true);
    // L'état à l'écran a changé : l'alerte once est triggered, elle ne se redéclenchera pas.
    expect(s().alerts).toMatchObject([{ state: 'triggered' }]);
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_200);
    await flush();
    expect(events()).toHaveLength(1);
  });

  it('une écriture de l’état encore en attente ne fait pas signaler l’alerte deux fois', async () => {
    await boot([alert({ level: 85_000, mode: 'rearm' })]);
    db.hanging.add('crypto.alerts');
    emitTicker(BTC, 84_000);
    emitTicker(BTC, 85_100);
    emitTicker(BTC, 85_200);
    emitTicker(BTC, 85_300);
    await flush();
    expect(events()).toHaveLength(1);
    expect(toasts()).toHaveLength(1);
  });
});
