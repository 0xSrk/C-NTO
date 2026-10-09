import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cryptoIndicatorById } from '@/engine/crypto/indicators';
import {
  CRYPTO_MARKETS,
  CRYPTO_TIMEFRAMES,
  cryptoHostAllowed,
  type CryptoBar,
  type CryptoSeriesId,
  type CryptoTimeframe,
  type CryptoVenue,
} from '@/engine/crypto/markets';
import { HISTORY_BARS, aggregateBars, historyRequests, historyTarget, parseCandles } from '@/engine/crypto/venues';

const HOUR = 3600;
const ONE_DAY = 86400;
/** 9 octobre 2026, 00:00 UTC. */
const DAY = 1791504000;
/** 9 octobre 2026, 10:00 UTC. */
const NOW = DAY + 10 * HOUR;
/** 9 octobre 2026, 23:55 UTC : en fin de journée, la fenêtre de 5 m est à son plus long. */
const LATE = DAY + 23 * HOUR + 55 * 60;
/** Des heures du 9 octobre 2026 où la fenêtre change de pas : minuit, les frontières de 1 800 et de 2 000 bougies d’une minute, 10:00, la fin de journée. */
const INSTANTS = [DAY, DAY + 59, DAY + 5 * HOUR + 59 * 60, DAY + 6 * HOUR, DAY + 9 * HOUR + 19 * 60, DAY + 9 * HOUR + 20 * 60, NOW, NOW + 1234, LATE, DAY + ONE_DAY - 1];

/** 00:00 UTC de la veille de `now` : le début de la fenêtre que l’historique doit couvrir. */
const windowStartOf = (now: number): number => (Math.floor(now / ONE_DAY) - 1) * ONE_DAY;

/**
 * Les créneaux de `timeframe` minutes depuis celui de 00:00 UTC de la veille jusqu’à celui de `now` compris : de quoi
 * couvrir la fenêtre. Compté en différence de créneaux, pas par la formule de `historyTarget` qu’il sert à vérifier.
 */
function slotsSinceWindowStart(timeframe: CryptoTimeframe, now: number): number {
  const step = timeframe * 60;
  return (Math.floor(now / step) * step - windowStartOf(now)) / step + 1;
}

// Réponses réelles du 9 octobre 2026 : Coinbase BTC-USD, Binance ONEUSDT et Bybit ZIGUSDT, en 1 h.
const COINBASE = [[1791540000, 82374.03, 82655.46, 82587.75, 82404.31, 46.81410505], [1791536400, 82473.97, 82623.57, 82616.1, 82582.34, 54.4319952]];
const BINANCE = [[1791536400000, '0.00214200', '0.00221700', '0.00213900', '0.00215800', '87072165.80000000', 1791539999999, '190392.81755970', 4407, '46488643.30000000', '101648.64787700', '0']];
const BYBIT = { retCode: 0, retMsg: 'OK', result: { list: [['1791540000000', '0.05908', '0.05932', '0.059', '0.05929', '19487.72', '1153.3725962'], ['1791536400000', '0.05929', '0.05944', '0.05905', '0.05908', '70882.67', '4199.972979']] } };
// Huit bougies 1 h réelles de Coinbase BTC-USD, de 00:00 à 07:00 UTC le 9 octobre 2026, plus récente d’abord.
const COINBASE_HOURS = [
  [1791529200, 82408.56, 82591.73, 82512.75, 82583.73, 118.24596102],
  [1791525600, 82286.92, 82598, 82286.92, 82512.75, 80.06737015],
  [1791522000, 82160, 82553.77, 82174.71, 82286.91, 115.0792444],
  [1791518400, 82132.64, 82463.76, 82358.58, 82174.7, 147.70089053],
  [1791514800, 81976.26, 82370.87, 82056.15, 82358.58, 140.56179634],
  [1791511200, 81841.05, 82303.51, 81920.09, 82056.15, 227.73483907],
  [1791507600, 81534.02, 81939.11, 81727.76, 81920.09, 197.8928324],
  [1791504000, 81631.93, 81850, 81692.79, 81725.97, 139.69147549],
];

/** Valeurs hors registre, que le typage interdit et qu’un appelant JavaScript pourrait passer. */
const asVenue = (v: string): CryptoVenue => v as CryptoVenue;
const asSeries = (s: string): CryptoSeriesId => s as CryptoSeriesId;
const asTimeframe = (n: number): CryptoTimeframe => n as CryptoTimeframe;

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}

function bar(time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume?: number): CryptoBar {
  return buyVolume === undefined ? { time, open, high, low, close, volume } : { time, open, high, low, close, volume, buyVolume };
}

/** La même bougie (ouverture 2, haut 3, bas 1, volume 7, et 4 d’achat chez Binance), écrite dans la langue de chaque venue. */
const FIXTURES: Record<CryptoVenue, { row: unknown[]; fields: number[]; needs: number; wrap: (rows: unknown[]) => unknown }> = {
  coinbase: { row: [1791536400, 1, 3, 2, 2.5, 7], fields: [0, 1, 2, 3, 4, 5], needs: 6, wrap: (rows) => rows },
  binance: { row: [1791536400000, '2', '3', '1', '2.5', '7', 1791539999999, '0', 0, '4'], fields: [0, 1, 2, 3, 4, 5, 9], needs: 10, wrap: (rows) => rows },
  bybit: { row: ['1791536400000', '2', '3', '1', '2.5', '7', '0'], fields: [0, 1, 2, 3, 4, 5], needs: 6, wrap: (rows) => ({ retCode: 0, retMsg: 'OK', result: { list: rows } }) },
};
const VENUES = Object.keys(FIXTURES) as CryptoVenue[];

/** Une bougie qui se tient : plus bas 1, plus haut 10, ouverture 2, et une clôture que l’appelant choisit entre 1 et 10. */
function rowAt(venue: CryptoVenue, sec: number, close: number): unknown[] {
  if (venue === 'coinbase') return [sec, 1, 10, 2, close, 7];
  if (venue === 'binance') return [sec * 1000, '2', '10', '1', String(close), '7', sec * 1000 + 59999, '0', 0, '4'];
  return [String(sec * 1000), '2', '10', '1', String(close), '7', '0'];
}

type Field = 'open' | 'high' | 'low' | 'close' | 'volume' | 'buyVolume';
/** La position de chaque valeur de la bougie dans la ligne de chaque venue (Coinbase : [time, low, high, open, close, volume]). */
const LAYOUT: Record<CryptoVenue, Partial<Record<Field, number>>> = {
  coinbase: { low: 1, high: 2, open: 3, close: 4, volume: 5 },
  binance: { open: 1, high: 2, low: 3, close: 4, volume: 5, buyVolume: 9 },
  bybit: { open: 1, high: 2, low: 3, close: 4, volume: 5 },
};

