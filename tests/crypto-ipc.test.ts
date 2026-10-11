import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARTABLE_MARKETS, CRYPTO_MARKETS, CRYPTO_TIMEFRAMES } from '@/engine/crypto/markets';
import { isSubscriptionId, parseHistoryRequest, parseSubscribeRequest } from '../electron/crypto-ipc';

/**
 * Ce qui n’est pas une requête : ni objet simple, ni rien de lisible. Un tableau qui porte les champs attendus en compte :
 * le clonage structuré de l’IPC garde les propriétés d’un tableau.
 */
const NOT_OBJECTS: unknown[] = [
  null,
  undefined,
  'coinbase:BTC-USD',
  42,
  true,
  [],
  [{ series: 'coinbase:BTC-USD', kind: 'ticker' }],
  Object.assign([], { series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 60 }),
];
/** Des séries hors du registre, ou mal écrites. */
const UNKNOWN_SERIES: unknown[] = ['coinbase:ETH-USD', 'BTC-USD', 'COINBASE:BTC-USD', 'coinbase:btc-usd', 'coinbase:BTC-USD ', '', 42, null, undefined, {}, ['coinbase:BTC-USD']];
/** Des timeframes hors des six du registre : 30 en tête. */
const BAD_TIMEFRAMES: unknown[] = [30, 0, -1, 2, 60.5, 10080, '60', NaN, Infinity, null, [60], { minutes: 60 }];
const PROXIES = CRYPTO_MARKETS.filter((m) => !m.chartable).map((m) => m.id);

