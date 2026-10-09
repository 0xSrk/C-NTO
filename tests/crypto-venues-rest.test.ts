import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRYPTO_MARKETS,
  CRYPTO_TIMEFRAMES,
  cryptoHostAllowed,
  type CryptoBar,
  type CryptoSeriesId,
  type CryptoTimeframe,
  type CryptoVenue,
} from '@/engine/crypto/markets';
import { HISTORY_BARS, aggregateBars, historyRequests, parseCandles } from '@/engine/crypto/venues';

const HOUR = 3600;
/** 9 octobre 2026, 00:00 UTC. */
const DAY = 1791504000;
/** 9 octobre 2026, 10:00 UTC. */
const NOW = DAY + 10 * HOUR;

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
    const intervals = CRYPTO_TIMEFRAMES.map((tf) => historyRequests('binance:BTCUSDT', tf, NOW).urls.map((u) => new URL(u).searchParams.get('interval')));
    expect(intervals).toEqual([['1m'], ['5m'], ['15m'], ['1h'], ['4h'], ['1d']]);
  });

  it('Bybit : un appel au comptant, l’intervalle de la venue, 500 bougies, sans agrégation', () => {
    expect(historyRequests('bybit:ZIGUSDT', 60, NOW)).toEqual({ urls: ['https://api.bybit.com/v5/market/kline?category=spot&symbol=ZIGUSDT&interval=60&limit=500'], aggregate: 1 });
    expect(historyRequests('bybit:ZIGUSDT', 1440, NOW).urls[0]).toContain('interval=D');
    const intervals = CRYPTO_TIMEFRAMES.map((tf) => historyRequests('bybit:ZIGUSDT', tf, NOW).urls.map((u) => new URL(u).searchParams.get('interval')));
    expect(intervals).toEqual([['1'], ['5'], ['15'], ['60'], ['240'], ['D']]);
  });

  it('Coinbase : deux pages en remontant, de granularité timeframe × 60, sauf le 4 h', () => {
    for (const tf of [1, 5, 15, 60, 1440] as const) {
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
        expect(pages, label).toHaveLength(tf === 240 ? 4 : 2);
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

  it('chaque URL, pour chaque série et chaque timeframe, passe cryptoHostAllowed et vise la venue de sa série', () => {
    for (const market of CRYPTO_MARKETS) {
      for (const tf of CRYPTO_TIMEFRAMES) {
        const { urls, aggregate } = historyRequests(market.id, tf, NOW);
        const label = `${market.id} ${tf}`;
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
  });

  it('ne rend aucune URL pour une série, un timeframe ou une heure hors de ce que le registre connaît', () => {
    const none = { urls: [], aggregate: 1 };
    expect(historyRequests(asSeries('kraken:BTC-USD'), 60, NOW)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', asTimeframe(30), NOW)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, Number.NaN)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, Number.POSITIVE_INFINITY)).toEqual(none);
    expect(historyRequests('coinbase:BTC-USD', 60, 1e20)).toEqual(none);
    expect(historyRequests('binance:ONEUSDT', asTimeframe(30), NOW)).toEqual(none);
  });

  it('rend chaque fois un objet neuf', () => {
    const a = historyRequests(asSeries('kraken:BTC-USD'), 60, NOW);
    a.urls.push('https://api.binance.com/');
    expect(historyRequests(asSeries('kraken:BTC-USD'), 60, NOW).urls).toEqual([]);
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
      expect(bars, `${tf}`).toHaveLength(tf === 240 ? 300 : 600);
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