/** La ligne témoin de la venue dont ces valeurs sont remplacées. Un nombre s’écrit en chaîne chez Binance et Bybit, comme dans leur API. */
function rowWith(venue: CryptoVenue, over: Partial<Record<Field, unknown>>): unknown[] {
  const row = [...FIXTURES[venue].row];
  for (const [field, value] of Object.entries(over)) {
    const index = LAYOUT[venue][field as Field];
    if (index !== undefined) row[index] = typeof value === 'number' && venue !== 'coinbase' ? String(value) : value;
  }
  return row;
}

/** Ce que doit rendre `parseCandles` pour `rowWith(venue, over)` quand la ligne est admise (le témoin : ouverture 2, haut 3, bas 1, clôture 2,5, volume 7, et 4 d’achat chez Binance). */
function barWith(venue: CryptoVenue, over: Partial<Record<Field, number>>): CryptoBar {
  const { buyVolume = 4, ...values } = over;
  const bar = { time: 1791536400, open: 2, high: 3, low: 1, close: 2.5, volume: 7, ...values };
  return venue === 'binance' ? { ...bar, buyVolume } : bar;
}

describe('lecture des bougies', () => {
  it('lit Coinbase : [time, low, high, open, close, volume], plus récentes d’abord', () => {
    expect(parseCandles('coinbase', COINBASE)[0]).toEqual({ time: 1791536400, open: 82616.1, high: 82623.57, low: 82473.97, close: 82582.34, volume: 54.4319952 });
    expect(parseCandles('coinbase', COINBASE)[1]).toEqual({ time: 1791540000, open: 82587.75, high: 82655.46, low: 82374.03, close: 82404.31, volume: 46.81410505 });
  });

  it('lit Binance : chaînes, millisecondes, volume acheteur à la position 9', () => {
    expect(parseCandles('binance', BINANCE)).toEqual([{ time: 1791536400, open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 }]);
  });

  it('lit Bybit : liste du résultat, plus récentes d’abord, millisecondes en chaînes', () => {
    expect(parseCandles('bybit', BYBIT).map((b) => b.time)).toEqual([1791536400, 1791540000]);
    expect(parseCandles('bybit', BYBIT)[0]).toEqual({ time: 1791536400, open: 0.05929, high: 0.05944, low: 0.05905, close: 0.05908, volume: 70882.67 });
  });

  it('range les champs de chaque venue aux bonnes places : la même bougie donne le même résultat', () => {
    const expected = { time: 1791536400, open: 2, high: 3, low: 1, close: 2.5, volume: 7 };
    for (const venue of VENUES) {
      const { row, wrap } = FIXTURES[venue];
      expect(parseCandles(venue, wrap([row])), venue).toEqual([venue === 'binance' ? { ...expected, buyVolume: 4 } : expected]);
    }
  });

  it('arrondit l’ouverture à la seconde entière, quelle que soit la précision de la venue', () => {
    const times: Record<CryptoVenue, unknown> = { coinbase: 1791536400.9, binance: 1791536400999, bybit: '1791536400999' };
    for (const venue of VENUES) {
      const row = [...FIXTURES[venue].row];
      row[0] = times[venue];
      expect(parseCandles(venue, FIXTURES[venue].wrap([row])).map((b) => b.time), venue).toEqual([1791536400]);
    }
  });

  it('ne donne un volume acheteur qu’aux bougies Binance', () => {
    for (const b of [...parseCandles('coinbase', COINBASE), ...parseCandles('bybit', BYBIT)]) expect('buyVolume' in b).toBe(false);
    expect(parseCandles('binance', BINANCE).every((b) => typeof b.buyVolume === 'number')).toBe(true);
  });

  it('garde les volumes nuls : un marché calme n’est pas une ligne invalide', () => {
    expect(parseCandles('binance', [[1791536400000, '1', '1', '1', '1', '0.00000000', 1791539999999, '0', 0, '0.00000000']])).toEqual([bar(1791536400, 1, 1, 1, 1, 0, 0)]);
    expect(parseCandles('coinbase', [[1791536400, 1, 1, 1, 1, 0]])).toEqual([bar(1791536400, 1, 1, 1, 1, 0)]);
    expect(parseCandles('bybit', FIXTURES.bybit.wrap([['1791536400000', '1', '1', '1', '1', '0', '0']]))).toEqual([bar(1791536400, 1, 1, 1, 1, 0)]);
  });

  it('trie par time croissant et dédoublonne, la dernière ligne lue l’emportant', () => {
    for (const venue of VENUES) {
      const rows = [rowAt(venue, 300, 9), rowAt(venue, 120, 1), rowAt(venue, 300, 2), rowAt(venue, 60, 4), rowAt(venue, 120, 7)];
      expect(parseCandles(venue, FIXTURES[venue].wrap(rows)).map((b) => [b.time, b.close]), venue).toEqual([[60, 4], [120, 7], [300, 2]]);
    }
  });

  it('écarte toute ligne courte ou non finie, sans rien lever', () => {
    expect(() => parseCandles('bybit', { retCode: 0, retMsg: 'OK', result: { list: [['x']] } })).not.toThrow();
    expect(parseCandles('binance', [['x', 'y'], [1791536400000, 'NaN', '1', '1', '1', '1', 0, '0', 0, '0']])).toEqual([]);
    expect(parseCandles('coinbase', [[1791536400, 1, 2], [1791536400, 'NaN', 2, 1, 1, 1]])).toEqual([]);
    expect(parseCandles('bybit', FIXTURES.bybit.wrap([['1791536400000', '1'], ['1791536400000', 'x', '1', '1', '1', '1', '0']]))).toEqual([]);
  });

  it('écarte une ligne trop courte, position par position', () => {
    for (const venue of VENUES) {
      const { row, needs, wrap } = FIXTURES[venue];
      for (let length = 0; length < needs; length++) expect(parseCandles(venue, wrap([row.slice(0, length)])), `${venue} sur ${length} champs`).toEqual([]);
      expect(parseCandles(venue, wrap([row.slice(0, needs)])), `${venue} sur ${needs} champs`).toHaveLength(1);
    }
  });

  it('n’accepte une ligne que si chaque nombre lu est fini : ni null, ni chaîne vide, ni booléen, ni tableau ne passent pour 0', () => {
    const garbage: unknown[] = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', '  ', 'abc', 'NaN', 'Infinity', true, false, [], [5], {}];
    for (const venue of VENUES) {
      const { row, fields, wrap } = FIXTURES[venue];
      expect(parseCandles(venue, wrap([row])), `${venue} (ligne témoin)`).toHaveLength(1);
      for (const field of fields) {
        for (const bad of garbage) {
          const broken = [...row];
          broken[field] = bad;
          expect(parseCandles(venue, wrap([broken])), `${venue} champ ${field} = ${JSON.stringify(bad) ?? 'undefined'}`).toEqual([]);
        }
      }
    }
  });

  it('écarte une ligne dont un prix est nul ou négatif, ou dont le volume est négatif', () => {
    const bad: unknown[] = [0, -1, -0.000001, '0', '0.00000000', '-0', '-1'];
    for (const venue of VENUES) {
      const { wrap } = FIXTURES[venue];
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        for (const value of bad) expect(parseCandles(venue, wrap([rowWith(venue, { [field]: value })])), `${venue} ${field} = ${JSON.stringify(value)}`).toEqual([]);
      }
      for (const value of [-1, -0.000001, '-1']) expect(parseCandles(venue, wrap([rowWith(venue, { volume: value })])), `${venue} volume = ${JSON.stringify(value)}`).toEqual([]);
    }
  });

  it('écarte une bougie qui ne se tient pas : plus haut sous le plus bas, sous l’ouverture ou sous la clôture, plus bas au-dessus de l’une ou de l’autre', () => {
    const broken: Partial<Record<Field, unknown>>[] = [
      { high: 1, low: 3, open: 2, close: 2 },
      { high: 2.4 },
      { high: 1.9 },
      { low: 2.1 },
      { low: 2.6 },
      { open: 0.5 },
      { open: 3.5 },
      { close: 0.5 },
      { close: 3.5 },
    ];
    for (const venue of VENUES) {
      for (const over of broken) expect(parseCandles(venue, FIXTURES[venue].wrap([rowWith(venue, over)])), `${venue} ${JSON.stringify(over)}`).toEqual([]);
    }
  });

  it('Binance : un volume acheteur négatif ou supérieur au volume écarte la ligne', () => {
    for (const buyVolume of [-1, -0.000001, 7.000001, 8, '8', '-1']) {
      expect(parseCandles('binance', [rowWith('binance', { buyVolume })]), JSON.stringify(buyVolume)).toEqual([]);
    }
    expect(parseCandles('binance', [rowWith('binance', { volume: 0, buyVolume: 0.1 })])).toEqual([]);
    expect(parseCandles('binance', [rowWith('binance', { volume: -1, buyVolume: -1 })])).toEqual([]);
  });

  it('garde les bougies limites : prix égaux, ouverture sur le plus bas, clôture sur le plus haut, volume nul, volume acheteur égal au volume, plus petit prix', () => {
    const edges: Partial<Record<Field, number>>[] = [
      { open: 2, high: 2, low: 2, close: 2 },
      { open: 1, close: 3 },
      { open: 3, close: 1 },
      { volume: 0, buyVolume: 0 },
      { buyVolume: 7 },
      { buyVolume: 0 },
      { low: 0.00000001 },
    ];
    for (const venue of VENUES) {
      for (const over of edges) {
        expect(parseCandles(venue, FIXTURES[venue].wrap([rowWith(venue, over)])), `${venue} ${JSON.stringify(over)}`).toEqual([barWith(venue, over)]);
      }
    }
  });

  it('une ligne écartée par ces règles ne gêne pas ses voisines', () => {
    for (const venue of VENUES) {
      const rows = [rowWith(venue, { low: 0 }), FIXTURES[venue].row, rowWith(venue, { high: 1 }), rowWith(venue, { volume: -1 })];
      expect(parseCandles(venue, FIXTURES[venue].wrap(rows)), venue).toEqual([barWith(venue, {})]);
    }
  });

  it('écarte ce qui n’est pas une ligne et garde les lignes valides voisines', () => {
    for (const venue of VENUES) {
      const { row, wrap } = FIXTURES[venue];
      expect(parseCandles(venue, wrap([null, 3, 'x', {}, [], row, undefined, true])), venue).toHaveLength(1);
    }
  });

  it('ne rend rien, sans lever, quand Coinbase ou Binance ne répondent pas une liste', () => {
    for (const venue of ['coinbase', 'binance'] as const) {
      for (const json of [[], null, undefined, {}, { message: 'NotFound' }, 'texte', 42, true]) expect(parseCandles(venue, json), `${venue} ${JSON.stringify(json) ?? 'undefined'}`).toEqual([]);
    }
  });

  it('Bybit : retCode différent de 0, c’est l’erreur de la venue qui se lève', () => {
    expect(() => parseCandles('bybit', { retCode: 10001, retMsg: 'Not supported symbols' })).toThrow('Not supported symbols');
    expect(() => parseCandles('bybit', { retCode: 10001, retMsg: 'Not supported symbols', result: BYBIT.result })).toThrow(new Error('Not supported symbols'));
    expect(() => parseCandles('bybit', { retCode: '10001', retMsg: 'Invalid symbol' })).toThrow('Invalid symbol');
    expect(() => parseCandles('bybit', { retCode: 10006 })).toThrow('10006');
    expect(() => parseCandles('bybit', { retCode: 10006, retMsg: '' })).toThrow('10006');
  });

  it('Bybit : une réponse qui ne porte pas retCode 0 n’est pas un succès', () => {
    for (const json of [null, undefined, 'texte', 42, [], {}, { result: BYBIT.result }, { retCode: null, result: BYBIT.result }, { retCode: 'x', result: BYBIT.result }]) {
      expect(() => parseCandles('bybit', json), JSON.stringify(json) ?? 'undefined').toThrow();
    }
  });

  it('Bybit : retCode 0 sans liste exploitable ne rend rien et ne lève pas', () => {
    const empty = [{ retCode: 0 }, { retCode: 0, retMsg: 'OK' }, { retCode: 0, result: null }, { retCode: 0, result: {} }, { retCode: 0, result: { list: null } }, { retCode: 0, result: { list: 'x' } }, { retCode: 0, result: { list: [] } }, { retCode: '0', result: { list: [] } }];
    for (const json of empty) expect(parseCandles('bybit', json), JSON.stringify(json)).toEqual([]);
  });

  it('rend une liste vide pour une venue inconnue', () => {
    expect(parseCandles(asVenue('kraken'), COINBASE)).toEqual([]);
  });
});

