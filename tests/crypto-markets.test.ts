import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHARTABLE_MARKETS,
  CRYPTO_HOSTS,
  CRYPTO_MARKETS,
  CRYPTO_TIMEFRAMES,
  DEFAULT_CRYPTO_MARKET,
  DEFAULT_CRYPTO_TIMEFRAME,
  cryptoHostAllowed,
  cryptoMarket,
  isChartableMarket,
  isCryptoSeriesId,
  isCryptoTimeframe,
} from '@/engine/crypto/markets';
import { allowedHosts } from '@/engine/sources';

describe('registre des marchés crypto', () => {
  it('range les six séries dans l’ordre du registre, les quatre affichables d’abord', () => {
    expect(CRYPTO_MARKETS.map((m) => m.id)).toEqual(['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT', 'binance:BTCUSDT', 'binance:ONDOUSDT']);
    expect(CHARTABLE_MARKETS).toEqual(['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT']);
  });

  it('fixe les valeurs relevées dans les métadonnées des exchanges le 9 octobre 2026', () => {
    expect(CRYPTO_MARKETS).toEqual([
      { id: 'coinbase:BTC-USD', venue: 'coinbase', symbol: 'BTC-USD', base: 'BTC', quote: 'USD', label: 'BTC-USD · Coinbase', tickSize: 0.01, precision: 2, chartable: true, cvdProxy: 'binance:BTCUSDT' },
      { id: 'coinbase:ONDO-USD', venue: 'coinbase', symbol: 'ONDO-USD', base: 'ONDO', quote: 'USD', label: 'ONDO-USD · Coinbase', tickSize: 0.00001, precision: 5, chartable: true, cvdProxy: 'binance:ONDOUSDT' },
      { id: 'binance:ONEUSDT', venue: 'binance', symbol: 'ONEUSDT', base: 'ONE', quote: 'USDT', label: 'ONEUSDT · Binance', tickSize: 0.000001, precision: 6, chartable: true },
      { id: 'bybit:ZIGUSDT', venue: 'bybit', symbol: 'ZIGUSDT', base: 'ZIG', quote: 'USDT', label: 'ZIGUSDT · Bybit', tickSize: 0.00001, precision: 5, chartable: true },
      { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', label: 'BTCUSDT · Binance', tickSize: 0.01, precision: 2, chartable: false },
      { id: 'binance:ONDOUSDT', venue: 'binance', symbol: 'ONDOUSDT', base: 'ONDO', quote: 'USDT', label: 'ONDOUSDT · Binance', tickSize: 0.0001, precision: 4, chartable: false },
    ]);
  });

  it('donne à chaque marché pour précision le nombre de décimales de son pas de prix', () => {
    for (const m of CRYPTO_MARKETS) expect(m.precision, m.id).toBe(String(m.tickSize).split('.')[1]?.length ?? 0);
  });

  it('ne laisse non affichables que les deux sources du CVD Binance, chacune rattachée à un marché', () => {
    const proxies = CRYPTO_MARKETS.filter((m) => !m.chartable).map((m) => m.id);
    expect(proxies).toEqual(['binance:BTCUSDT', 'binance:ONDOUSDT']);
    expect(CRYPTO_MARKETS.flatMap((m) => (m.cvdProxy ? [m.cvdProxy] : []))).toEqual(proxies);
    expect(CRYPTO_MARKETS.filter((m) => !m.chartable && m.cvdProxy)).toEqual([]);
  });

  it('retrouve une série par son identifiant exact, et rien d’autre', () => {
    expect(cryptoMarket('coinbase:ONDO-USD')?.label).toBe('ONDO-USD · Coinbase');
    expect(cryptoMarket('binance:ONDOUSDT')?.chartable).toBe(false);
    for (const m of CRYPTO_MARKETS) expect(cryptoMarket(m.id), m.id).toBe(m);
    for (const id of ['', 'BTC-USD', 'coinbase:btc-usd', 'coinbase:BTC-USD ', 'kraken:BTC-USD', 'constructor', '__proto__', 'toString']) {
      expect(cryptoMarket(id), id).toBeUndefined();
    }
  });

  it('ouvre par défaut Coinbase BTC-USD en 1 h', () => {
    expect(DEFAULT_CRYPTO_MARKET).toBe('coinbase:BTC-USD');
    expect(DEFAULT_CRYPTO_TIMEFRAME).toBe(60);
    expect(isChartableMarket(DEFAULT_CRYPTO_MARKET)).toBe(true);
    expect(isCryptoTimeframe(DEFAULT_CRYPTO_TIMEFRAME)).toBe(true);
  });
});

describe('gardes de forme', () => {
  it('reconnaît les six timeframes, en minutes, et eux seuls', () => {
    expect(CRYPTO_TIMEFRAMES).toEqual([1, 5, 15, 60, 240, 1440]);
    for (const tf of CRYPTO_TIMEFRAMES) expect(isCryptoTimeframe(tf), String(tf)).toBe(true);
    expect(isCryptoTimeframe(240)).toBe(true);
    expect(isCryptoTimeframe(30)).toBe(false);
    for (const v of ['60', '1h', 0, -60, 61, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, [60], {}]) {
      expect(isCryptoTimeframe(v), String(v)).toBe(false);
    }
  });

  it('sépare les marchés affichables des sources du CVD', () => {
    expect(isChartableMarket('binance:BTCUSDT')).toBe(false);
    expect(isCryptoSeriesId('binance:BTCUSDT')).toBe(true);
    expect(isChartableMarket('binance:ONDOUSDT')).toBe(false);
    expect(isCryptoSeriesId('binance:ONDOUSDT')).toBe(true);
    for (const id of CHARTABLE_MARKETS) {
      expect(isChartableMarket(id), id).toBe(true);
      expect(isCryptoSeriesId(id), id).toBe(true);
    }
    for (const v of ['', 'BTC-USD', 'COINBASE:BTC-USD', 'coinbase:BTC-USD ', 'binance:ETHUSDT', 'constructor', 42, null, undefined, {}, ['coinbase:BTC-USD']]) {
      expect(isChartableMarket(v), String(v)).toBe(false);
      expect(isCryptoSeriesId(v), String(v)).toBe(false);
    }
  });
});

describe('hôtes des exchanges', () => {
  it('liste les huit hôtes de Coinbase, Binance et Bybit, nus et triés', () => {
    expect(CRYPTO_HOSTS).toEqual([
      'api.binance.com',
      'api.bybit.com',
      'api.exchange.coinbase.com',
      'fapi.binance.com',
      'fstream.binance.com',
      'stream.binance.com',
      'stream.bybit.com',
      'ws-feed.exchange.coinbase.com',
    ]);
  });

  it('reste hors des hôtes de production des sources (décision 9)', () => {
    expect(CRYPTO_HOSTS.filter((h) => allowedHosts().includes(h))).toEqual([]);
  });

  it('accepte https et wss vers un hôte de la liste, quels que soient le port et la casse', () => {
    expect(cryptoHostAllowed('https://api.binance.com/api/v3/klines?symbol=ONEUSDT', 'https:')).toBe(true);
    expect(cryptoHostAllowed('wss://stream.binance.com:9443/ws', 'wss:')).toBe(true);
    expect(cryptoHostAllowed('https://API.Binance.com/api/v3/time', 'https:')).toBe(true);
    for (const host of CRYPTO_HOSTS) {
      expect(cryptoHostAllowed(`https://${host}/`, 'https:'), host).toBe(true);
      expect(cryptoHostAllowed(`wss://${host}/ws`, 'wss:'), host).toBe(true);
    }
  });

  it('refuse un protocole différent de celui demandé', () => {
    expect(cryptoHostAllowed('http://api.binance.com/api/v3/klines', 'https:')).toBe(false);
    expect(cryptoHostAllowed('wss://api.binance.com/ws', 'https:')).toBe(false);
    expect(cryptoHostAllowed('https://stream.binance.com/ws', 'wss:')).toBe(false);
    expect(cryptoHostAllowed('ws://stream.binance.com:9443/ws', 'wss:')).toBe(false);
    expect(cryptoHostAllowed('ftp://api.binance.com/', 'https:')).toBe(false);
  });

  it('refuse un utilisateur ou un mot de passe', () => {
    expect(cryptoHostAllowed('https://user:pw@api.binance.com/', 'https:')).toBe(false);
    expect(cryptoHostAllowed('https://user@api.binance.com/', 'https:')).toBe(false);
    expect(cryptoHostAllowed('https://:pw@api.binance.com/', 'https:')).toBe(false);
    expect(cryptoHostAllowed('wss://user:pw@stream.binance.com:9443/ws', 'wss:')).toBe(false);
    expect(cryptoHostAllowed('https://api.binance.com@evil.io/', 'https:')).toBe(false);
  });

  it('refuse un hôte hors liste, même quand il y ressemble', () => {
    for (const url of [
      'https://api.binance.com.evil.io/',
      'https://evilapi.binance.com/',
      'https://api.binance.com./',
      'https://www.binance.com/',
      'https://api.coinbase.com/',
      'https://evil.io/api.binance.com',
      'https://evil.io/?next=https://api.binance.com/',
    ]) {
      expect(cryptoHostAllowed(url, 'https:'), url).toBe(false);
    }
  });

  it('refuse ce qui n’est pas une URL', () => {
    for (const url of ['pas une url', '', 'api.binance.com', '//api.binance.com/', 'https://']) {
      expect(cryptoHostAllowed(url, 'https:'), url).toBe(false);
    }
  });
});

describe('partage avec le process principal', () => {
  const source = readFileSync('src/engine/crypto/markets.ts', 'utf8');

  it('n’importe rien : le process principal compile ce fichier seul', () => {
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('est émis par electron/tsconfig.sources.json', () => {
    const config = JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')) as { files: string[] };
    expect(config.files).toContain('../src/engine/crypto/markets.ts');
  });

  it('est typé par un .d.ts qui déclare les mêmes exports, types compris', () => {
    const exported = (text: string): string[] =>
      [...text.matchAll(/^export (?:declare )?(?:const|function|type|interface) (\w+)/gm)].map((m) => m[1] ?? '').sort();
    expect(exported(readFileSync('electron/crypto/markets.d.ts', 'utf8'))).toEqual(exported(source));
  });
});
