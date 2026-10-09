import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALERTS_MAX,
  CRYPTO_ALERT_KINDS,
  CrossWatch,
  alertDirection,
  alertValue,
  hysteresisBand,
  sanitizeAlerts,
  validateAlert,
  type CryptoAlert,
  type CryptoAlertKind,
} from '@/engine/crypto/alerts';
import { DEFAULT_CRYPTO_INDICATORS } from '@/engine/crypto/indicators';
import { CHARTABLE_MARKETS, type CryptoMarketId, type CryptoTicker } from '@/engine/crypto/markets';
import { DRAWINGS_MAX, LABEL_MAX, sanitizeCryptoChart, sanitizeDrawings, sanitizeWatchlist, type CryptoDrawing } from '@/engine/crypto/persist';
import { emptyReading, type TemperatureReading } from '@/engine/crypto/temperature';

/** Le 9 octobre 2026, midi UTC, en millisecondes : l’unité de `createdAt` et des relevés. */
const NOW = Date.parse('2026-10-09T12:00:00Z');

type AlertData = Parameters<typeof alertValue>[1];
type AlertInput = Parameters<typeof validateAlert>[0];

/** Une alerte de prix valide sur BTC-USD ; `over` écrase les champs. */
function alert(over: Partial<CryptoAlert> = {}): CryptoAlert {
  return { id: 'a1', target: 'coinbase:BTC-USD', kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW, ...over };
}

/** Une alerte valide du genre demandé, sur sa cible et dans son unité. */
function sample(kind: CryptoAlertKind): CryptoAlert {
  const price = kind === 'price_above' || kind === 'price_below';
  const level = price ? 90_000 : kind.startsWith('funding') ? 0.01 : kind.startsWith('breadth') ? 40 : 5_000_000;
  return alert({ id: kind, kind, target: price ? 'coinbase:BTC-USD' : 'temperature', level });
}