interface Page {
  granularity: number;
  start: number;
  end: number;
}

function pageOf(url: string): Page {
  const query = new URL(url).searchParams;
  return { granularity: Number(query.get('granularity')), start: Date.parse(query.get('start') ?? '') / 1000, end: Date.parse(query.get('end') ?? '') / 1000 };
}

describe('URLs de l’historique', () => {
  const hosts: Record<CryptoVenue, string> = { coinbase: 'api.exchange.coinbase.com', binance: 'api.binance.com', bybit: 'api.bybit.com' };

  it('Binance : un appel, l’intervalle de la venue, 500 bougies, sans agrégation', () => {
    expect(HISTORY_BARS).toBe(500);
    expect(historyRequests('binance:ONEUSDT', 60, NOW)).toEqual({ urls: ['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1h&limit=500'], aggregate: 1 });
    // En 1m l’historique tient en plusieurs pages (voir « historique jusqu’à 00:00 UTC de la veille ») : l’intervalle, lui, ne change pas.
    const intervals = CRYPTO_TIMEFRAMES.map((tf) => [...new Set(historyRequests('binance:BTCUSDT', tf, NOW).urls.map((u) => new URL(u).searchParams.get('interval')))]);
    expect(intervals).toEqual([['1m'], ['5m'], ['15m'], ['1h'], ['4h'], ['1d']]);
  });

  it('Bybit : un appel au comptant, l’intervalle de la venue, 500 bougies, sans agrégation', () => {
    expect(historyRequests('bybit:ZIGUSDT', 60, NOW)).toEqual({ urls: ['https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=60&limit=500'], aggregate: 1 });
    expect(historyRequests('bybit:ZIGUSDT', 1440, NOW).urls[0]).toContain('interval=D');
    const intervals = CRYPTO_TIMEFRAMES.map((tf) => [...new Set(historyRequests('bybit:ZIGUSDT', tf, NOW).urls.map((u) => new URL(u).searchParams.get('interval')))]);
    expect(intervals).toEqual([['1'], ['5'], ['15'], ['60'], ['240'], ['D']]);
  });

  it('Coinbase : deux pages en remontant, de granularité timeframe × 60, sauf le 1 m (voir plus bas) et le 4 h', () => {
    for (const tf of [5, 15, 60, 1440] as const) {
      const { urls, aggregate } = historyRequests('coinbase:BTC-USD', tf, NOW);
      expect(aggregate, `${tf}`).toBe(1);
      expect(urls.map((u) => pageOf(u).granularity), `${tf}`).toEqual([tf * 60, tf * 60]);
    }
  });

  it('Coinbase 4 h : quatre pages d’une heure, à regrouper par quatre', () => {
    const four = historyRequests('coinbase:BTC-USD', 240, NOW);
    expect(four.aggregate).toBe(4);
    expect(four.urls).toHaveLength(4);
    expect(four.urls.every((u) => u.includes('granularity=3600'))).toBe(true);
    expect([...four.urls, ...historyRequests('coinbase:ONDO-USD', 5, NOW).urls].every((u) => cryptoHostAllowed(u, 'https:'))).toBe(true);
  });

  it('Coinbase : les URLs exactes d’un cas connu, bornes en ISO 8601 UTC', () => {
    expect(historyRequests('coinbase:BTC-USD', 60, NOW)).toEqual({
      urls: [
        'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=2026-09-26T23:00:00.000Z&end=2026-10-09T10:00:00.000Z',
        'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=2026-09-14T11:00:00.000Z&end=2026-09-26T22:00:00.000Z',
      ],
      aggregate: 1,
    });
    expect(historyRequests('coinbase:ONDO-USD', 240, NOW).urls.map((u) => u.split('?')[1])).toEqual([
      'granularity=3600&start=2026-09-27T00:00:00.000Z&end=2026-10-09T11:00:00.000Z',
      'granularity=3600&start=2026-09-14T12:00:00.000Z&end=2026-09-26T23:00:00.000Z',
      'granularity=3600&start=2026-09-02T00:00:00.000Z&end=2026-09-14T11:00:00.000Z',
      'granularity=3600&start=2026-08-20T12:00:00.000Z&end=2026-09-01T23:00:00.000Z',
    ]);
  });

  it('Coinbase : chaque page tient dans la limite de 300 bougies, sans trou ni recouvrement, de la plus récente à la plus ancienne', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      for (const now of [NOW, NOW + 1, NOW + 1234, NOW + 3 * HOUR + 59, NOW + 7 * HOUR]) {
        const { urls, aggregate } = historyRequests('coinbase:ONDO-USD', tf, now);
        const pages = urls.map(pageOf);
        const label = `${tf} min à ${now}`;
        expect(pages, label).toHaveLength(tf === 240 ? 4 : Math.max(2, Math.ceil(slotsSinceWindowStart(tf, now) / 300)));
        pages.forEach((page, i) => {
          const g = page.granularity;
          expect((page.end - page.start) / g + 1, `${label}, page ${i}`).toBe(300);
          expect(page.start % g, `${label}, page ${i}`).toBe(0);
          expect(page.end % g, `${label}, page ${i}`).toBe(0);
          if (i > 0) expect(page.end, `${label}, page ${i}`).toBe(nth(pages, i - 1).start - g);
        });
        // La page la plus récente couvre la bougie entamée : elle finit sur le dernier créneau du seau de nowSec.
        const g = nth(pages, 0).granularity;
        const opening = Math.floor(now / g) * g;
        expect(nth(pages, 0).end, label).toBeGreaterThanOrEqual(opening);
        expect(nth(pages, 0).end - opening, label).toBeLessThan(g * aggregate);
        // Avec un regroupement, la fenêtre entière commence sur une frontière de seau : aucune bougie de bord partielle.
        expect(nth(pages, -1).start % (g * aggregate), label).toBe(0);
      }
    }
  });

  it('Coinbase : la page la plus récente finit sur le seau de nowSec', () => {
    const endOf = (tf: CryptoTimeframe, now: number): number => pageOf(nth(historyRequests('coinbase:BTC-USD', tf, now).urls, 0)).end;
    expect(endOf(60, NOW)).toBe(NOW);
    expect(endOf(60, NOW + 1234)).toBe(NOW);
    expect(endOf(60, NOW + HOUR)).toBe(NOW + HOUR);
    expect(endOf(1, NOW + 59)).toBe(NOW);
    expect(endOf(1440, NOW)).toBe(DAY);
    expect(endOf(240, NOW)).toBe(NOW + HOUR);
    expect(endOf(240, NOW + 2 * HOUR)).toBe(NOW + 5 * HOUR);
  });

  it('chaque URL, pour chaque série, chaque timeframe et en début comme en fin de journée, passe cryptoHostAllowed et vise la venue de sa série', () => {
    for (const market of CRYPTO_MARKETS) {
      for (const tf of CRYPTO_TIMEFRAMES) {
        for (const now of [NOW, LATE]) {
          const { urls, aggregate } = historyRequests(market.id, tf, now);
          const label = `${market.id} ${tf} à ${now}`;
          expect(urls.length, label).toBeGreaterThan(0);
          expect(aggregate, label).toBe(market.venue === 'coinbase' && tf === 240 ? 4 : 1);
          for (const url of urls) {
            expect(cryptoHostAllowed(url, 'https:'), url).toBe(true);
            expect(new URL(url).hostname, url).toBe(hosts[market.venue]);
            expect(url, url).toContain(market.symbol);
            expect(url, url).not.toMatch(/\s/);
          }
        }
      }
    }
  });

  it('ne rend aucune URL pour une série, un timeframe ou une heure hors de ce que le registre connaît', () => {
    const none = { urls: [], aggregate: 1 };
    expect(historyRequests(asSeries('kraken:BTC-USD'), 60, NOW)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', asTimeframe(30), NOW)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, Number.NaN)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, Number.POSITIVE_INFINITY)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, 1e20)).toEqual(none);
    expect(historyRequests('binance:ONEUSDT', asTimeframe(30), NOW)).toEqual(none);
    // Quelle que soit la venue, une heure qui n’est pas une date ne donne aucune URL (Binance et Bybit l’écrivent dans `startTime` et `start`).
    for (const series of ['coinbase:BTC-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT'] as const) {
      for (const tf of CRYPTO_TIMEFRAMES) {
        for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20, -1e20]) expect(historyRequests(series, tf, now), `${series} ${tf} à ${now}`).toEqual(none);
      }
    }
  });

  it('rend chaque fois un objet neuf', () => {
    const a = historyRequests(asSeries('kraken:BTC-USD'), 60, NOW);
    a.urls.push('https://api.binance.com/');
    expect(historyRequests(asSeries('kraken:BTC-USD'), 60, NOW).urls).toEqual([]);
  });
});