describe('parseSubscribeRequest', () => {
  it('ticker : chacun des quatre marchés affichables', () => {
    expect(CHARTABLE_MARKETS).toHaveLength(4);
    for (const series of CHARTABLE_MARKETS) expect(parseSubscribeRequest({ series, kind: 'ticker' })).toEqual({ series, kind: 'ticker' });
  });

  it('ticker sur une source du CVD Binance : refusé', () => {
    expect(PROXIES).toEqual(['binance:BTCUSDT', 'binance:ONDOUSDT']);
    for (const series of PROXIES) expect(parseSubscribeRequest({ series, kind: 'ticker' })).toBeNull();
  });

  it('ticker : un timeframe joint est ignoré, comme dans CryptoFeedHost.subscribe, et ne passe pas', () => {
    expect(parseSubscribeRequest({ series: 'coinbase:BTC-USD', kind: 'ticker', timeframe: 60 })).toEqual({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    expect(parseSubscribeRequest({ series: 'bybit:ZIGUSDT', kind: 'ticker', timeframe: 30 })).toEqual({ series: 'bybit:ZIGUSDT', kind: 'ticker' });
  });

  it('bars : chaque série du registre, affichable ou source du CVD, avec chacun des six timeframes', () => {
    expect(CRYPTO_MARKETS).toHaveLength(6);
    for (const { id: series } of CRYPTO_MARKETS) {
      for (const timeframe of CRYPTO_TIMEFRAMES) expect(parseSubscribeRequest({ series, kind: 'bars', timeframe })).toEqual({ series, kind: 'bars', timeframe });
    }
  });

  it('bars sans timeframe : refusé', () => {
    expect(parseSubscribeRequest({ series: 'coinbase:BTC-USD', kind: 'bars' })).toBeNull();
    expect(parseSubscribeRequest({ series: 'binance:BTCUSDT', kind: 'bars', timeframe: undefined })).toBeNull();
  });

  it('bars avec un timeframe hors du registre (30, 0, 60.5, "60"…) : refusé', () => {
    for (const timeframe of BAD_TIMEFRAMES) expect(parseSubscribeRequest({ series: 'binance:ONEUSDT', kind: 'bars', timeframe }), String(timeframe)).toBeNull();
  });

  it('série inconnue ou mal formée : refusée, quel que soit le genre', () => {
    for (const series of UNKNOWN_SERIES) {
      expect(parseSubscribeRequest({ series, kind: 'ticker' }), String(series)).toBeNull();
      expect(parseSubscribeRequest({ series, kind: 'bars', timeframe: 60 }), String(series)).toBeNull();
    }
  });

  it('genre inconnu : refusé', () => {
    for (const kind of ['quote', 'tick', 'trades', 'Ticker', 'BARS', '', null, undefined, 1]) {
      expect(parseSubscribeRequest({ series: 'coinbase:BTC-USD', kind, timeframe: 60 }), String(kind)).toBeNull();
    }
  });

  it('une requête qui n’est pas un objet simple : refusée', () => {
    for (const raw of NOT_OBJECTS) expect(parseSubscribeRequest(raw), JSON.stringify(raw)).toBeNull();
  });

  it('rend une requête neuve, des seuls champs lus : un champ en trop ne passe pas', () => {
    const raw = { series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1, extra: 'x', subscriptionId: 'sub-1' };
    const parsed = parseSubscribeRequest(raw);
    expect(parsed).toEqual({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 1 });
    expect(Object.keys(parsed ?? {})).toEqual(['series', 'kind', 'timeframe']);
    expect(parsed).not.toBe(raw);
  });
});

describe('parseHistoryRequest', () => {
  it('chaque série du registre, affichable ou source du CVD, avec chacun des six timeframes', () => {
    for (const { id: series } of CRYPTO_MARKETS) {
      for (const timeframe of CRYPTO_TIMEFRAMES) expect(parseHistoryRequest({ series, timeframe })).toEqual({ series, timeframe });
    }
  });

  it('timeframe absent ou hors du registre (30 en tête) : refusé', () => {
    expect(parseHistoryRequest({ series: 'coinbase:BTC-USD' })).toBeNull();
    for (const timeframe of BAD_TIMEFRAMES) expect(parseHistoryRequest({ series: 'coinbase:BTC-USD', timeframe }), String(timeframe)).toBeNull();
  });

  it('série inconnue ou mal formée : refusée', () => {
    for (const series of UNKNOWN_SERIES) expect(parseHistoryRequest({ series, timeframe: 60 }), String(series)).toBeNull();
  });

  it('une requête qui n’est pas un objet simple : refusée', () => {
    for (const raw of NOT_OBJECTS) expect(parseHistoryRequest(raw), JSON.stringify(raw)).toBeNull();
  });

  it('rend une requête neuve : series et timeframe seulement', () => {
    const parsed = parseHistoryRequest({ series: 'bybit:ZIGUSDT', timeframe: 240, from: 0, to: 1, kind: 'bars' });
    expect(parsed).toEqual({ series: 'bybit:ZIGUSDT', timeframe: 240 });
    expect(Object.keys(parsed ?? {})).toEqual(['series', 'timeframe']);
  });
});

describe('isSubscriptionId', () => {
  it('accepte les identifiants de CryptoFeedHost, et tout [a-z0-9-] de 1 à 64 caractères', () => {
    for (const id of ['sub-1', 'sub-42', 'sub-123456789', 'a', '0', '-', 'a'.repeat(64), `sub-${'9'.repeat(60)}`]) expect(isSubscriptionId(id), id).toBe(true);
  });

  it('refuse 65 caractères, le vide, majuscules, espaces, retours à la ligne, autres signes et ce qui n’est pas une chaîne', () => {
    for (const id of ['a'.repeat(65), `sub-${'1'.repeat(61)}`, '', 'Sub-1', 'SUB-1', 'sub 1', ' sub-1', 'sub-1\n', 'sub_1', 'sub.1', 'sub-é', 'sub-1;', '../sub']) {
      expect(isSubscriptionId(id), JSON.stringify(id)).toBe(false);
    }
    for (const raw of [1, null, undefined, {}, ['sub-1'], { id: 'sub-1' }]) expect(isSubscriptionId(raw), JSON.stringify(raw)).toBe(false);
  });
});

describe('module de validation', () => {
  it('pur : il n’importe que le registre des marchés, ni electron, ni ws, ni le réseau', () => {
    const source = readFileSync('electron/crypto-ipc.ts', 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['./crypto/markets']);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });
});