/** Ce que `validateAlert` reçoit, avec des valeurs que le type refuserait. */
function input(over: Record<string, unknown> = {}): AlertInput {
  return { target: 'coinbase:BTC-USD', kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', ...over } as unknown as AlertInput;
}

const ticker = (market: CryptoMarketId, last: number): CryptoTicker => ({ market, last, change24hPct: null, time: NOW });
const funding = (median: number): NonNullable<TemperatureReading['funding']> => ({ median, btc: median, symbols: 300, at: NOW });
const breadth = (upShare: number): NonNullable<TemperatureReading['breadth']> => ({ upShare, pairs: 500, at: NOW });
const reading = (over: Partial<TemperatureReading> = {}): TemperatureReading => ({ ...emptyReading(NOW), ...over });
const data = (tickers: AlertData['tickers'] = {}, temperature: TemperatureReading | null = null): AlertData => ({ tickers, temperature });

/** Ce que fait l’évaluateur du desk : la valeur de l’alerte, puis un pas de son `CrossWatch`. */
function feed(watch: CrossWatch, a: CryptoAlert, d: AlertData): boolean {
  const value = alertValue(a, d);
  if (value === null) throw new Error('aucune valeur à évaluer');
  return watch.step(value);
}

/** Un objet lu dans un JSON : `__proto__` et `constructor` y sont des propriétés propres, comme dans un coffre importé. */
const fromJson = (text: string): unknown => JSON.parse(text);

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

/** Aucune pollution n’a atteint les objets ordinaires. */
function expectNoPollution(): void {
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
}

describe('CrossWatch', () => {
  const run = (watch: CrossWatch, values: readonly number[]): boolean[] => values.map((value) => watch.step(value));

  it('ne signale rien au premier pas, que la valeur soit déjà au-delà du niveau ou non', () => {
    expect(new CrossWatch('above', 100, 1).step(150)).toBe(false);
    expect(new CrossWatch('above', 100, 1).step(50)).toBe(false);
    expect(new CrossWatch('below', 100, 1).step(50)).toBe(false);
    expect(new CrossWatch('below', 100, 1).step(150)).toBe(false);
  });

  it('ne signale rien tant que la valeur reste du côté où elle a commencé', () => {
    expect(run(new CrossWatch('above', 100, 1), [150, 160, 140, 120])).toEqual([false, false, false, false]);
    expect(run(new CrossWatch('above', 100, 1), [50, 60, 99.99])).toEqual([false, false, false]);
    expect(run(new CrossWatch('below', 100, 1), [50, 60, 80])).toEqual([false, false, false]);
    expect(run(new CrossWatch('below', 100, 1), [150, 140, 100.01])).toEqual([false, false, false]);
  });

  it('signale une seule fois le franchissement vers le haut, dès le niveau exact', () => {
    expect(run(new CrossWatch('above', 100, 1), [99, 100, 101, 150, 100])).toEqual([false, true, false, false, false]);
  });

  it('ne se réarme qu’une fois la valeur repassée sous level − band', () => {
    // 99 vaut level − band : pas encore sous la bande, le niveau n’alerte pas une seconde fois.
    expect(run(new CrossWatch('above', 100, 1), [99, 100, 99.5, 99, 100])).toEqual([false, true, false, false, false]);
    // 98,99 est sous la bande : réarmé ; 99,5 ne franchit pas le niveau ; 100 le franchit.
    expect(run(new CrossWatch('above', 100, 1), [99, 100, 98.99, 99.5, 100])).toEqual([false, true, false, false, true]);
  });

  it('signale chaque franchissement successif, une fois chacun', () => {
    expect(run(new CrossWatch('above', 100, 1), [90, 100, 90, 100, 90, 100])).toEqual([false, true, false, true, false, true]);
  });

  it('est le miroir vers le bas : franchissement au niveau exact, réarmement au-dessus de level + band', () => {
    // 101 vaut level + band : pas encore au-dessus de la bande.
    expect(run(new CrossWatch('below', 100, 1), [101, 100, 99, 101, 100])).toEqual([false, true, false, false, false]);
    expect(run(new CrossWatch('below', 100, 1), [101, 100, 101.01, 100.5, 100])).toEqual([false, true, false, false, true]);
    expect(run(new CrossWatch('below', 100, 1), [110, 100, 110, 100, 110, 100])).toEqual([false, true, false, true, false, true]);
  });

  it('ignore une valeur non finie : elle ne pose pas le côté et ne franchit rien', () => {
    // 150 est le premier pas : le NaN d’avant n’a posé aucun côté, sans quoi 150 serait un franchissement.
    expect(run(new CrossWatch('above', 100, 1), [Number.NaN, 150])).toEqual([false, false]);
    expect(run(new CrossWatch('above', 100, 1), [90, Number.POSITIVE_INFINITY, 100])).toEqual([false, false, true]);
    expect(run(new CrossWatch('below', 100, 1), [110, Number.NEGATIVE_INFINITY, 100])).toEqual([false, false, true]);
  });

  it('tient une bande relative au niveau pour un prix minuscule (ONE 0,002163)', () => {
    const level = 0.002163;
    const watch = new CrossWatch('above', level, hysteresisBand('price_above', level));
    // La bande de 0,1 % ramène la limite à 0,002160837 : 0,002162 et 0,0021625 restent dedans, 0,0021608 en sort.
    expect(run(watch, [0.00216, 0.002163, 0.002162, 0.0021625, 0.002164, 0.0021608, 0.002163])).toEqual([false, true, false, false, false, false, true]);
  });

  it('tient une bande relative au niveau pour un prix énorme (BTC 82 528)', () => {
    const level = 82_528;
    const watch = new CrossWatch('above', level, hysteresisBand('price_above', level));
    // La bande vaut 82,528 : 82 500 et 82 460 restent dedans, 82 445 en sort.
    expect(run(watch, [82_000, 82_528, 82_500, 82_460, 82_528, 82_445, 82_528])).toEqual([false, true, false, false, false, false, true]);
  });

  it('déclenche l’alerte funding à 0,01 quand la médiane passe de 0,00009 à 0,00011', () => {
    const a = alert({ target: 'temperature', kind: 'funding_median_above', level: 0.01 });
    const watch = new CrossWatch(alertDirection(a.kind), a.level, hysteresisBand(a.kind, a.level));
    expect(feed(watch, a, data({}, reading({ funding: funding(0.00009) })))).toBe(false);
    expect(feed(watch, a, data({}, reading({ funding: funding(0.00011) })))).toBe(true);
    // 0,0099 % reste dans la bande de 0,0005 point : pas de nouvelle alerte au retour.
    expect(feed(watch, a, data({}, reading({ funding: funding(0.000099) })))).toBe(false);
    expect(feed(watch, a, data({}, reading({ funding: funding(0.00011) })))).toBe(false);
    expect(feed(watch, a, data({}, reading({ funding: funding(0.00009) })))).toBe(false);
    expect(feed(watch, a, data({}, reading({ funding: funding(0.00011) })))).toBe(true);
  });
});

describe('hysteresisBand', () => {
  it('vaut 0,1 % du niveau pour un prix, à toute échelle', () => {
    expect(hysteresisBand('price_above', 0.002)).toBeCloseTo(0.000002, 12);
    expect(hysteresisBand('price_below', 0.002)).toBeCloseTo(0.000002, 12);
    expect(hysteresisBand('price_above', 85_000)).toBeCloseTo(85, 9);
    expect(hysteresisBand('price_below', 85_000)).toBeCloseTo(85, 9);
    expect(hysteresisBand('price_above', 0.002163)).toBeCloseTo(0.000002163, 14);
    expect(hysteresisBand('price_above', 82_528)).toBeCloseTo(82.528, 9);
  });

  it('vaut 0,0005 point pour le funding, quel que soit le niveau', () => {
    for (const level of [0.01, 0.3, -0.02]) {
      expect(hysteresisBand('funding_median_above', level), String(level)).toBe(0.0005);
      expect(hysteresisBand('funding_median_below', level), String(level)).toBe(0.0005);
    }
  });

  it('vaut 5 % du niveau pour les liquidations', () => {
    expect(hysteresisBand('liquidations_long_1h_above', 4_000_000)).toBeCloseTo(200_000, 6);
    expect(hysteresisBand('liquidations_short_1h_above', 4_000_000)).toBeCloseTo(200_000, 6);
    expect(hysteresisBand('liquidations_long_1h_above', 1_200_000)).toBeCloseTo(60_000, 6);
  });

  it('vaut 1 point pour la largeur, quel que soit le niveau', () => {
    for (const level of [25, 40, 75]) {
      expect(hysteresisBand('breadth_above', level), String(level)).toBe(1);
      expect(hysteresisBand('breadth_below', level), String(level)).toBe(1);
    }
  });

  it('n’est jamais négative', () => {
    for (const kind of CRYPTO_ALERT_KINDS) {
      for (const level of [-1_000_000, -5, -0.001, 0, 0.5, 1_000_000]) expect(hysteresisBand(kind, level), `${kind} ${level}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('alertDirection', () => {
  it('lit le côté surveillé dans le genre', () => {
    expect(Object.fromEntries(CRYPTO_ALERT_KINDS.map((kind) => [kind, alertDirection(kind)]))).toEqual({
      price_above: 'above',
      price_below: 'below',
      funding_median_above: 'above',
      funding_median_below: 'below',
      liquidations_long_1h_above: 'above',
      liquidations_short_1h_above: 'above',
      breadth_above: 'above',
      breadth_below: 'below',
    });
  });

  it('compte les huit genres du § 8, ceux de prix d’abord', () => {
    expect(CRYPTO_ALERT_KINDS).toEqual([
      'price_above',
      'price_below',
      'funding_median_above',
      'funding_median_below',
      'liquidations_long_1h_above',
      'liquidations_short_1h_above',
      'breadth_above',
      'breadth_below',
    ]);
  });
});

describe('alertValue', () => {
  const btc = alert({ kind: 'price_above', target: 'coinbase:BTC-USD' });
  const one = alert({ kind: 'price_below', target: 'binance:ONEUSDT', level: 0.002 });
  const hot = reading({
    funding: funding(0.0001),
    breadth: breadth(0.4),
    liquidations: { long: 4_100_000, short: 1_200_000, since: NOW - 3_600_000, at: NOW, lowerBound: true },
  });

  it('lit le dernier prix du marché visé, à son échelle', () => {
    const tickers = { 'coinbase:BTC-USD': ticker('coinbase:BTC-USD', 82_528), 'binance:ONEUSDT': ticker('binance:ONEUSDT', 0.002163) };
    expect(alertValue(btc, data(tickers))).toBe(82_528);
    expect(alertValue(one, data(tickers))).toBe(0.002163);
  });

  it('rend null sans ticker du marché visé, même quand un autre marché en a un', () => {
    expect(alertValue(btc, data())).toBeNull();
    expect(alertValue(btc, data({ 'coinbase:ONDO-USD': ticker('coinbase:ONDO-USD', 1.2) }))).toBeNull();
  });

  it('rend null pour un prix non fini ou qui n’est pas un nombre', () => {
    for (const last of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '82528', null, undefined]) {
      const tickers = { 'coinbase:BTC-USD': { ...ticker('coinbase:BTC-USD', 1), last } } as unknown as AlertData['tickers'];
      expect(alertValue(btc, data(tickers)), String(last)).toBeNull();
    }
  });

  it('rend null pour une alerte de prix qui vise la température', () => {
    const wrong = alert({ kind: 'price_above', target: 'temperature' });
    expect(alertValue(wrong, data({ 'coinbase:BTC-USD': ticker('coinbase:BTC-USD', 82_528) }, hot))).toBeNull();
  });

  it('lit le funding en pourcentage : la médiane × 100 (0,0001 vaut 0,01 %)', () => {
    expect(alertValue(sample('funding_median_above'), data({}, hot))).toBeCloseTo(0.01, 12);
    expect(alertValue(sample('funding_median_below'), data({}, hot))).toBeCloseTo(0.01, 12);
    expect(alertValue(sample('funding_median_below'), data({}, reading({ funding: funding(-0.0002) })))).toBeCloseTo(-0.02, 12);
  });

  it('lit les liquidations en dollars, longues et courtes à part', () => {
    expect(alertValue(sample('liquidations_long_1h_above'), data({}, hot))).toBe(4_100_000);
    expect(alertValue(sample('liquidations_short_1h_above'), data({}, hot))).toBe(1_200_000);
  });

  it('lit zéro liquidation comme une valeur, pas comme une donnée absente', () => {
    expect(alertValue(sample('liquidations_long_1h_above'), data({}, reading()))).toBe(0);
    expect(alertValue(sample('liquidations_short_1h_above'), data({}, reading()))).toBe(0);
  });

  it('lit la largeur en points de pourcentage : upShare × 100 (0,4 vaut 40)', () => {
    expect(alertValue(sample('breadth_above'), data({}, hot))).toBeCloseTo(40, 9);
    expect(alertValue(sample('breadth_below'), data({}, reading({ breadth: breadth(0) })))).toBe(0);
    expect(alertValue(sample('breadth_below'), data({}, reading({ breadth: breadth(1) })))).toBeCloseTo(100, 9);
  });

  it('rend null pour toute alerte de température sans relevé', () => {
    for (const kind of CRYPTO_ALERT_KINDS.filter((k) => k !== 'price_above' && k !== 'price_below')) {
      expect(alertValue(sample(kind), data({}, null)), kind).toBeNull();
    }
  });

  it('rend null quand la lecture voulue manque, sans toucher aux autres', () => {
    const noFunding = reading({ breadth: breadth(0.4) });
    expect(alertValue(sample('funding_median_above'), data({}, noFunding))).toBeNull();
    expect(alertValue(sample('funding_median_below'), data({}, noFunding))).toBeNull();
    expect(alertValue(sample('breadth_above'), data({}, noFunding))).toBeCloseTo(40, 9);
    const noBreadth = reading({ funding: funding(0.0001) });
    expect(alertValue(sample('breadth_above'), data({}, noBreadth))).toBeNull();
    expect(alertValue(sample('breadth_below'), data({}, noBreadth))).toBeNull();
    expect(alertValue(sample('funding_median_above'), data({}, noBreadth))).toBeCloseTo(0.01, 12);
  });

  it('rend null pour une lecture non finie ou qui n’est pas un nombre, produit compris', () => {
    for (const median of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, '0.0001']) {
      const bad = reading({ funding: { ...funding(0.0001), median } as unknown as TemperatureReading['funding'] });
      expect(alertValue(sample('funding_median_above'), data({}, bad)), String(median)).toBeNull();
    }
    const badBreadth = reading({ breadth: breadth(Number.NaN) });
    expect(alertValue(sample('breadth_above'), data({}, badBreadth))).toBeNull();
    const badLiquidations = reading({ liquidations: { long: Number.NaN, short: Number.POSITIVE_INFINITY, since: NOW, at: NOW, lowerBound: true } });
    expect(alertValue(sample('liquidations_long_1h_above'), data({}, badLiquidations))).toBeNull();
    expect(alertValue(sample('liquidations_short_1h_above'), data({}, badLiquidations))).toBeNull();
  });
});

describe('validateAlert', () => {
  it('accepte chaque genre posé sur sa cible, dans son unité', () => {
    for (const kind of CRYPTO_ALERT_KINDS) {
      const a = sample(kind);
      expect(validateAlert({ target: a.target, kind: a.kind, level: a.level, mode: 'rearm', author: 'agent' }), kind).toEqual({ ok: true });
    }
    for (const market of CHARTABLE_MARKETS) expect(validateAlert(input({ target: market, level: 1.5 })), market).toEqual({ ok: true });
  });

  it('refuse une alerte de prix sur la température', () => {
    expect(validateAlert(input({ target: 'temperature', kind: 'price_above' }))).toEqual({ ok: false, reason: 'bad_target' });
    expect(validateAlert(input({ target: 'temperature', kind: 'price_below' }))).toEqual({ ok: false, reason: 'bad_target' });
  });

  it('refuse une alerte de température sur un marché', () => {
    for (const kind of CRYPTO_ALERT_KINDS.filter((k) => k !== 'price_above' && k !== 'price_below')) {
      expect(validateAlert(input({ target: 'coinbase:BTC-USD', kind, level: 1 })), kind).toEqual({ ok: false, reason: 'bad_target' });
    }
  });

  it('refuse une cible qui n’est pas un marché affichable', () => {
    for (const target of ['binance:BTCUSDT', 'binance:ONDOUSDT', 'kraken:BTC-USD', 'coinbase:btc-usd', '', 'constructor', '__proto__', 7, null, undefined]) {
      expect(validateAlert(input({ target })), String(target)).toEqual({ ok: false, reason: 'bad_target' });
    }
  });

  it('refuse un genre inconnu avant de juger la cible et le niveau', () => {
    for (const kind of ['price_between', 'PRICE_ABOVE', '', 'constructor', 7, null, undefined]) {
      expect(validateAlert(input({ kind })), String(kind)).toEqual({ ok: false, reason: 'bad_kind' });
    }
    expect(validateAlert(input({ kind: 'nope', target: 'kraken:BTC-USD', level: Number.NaN }))).toEqual({ ok: false, reason: 'bad_kind' });
  });

  it('refuse un niveau qui n’est pas un nombre fini', () => {
    for (const level of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '90000', null, undefined, {}, [90_000]]) {
      expect(validateAlert(input({ level })), String(level)).toEqual({ ok: false, reason: 'bad_level' });
    }
  });

  it('juge la cible avant le niveau', () => {
    expect(validateAlert(input({ target: 'temperature', level: Number.NaN }))).toEqual({ ok: false, reason: 'bad_target' });
  });

  it('refuse un niveau hors du domaine de son unité', () => {
    const bad = (kind: CryptoAlertKind, level: number): unknown => validateAlert(input({ kind, level, target: kind.startsWith('price') ? 'coinbase:BTC-USD' : 'temperature' }));
    const reject = { ok: false, reason: 'bad_level' };
    expect(bad('price_above', 0)).toEqual(reject);
    expect(bad('price_below', -1)).toEqual(reject);
    expect(bad('liquidations_long_1h_above', 0)).toEqual(reject);
    expect(bad('liquidations_short_1h_above', -5)).toEqual(reject);
    expect(bad('breadth_above', -1)).toEqual(reject);
    expect(bad('breadth_below', 100.5)).toEqual(reject);
  });

  it('accepte un funding négatif ou nul et les extrémités de la largeur', () => {
    const ok = (kind: CryptoAlertKind, level: number): unknown => validateAlert(input({ kind, level, target: 'temperature' }));
    expect(ok('funding_median_below', -0.02)).toEqual({ ok: true });
    expect(ok('funding_median_above', 0)).toEqual({ ok: true });
    expect(ok('breadth_above', 100)).toEqual({ ok: true });
    expect(ok('breadth_below', 0)).toEqual({ ok: true });
  });
});

describe('sanitizeAlerts', () => {
  it('rend undefined pour une valeur qui n’est pas un tableau', () => {
    for (const v of [undefined, null, 0, 'alerts', true, {}, { length: 1, 0: alert() }, new Set([alert()])]) {
      expect(sanitizeAlerts(v), String(v)).toBeUndefined();
    }
  });

  it('garde un tableau vide et les alertes valides de chaque genre, dans des objets neufs', () => {
    expect(sanitizeAlerts([])).toEqual([]);
    const input = CRYPTO_ALERT_KINDS.map(sample);
    const out = sanitizeAlerts(input);
    expect(out).toEqual(input);
    out?.forEach((a, i) => expect(a).not.toBe(input[i]));
  });

  it('garde les trois états, les deux modes, les deux auteurs et lastTriggeredAt', () => {
    const list = [
      alert({ id: 'a', state: 'armed', mode: 'once', author: 'trader' }),
      alert({ id: 'b', state: 'triggered', mode: 'rearm', author: 'agent', lastTriggeredAt: NOW + 1_000 }),
      alert({ id: 'c', state: 'paused', mode: 'rearm', author: 'trader', lastTriggeredAt: 0 }),
    ];
    expect(sanitizeAlerts(list)).toEqual(list);
  });

  it('ne copie ni clé inconnue ni lastTriggeredAt absent', () => {
    const out = sanitizeAlerts([{ ...alert(), extra: 'x', note: { deep: true } }]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out?.[0] ?? {}).sort()).toEqual(['author', 'createdAt', 'id', 'kind', 'level', 'mode', 'state', 'target']);
  });

  it('écarte chaque entrée invalide sans toucher aux autres', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['id vide', { id: '' }],
      ['id de 65 caractères', { id: 'x'.repeat(65) }],
      ['id numérique', { id: 7 }],
      ['cible hors registre', { target: 'kraken:BTC-USD' }],
      ['cible qui est une source du CVD', { target: 'binance:BTCUSDT' }],
      ['alerte de prix sur la température', { target: 'temperature' }],
      ['alerte de température sur un marché', { kind: 'breadth_above', target: 'coinbase:BTC-USD', level: 40 }],
      ['genre inconnu', { kind: 'price_between' }],
      ['niveau NaN', { level: Number.NaN }],
      ['niveau infini', { level: Number.POSITIVE_INFINITY }],
      ['niveau en chaîne', { level: '90000' }],
      ['niveau hors domaine', { level: -90_000 }],
      ['mode inconnu', { mode: 'twice' }],
      ['auteur inconnu', { author: 'robot' }],
      ['état inconnu', { state: 'fired' }],
      ['état absent', { state: undefined }],
      ['createdAt absent', { createdAt: undefined }],
      ['createdAt NaN', { createdAt: Number.NaN }],
      ['createdAt en chaîne', { createdAt: '2026-10-09' }],
      ['lastTriggeredAt en chaîne', { lastTriggeredAt: 'hier' }],
      ['lastTriggeredAt null', { lastTriggeredAt: null }],
    ];
    for (const [label, patch] of bad) {
      const out = sanitizeAlerts([{ ...alert({ id: 'bad' }), ...patch }, alert({ id: 'ok' })]);
      expect(out?.map((a) => a.id), label).toEqual(['ok']);
    }
    expect(sanitizeAlerts([null, undefined, 3, 'a', [], [alert()], alert({ id: 'ok' })])?.map((a) => a.id)).toEqual(['ok']);
  });

  it('accepte un id de 64 caractères', () => {
    expect(sanitizeAlerts([alert({ id: 'x'.repeat(64) })])).toHaveLength(1);
  });

  it('tient le plafond de 50 alertes : 51 alertes en donnent 50', () => {
    expect(ALERTS_MAX).toBe(50);
    const list = Array.from({ length: ALERTS_MAX + 1 }, (_, i) => alert({ id: `a${i}` }));
    const out = sanitizeAlerts(list);
    expect(out).toHaveLength(50);
    expect(out?.map((a) => a.id)).toEqual(list.slice(0, 50).map((a) => a.id));
  });

  it('compte le plafond sur les alertes valides seulement', () => {
    const list = [...Array.from({ length: 10 }, (_, i) => ({ ...alert({ id: `bad${i}` }), level: Number.NaN })), ...Array.from({ length: 60 }, (_, i) => alert({ id: `ok${i}` }))];
    const out = sanitizeAlerts(list);
    expect(out).toHaveLength(50);
    expect(out?.[0]?.id).toBe('ok0');
    expect(sanitizeAlerts([...list.slice(0, 10), ...list.slice(10, 55)])).toHaveLength(45);
  });

  it('écarte la seconde alerte qui reprend un id déjà vu', () => {
    const out = sanitizeAlerts([alert({ id: 'dup', level: 1 }), alert({ id: 'dup', level: 2 }), alert({ id: 'other' })]);
    expect(out?.map((a) => [a.id, a.level])).toEqual([['dup', 1], ['other', 90_000]]);
  });

  it('écarte une entrée qui porte __proto__ ou constructor comme clé propre, sans rien polluer', () => {
    const entry = (id: string, extra = ''): unknown =>
      fromJson(`{"id":"${id}","target":"coinbase:BTC-USD","kind":"price_above","level":90000,"mode":"once","author":"trader","state":"armed","createdAt":1${extra}}`);
    const evil = [entry('evil1', ',"__proto__":{"polluted":true}'), entry('evil2', ',"constructor":{"prototype":{"polluted":true}}'), entry('p')];
    const out = sanitizeAlerts(evil);
    expect(out?.map((a) => a.id)).toEqual(['p']);
    expect(out?.[0]).toEqual({ id: 'p', target: 'coinbase:BTC-USD', kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed', createdAt: 1 });
    expectNoPollution();
  });

  it('ne modifie pas son entrée, même gelée', () => {
    const list = deepFreeze([alert({ id: 'a' }), alert({ id: 'b', state: 'triggered', lastTriggeredAt: NOW })]);
    const before = JSON.stringify(list);
    expect(sanitizeAlerts(list)).toEqual(list);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('sanitizeWatchlist', () => {
  it('rend undefined pour une valeur qui n’est pas un tableau', () => {
    for (const v of [undefined, null, 0, 'coinbase:BTC-USD', true, {}, { 0: 'coinbase:BTC-USD', length: 1 }]) {
      expect(sanitizeWatchlist(v), String(v)).toBeUndefined();
    }
  });

  it('garde les marchés affichables, dans l’ordre du trader, dans un tableau neuf', () => {
    const list = ['bybit:ZIGUSDT', 'coinbase:BTC-USD'];
    const out = sanitizeWatchlist(list);
    expect(out).toEqual(['bybit:ZIGUSDT', 'coinbase:BTC-USD']);
    expect(out).not.toBe(list);
    expect(sanitizeWatchlist([])).toEqual([]);
    expect(sanitizeWatchlist([...CHARTABLE_MARKETS])).toEqual([...CHARTABLE_MARKETS]);
  });

  it('retire un marché hors registre, dont les deux sources du CVD Binance', () => {
    expect(sanitizeWatchlist(['coinbase:BTC-USD', 'binance:BTCUSDT', 'binance:ONDOUSDT', 'kraken:BTC-USD', 'binance:ONEUSDT'])).toEqual(['coinbase:BTC-USD', 'binance:ONEUSDT']);
  });

  it('retire ce qui n’est pas une chaîne du registre, exactement', () => {
    expect(sanitizeWatchlist([null, undefined, 7, {}, [], '', 'coinbase:btc-usd', ' coinbase:BTC-USD', 'constructor', '__proto__', 'coinbase:ONDO-USD'])).toEqual(['coinbase:ONDO-USD']);
  });

  it('ne garde un marché qu’une fois', () => {
    expect(sanitizeWatchlist(['coinbase:BTC-USD', 'bybit:ZIGUSDT', 'coinbase:BTC-USD', 'bybit:ZIGUSDT'])).toEqual(['coinbase:BTC-USD', 'bybit:ZIGUSDT']);
  });

  it('ne modifie pas son entrée, même gelée', () => {
    const list = deepFreeze(['coinbase:BTC-USD', 'binance:BTCUSDT']);
    expect(sanitizeWatchlist(list)).toEqual(['coinbase:BTC-USD']);
    expect(list).toEqual(['coinbase:BTC-USD', 'binance:BTCUSDT']);
  });
});

describe('sanitizeDrawings', () => {
  const level = (over: Record<string, unknown> = {}): CryptoDrawing => ({ id: 'd1', market: 'coinbase:BTC-USD', kind: 'level', price: 82_000, author: 'trader', createdAt: NOW, ...over }) as CryptoDrawing;
  const zone = (over: Record<string, unknown> = {}): CryptoDrawing => ({ id: 'z1', market: 'coinbase:BTC-USD', kind: 'zone', from: 81_000, to: 82_000, author: 'agent', createdAt: NOW, ...over }) as CryptoDrawing;

  it('rend undefined pour une valeur qui n’est pas un tableau', () => {
    for (const v of [undefined, null, 0, 'drawings', true, {}, { length: 1, 0: level() }]) {
      expect(sanitizeDrawings(v), String(v)).toBeUndefined();
    }
  });

  it('garde un niveau et une zone valides, avec leur label, dans des objets neufs', () => {
    expect(sanitizeDrawings([])).toEqual([]);
    const list = [level({ label: 'Support' }), zone({ label: 'Offre' }), level({ id: 'd2', market: 'binance:ONEUSDT', price: 0.002163 })];
    const out = sanitizeDrawings(list);
    expect(out).toEqual(list);
    out?.forEach((d, i) => expect(d).not.toBe(list[i]));
  });

  it('ne garde du niveau que son prix et de la zone que ses bornes', () => {
    const out = sanitizeDrawings([level({ from: 1, to: 2 }), zone({ price: 5, extra: 'x' })]);
    expect(out).toEqual([level(), zone()]);
    expect(Object.keys(out?.[0] ?? {}).sort()).toEqual(['author', 'createdAt', 'id', 'kind', 'market', 'price']);
    expect(Object.keys(out?.[1] ?? {}).sort()).toEqual(['author', 'createdAt', 'from', 'id', 'kind', 'market', 'to']);
  });

  it('écarte une zone inversée ou réduite à un point', () => {
    expect(sanitizeDrawings([zone({ from: 82_000, to: 81_000 }), zone({ id: 'z2', from: 82_000, to: 82_000 }), zone({ id: 'z3' })])?.map((d) => d.id)).toEqual(['z3']);
  });

  it('écarte un niveau ou une zone dont un prix manque ou n’est pas un prix', () => {
    const bad: [string, CryptoDrawing][] = [
      ['niveau sans prix', level({ price: undefined })],
      ['niveau NaN', level({ price: Number.NaN })],
      ['niveau infini', level({ price: Number.POSITIVE_INFINITY })],
      ['niveau en chaîne', level({ price: '82000' })],
      ['niveau nul', level({ price: 0 })],
      ['niveau négatif', level({ price: -5 })],
      ['zone sans from', zone({ from: undefined })],
      ['zone sans to', zone({ to: undefined })],
      ['zone dont to est infini', zone({ to: Number.POSITIVE_INFINITY })],
      ['zone dont from est NaN', zone({ from: Number.NaN })],
      ['zone dont from est négatif', zone({ from: -10, to: 82_000 })],
      ['genre inconnu', level({ kind: 'line' })],
      ['niveau décrit par ses bornes', level({ price: undefined, from: 81_000, to: 82_000 })],
      ['zone décrite par un prix', zone({ from: undefined, to: undefined, price: 82_000 })],
    ];
    for (const [label, drawing] of bad) {
      expect(sanitizeDrawings([{ ...drawing, id: 'bad' }, level({ id: 'ok' })])?.map((d) => d.id), label).toEqual(['ok']);
    }
  });

  it('écarte un tracé dont le marché est hors registre ou n’est pas affichable', () => {
    for (const market of ['binance:BTCUSDT', 'kraken:BTC-USD', '', 7, null, undefined]) {
      expect(sanitizeDrawings([level({ market }), level({ id: 'ok' })])?.map((d) => d.id), String(market)).toEqual(['ok']);
    }
  });

  it('écarte un tracé dont le label dépasse 40 caractères, et garde celui de 40', () => {
    expect(LABEL_MAX).toBe(40);
    expect(sanitizeDrawings([level({ id: 'long', label: 'x'.repeat(41) }), level({ id: 'edge', label: 'x'.repeat(40) })])?.map((d) => d.id)).toEqual(['edge']);
    expect(sanitizeDrawings([zone({ id: 'long', label: 'y'.repeat(41) })])).toEqual([]);
    expect(sanitizeDrawings([level({ id: 'num', label: 7 })])).toEqual([]);
    expect(sanitizeDrawings([level({ id: 'null', label: null })])).toEqual([]);
  });

  it('borne l’id à 64 caractères et refuse l’id vide', () => {
    expect(sanitizeDrawings([level({ id: '' }), level({ id: 'x'.repeat(65) }), level({ id: 7 }), level({ id: 'x'.repeat(64) })])?.map((d) => d.id.length)).toEqual([64]);
  });

  it('écarte un auteur ou une date de création invalide', () => {
    for (const patch of [{ author: 'robot' }, { author: undefined }, { createdAt: Number.NaN }, { createdAt: '2026-10-09' }, { createdAt: undefined }]) {
      expect(sanitizeDrawings([level(patch), level({ id: 'ok' })])?.map((d) => d.id), JSON.stringify(patch)).toEqual(['ok']);
    }
  });

  it('tient le plafond de 100 tracés : 101 tracés en donnent 100', () => {
    expect(DRAWINGS_MAX).toBe(100);
    const list = Array.from({ length: DRAWINGS_MAX + 1 }, (_, i) => level({ id: `d${i}` }));
    const out = sanitizeDrawings(list);
    expect(out).toHaveLength(100);
    expect(out?.map((d) => d.id)).toEqual(list.slice(0, 100).map((d) => d.id));
  });

  it('compte le plafond sur les tracés valides seulement', () => {
    const list = [...Array.from({ length: 5 }, (_, i) => level({ id: `bad${i}`, price: Number.NaN })), ...Array.from({ length: 110 }, (_, i) => level({ id: `ok${i}` }))];
    const out = sanitizeDrawings(list);
    expect(out).toHaveLength(100);
    expect(out?.[0]?.id).toBe('ok0');
  });

  it('écarte le second tracé qui reprend un id déjà vu', () => {
    expect(sanitizeDrawings([level({ id: 'dup', price: 1 }), zone({ id: 'dup' }), level({ id: 'other' })])?.map((d) => [d.id, d.kind])).toEqual([['dup', 'level'], ['other', 'level']]);
  });

  it('écarte une entrée qui porte __proto__ ou constructor comme clé propre, sans rien polluer', () => {
    const entry = (id: string, extra = ''): unknown => fromJson(`{"id":"${id}","market":"coinbase:BTC-USD","kind":"level","price":82000,"author":"trader","createdAt":1${extra}}`);
    const out = sanitizeDrawings([entry('evil1', ',"__proto__":{"polluted":true}'), entry('evil2', ',"constructor":{"prototype":{"polluted":true}}'), entry('p')]);
    expect(out).toEqual([{ id: 'p', market: 'coinbase:BTC-USD', kind: 'level', price: 82_000, author: 'trader', createdAt: 1 }]);
    expectNoPollution();
  });

  it('ne modifie pas son entrée, même gelée', () => {
    const list = deepFreeze([level({ label: 'a' }), zone(), level({ id: 'bad', price: Number.NaN })]);
    const before = JSON.stringify(list);
    expect(sanitizeDrawings(list)?.map((d) => d.id)).toEqual(['d1', 'z1']);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('sanitizeCryptoChart', () => {
  const chart = (over: Record<string, unknown> = {}): unknown => ({ market: 'coinbase:ONDO-USD', timeframe: 15, indicators: [{ id: 'i1', definitionId: 'ema', params: { period: 20, source: 'close' }, visible: true }], ...over });

  it('rend undefined pour une valeur qui n’est pas un objet', () => {
    for (const v of [undefined, null, 0, 'chart', true, [], [chart()]]) {
      expect(sanitizeCryptoChart(v), String(v)).toBeUndefined();
    }
  });

  it('garde un réglage valide dans des objets neufs, indicateurs et paramètres compris', () => {
    const input = chart() as { indicators: { params: object }[] };
    const out = sanitizeCryptoChart(input);
    expect(out).toEqual({ market: 'coinbase:ONDO-USD', timeframe: 15, indicators: [{ id: 'i1', definitionId: 'ema', params: { period: 20, source: 'close' }, visible: true }] });
    expect(out).not.toBe(input);
    expect(out?.indicators).not.toBe(input.indicators);
    expect(out?.indicators[0]).not.toBe(input.indicators[0]);
    expect(out?.indicators[0]?.params).not.toBe(input.indicators[0]?.params);
  });

  it('garde les indicateurs que le chart ouvre par défaut', () => {
    expect(sanitizeCryptoChart({ market: 'coinbase:BTC-USD', timeframe: 60, indicators: DEFAULT_CRYPTO_INDICATORS })).toEqual({ market: 'coinbase:BTC-USD', timeframe: 60, indicators: DEFAULT_CRYPTO_INDICATORS });
  });

  it('garde un réglage sans indicateur, et les six timeframes', () => {
    expect(sanitizeCryptoChart(chart({ indicators: [] }))).toEqual({ market: 'coinbase:ONDO-USD', timeframe: 15, indicators: [] });
    for (const timeframe of [1, 5, 15, 60, 240, 1440]) expect(sanitizeCryptoChart(chart({ timeframe }))?.timeframe, String(timeframe)).toBe(timeframe);
  });

  it('rend undefined quand le marché n’est pas un marché affichable', () => {
    for (const market of ['binance:BTCUSDT', 'binance:ONDOUSDT', 'kraken:BTC-USD', '', 'constructor', 7, null, undefined]) {
      expect(sanitizeCryptoChart(chart({ market })), String(market)).toBeUndefined();
    }
  });

  it('rend undefined quand le timeframe n’est pas l’un des six', () => {
    for (const timeframe of [0, 2, 30, 61, 120, '60', null, undefined, Number.NaN]) {
      expect(sanitizeCryptoChart(chart({ timeframe })), String(timeframe)).toBeUndefined();
    }
  });

  it('rend undefined quand les indicateurs ne sont pas un tableau', () => {
    for (const indicators of [undefined, null, {}, 'ema', 3]) {
      expect(sanitizeCryptoChart(chart({ indicators })), String(indicators)).toBeUndefined();
    }
  });

  it('écarte l’indicateur dont le definitionId n’est pas au catalogue crypto, et garde les autres', () => {
    const ok = { id: 'ok', definitionId: 'cvd-binance', params: {}, visible: false };
    // `vwap` et `prev-session` sont des indicateurs de séance du desk ; le catalogue crypto a `vwap-utc` et `levels-utc`.
    for (const definitionId of ['vwap', 'prev-session', 'opening-range', 'rsi', '', 'constructor', '__proto__']) {
      const out = sanitizeCryptoChart(chart({ indicators: [{ id: 'bad', definitionId, params: {}, visible: true }, ok] }));
      expect(out?.indicators.map((i) => i.id), definitionId).toEqual(['ok']);
    }
    const out = sanitizeCryptoChart(chart({ indicators: ['vwap-utc', 'levels-utc', 'sma', 'atr', 'volume-ma', 'cvd'].map((definitionId) => ({ id: `i_${definitionId}`, definitionId, params: {}, visible: true })) }));
    expect(out?.indicators.map((i) => i.definitionId)).toEqual(['vwap-utc', 'levels-utc', 'sma', 'atr', 'volume-ma', 'cvd']);
  });

  it('reprend les contrôles de forme de chart.indicators', () => {
    const base = { id: 'bad', definitionId: 'ema', params: { period: 20 }, visible: true };
    const bad: [string, Record<string, unknown>][] = [
      ['id vide', { id: '' }],
      ['id de 101 caractères', { id: 'x'.repeat(101) }],
      ['id numérique', { id: 3 }],
      ['definitionId de 101 caractères', { definitionId: 'x'.repeat(101) }],
      ['visible en chaîne', { visible: 'true' }],
      ['visible absent', { visible: undefined }],
      ['params absent', { params: undefined }],
      ['params en tableau', { params: [20] }],
      ['params null', { params: null }],
      ['paramètre booléen', { params: { period: true } }],
      ['paramètre imbriqué', { params: { period: { deep: 1 } } }],
      ['paramètre NaN', { params: { period: Number.NaN } }],
      ['paramètre infini', { params: { period: Number.POSITIVE_INFINITY } }],
      ['paramètre null', { params: { period: null } }],
      ['paramètre texte de 101 caractères', { params: { source: 'x'.repeat(101) } }],
    ];
    for (const [label, patch] of bad) {
      const out = sanitizeCryptoChart(chart({ indicators: [{ ...base, ...patch }, { ...base, id: 'ok' }] }));
      expect(out?.indicators.map((i) => i.id), label).toEqual(['ok']);
    }
    const edge = sanitizeCryptoChart(chart({ indicators: [{ id: 'x'.repeat(100), definitionId: 'ema', params: { source: 'y'.repeat(100), period: -3.5, zero: 0, empty: '' }, visible: false }] }));
    expect(edge?.indicators).toHaveLength(1);
    expect(edge?.indicators[0]?.params).toEqual({ source: 'y'.repeat(100), period: -3.5, zero: 0, empty: '' });
  });

  it('écarte ce qui n’est pas un objet dans les indicateurs', () => {
    const out = sanitizeCryptoChart(chart({ indicators: [null, undefined, 4, 'ema', [], { id: 'ok', definitionId: 'ema', params: {}, visible: true }] }));
    expect(out?.indicators.map((i) => i.id)).toEqual(['ok']);
  });

  it('tient le plafond de 50 indicateurs et ne garde un id qu’une fois', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `i${i}`, definitionId: 'ema', params: {}, visible: true }));
    const out = sanitizeCryptoChart(chart({ indicators: many }));
    expect(out?.indicators).toHaveLength(50);
    expect(out?.indicators.map((i) => i.id)).toEqual(many.slice(0, 50).map((i) => i.id));
    const dup = sanitizeCryptoChart(chart({ indicators: [{ id: 'd', definitionId: 'ema', params: { period: 1 }, visible: true }, { id: 'd', definitionId: 'sma', params: {}, visible: true }] }));
    expect(dup?.indicators.map((i) => [i.id, i.definitionId])).toEqual([['d', 'ema']]);
  });

  it('écarte l’indicateur dont une clé propre est __proto__ ou constructor, sans rien polluer', () => {
    const entry = (id: string, extra: string): unknown => fromJson(`{"id":"${id}","definitionId":"ema","visible":true,"params":{"period":20${extra}}}`);
    const out = sanitizeCryptoChart(chart({ indicators: [entry('evil1', ',"__proto__":{"polluted":true}'), entry('evil2', ',"constructor":1'), entry('e', '')] }));
    expect(out?.indicators).toEqual([{ id: 'e', definitionId: 'ema', visible: true, params: { period: 20 } }]);
    const onEntry = fromJson('{"id":"x","definitionId":"ema","visible":true,"params":{},"__proto__":{"polluted":true}}');
    expect(sanitizeCryptoChart(chart({ indicators: [onEntry] }))?.indicators).toEqual([]);
    expectNoPollution();
  });

  it('rend undefined pour un réglage qui porte lui-même __proto__ ou constructor', () => {
    expect(sanitizeCryptoChart(fromJson('{"market":"coinbase:BTC-USD","timeframe":60,"indicators":[],"__proto__":{"polluted":true}}'))).toBeUndefined();
    expect(sanitizeCryptoChart(fromJson('{"market":"coinbase:BTC-USD","timeframe":60,"indicators":[],"constructor":{}}'))).toBeUndefined();
    expectNoPollution();
  });

  it('ne modifie pas son entrée, même gelée', () => {
    const value = deepFreeze(chart({ indicators: [{ id: 'i1', definitionId: 'ema', params: { period: 20 }, visible: true }, { id: 'bad', definitionId: 'vwap', params: {}, visible: true }] }));
    const before = JSON.stringify(value);
    expect(sanitizeCryptoChart(value)?.indicators.map((i) => i.id)).toEqual(['i1']);
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe('assainisseurs : jamais de levée', () => {
  const throwing = { get id(): string { throw new Error('accesseur qui lève'); } };
  const revoked = (): unknown => {
    const { proxy, revoke } = Proxy.revocable<unknown[]>([], {});
    revoke();
    return proxy;
  };
  const junk: unknown[] = [
    undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', 'x', true, {}, [], [null], [undefined], [[]], [{}], [1, 'a', null, {}], () => 1, Symbol('s'), 10n, new Date(0), new Map(), Object.create(null),
  ];
  const sanitizers = [sanitizeAlerts, sanitizeWatchlist, sanitizeDrawings, sanitizeCryptoChart];

  it('absorbe toute valeur illisible', () => {
    for (const sanitize of sanitizers) {
      for (const v of junk) expect(() => sanitize(v), sanitize.name).not.toThrow();
      expect(() => sanitize(revoked()), sanitize.name).not.toThrow();
      expect(() => sanitize([throwing]), sanitize.name).not.toThrow();
      expect(() => sanitize(throwing), sanitize.name).not.toThrow();
    }
  });

  it('rejette la ligne dont une entrée ne se lit pas', () => {
    expect(sanitizeAlerts([alert(), throwing])).toBeUndefined();
    expect(sanitizeDrawings([throwing])).toBeUndefined();
    expect(sanitizeAlerts(revoked())).toBeUndefined();
    expect(sanitizeWatchlist(revoked())).toBeUndefined();
    expect(sanitizeCryptoChart({ market: 'coinbase:BTC-USD', timeframe: 60, indicators: [throwing] })).toBeUndefined();
  });

  it('ne fait de la liste qu’un tableau, jamais autre chose', () => {
    for (const sanitize of [sanitizeAlerts, sanitizeWatchlist, sanitizeDrawings]) {
      for (const v of junk) {
        const out = sanitize(v);
        expect(out === undefined || Array.isArray(out), `${sanitize.name} #${junk.indexOf(v)}`).toBe(true);
      }
    }
  });
});

describe('renderer seulement', () => {
  const specifiers = (text: string): string[] => [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

  it('n’est pas émis pour le process principal et n’a pas de .d.ts', () => {
    const config = JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')) as { files: string[] };
    for (const name of ['alerts', 'persist']) {
      expect(config.files, name).not.toContain(`../src/engine/crypto/${name}.ts`);
      expect(existsSync(`electron/crypto/${name}.d.ts`), name).toBe(false);
      expect(readFileSync('vitest.config.mts', 'utf8'), name).not.toContain(`'crypto/${name}'`);
    }
  });

  it('alerts.ts n’importe que ./markets et ./temperature', () => {
    const source = readFileSync('src/engine/crypto/alerts.ts', 'utf8');
    expect(new Set(specifiers(source))).toEqual(new Set(['./markets', './temperature']));
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('persist.ts n’importe que le moteur : ./markets, ./indicators et, en types seulement, @/engine/indicators', () => {
    const source = readFileSync('src/engine/crypto/persist.ts', 'utf8');
    expect(new Set(specifiers(source))).toEqual(new Set(['./markets', './indicators', '@/engine/indicators']));
    expect(source).toMatch(/^import type \{[^}]*\} from '@\/engine\/indicators';/m);
    expect(source).not.toMatch(/^import (?!type\b)[^;]*from '@\/engine\/indicators'/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