describe('historyTarget : de quoi remonter à 00:00 UTC de la veille', () => {
  it('à 10:00 UTC : 34 h de bougies d’une minute et celle qui est entamée, le plancher de 500 dès 5 m', () => {
    expect(historyTarget(1, NOW)).toBe(2041); // 34 h × 60 + 1
    expect(historyTarget(5, NOW)).toBe(500); // 409 < 500
    expect(historyTarget(5, LATE)).toBe(576);
    expect(historyTarget(15, NOW)).toBe(500);
    expect(historyTarget(1440, NOW)).toBe(500);
  });

  it('1 m : de 1 441 bougies à minuit UTC à 2 880 à 23:59 ; 5 m : de 500 à 576 ; au-dessus : 500 à toute heure', () => {
    const sweep = (tf: CryptoTimeframe): number[] => Array.from({ length: 1440 }, (_, minute) => historyTarget(tf, DAY + minute * 60 + 59));
    expect([Math.min(...sweep(1)), Math.max(...sweep(1))]).toEqual([1441, 2880]);
    expect([Math.min(...sweep(5)), Math.max(...sweep(5))]).toEqual([500, 576]);
    for (const tf of [15, 60, 240, 1440] as const) expect(new Set(sweep(tf)), `${tf}`).toEqual(new Set([HISTORY_BARS]));
  });

  it('compte les créneaux de 00:00 UTC de la veille à celui de l’instant, au moins HISTORY_BARS, sur trois jours échantillonnés toutes les 61 s', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      for (let at = DAY - ONE_DAY; at < DAY + 2 * ONE_DAY; at += 61) {
        expect(historyTarget(tf, at), `${tf} min à ${at}`).toBe(Math.max(HISTORY_BARS, slotsSinceWindowStart(tf, at)));
      }
    }
  });

  it('la première des historyTarget bougies ouvre au plus tard à 00:00 UTC de la veille, et à cet instant même quand le plancher ne joue pas (un jour échantillonné toutes les 301 s)', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      const step = tf * 60;
      for (let at = DAY; at < DAY + ONE_DAY; at += 301) {
        const target = historyTarget(tf, at);
        const first = Math.floor(at / step) * step - (target - 1) * step;
        expect(first, `${tf} min à ${at}`).toBeLessThanOrEqual(windowStartOf(at));
        if (target > HISTORY_BARS) expect(first, `${tf} min à ${at}`).toBe(windowStartOf(at));
      }
    }
  });

  it('suit le jour UTC : à minuit pile, la veille est 24 h plus tôt ; une seconde avant, 48 h', () => {
    expect(historyTarget(1, DAY)).toBe(1441);
    expect(historyTarget(1, DAY - 1)).toBe(2880);
  });

  it('rend HISTORY_BARS quand l’heure ou le timeframe ne définissent aucune fenêtre', () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(historyTarget(1, now), String(now)).toBe(HISTORY_BARS);
    expect(historyTarget(asTimeframe(0), NOW)).toBe(HISTORY_BARS);
    expect(historyTarget(asTimeframe(Number.NaN), NOW)).toBe(HISTORY_BARS);
  });
});

describe('historique jusqu’à 00:00 UTC de la veille : URLs', () => {
  /** Binance lit `startTime`, Bybit `start` : le point de départ d’une page, en secondes, ou `null` pour un appel sans départ. */
  const startOf = (url: string, param: 'startTime' | 'start'): number | null => {
    const value = new URL(url).searchParams.get(param);
    return value === null ? null : Number(value) / 1000;
  };

  it('Coinbase 1 m : ceil(historyTarget / 300) pages, sept à 10:00 UTC', () => {
    expect(historyRequests('coinbase:BTC-USD', 1, NOW).urls).toHaveLength(7); // 2 041 bougies
    expect(historyRequests('coinbase:BTC-USD', 1, NOW).aggregate).toBe(1);
    expect(historyRequests('coinbase:BTC-USD', 1, DAY + 59).urls).toHaveLength(5); // 1 441 bougies
    expect(historyRequests('coinbase:BTC-USD', 1, DAY + 5 * HOUR + 59 * 60).urls).toHaveLength(6); // 1 800 bougies : six pages pleines
    expect(historyRequests('coinbase:BTC-USD', 1, DAY + 6 * HOUR).urls).toHaveLength(7); // 1 801
    expect(historyRequests('coinbase:BTC-USD', 1, DAY + ONE_DAY - 1).urls).toHaveLength(10); // 2 880
  });

  it('Coinbase 1 m et 5 m : la page la plus ancienne commence au plus tard à 00:00 UTC de la veille, et les 5 m gardent leurs deux pages', () => {
    for (const tf of [1, 5] as const) {
      for (const now of INSTANTS) {
        const pages = historyRequests('coinbase:BTC-USD', tf, now).urls.map(pageOf);
        expect(nth(pages, -1).start, `${tf} min à ${now}`).toBeLessThanOrEqual(windowStartOf(now));
        if (tf === 5) expect(pages, `${now}`).toHaveLength(2);
      }
    }
  });

  it('Binance 1 m : trois pages de 1 000 en avançant à 10:00 UTC, la première à 00:00 UTC de la veille', () => {
    const t = Date.UTC(2026, 9, 9, 10, 0, 0) / 1000;
    const bn = historyRequests('binance:ONEUSDT', 1, t).urls;
    expect(bn).toHaveLength(3);
    expect(bn.every((u) => u.includes('limit=1000') && u.includes('startTime='))).toBe(true);
    expect(new URL(nth(bn, 0)).searchParams.get('startTime')).toBe(String((t - 2040 * 60) * 1000));
    expect(bn).toEqual([
      'https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1m&startTime=1791417600000&limit=1000',
      'https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1m&startTime=1791477600000&limit=1000',
      'https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1m&startTime=1791537600000&limit=1000',
    ]);
    expect(historyRequests('binance:ONEUSDT', 1, t).aggregate).toBe(1);
  });

  it('Bybit 1 m : trois pages de 1 000 en avançant à 10:00 UTC, par `start`, l’intervalle et la catégorie inchangés', () => {
    const t = Date.UTC(2026, 9, 9, 10, 0, 0) / 1000;
    const by = historyRequests('bybit:ZIGUSDT', 1, t).urls;
    expect(by).toHaveLength(3);
    expect(by.every((u) => u.includes('limit=1000') && u.includes('start=') && !u.includes('startTime'))).toBe(true);
    expect(by).toEqual([
      'https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=1&start=1791417600000&limit=1000',
      'https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=1&start=1791477600000&limit=1000',
      'https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=1&start=1791537600000&limit=1000',
    ]);
    expect(historyRequests('bybit:ZIGUSDT', 1, t).aggregate).toBe(1);
  });

  it('Binance et Bybit 1 m : deux pages tant que l’historique tient en 2 000 bougies, trois dès la 2 001e, jamais plus de trois', () => {
    const at2000 = DAY + 9 * HOUR + 19 * 60;
    expect([historyTarget(1, at2000), historyTarget(1, at2000 + 60)]).toEqual([2000, 2001]);
    for (const series of ['binance:ONEUSDT', 'bybit:ZIGUSDT'] as const) {
      expect(historyRequests(series, 1, DAY).urls, series).toHaveLength(2); // 1 441
      expect(historyRequests(series, 1, at2000).urls, series).toHaveLength(2);
      expect(historyRequests(series, 1, at2000 + 60).urls, series).toHaveLength(3);
      expect(historyRequests(series, 1, DAY + ONE_DAY - 1).urls, series).toHaveLength(3); // 2 880
    }
  });

  it('Binance et Bybit : les pages se suivent de 1 000 bougies, sans recouvrement, et la première part de 00:00 UTC de la veille', () => {
    for (const [series, param] of [['binance:ONEUSDT', 'startTime'], ['bybit:ZIGUSDT', 'start']] as const) {
      for (const now of [DAY, NOW, NOW + 1234, DAY + ONE_DAY - 1]) {
        const starts = historyRequests(series, 1, now).urls.map((u) => startOf(u, param));
        expect(starts, `${series} à ${now}`).toEqual(starts.map((_, i) => windowStartOf(now) + i * 1000 * 60));
      }
    }
  });

  it('5 m en fin de journée : un seul appel de 576 bougies, sans point de départ ; à 10:00 UTC : le plancher de 500', () => {
    expect(historyRequests('binance:ONEUSDT', 5, LATE).urls).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=576']);
    expect(historyRequests('bybit:ZIGUSDT', 5, LATE).urls).toEqual(['https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=5&limit=576']);
    expect(historyRequests('binance:ONEUSDT', 5, NOW).urls).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=500']);
    expect(historyRequests('bybit:ZIGUSDT', 5, NOW).urls).toEqual(['https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=5&limit=500']);
    expect(historyRequests('binance:ONEUSDT', 5, Date.UTC(2026, 9, 9, 23, 55) / 1000).urls).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=576']);
  });

  it('15 m, 1 h, 4 h et 1 j : les URLs de CRY1.2, à toute heure de la journée', () => {
    const klines: [CryptoTimeframe, string, string][] = [[15, '15m', '15'], [60, '1h', '60'], [240, '4h', '240'], [1440, '1d', 'D']];
    for (const now of [DAY, DAY + 59, NOW, LATE, DAY + ONE_DAY - 1]) {
      for (const [tf, binance, bybit] of klines) {
        expect(historyRequests('binance:BTCUSDT', tf, now), `binance ${tf} à ${now}`).toEqual({ urls: [`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${binance}&limit=500`], aggregate: 1 });
        expect(historyRequests('bybit:ZIGUSDT', tf, now), `bybit ${tf} à ${now}`).toEqual({ urls: [`https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=${bybit}&limit=500`], aggregate: 1 });
      }
    }
  });
});

describe('regroupement des bougies', () => {
  it('regroupe huit bougies 1 h réelles du 9 octobre 2026 en deux bougies 4 h', () => {
    const four = aggregateBars(parseCandles('coinbase', COINBASE_HOURS), 60, 4);
    expect(four.map((b) => b.time)).toEqual([DAY, DAY + 4 * HOUR]);
    expect(four[0]).toMatchObject({ open: 81692.79, high: 82370.87, low: 81534.02, close: 82358.58 });
    expect(four[1]).toMatchObject({ open: 82358.58, high: 82598, low: 82132.64, close: 82583.73 });
    expect(four[0]?.volume).toBeCloseTo(705.8809433, 8);
    expect(four[1]?.volume).toBeCloseTo(461.0934661, 8);
  });

  it('prend l’ouverture de la première, le plus haut, le plus bas, la clôture de la dernière et la somme des volumes', () => {
    const a = bar(DAY, 10, 12, 9, 11, 1);
    const b = bar(DAY + HOUR, 11, 15, 10, 14, 2);
    const c = bar(DAY + 2 * HOUR, 14, 14.5, 6, 7, 3);
    const d = bar(DAY + 3 * HOUR, 7, 8, 5, 8, 4);
    expect(aggregateBars([a, b, c, d], 60, 4)).toEqual([bar(DAY, 10, 15, 5, 8, 10)]);
  });

  it('aligne les seaux sur l’epoch UTC, pas sur la première bougie reçue', () => {
    const hours = [1, 2, 3, 4, 5, 6, 7, 8].map((h) => bar(DAY + h * HOUR, h, h + 0.5, h - 0.5, h + 0.25, 1));
    expect(aggregateBars(hours, 60, 4)).toEqual([
      bar(DAY, 1, 3.5, 0.5, 3.25, 3),
      bar(DAY + 4 * HOUR, 4, 7.5, 3.5, 7.25, 4),
      bar(DAY + 8 * HOUR, 8, 8.5, 7.5, 8.25, 1),
    ]);
  });

  it('regroupe aussi par jour, sur minuit UTC', () => {
    const hours = Array.from({ length: 24 }, (_, h) => bar(DAY + h * HOUR, 1, 2, 0, 1, 1));
    expect(aggregateBars([...hours, bar(DAY + 24 * HOUR, 5, 6, 4, 5, 1)], 60, 24)).toEqual([bar(DAY, 1, 2, 0, 1, 24), bar(DAY + 24 * HOUR, 5, 6, 4, 5, 1)]);
  });

  it('ne somme le volume acheteur que si toutes les bougies du seau en ont un', () => {
    const full = [0, 1, 2, 3].map((i) => bar(DAY + i * HOUR, 1, 2, 0, 1, 10, 4 + i));
    expect(aggregateBars(full, 60, 4)).toStrictEqual([bar(DAY, 1, 2, 0, 1, 40, 22)]);
    const holey = [...full.slice(0, 3), bar(DAY + 3 * HOUR, 1, 2, 0, 1, 10)];
    expect(aggregateBars(holey, 60, 4)).toStrictEqual([bar(DAY, 1, 2, 0, 1, 40)]);
    const mixed = [...full, ...[4, 5, 6, 7].map((i) => bar(DAY + i * HOUR, 1, 2, 0, 1, 10, i === 6 ? undefined : 1))];
    expect(aggregateBars(mixed, 60, 4)).toStrictEqual([bar(DAY, 1, 2, 0, 1, 40, 22), bar(DAY + 4 * HOUR, 1, 2, 0, 1, 40)]);
    expect(aggregateBars([bar(DAY, 1, 1, 1, 1, 1, 0)], 60, 1)).toStrictEqual([bar(DAY, 1, 1, 1, 1, 1, 0)]);
  });

  it('avec un facteur 1, remet en ordre et dédoublonne sans rien changer d’autre', () => {
    const a = bar(DAY, 1, 2, 0, 1, 1);
    const b = bar(DAY + HOUR, 2, 3, 1, 2, 1, 1);
    const c = bar(DAY + 2 * HOUR, 3, 4, 2, 3, 1);
    expect(aggregateBars([c, a, b, a], 60, 1)).toEqual([a, b, c]);
    expect(aggregateBars([a, b, { ...a, close: 99 }], 60, 1)).toEqual([{ ...a, close: 99 }, b]);
    expect(aggregateBars([], 60, 4)).toEqual([]);
  });

  it('range sur la bougie du seau une bougie décalée de sa grille', () => {
    expect(aggregateBars([bar(DAY + 1, 1, 2, 0, 1, 1)], 60, 1)).toEqual([bar(DAY, 1, 2, 0, 1, 1)]);
  });

  it('ne modifie pas son entrée', () => {
    const input = [0, 1, 2, 3].map((i) => Object.freeze(bar(DAY + i * HOUR, 1, 2, 0, 1, 1, 1)));
    Object.freeze(input);
    const out = aggregateBars(input, 60, 4);
    expect(out).toHaveLength(1);
    expect(input.every((b) => b.volume === 1)).toBe(true);
  });

  it('rend une liste vide pour un facteur ou un timeframe qui ne définit aucun seau', () => {
    const one = [bar(DAY, 1, 2, 0, 1, 1)];
    for (const factor of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(aggregateBars(one, 60, factor), String(factor)).toEqual([]);
    expect(aggregateBars(one, asTimeframe(Number.NaN), 4)).toEqual([]);
    expect(aggregateBars(one, asTimeframe(0), 4)).toEqual([]);
  });

  it('écarte une bougie dont un nombre n’est pas fini, au lieu de la propager', () => {
    const good = bar(DAY, 1, 2, 0, 1, 1);
    const broken = [bar(DAY + HOUR, 1, Number.NaN, 0, 1, 1), bar(DAY + 2 * HOUR, 1, 2, 0, 1, Number.POSITIVE_INFINITY), bar(DAY + 3 * HOUR, 1, 2, 0, 1, 1, Number.NaN)];
    expect(aggregateBars([good, ...broken], 60, 4)).toEqual([good]);
  });
});

/**
 * Ce que fait l’API Coinbase, relevé le 9 octobre 2026 : les bougies dont l’ouverture tombe dans [start, end],
 * bornes comprises et jusqu’à maintenant, plus récentes d’abord ; au-delà de 300 granularités d’écart, c’est un 400.
 * Une bougie par créneau : bas t - 1, haut t + 1, ouverture et clôture t, volume 1.
 */
function fakeCoinbase(url: string, now: number): number[][] {
  const { granularity: g, start, end } = pageOf(url);
  if ((end - start) / g > 300) throw new Error('granularity too small for the requested time range');
  const rows: number[][] = [];
  for (let t = Math.ceil(start / g) * g; t <= end && t <= now; t += g) rows.unshift([t, t - 1, t + 1, t, t, 1]);
  return rows;
}

/** Le chemin du process principal : lire chaque page, les fusionner, regrouper. */
function coinbaseHistory(series: CryptoSeriesId, timeframe: CryptoTimeframe, now: number): CryptoBar[] {
  const { urls, aggregate } = historyRequests(series, timeframe, now);
  const bars = urls.flatMap((url) => parseCandles('coinbase', fakeCoinbase(url, now)));
  return aggregateBars(bars, (timeframe / aggregate) as CryptoTimeframe, aggregate);
}

describe('historique Coinbase de bout en bout, sur une API simulée', () => {
  it('1 h : deux pages donnent 600 bougies contiguës, la bougie entamée en dernier', () => {
    const bars = coinbaseHistory('coinbase:BTC-USD', 60, NOW + 1234);
    expect(bars.map((b) => b.time)).toEqual(Array.from({ length: 600 }, (_, i) => NOW - (599 - i) * HOUR));
    expect(bars.slice(-HISTORY_BARS)).toHaveLength(HISTORY_BARS);
  });

  it('chaque timeframe : bougies contiguës au pas du timeframe, sans doublon, la bougie entamée en dernier', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      const now = NOW + 777;
      const bars = coinbaseHistory('coinbase:ONDO-USD', tf, now);
      const step = tf * 60;
      expect(bars, `${tf}`).toHaveLength(tf === 240 ? 300 : 300 * Math.max(2, Math.ceil(slotsSinceWindowStart(tf, now) / 300)));
      bars.forEach((b, i) => {
        if (i > 0) expect(b.time - nth(bars, i - 1).time, `${tf} index ${i}`).toBe(step);
      });
      expect(nth(bars, -1).time, `${tf}`).toBe(Math.floor(now / step) * step);
    }
  });

  it('4 h : 300 bougies dont aucune n’est amputée à son bord le plus ancien, quelle que soit l’heure de la demande', () => {
    for (const offset of [0, HOUR, 2 * HOUR, 3 * HOUR, 5 * HOUR, 6 * HOUR + 59]) {
      const now = NOW + offset;
      const bars = coinbaseHistory('coinbase:BTC-USD', 240, now);
      expect(bars, `+${offset}`).toHaveLength(300);
      // Chaque bougie 1 h pèse 1 de volume : quatre pour une bougie 4 h complète.
      expect(bars.slice(0, -1).every((b) => b.volume === 4), `+${offset}`).toBe(true);
      const opening = Math.floor(now / (4 * HOUR)) * 4 * HOUR;
      expect(nth(bars, -1).volume, `+${offset}`).toBe(Math.floor((now - opening) / HOUR) + 1);
    }
  });
});

/**
 * Ce que font les API Binance (`startTime`) et Bybit (`start`), relevé en direct le 9 octobre 2026 : sans point de départ,
 * les `limit` dernières bougies ; avec, les `limit` premières depuis cette ouverture, jusqu’à la bougie entamée comprise
 * (moins s’il n’y en a pas assez) ; `limit` va de 1 à 1 000. Les ouvertures rendues, de la plus ancienne à la plus récente.
 */
function fakeKlineTimes(url: string, startParam: 'startTime' | 'start', now: number, step: number): number[] {
  const query = new URL(url).searchParams;
  const limit = Number(query.get('limit'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error(`limit hors de 1 à 1 000 : ${query.get('limit')}`);
  const current = Math.floor(now / step) * step;
  const from = query.get(startParam);
  const first = from === null ? current - (limit - 1) * step : Math.ceil(Number(from) / 1000 / step) * step;
  const times: number[] = [];
  for (let t = first; t <= current && times.length < limit; t += step) times.push(t);
  return times;
}

type KlineVenue = 'binance' | 'bybit';
const KLINE_VENUES: Record<KlineVenue, { series: CryptoSeriesId; startParam: 'startTime' | 'start' }> = {
  binance: { series: 'binance:ONEUSDT', startParam: 'startTime' },
  bybit: { series: 'bybit:ZIGUSDT', startParam: 'start' },
};

/** Le chemin du process principal pour Binance et Bybit : lire chaque page dans la langue de la venue, les fusionner. */
function klineHistory(venue: KlineVenue, timeframe: CryptoTimeframe, now: number): CryptoBar[] {
  const { series, startParam } = KLINE_VENUES[venue];
  const bars = historyRequests(series, timeframe, now).urls.flatMap((url) => {
    const rows = fakeKlineTimes(url, startParam, now, timeframe * 60).map((t) => rowAt(venue, t, 5));
    return parseCandles(venue, FIXTURES[venue].wrap(venue === 'bybit' ? rows.reverse() : rows));
  });
  return aggregateBars(bars, timeframe, 1);
}

/** L’historique d’une venue pour son marché de test : Coinbase par ses pages en arrière, Binance et Bybit par les leurs. */
function venueHistory(venue: CryptoVenue, timeframe: CryptoTimeframe, now: number): CryptoBar[] {
  return venue === 'coinbase' ? coinbaseHistory('coinbase:BTC-USD', timeframe, now) : klineHistory(venue, timeframe, now);
}

describe('historique Binance et Bybit de bout en bout, sur une API simulée', () => {
  it('1 m : les pages se suivent sans trou ni recouvrement, de 00:00 UTC de la veille à la bougie entamée', () => {
    for (const venue of ['binance', 'bybit'] as const) {
      const { series, startParam } = KLINE_VENUES[venue];
      for (const now of INSTANTS) {
        const opens = historyRequests(series, 1, now).urls.flatMap((url) => fakeKlineTimes(url, startParam, now, 60));
        expect(opens, `${venue} à ${now}`).toEqual(Array.from({ length: slotsSinceWindowStart(1, now) }, (_, i) => windowStartOf(now) + i * 60));
      }
    }
  });

  it('chaque timeframe : historyTarget bougies contiguës au pas du timeframe, la bougie entamée en dernier', () => {
    for (const venue of ['binance', 'bybit'] as const) {
      for (const tf of CRYPTO_TIMEFRAMES) {
        const step = tf * 60;
        for (const now of INSTANTS) {
          const target = historyTarget(tf, now);
          const last = Math.floor(now / step) * step;
          const expected = Array.from({ length: target }, (_, i) => last - (target - 1 - i) * step);
          expect(klineHistory(venue, tf, now).map((b) => b.time), `${venue} ${tf} min à ${now}`).toEqual(expected);
        }
      }
    }
  });
});

describe('l’historique chargé couvre le début du jour UTC précédent', () => {
  it('chaque venue, chaque timeframe, toute heure : les historyTarget dernières bougies vont de 00:00 UTC de la veille au plus tard à la bougie entamée', () => {
    for (const venue of VENUES) {
      for (const tf of CRYPTO_TIMEFRAMES) {
        for (const now of INSTANTS) {
          const loaded = venueHistory(venue, tf, now).slice(-historyTarget(tf, now));
          const label = `${venue} ${tf} min à ${now}`;
          expect(nth(loaded, 0).time, label).toBeLessThanOrEqual(windowStartOf(now));
          expect(nth(loaded, -1).time, label).toBe(Math.floor(now / (tf * 60)) * tf * 60);
        }
      }
    }
  });

  it('le VWAP 00:00 UTC et les niveaux de la veille se calculent en 1 m dès l’ouverture du chart, ce que les 500 dernières bougies ne permettent pas', () => {
    /** Les points qui portent une valeur, de `since` à la fin, pour une ligne d’un indicateur du catalogue crypto. */
    const points = (bars: readonly CryptoBar[], id: string, key: string, since: number): number => {
      const def = cryptoIndicatorById(id);
      if (!def) throw new Error(`indicateur absent du catalogue : ${id}`);
      const line = def.compute([...bars], { bands: '0' }).lines.find((l) => l.key === key);
      return (line?.data ?? []).filter((p) => p.value !== undefined && p.time >= since).length;
    };
    for (const venue of VENUES) {
      const all = venueHistory(venue, 1, NOW);
      const loaded = all.slice(-historyTarget(1, NOW));
      // Aujourd’hui : 601 bougies, de 00:00 à 10:00 UTC compris. Chacune a son VWAP et les niveaux d’hier.
      expect(points(loaded, 'vwap-utc', 'vwap', DAY), venue).toBe(601);
      for (const key of ['pdh', 'pdl', 'pdc']) expect(points(loaded, 'levels-utc', key, DAY), `${venue} ${key}`).toBe(601);
      // Les 500 dernières bougies commencent à 01:41 UTC : aujourd’hui n’est pas couvert, la ligne est interrompue.
      const legacy = all.slice(-HISTORY_BARS);
      expect(points(legacy, 'vwap-utc', 'vwap', DAY), venue).toBe(0);
      expect(points(legacy, 'levels-utc', 'pdh', DAY), venue).toBe(0);
    }
  });
});

describe('partage avec le process principal', () => {
  const source = readFileSync('src/engine/crypto/venues.ts', 'utf8');

  it('n’importe que ./markets : le process principal le compile sans alias ni bars', () => {
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(new Set(specifiers)).toEqual(new Set(['./markets']));
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*import\s+['"]/m);
  });

  it('est émis par electron/tsconfig.sources.json, après markets', () => {
    const config = JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')) as { files: string[] };
    expect(config.files).toContain('../src/engine/crypto/venues.ts');
    expect(config.files.indexOf('../src/engine/crypto/venues.ts')).toBeGreaterThan(config.files.indexOf('../src/engine/crypto/markets.ts'));
  });

  it('est typé par un .d.ts qui déclare les mêmes exports', () => {
    const exported = (text: string): string[] =>
      [...text.matchAll(/^export (?:declare )?(?:const|function|type|interface) (\w+)/gm)].map((m) => m[1] ?? '').sort();
    const declaration = readFileSync('electron/crypto/venues.d.ts', 'utf8');
    expect(exported(declaration)).toEqual(exported(source));
    expect(exported(source)).toEqual([
      'FORCE_ORDER_URL',
      'HISTORY_BARS',
      'PREMIUM_INDEX_URL',
      'TICKER_24H_URL',
      'WsParsed',
      'aggregateBars',
      'historyRequests',
      'historyTarget',
      'openInterestUrl',
      'parseCandles',
      'parseWsMessage',
      'streamKeys',
      'subscribeMessage',
      'wsUrl',
    ]);
    expect(declaration).toMatch(/from '\.\/markets'/);
  });

  it('est relié dans la carte engineSource de vitest.config.mts', () => {
    expect(readFileSync('vitest.config.mts', 'utf8')).toContain("'crypto/venues': 'src/engine/crypto/venues.ts'");
  });
});
