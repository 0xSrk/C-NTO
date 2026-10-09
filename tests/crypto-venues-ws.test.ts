import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CRYPTO_MARKETS,
  CRYPTO_TIMEFRAMES,
  cryptoHostAllowed,
  type CryptoSeriesId,
  type CryptoTimeframe,
  type CryptoVenue,
} from '@/engine/crypto/markets';
import {
  FORCE_ORDER_URL,
  PREMIUM_INDEX_URL,
  TICKER_24H_URL,
  openInterestUrl,
  parseWsMessage,
  streamKeys,
  subscribeMessage,
  wsUrl,
  type WsParsed,
} from '@/engine/crypto/venues';

const VENUES: CryptoVenue[] = ['coinbase', 'binance', 'bybit'];
const IGNORED: WsParsed[] = [{ kind: 'ignored' }];

/** Valeurs hors registre, que le typage interdit et qu’un appelant JavaScript pourrait passer. */
const asVenue = (v: string): CryptoVenue => v as CryptoVenue;
const asTimeframe = (n: number): CryptoTimeframe => n as CryptoTimeframe;
const asOpenInterestSymbol = (s: string): 'BTCUSDT' => s as 'BTCUSDT';

/** Le texte JSON tel que la socket le livre. `undefined` retire la clé. */
const wire = (message: unknown): string => JSON.stringify(message);

// Messages du 9 octobre 2026. Les formes viennent des flux réels (relevés en direct) ; les valeurs sont celles du
// brief quand il en donne, sinon celles du relevé.
const CB_TICKER =
  '{"type":"ticker","sequence":137481121996,"product_id":"BTC-USD","price":"82595.17","open_24h":"81100.00","volume_24h":"7932.87331115","low_24h":"80314.7","high_24h":"83452.99","volume_30d":"182908.60440536","best_bid":"82595.16","best_bid_size":"0.09873605","best_ask":"82595.17","best_ask_size":"0.05998131","side":"sell","time":"2026-10-09T09:57:05.853031Z","trade_id":1104206115,"last_size":"0.00000019"}';
const CB_MATCH_SELL = '{"type":"match","product_id":"BTC-USD","side":"sell","price":"82500.10","size":"0.01","time":"2026-10-09T10:00:01.000Z"}';
// Relevé en direct : un même échange (trade_id 1104206115), vu par le canal ticker (côté du taker) et par matches (côté du maker).
const CB_TICKER_LIVE =
  '{"type":"ticker","sequence":137481121996,"product_id":"BTC-USD","price":"83026.18","open_24h":"82256.84","volume_24h":"7932.87331115","low_24h":"80314.7","high_24h":"83452.99","volume_30d":"182908.60440536","best_bid":"83026.18","best_bid_size":"0.09873605","best_ask":"83026.19","best_ask_size":"0.05998131","side":"sell","time":"2026-10-09T12:32:19.736799Z","trade_id":1104206115,"last_size":"0.00000019"}';
const CB_LAST_MATCH_LIVE =
  '{"type":"last_match","trade_id":1104206115,"maker_order_id":"121a8a75-e093-4d88-b805-e4c7f3af0f81","taker_order_id":"de25e12a-7a82-44ec-b6cd-cbab324a57a8","side":"buy","size":"0.00000019","price":"83026.18","product_id":"BTC-USD","sequence":137481121996,"time":"2026-10-09T12:32:19.736799Z"}';
const CB_MATCH_LIVE =
  '{"type":"match","trade_id":1104206116,"maker_order_id":"121a8a75-e093-4d88-b805-e4c7f3af0f81","taker_order_id":"daff4e56-5a2f-43f6-bf13-4a13dd9afca8","side":"buy","size":"0.00000003","price":"83026.18","product_id":"BTC-USD","sequence":137481122465,"time":"2026-10-09T12:32:20.707971Z"}';
const CB_HEARTBEAT = '{"type":"heartbeat","last_trade_id":69152544,"product_id":"ONDO-USD","sequence":17330104222,"time":"2026-10-09T12:32:21.000000Z"}';
const CB_SUBSCRIPTIONS =
  '{"type":"subscriptions","channels":[{"name":"heartbeat","product_ids":["BTC-USD","ONDO-USD"],"account_ids":null},{"name":"ticker","product_ids":["BTC-USD","ONDO-USD"],"account_ids":null},{"name":"matches","product_ids":["BTC-USD","ONDO-USD"],"account_ids":null}]}';

const BN_MINI_TICKER =
  '{"e":"24hrMiniTicker","E":1791540000123,"s":"ONEUSDT","c":"0.00216300","o":"0.00223400","h":"0.00225300","l":"0.00200600","v":"1582084367.30000000","q":"3365266.96453790"}';
const BN_KLINE =
  '{"e":"kline","E":1791539000123,"s":"ONEUSDT","k":{"t":1791536400000,"T":1791539999999,"s":"ONEUSDT","i":"1h","f":1,"L":2,"o":"0.002142","c":"0.002158","h":"0.002217","l":"0.002139","v":"87072165.8","n":4407,"x":false,"q":"190392.8","V":"46488643.3","Q":"101648.6","B":"0"}}';
const BN_KLINE_FINAL =
  '{"e":"kline","E":1791540000123,"s":"ONEUSDT","k":{"t":1791536400000,"T":1791539999999,"s":"ONEUSDT","i":"1h","f":1,"L":2,"o":"0.002142","c":"0.002158","h":"0.002217","l":"0.002139","v":"87072165.8","n":4407,"x":true,"q":"190392.8","V":"46488643.3","Q":"101648.6","B":"0"}}';
const BN_KLINE_LIVE =
  '{"e":"kline","E":1791549142026,"s":"BTCUSDT","k":{"t":1791547200000,"T":1791550799999,"s":"BTCUSDT","i":"1h","f":6750796658,"L":6750886254,"o":"83246.82000000","c":"83108.52000000","h":"83418.00000000","l":"83050.02000000","v":"345.01548000","n":89597,"x":false,"q":"28716628.00892020","V":"188.43058000","Q":"15685554.35113190","B":"0"}}';
const BN_ACK = '{"result":null,"id":1}';

const BY_TICKER =
  '{"topic":"tickers.ZIGUSDT","ts":1791540000123,"type":"snapshot","data":{"symbol":"ZIGUSDT","lastPrice":"0.05932","price24hPcnt":"0.0061","highPrice24h":"0.06102","lowPrice24h":"0.0579","prevPrice24h":"0.05897","volume24h":"19122164.31","turnover24h":"1133429.78"}}';
const BY_TICKER_LIVE =
  '{"topic":"tickers.ZIGUSDT","ts":1791549140024,"type":"snapshot","cs":135626168031,"data":{"symbol":"ZIGUSDT","lastPrice":"0.05967","highPrice24h":"0.06102","lowPrice24h":"0.0579","prevPrice24h":"0.05905","volume24h":"19122164.31","turnover24h":"1133429.7805195","price24hPcnt":"0.0105","usdIndexPrice":"0.0596131"}}';
// Forme relevée sur publicTrade.BTCUSDT (ZIGUSDT n’avait aucun trade) : symbole et prix remplacés, un Sell et un Buy.
const BY_TRADES =
  '{"topic":"publicTrade.ZIGUSDT","ts":1791540000123,"type":"snapshot","data":[{"i":"2290000001228943833","T":1791540000100,"p":"0.05931","v":"120.5","S":"Sell","seq":115188396083,"s":"ZIGUSDT","BT":false,"RPI":false},{"i":"2290000001228943834","T":1791540000100,"p":"0.05932","v":"61","S":"Buy","seq":115188396083,"s":"ZIGUSDT","BT":false,"RPI":false}]}';
const BY_ACK = '{"success":true,"ret_msg":"subscribe","conn_id":"d9avrremonceh80v85sg-gbvsb","op":"subscribe"}';
const BY_PONG = '{"success":true,"ret_msg":"pong","conn_id":"d9avrremonceh80v85sg-gbvsb","op":"ping"}';

/** Chaque message de référence, avec la venue qui le parle. */
const SAMPLES: { venue: CryptoVenue; name: string; raw: string }[] = [
  { venue: 'coinbase', name: 'ticker', raw: CB_TICKER },
  { venue: 'coinbase', name: 'match', raw: CB_MATCH_SELL },
  { venue: 'coinbase', name: 'ticker réel', raw: CB_TICKER_LIVE },
  { venue: 'coinbase', name: 'last_match réel', raw: CB_LAST_MATCH_LIVE },
  { venue: 'coinbase', name: 'match réel', raw: CB_MATCH_LIVE },
  { venue: 'coinbase', name: 'heartbeat', raw: CB_HEARTBEAT },
  { venue: 'coinbase', name: 'subscriptions', raw: CB_SUBSCRIPTIONS },
  { venue: 'coinbase', name: 'error', raw: '{"type":"error","message":"Failed to subscribe","reason":"ETH-XXX is not a valid product"}' },
  { venue: 'binance', name: 'miniTicker', raw: BN_MINI_TICKER },
  { venue: 'binance', name: 'kline', raw: BN_KLINE },
  { venue: 'binance', name: 'kline finale', raw: BN_KLINE_FINAL },
  { venue: 'binance', name: 'kline réelle', raw: BN_KLINE_LIVE },
  { venue: 'binance', name: 'acquittement', raw: BN_ACK },
  { venue: 'bybit', name: 'tickers', raw: BY_TICKER },
  { venue: 'bybit', name: 'tickers réel', raw: BY_TICKER_LIVE },
  { venue: 'bybit', name: 'publicTrade', raw: BY_TRADES },
  { venue: 'bybit', name: 'acquittement', raw: BY_ACK },
  { venue: 'bybit', name: 'pong', raw: BY_PONG },
];

/** Les mêmes messages, en objets, que les tests cassent champ par champ. */
const BASE = {
  cbTicker: { type: 'ticker', product_id: 'BTC-USD', price: '82595.17', open_24h: '81100.00', time: '2026-10-09T09:57:05.853031Z' },
  cbMatch: { type: 'match', product_id: 'BTC-USD', side: 'sell', price: '82500.10', size: '0.01', time: '2026-10-09T10:00:01.000Z' },
  bnTicker: { e: '24hrMiniTicker', E: 1791540000123, s: 'ONEUSDT', c: '0.00216300', o: '0.00223400' },
  bnKline: {
    e: 'kline',
    E: 1791539000123,
    s: 'ONEUSDT',
    k: { t: 1791536400000, T: 1791539999999, s: 'ONEUSDT', i: '1h', o: '0.002142', c: '0.002158', h: '0.002217', l: '0.002139', v: '87072165.8', x: false, V: '46488643.3' },
  },
  byTicker: { topic: 'tickers.ZIGUSDT', ts: 1791540000123, type: 'snapshot', data: { symbol: 'ZIGUSDT', lastPrice: '0.05932', price24hPcnt: '0.0061' } },
  byTrade: {
    topic: 'publicTrade.ZIGUSDT',
    ts: 1791540000123,
    type: 'snapshot',
    data: [{ T: 1791540000100, s: 'ZIGUSDT', S: 'Sell', v: '120.5', p: '0.05931', i: '1', BT: false }],
  },
};

/** La copie de `base` dont le champ `path` vaut `value` (un indice de tableau s’écrit en chaîne). */
function withField(base: unknown, path: readonly string[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (Array.isArray(base)) {
    const copy: unknown[] = [...base];
    copy[Number(head)] = withField(copy[Number(head)], rest, value);
    return copy;
  }
  const record = base as Record<string, unknown>;
  return { ...record, [head]: withField(record[head], rest, value) };
}

/** Tout nombre d’une sortie, où qu’il soit. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(numbersIn);
  return [];
}

/** Ce qu’un exchange ou un intermédiaire peut mettre à la place d’un nombre ou d’un texte attendu. */
const GARBAGE: unknown[] = [null, undefined, '', '  ', 'abc', 'NaN', 'Infinity', '-Infinity', true, false, [], [5], {}];
/** Jetons JSON qui se lisent comme des nombres infinis (`JSON.parse('1e999')` donne `Infinity`). */
const RAW_INFINITY = ['1e999', '-1e999'];

describe('URLs des flux et de la température', () => {
  it('wsUrl : l’URL de flux de chaque venue, en wss: et sur un hôte du registre', () => {
    expect(wsUrl('coinbase')).toBe('wss://ws-feed.exchange.coinbase.com');
    expect(wsUrl('binance')).toBe('wss://stream.binance.com:9443/ws');
    expect(wsUrl('bybit')).toBe('wss://stream.bybit.com/v5/public/spot');
    for (const venue of VENUES) {
      expect(cryptoHostAllowed(wsUrl(venue), 'wss:'), venue).toBe(true);
      expect(cryptoHostAllowed(wsUrl(venue), 'https:'), venue).toBe(false);
    }
  });

  it('FORCE_ORDER_URL : le flux des liquidations Binance, en wss:', () => {
    expect(FORCE_ORDER_URL).toBe('wss://fstream.binance.com/ws/!forceOrder@arr');
    expect(cryptoHostAllowed(FORCE_ORDER_URL, 'wss:')).toBe(true);
    expect(cryptoHostAllowed(FORCE_ORDER_URL, 'https:')).toBe(false);
  });

  it('les relevés REST de la température : premiumIndex, ticker/24hr, openInterestHist, en https:', () => {
    expect(PREMIUM_INDEX_URL).toBe('https://fapi.binance.com/fapi/v1/premiumIndex');
    expect(TICKER_24H_URL).toBe('https://api.binance.com/api/v3/ticker/24hr');
    expect(openInterestUrl('BTCUSDT')).toBe('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25');
    expect(openInterestUrl('ETHUSDT')).toBe('https://fapi.binance.com/futures/data/openInterestHist?symbol=ETHUSDT&period=1h&limit=25');
    for (const url of [PREMIUM_INDEX_URL, TICKER_24H_URL, openInterestUrl('BTCUSDT'), openInterestUrl('ETHUSDT')]) {
      expect(cryptoHostAllowed(url, 'https:'), url).toBe(true);
      expect(cryptoHostAllowed(url, 'wss:'), url).toBe(false);
    }
  });

  it('openInterestUrl : un symbole hors liste reste dans son paramètre, il ne change ni l’hôte ni le reste de la requête', () => {
    const url = openInterestUrl(asOpenInterestSymbol('BTCUSDT&limit=1000#x'));
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('fapi.binance.com');
    expect(parsed.searchParams.get('symbol')).toBe('BTCUSDT&limit=1000#x');
    expect(parsed.searchParams.get('period')).toBe('1h');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(cryptoHostAllowed(url, 'https:')).toBe(true);
  });

  it('wsUrl ne rend aucune URL pour une venue inconnue, et cryptoHostAllowed la refuse', () => {
    for (const venue of ['kraken', '', 'constructor', '__proto__', 'toString']) {
      expect(wsUrl(asVenue(venue)), venue).toBe('');
      expect(cryptoHostAllowed(wsUrl(asVenue(venue)), 'wss:'), venue).toBe(false);
    }
  });
});

describe('clés de flux', () => {
  const KEYS: Record<CryptoSeriesId, { ticker: string[]; bars: string[] }> = {
    'coinbase:BTC-USD': { ticker: ['ticker:BTC-USD', 'heartbeat:BTC-USD'], bars: ['matches:BTC-USD', 'heartbeat:BTC-USD'] },
    'coinbase:ONDO-USD': { ticker: ['ticker:ONDO-USD', 'heartbeat:ONDO-USD'], bars: ['matches:ONDO-USD', 'heartbeat:ONDO-USD'] },
    'binance:ONEUSDT': { ticker: ['oneusdt@miniTicker'], bars: ['oneusdt@kline_1h'] },
    'bybit:ZIGUSDT': { ticker: ['tickers.ZIGUSDT'], bars: ['publicTrade.ZIGUSDT'] },
    'binance:BTCUSDT': { ticker: ['btcusdt@miniTicker'], bars: ['btcusdt@kline_1h'] },
    'binance:ONDOUSDT': { ticker: ['ondousdt@miniTicker'], bars: ['ondousdt@kline_1h'] },
  };

  it('les clés exactes de chaque série du registre, en 1 h pour les bougies', () => {
    expect(Object.keys(KEYS).sort()).toEqual(CRYPTO_MARKETS.map((m) => m.id).sort());
    for (const market of CRYPTO_MARKETS) {
      expect(streamKeys(market.id, 'ticker'), `${market.id} ticker`).toEqual(KEYS[market.id].ticker);
      expect(streamKeys(market.id, 'bars', 60), `${market.id} bars`).toEqual(KEYS[market.id].bars);
    }
  });

  it('les exemples du brief', () => {
    expect(streamKeys('coinbase:BTC-USD', 'ticker')).toEqual(['ticker:BTC-USD', 'heartbeat:BTC-USD']);
    expect(streamKeys('coinbase:BTC-USD', 'bars')).toEqual(['matches:BTC-USD', 'heartbeat:BTC-USD']);
    expect(streamKeys('binance:ONEUSDT', 'ticker')).toEqual(['oneusdt@miniTicker']);
    expect(streamKeys('binance:ONEUSDT', 'bars', 60)).toEqual(['oneusdt@kline_1h']);
    expect(streamKeys('bybit:ZIGUSDT', 'ticker')).toEqual(['tickers.ZIGUSDT']);
    expect(streamKeys('bybit:ZIGUSDT', 'bars')).toEqual(['publicTrade.ZIGUSDT']);
  });

  it('Binance : le flux de bougies porte l’intervalle du timeframe, dans la langue de la venue', () => {
    const intervals = CRYPTO_TIMEFRAMES.map((tf) => streamKeys('binance:ONEUSDT', 'bars', tf));
    expect(intervals).toEqual([['oneusdt@kline_1m'], ['oneusdt@kline_5m'], ['oneusdt@kline_15m'], ['oneusdt@kline_1h'], ['oneusdt@kline_4h'], ['oneusdt@kline_1d']]);
  });

  it('Binance : sans timeframe du registre, il n’y a pas de flux de bougies à demander', () => {
    expect(streamKeys('binance:ONEUSDT', 'bars')).toEqual([]);
    expect(streamKeys('binance:ONEUSDT', 'bars', asTimeframe(30))).toEqual([]);
    expect(streamKeys('binance:ONEUSDT', 'bars', asTimeframe(Number.NaN))).toEqual([]);
    expect(streamKeys('binance:BTCUSDT', 'bars', asTimeframe(0))).toEqual([]);
  });

  it('Coinbase et Bybit : les bougies viennent des trades, le timeframe ne change pas la clé', () => {
    for (const series of ['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'bybit:ZIGUSDT'] as const) {
      const reference = streamKeys(series, 'bars');
      for (const tf of CRYPTO_TIMEFRAMES) expect(streamKeys(series, 'bars', tf), `${series} ${tf}`).toEqual(reference);
    }
  });

  it('le ticker ne dépend pas du timeframe', () => {
    for (const market of CRYPTO_MARKETS) {
      for (const tf of CRYPTO_TIMEFRAMES) expect(streamKeys(market.id, 'ticker', tf), `${market.id} ${tf}`).toEqual(KEYS[market.id].ticker);
    }
  });

  it('ne rend aucune clé pour une série ou un genre hors de ce que le registre connaît', () => {
    expect(streamKeys('kraken:BTC-USD' as CryptoSeriesId, 'ticker')).toEqual([]);
    expect(streamKeys('coinbase:ETH-USD' as CryptoSeriesId, 'bars', 60)).toEqual([]);
    expect(streamKeys('constructor' as CryptoSeriesId, 'ticker')).toEqual([]);
    expect(streamKeys('coinbase:BTC-USD', 'depth' as 'ticker')).toEqual([]);
    expect(streamKeys('binance:ONEUSDT', undefined as unknown as 'ticker', 60)).toEqual([]);
  });

  it('rend chaque fois un tableau neuf', () => {
    const a = streamKeys('coinbase:BTC-USD', 'ticker');
    a.push('x');
    expect(streamKeys('coinbase:BTC-USD', 'ticker')).toEqual(['ticker:BTC-USD', 'heartbeat:BTC-USD']);
  });

  it('chaque clé garde le symbole de sa série, et une clé Binance est en minuscules', () => {
    for (const market of CRYPTO_MARKETS) {
      for (const kind of ['ticker', 'bars'] as const) {
        const keys = streamKeys(market.id, kind, 60);
        expect(keys.length, `${market.id} ${kind}`).toBeGreaterThan(0);
        for (const key of keys) {
          expect(key, `${market.id} ${kind}`).not.toMatch(/\s/);
          expect(key, `${market.id} ${kind}`).toContain(market.venue === 'binance' ? market.symbol.toLowerCase() : market.symbol);
          if (market.venue === 'binance') expect(key.split('@')[0], key).toBe(key.split('@')[0]?.toLowerCase());
        }
      }
    }
  });

  it('Bybit : la clé est le topic que la venue répète dans ses messages', () => {
    for (const kind of ['ticker', 'bars'] as const) {
      const [topic] = streamKeys('bybit:ZIGUSDT', kind);
      const message = kind === 'ticker' ? { ...BASE.byTicker, topic } : { ...BASE.byTrade, topic };
      expect(parseWsMessage('bybit', wire(message)).map((e) => e.kind), kind).toEqual([kind === 'ticker' ? 'ticker' : 'trade']);
    }
  });

  it('Binance : l’intervalle de la clé est celui que la venue répète dans ses bougies', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      const [key] = streamKeys('binance:ONEUSDT', 'bars', tf);
      const interval = key?.split('kline_')[1];
      const message = withField(BASE.bnKline, ['k', 'i'], interval);
      const [event] = parseWsMessage('binance', wire(message));
      expect(event?.kind, `${tf}`).toBe('kline');
      expect(event?.kind === 'kline' ? event.timeframe : null, `${tf}`).toBe(tf);
    }
  });
});

describe('messages d’abonnement', () => {
  it('Coinbase : un seul message, les canaux regroupés par nom avec leurs produits', () => {
    const keys = ['ticker:BTC-USD', 'heartbeat:BTC-USD', 'matches:ONDO-USD', 'heartbeat:ONDO-USD'];
    expect(subscribeMessage('coinbase', keys, true, 1)).toBe(
      '{"type":"subscribe","channels":[{"name":"ticker","product_ids":["BTC-USD"]},{"name":"heartbeat","product_ids":["BTC-USD","ONDO-USD"]},{"name":"matches","product_ids":["ONDO-USD"]}]}',
    );
  });

  it('Coinbase : se désabonner a la même forme, avec unsubscribe', () => {
    const keys = streamKeys('coinbase:BTC-USD', 'ticker');
    expect(JSON.parse(subscribeMessage('coinbase', keys, false, 9))).toEqual({
      type: 'unsubscribe',
      channels: [
        { name: 'ticker', product_ids: ['BTC-USD'] },
        { name: 'heartbeat', product_ids: ['BTC-USD'] },
      ],
    });
  });

  it('Coinbase : le même produit n’est écrit qu’une fois par canal, et une clé mal formée est écartée', () => {
    const keys = ['ticker:BTC-USD', 'ticker:BTC-USD', 'ticker', ':BTC-USD', 'ticker:', '', 'heartbeat:BTC-USD'];
    expect(JSON.parse(subscribeMessage('coinbase', keys, true, 1))).toEqual({
      type: 'subscribe',
      channels: [
        { name: 'ticker', product_ids: ['BTC-USD'] },
        { name: 'heartbeat', product_ids: ['BTC-USD'] },
      ],
    });
    expect(JSON.parse(subscribeMessage('coinbase', [], true, 1))).toEqual({ type: 'subscribe', channels: [] });
  });

  it('Coinbase : ni identifiant ni autre champ que type et channels', () => {
    const message: unknown = JSON.parse(subscribeMessage('coinbase', ['ticker:BTC-USD'], true, 42));
    expect(Object.keys(message as object)).toEqual(['type', 'channels']);
  });

  it('Binance : SUBSCRIBE ou UNSUBSCRIBE, les clés en params, l’identifiant de la demande', () => {
    const keys = [...streamKeys('binance:ONEUSDT', 'ticker'), ...streamKeys('binance:ONEUSDT', 'bars', 60)];
    expect(subscribeMessage('binance', keys, true, 7)).toBe('{"method":"SUBSCRIBE","params":["oneusdt@miniTicker","oneusdt@kline_1h"],"id":7}');
    expect(JSON.parse(subscribeMessage('binance', keys, false, 8))).toEqual({ method: 'UNSUBSCRIBE', params: keys, id: 8 });
  });

  it('Bybit : subscribe ou unsubscribe, les clés en args, sans identifiant', () => {
    const keys = [...streamKeys('bybit:ZIGUSDT', 'ticker'), ...streamKeys('bybit:ZIGUSDT', 'bars')];
    expect(subscribeMessage('bybit', keys, true, 7)).toBe('{"op":"subscribe","args":["tickers.ZIGUSDT","publicTrade.ZIGUSDT"]}');
    expect(JSON.parse(subscribeMessage('bybit', keys, false, 8))).toEqual({ op: 'unsubscribe', args: keys });
  });

  it('Binance et Bybit : liste vide, liste dans l’ordre donné, entrée intacte', () => {
    expect(JSON.parse(subscribeMessage('binance', [], true, 1))).toEqual({ method: 'SUBSCRIBE', params: [], id: 1 });
    expect(JSON.parse(subscribeMessage('bybit', [], true, 1))).toEqual({ op: 'subscribe', args: [] });
    const keys = Object.freeze(['b@miniTicker', 'a@miniTicker']);
    expect(JSON.parse(subscribeMessage('binance', keys, true, 1))).toMatchObject({ params: ['b@miniTicker', 'a@miniTicker'] });
    expect(JSON.parse(subscribeMessage('bybit', keys, true, 1))).toMatchObject({ args: ['b@miniTicker', 'a@miniTicker'] });
    expect(subscribeMessage('coinbase', Object.freeze(['ticker:BTC-USD']), true, 1)).toContain('BTC-USD');
  });

  it('chaque série, chaque genre : le message de la venue contient toutes les clés demandées', () => {
    for (const market of CRYPTO_MARKETS) {
      for (const kind of ['ticker', 'bars'] as const) {
        const keys = streamKeys(market.id, kind, 15);
        const text = subscribeMessage(market.venue, keys, true, 3);
        const message = JSON.parse(text) as Record<string, unknown>;
        if (market.venue === 'coinbase') {
          const channels = message.channels as { name: string; product_ids: string[] }[];
          expect(channels.flatMap((c) => c.product_ids.map((p) => `${c.name}:${p}`)), `${market.id} ${kind}`).toEqual(keys);
        } else {
          expect(message.params ?? message.args, `${market.id} ${kind}`).toEqual(keys);
        }
      }
    }
  });

  it('rend une chaîne vide pour une venue inconnue', () => {
    for (const venue of ['kraken', '', 'constructor']) expect(subscribeMessage(asVenue(venue), ['x'], true, 1), venue).toBe('');
  });
});

describe('lecture des messages Coinbase', () => {
  it('ticker : prix, variation sur 24 h depuis open_24h, horodatage en millisecondes', () => {
    expect(parseWsMessage('coinbase', CB_TICKER)).toEqual([
      { kind: 'ticker', ticker: { market: 'coinbase:BTC-USD', last: 82595.17, change24hPct: expect.closeTo(1.8436128, 6), time: 1791539825853 } },
    ]);
  });

  it('ticker : la variation est (prix / open_24h - 1) x 100, négative quand le prix a baissé', () => {
    const [event] = parseWsMessage('coinbase', wire({ ...BASE.cbTicker, product_id: 'ONDO-USD', price: '0.9', open_24h: '1.2' }));
    expect(event).toEqual({ kind: 'ticker', ticker: { market: 'coinbase:ONDO-USD', last: 0.9, change24hPct: expect.closeTo(-25, 9), time: 1791539825853 } });
  });

  it('ticker : sans open_24h exploitable, le prix passe et la variation est null', () => {
    for (const open of [undefined, null, '', 'abc', 'NaN', 'Infinity', '0', 0, '0.0', '-5', true, [], {}]) {
      const events = parseWsMessage('coinbase', wire({ ...BASE.cbTicker, open_24h: open }));
      expect(events, JSON.stringify(open) ?? 'undefined').toEqual([{ kind: 'ticker', ticker: { market: 'coinbase:BTC-USD', last: 82595.17, change24hPct: null, time: 1791539825853 } }]);
    }
  });

  it('match : l’agresseur est le côté opposé à side, qui est celui du maker', () => {
    expect(parseWsMessage('coinbase', CB_MATCH_SELL)).toEqual([
      { kind: 'trade', trade: { market: 'coinbase:BTC-USD', time: 1791540001000, price: 82500.1, size: 0.01, aggressor: 'buy' } },
    ]);
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, side: 'buy' }))).toEqual([
      { kind: 'trade', trade: { market: 'coinbase:BTC-USD', time: 1791540001000, price: 82500.1, size: 0.01, aggressor: 'sell' } },
    ]);
  });

  it('last_match se lit comme un match', () => {
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, type: 'last_match' }))).toEqual(parseWsMessage('coinbase', CB_MATCH_SELL));
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, type: 'last_match', side: 'buy' }))).toEqual(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, side: 'buy' })));
  });

  it('relevé en direct : l’agresseur de matches est le côté du taker que le ticker donne pour le même échange', () => {
    const ticker: unknown = JSON.parse(CB_TICKER_LIVE);
    const lastMatch: unknown = JSON.parse(CB_LAST_MATCH_LIVE);
    expect((ticker as { trade_id: number }).trade_id).toBe((lastMatch as { trade_id: number }).trade_id);
    expect((lastMatch as { side: string }).side).toBe('buy');
    expect((ticker as { side: string }).side).toBe('sell');
    expect(parseWsMessage('coinbase', CB_LAST_MATCH_LIVE)).toEqual([
      { kind: 'trade', trade: { market: 'coinbase:BTC-USD', time: 1791549139736, price: 83026.18, size: 0.00000019, aggressor: 'sell' } },
    ]);
    expect(parseWsMessage('coinbase', CB_MATCH_LIVE)).toEqual([
      { kind: 'trade', trade: { market: 'coinbase:BTC-USD', time: 1791549140707, price: 83026.18, size: 0.00000003, aggressor: 'sell' } },
    ]);
    expect(parseWsMessage('coinbase', CB_TICKER_LIVE)).toEqual([
      { kind: 'ticker', ticker: { market: 'coinbase:BTC-USD', last: 83026.18, change24hPct: expect.closeTo(0.93529, 5), time: 1791549139736 } },
    ]);
  });

  it('un côté qui n’est pas exactement buy ou sell écarte le trade : le CVD ne devine pas', () => {
    for (const side of [undefined, null, '', 'BUY', 'Sell', 'bid', 'ask', 0, true, [], {}]) {
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, side })), JSON.stringify(side) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('heartbeat : la preuve de vie du canal', () => {
    expect(parseWsMessage('coinbase', CB_HEARTBEAT)).toEqual([{ kind: 'heartbeat' }]);
    expect(parseWsMessage('coinbase', '{"type":"heartbeat"}')).toEqual([{ kind: 'heartbeat' }]);
  });

  it('error : le détail de la venue', () => {
    expect(parseWsMessage('coinbase', '{"type":"error","message":"Failed to subscribe"}')).toEqual([{ kind: 'error', detail: 'Failed to subscribe' }]);
    expect(parseWsMessage('coinbase', '{"type":"error","message":"Failed to subscribe","reason":"ETH-XXX is not a valid product"}')).toEqual([
      { kind: 'error', detail: 'Failed to subscribe: ETH-XXX is not a valid product' },
    ]);
    expect(parseWsMessage('coinbase', '{"type":"error","reason":"rate limit"}')).toEqual([{ kind: 'error', detail: 'rate limit' }]);
  });

  it('error sans texte exploitable : un détail quand même, jamais vide', () => {
    for (const message of [undefined, null, '', '   ', 42, {}, []]) {
      expect(parseWsMessage('coinbase', wire({ type: 'error', message })), JSON.stringify(message) ?? 'undefined').toEqual([{ kind: 'error', detail: 'coinbase: error' }]);
    }
  });

  it('le reste est ignoré : abonnements acquittés, statuts, carnets, types inconnus', () => {
    expect(parseWsMessage('coinbase', CB_SUBSCRIPTIONS)).toEqual(IGNORED);
    for (const type of ['status', 'snapshot', 'l2update', 'received', 'open', 'done', 'change', 'activate', 'full', 'TICKER', '', null, 7]) {
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbTicker, type })), JSON.stringify(type)).toEqual(IGNORED);
    }
    expect(parseWsMessage('coinbase', wire({ product_id: 'BTC-USD', price: '1' }))).toEqual(IGNORED);
  });

  it('un produit hors registre est ignoré : ticker comme match', () => {
    for (const product of ['ETH-USD', 'BTC-EUR', 'btc-usd', 'ONEUSDT', 'binance:ONEUSDT', 'BTC-USD:x', '__proto__', 'constructor', '']) {
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbTicker, product_id: product })), product).toEqual(IGNORED);
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, product_id: product })), product).toEqual(IGNORED);
    }
  });

  it('un produit qui n’est pas du texte est ignoré, même quand son écriture est celle d’un produit du registre', () => {
    // `String(['BTC-USD'])` vaut `BTC-USD` : seul le type du champ l’écarte.
    for (const product of [['BTC-USD'], ['ONDO-USD'], [['BTC-USD']]]) {
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbTicker, product_id: product })), JSON.stringify(product)).toEqual(IGNORED);
      expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, product_id: product })), JSON.stringify(product)).toEqual(IGNORED);
    }
  });

  it('price: abc est ignoré, ticker comme match', () => {
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbTicker, price: 'abc' }))).toEqual(IGNORED);
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbMatch, price: 'abc' }))).toEqual(IGNORED);
  });
});

describe('lecture des messages Binance', () => {
  it('miniTicker : c, o et E, variation sur 24 h depuis o', () => {
    expect(parseWsMessage('binance', BN_MINI_TICKER)).toEqual([
      { kind: 'ticker', ticker: { market: 'binance:ONEUSDT', last: 0.002163, change24hPct: expect.closeTo(-3.17815577, 6), time: 1791540000123 } },
    ]);
  });

  it('miniTicker réel : un prix minuscule garde toute sa précision', () => {
    const [event] = parseWsMessage('binance', '{"e":"24hrMiniTicker","E":1791549144541,"s":"ONEUSDT","c":"0.00214000","o":"0.00209700","h":"0.00225300","l":"0.00200600","v":"1582084367.30000000","q":"3365266.96453790"}');
    expect(event).toEqual({ kind: 'ticker', ticker: { market: 'binance:ONEUSDT', last: 0.00214, change24hPct: expect.closeTo(2.05055, 4), time: 1791549144541 } });
  });

  it('miniTicker : sans o exploitable, le prix passe et la variation est null', () => {
    for (const open of [undefined, null, '', 'abc', 'NaN', '0', '0.00000000', '-1', true, [], {}]) {
      expect(parseWsMessage('binance', wire({ ...BASE.bnTicker, o: open })), JSON.stringify(open) ?? 'undefined').toEqual([
        { kind: 'ticker', ticker: { market: 'binance:ONEUSDT', last: 0.002163, change24hPct: null, time: 1791540000123 } },
      ]);
    }
  });

  it('kline non finale : la bougie entière, le volume acheteur, l’ouverture en secondes', () => {
    expect(parseWsMessage('binance', BN_KLINE)).toEqual([
      {
        kind: 'kline',
        series: 'binance:ONEUSDT',
        timeframe: 60,
        bar: { time: 1791536400, open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 },
        final: false,
      },
    ]);
  });

  it('kline finale (x vrai) : la même bougie, marquée finale', () => {
    expect(parseWsMessage('binance', BN_KLINE_FINAL)).toEqual([
      {
        kind: 'kline',
        series: 'binance:ONEUSDT',
        timeframe: 60,
        bar: { time: 1791536400, open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 },
        final: true,
      },
    ]);
  });

  it('kline réelle d’une source du CVD : BTCUSDT en 1 h', () => {
    expect(parseWsMessage('binance', BN_KLINE_LIVE)).toEqual([
      {
        kind: 'kline',
        series: 'binance:BTCUSDT',
        timeframe: 60,
        bar: { time: 1791547200, open: 83246.82, high: 83418, low: 83050.02, close: 83108.52, volume: 345.01548, buyVolume: 188.43058 },
        final: false,
      },
    ]);
  });

  it('kline : final ne vaut vrai que pour x à true', () => {
    for (const x of [undefined, null, false, 0, 1, 'true', 'x', [], {}]) {
      const [event] = parseWsMessage('binance', wire(withField(BASE.bnKline, ['k', 'x'], x)));
      expect(event?.kind, JSON.stringify(x) ?? 'undefined').toBe('kline');
      expect(event?.kind === 'kline' ? event.final : null, JSON.stringify(x) ?? 'undefined').toBe(false);
    }
    const [done] = parseWsMessage('binance', wire(withField(BASE.bnKline, ['k', 'x'], true)));
    expect(done?.kind === 'kline' ? done.final : null).toBe(true);
  });

  it('kline : les six intervalles de la venue donnent les six timeframes', () => {
    const expected: [string, CryptoTimeframe][] = [['1m', 1], ['5m', 5], ['15m', 15], ['1h', 60], ['4h', 240], ['1d', 1440]];
    for (const [interval, timeframe] of expected) {
      const [event] = parseWsMessage('binance', wire(withField(BASE.bnKline, ['k', 'i'], interval)));
      expect(event?.kind === 'kline' ? event.timeframe : null, interval).toBe(timeframe);
    }
  });

  it('kline : un intervalle hors des six timeframes est ignoré', () => {
    for (const interval of ['3m', '30m', '2h', '6h', '12h', '3d', '1w', '1M', '1H', '60', '', 'constructor', '__proto__', 'toString', 60, 1, null, undefined, [], {}]) {
      expect(parseWsMessage('binance', wire(withField(BASE.bnKline, ['k', 'i'], interval))), JSON.stringify(interval) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('kline : le symbole vient du message, pas d’un intervalle ni d’une liste figée', () => {
    for (const symbol of ['ONEUSDT', 'BTCUSDT', 'ONDOUSDT']) {
      const [event] = parseWsMessage('binance', wire(withField(BASE.bnKline, ['s'], symbol)));
      expect(event?.kind === 'kline' ? event.series : null, symbol).toBe(`binance:${symbol}`);
    }
  });

  it('acquittements { result, id } : ignorés', () => {
    expect(parseWsMessage('binance', BN_ACK)).toEqual(IGNORED);
    expect(parseWsMessage('binance', '{"result":["oneusdt@miniTicker"],"id":3}')).toEqual(IGNORED);
    expect(parseWsMessage('binance', '{"id":9}')).toEqual(IGNORED);
  });

  it('les autres événements sont ignorés', () => {
    for (const e of ['aggTrade', 'trade', '24hrTicker', 'depthUpdate', 'bookTicker', 'forceOrder', 'KLINE', '', null, 7, undefined]) {
      expect(parseWsMessage('binance', wire({ ...BASE.bnTicker, e })), JSON.stringify(e) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('un symbole hors registre est ignoré : miniTicker comme kline', () => {
    for (const symbol of ['ETHUSDT', 'oneusdt', 'ONEUSDC', 'BTC-USD', 'binance:ONEUSDT', '__proto__', 'constructor', '', null, 5, ['ONEUSDT'], ['BTCUSDT']]) {
      expect(parseWsMessage('binance', wire({ ...BASE.bnTicker, s: symbol })), JSON.stringify(symbol)).toEqual(IGNORED);
      expect(parseWsMessage('binance', wire({ ...BASE.bnKline, s: symbol })), JSON.stringify(symbol)).toEqual(IGNORED);
    }
  });

  it('kline sans objet k exploitable : ignorée', () => {
    for (const k of [undefined, null, 'x', 5, [], [1, 2], true]) expect(parseWsMessage('binance', wire({ ...BASE.bnKline, k })), JSON.stringify(k) ?? 'undefined').toEqual(IGNORED);
  });
});

describe('lecture des messages Bybit', () => {
  it('tickers : lastPrice, price24hPcnt x 100, ts', () => {
    expect(parseWsMessage('bybit', BY_TICKER)).toEqual([
      { kind: 'ticker', ticker: { market: 'bybit:ZIGUSDT', last: 0.05932, change24hPct: expect.closeTo(0.61, 9), time: 1791540000123 } },
    ]);
  });

  it('tickers réel : la variation est celle de prevPrice24h, en pourcent', () => {
    const [event] = parseWsMessage('bybit', BY_TICKER_LIVE);
    expect(event).toEqual({ kind: 'ticker', ticker: { market: 'bybit:ZIGUSDT', last: 0.05967, change24hPct: expect.closeTo(1.05, 9), time: 1791549140024 } });
    // 0,05967 / 0,05905 - 1, en pourcent : la venue arrondit à quatre décimales.
    expect(0.05967 / 0.05905 - 1).toBeCloseTo(0.0105, 4);
  });

  it('tickers : sans price24hPcnt exploitable, le prix passe et la variation est null', () => {
    for (const pct of [undefined, null, '', 'abc', 'NaN', 'Infinity', true, [], {}]) {
      expect(parseWsMessage('bybit', wire(withField(BASE.byTicker, ['data', 'price24hPcnt'], pct))), JSON.stringify(pct) ?? 'undefined').toEqual([
        { kind: 'ticker', ticker: { market: 'bybit:ZIGUSDT', last: 0.05932, change24hPct: null, time: 1791540000123 } },
      ]);
    }
  });

  it('tickers : un recul de 24 h est une variation négative', () => {
    const [event] = parseWsMessage('bybit', wire(withField(BASE.byTicker, ['data', 'price24hPcnt'], '-0.0123')));
    expect(event).toEqual({ kind: 'ticker', ticker: { market: 'bybit:ZIGUSDT', last: 0.05932, change24hPct: expect.closeTo(-1.23, 9), time: 1791540000123 } });
  });

  it('publicTrade : un trade par élément, dans l’ordre, avec T, p, v et l’agresseur', () => {
    expect(parseWsMessage('bybit', BY_TRADES)).toEqual([
      { kind: 'trade', trade: { market: 'bybit:ZIGUSDT', time: 1791540000100, price: 0.05931, size: 120.5, aggressor: 'sell' } },
      { kind: 'trade', trade: { market: 'bybit:ZIGUSDT', time: 1791540000100, price: 0.05932, size: 61, aggressor: 'buy' } },
    ]);
  });

  it('publicTrade : S Sell donne un agresseur vendeur, S Buy un agresseur acheteur (S est le côté du taker)', () => {
    const sell = parseWsMessage('bybit', wire(BASE.byTrade));
    expect(sell).toEqual([{ kind: 'trade', trade: { market: 'bybit:ZIGUSDT', time: 1791540000100, price: 0.05931, size: 120.5, aggressor: 'sell' } }]);
    const buy = parseWsMessage('bybit', wire(withField(BASE.byTrade, ['data', '0', 'S'], 'Buy')));
    expect(buy).toEqual([{ kind: 'trade', trade: { market: 'bybit:ZIGUSDT', time: 1791540000100, price: 0.05931, size: 120.5, aggressor: 'buy' } }]);
  });

  it('publicTrade : un côté qui n’est pas exactement Buy ou Sell écarte le trade : le CVD ne devine pas', () => {
    for (const side of [undefined, null, '', 'buy', 'sell', 'BUY', 'SELL', 'Bid', 0, true, [], {}]) {
      expect(parseWsMessage('bybit', wire(withField(BASE.byTrade, ['data', '0', 'S'], side))), JSON.stringify(side) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('publicTrade : une ligne invalide est écartée, ses voisines valides sont gardées', () => {
    const good = BASE.byTrade.data[0];
    const data = [{ ...good, p: 'abc' }, { ...good, v: '2' }, null, 3, 'x', [], { ...good, T: 'NaN' }, { ...good, S: 'Buy', v: '3' }];
    expect(parseWsMessage('bybit', wire({ ...BASE.byTrade, data })).map((e) => (e.kind === 'trade' ? [e.trade.size, e.trade.aggressor] : e.kind))).toEqual([
      [2, 'sell'],
      [3, 'buy'],
    ]);
  });

  it('publicTrade sans élément exploitable : ignoré', () => {
    for (const data of [[], undefined, null, {}, 'x', 5, [null], [{}]]) {
      expect(parseWsMessage('bybit', wire({ ...BASE.byTrade, data })), JSON.stringify(data) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('pong : les deux formes sont une preuve de vie', () => {
    expect(parseWsMessage('bybit', '{"op":"pong","args":["1791540000123"],"conn_id":"abc"}')).toEqual([{ kind: 'heartbeat' }]);
    expect(parseWsMessage('bybit', BY_PONG)).toEqual([{ kind: 'heartbeat' }]);
    expect(parseWsMessage('bybit', '{"success":true,"ret_msg":"pong","op":"ping"}')).toEqual([{ kind: 'heartbeat' }]);
    expect(parseWsMessage('bybit', '{"op":"pong"}')).toEqual([{ kind: 'heartbeat' }]);
    expect(parseWsMessage('bybit', '{"ret_msg":"pong"}')).toEqual([{ kind: 'heartbeat' }]);
  });

  it('acquittements d’abonnement : ignorés', () => {
    expect(parseWsMessage('bybit', BY_ACK)).toEqual(IGNORED);
    expect(parseWsMessage('bybit', '{"success":true,"ret_msg":"","conn_id":"abc","req_id":"1","op":"subscribe"}')).toEqual(IGNORED);
    expect(parseWsMessage('bybit', '{"success":true,"ret_msg":"unsubscribe","conn_id":"abc","op":"unsubscribe"}')).toEqual(IGNORED);
  });

  it('un autre topic est ignoré', () => {
    for (const topic of ['orderbook.1.ZIGUSDT', 'kline.60.ZIGUSDT', 'tickers', 'publicTrade', 'publicTrades.ZIGUSDT', 'ticker.ZIGUSDT', 'Tickers.ZIGUSDT', '', 'x', null, 5, undefined]) {
      expect(parseWsMessage('bybit', wire({ ...BASE.byTicker, topic })), JSON.stringify(topic) ?? 'undefined').toEqual(IGNORED);
      expect(parseWsMessage('bybit', wire({ ...BASE.byTrade, topic })), JSON.stringify(topic) ?? 'undefined').toEqual(IGNORED);
    }
  });

  it('un symbole hors registre est ignoré : tickers comme publicTrade', () => {
    for (const symbol of ['BTCUSDT', 'zigusdt', 'ZIGUSDC', 'ZIG', '', 'ZIGUSDT.x', '__proto__', 'constructor']) {
      expect(parseWsMessage('bybit', wire({ ...BASE.byTicker, topic: `tickers.${symbol}` })), symbol).toEqual(IGNORED);
      expect(parseWsMessage('bybit', wire({ ...BASE.byTrade, topic: `publicTrade.${symbol}` })), symbol).toEqual(IGNORED);
    }
  });

  it('tickers sans data exploitable : ignoré', () => {
    for (const data of [undefined, null, 'x', 5, [], [{ lastPrice: '1' }], true]) {
      expect(parseWsMessage('bybit', wire({ ...BASE.byTicker, data })), JSON.stringify(data) ?? 'undefined').toEqual(IGNORED);
    }
  });
});

describe('lecture défensive des messages', () => {
  /** Chaque champ obligatoire de chaque message : un texte ou un nombre exploitable, sinon rien n’en sort. */
  const REQUIRED: { venue: CryptoVenue; name: string; base: unknown; paths: string[][] }[] = [
    { venue: 'coinbase', name: 'ticker', base: BASE.cbTicker, paths: [['product_id'], ['price'], ['time']] },
    { venue: 'coinbase', name: 'match', base: BASE.cbMatch, paths: [['product_id'], ['side'], ['price'], ['size'], ['time']] },
    { venue: 'binance', name: 'miniTicker', base: BASE.bnTicker, paths: [['s'], ['c'], ['E']] },
    {
      venue: 'binance',
      name: 'kline',
      base: BASE.bnKline,
      paths: [['s'], ['k', 't'], ['k', 'i'], ['k', 'o'], ['k', 'h'], ['k', 'l'], ['k', 'c'], ['k', 'v'], ['k', 'V']],
    },
    { venue: 'bybit', name: 'tickers', base: BASE.byTicker, paths: [['ts'], ['data', 'lastPrice']] },
    { venue: 'bybit', name: 'publicTrade', base: BASE.byTrade, paths: [['data', '0', 'T'], ['data', '0', 'p'], ['data', '0', 'v'], ['data', '0', 'S']] },
  ];

  it('JSON illisible, coupé ou qui n’est pas un objet : un seul message ignoré, sans rien lever', () => {
    const texts = ['{', '', ' ', '{"type":', '{"type":"ticker"', 'null', 'true', '42', '"ticker"', '[]', '[{"type":"heartbeat"}]', '{}', '{"a":}', 'undefined', 'NaN', "{'type':'heartbeat'}", '\u0000', '{"type":"heartbeat"}}'];
    for (const venue of VENUES) {
      for (const text of texts) expect(parseWsMessage(venue, text), `${venue} ${JSON.stringify(text)}`).toEqual(IGNORED);
    }
  });

  it('un JSON coupé à n’importe quelle position est ignoré', () => {
    for (const { venue, name, raw } of SAMPLES) {
      for (let cut = 0; cut < raw.length; cut++) expect(parseWsMessage(venue, raw.slice(0, cut)), `${venue} ${name} coupé à ${cut}`).toEqual(IGNORED);
    }
  });

  it('une valeur qui n’est pas du texte ne fait pas lever non plus', () => {
    const throwing = { toString: (): string => { throw new Error('toString'); } };
    for (const venue of VENUES) {
      for (const raw of [undefined, null, 42, true, {}, [], Symbol('x'), throwing]) {
        expect(parseWsMessage(venue, raw as unknown as string), `${venue} ${String(typeof raw)}`).toEqual(IGNORED);
      }
    }
  });

  it('un JSON très profond ne fait pas lever', () => {
    for (const venue of VENUES) {
      expect(parseWsMessage(venue, '['.repeat(200000)), venue).toEqual(IGNORED);
      expect(parseWsMessage(venue, '{"a":'.repeat(100000)), venue).toEqual(IGNORED);
    }
  });

  it('une venue inconnue ne lit rien', () => {
    for (const venue of ['kraken', '', 'constructor', '__proto__']) {
      for (const { raw } of SAMPLES) expect(parseWsMessage(asVenue(venue), raw), venue).toEqual(IGNORED);
    }
  });

  it('chaque venue ne lit que son propre dialecte', () => {
    for (const { venue, name, raw } of SAMPLES) {
      for (const other of VENUES.filter((v) => v !== venue)) expect(parseWsMessage(other, raw), `${name} (${venue}) lu par ${other}`).toEqual(IGNORED);
    }
  });

  it('n’accepte un message que si chaque champ obligatoire est exploitable : tout le reste est ignoré', () => {
    for (const { venue, name, base, paths } of REQUIRED) {
      expect(parseWsMessage(venue, wire(base)).map((e) => e.kind), `${venue} ${name} (témoin)`).not.toEqual(['ignored']);
      for (const path of paths) {
        for (const bad of GARBAGE) {
          const label = `${venue} ${name} ${path.join('.')} = ${JSON.stringify(bad) ?? 'undefined'}`;
          expect(parseWsMessage(venue, wire(withField(base, path, bad))), label).toEqual(IGNORED);
        }
      }
    }
  });

  it('un nombre que JSON lit comme infini est écarté lui aussi', () => {
    for (const { venue, name, base, paths } of REQUIRED) {
      for (const path of paths) {
        for (const token of RAW_INFINITY) {
          const text = wire(withField(base, path, '@@INFINI@@')).replace('"@@INFINI@@"', token);
          const label = `${venue} ${name} ${path.join('.')} = ${token}`;
          // Un champ de texte (symbole, côté, intervalle, horodatage) reste invalide : un nombre n’en est pas un.
          expect(parseWsMessage(venue, text), label).toEqual(IGNORED);
        }
      }
    }
  });

  it('un nombre infini dans un champ facultatif ne donne ni NaN ni Infinity', () => {
    const optional: { venue: CryptoVenue; base: unknown; path: string[] }[] = [
      { venue: 'coinbase', base: BASE.cbTicker, path: ['open_24h'] },
      { venue: 'binance', base: BASE.bnTicker, path: ['o'] },
      { venue: 'bybit', base: BASE.byTicker, path: ['data', 'price24hPcnt'] },
    ];
    for (const { venue, base, path } of optional) {
      for (const token of RAW_INFINITY) {
        const events = parseWsMessage(venue, wire(withField(base, path, '@@INFINI@@')).replace('"@@INFINI@@"', token));
        expect(events.map((e) => e.kind), `${venue} ${token}`).toEqual(['ticker']);
        expect(numbersIn(events).every(Number.isFinite), `${venue} ${token}`).toBe(true);
        expect(events[0]?.kind === 'ticker' ? events[0].ticker.change24hPct : 'absent', `${venue} ${token}`).toBeNull();
      }
    }
  });

  it('une variation qui déborderait de Number reste null, jamais Infinity', () => {
    expect(parseWsMessage('coinbase', wire({ ...BASE.cbTicker, price: '1e300', open_24h: '1e-300' }))).toEqual([
      { kind: 'ticker', ticker: { market: 'coinbase:BTC-USD', last: 1e300, change24hPct: null, time: 1791539825853 } },
    ]);
    expect(parseWsMessage('bybit', wire(withField(BASE.byTicker, ['data', 'price24hPcnt'], '1e308')))).toEqual([
      { kind: 'ticker', ticker: { market: 'bybit:ZIGUSDT', last: 0.05932, change24hPct: null, time: 1791540000123 } },
    ]);
  });

  it('jamais de tableau vide, toujours des genres connus, jamais un nombre non fini, sur tous les messages de référence', () => {
    const kinds = new Set(['ticker', 'trade', 'kline', 'heartbeat', 'error', 'ignored']);
    for (const venue of VENUES) {
      for (const { raw, name } of SAMPLES) {
        const events = parseWsMessage(venue, raw);
        expect(events.length, `${venue} ${name}`).toBeGreaterThan(0);
        expect(events.every((e) => kinds.has(e.kind)), `${venue} ${name}`).toBe(true);
        expect(numbersIn(events).every(Number.isFinite), `${venue} ${name}`).toBe(true);
      }
    }
  });

  it('les clés piégées d’un JSON (__proto__, constructor) ne changent rien', () => {
    expect(parseWsMessage('coinbase', '{"__proto__":{"type":"ticker"},"product_id":"BTC-USD","price":"1"}')).toEqual(IGNORED);
    expect(parseWsMessage('binance', '{"__proto__":{"e":"kline"},"s":"ONEUSDT"}')).toEqual(IGNORED);
    expect(parseWsMessage('bybit', '{"constructor":{"topic":"tickers.ZIGUSDT"}}')).toEqual(IGNORED);
    expect(parseWsMessage('coinbase', CB_TICKER)).toHaveLength(1);
  });

  it('rend chaque fois des objets neufs', () => {
    const a = parseWsMessage('coinbase', CB_HEARTBEAT);
    a.push({ kind: 'ignored' });
    expect(parseWsMessage('coinbase', CB_HEARTBEAT)).toEqual([{ kind: 'heartbeat' }]);
    const b = parseWsMessage('bybit', 'pas du JSON');
    b.pop();
    expect(parseWsMessage('bybit', 'pas du JSON')).toEqual(IGNORED);
  });
});

describe('partage avec le process principal', () => {
  it('le .d.ts type chaque constante d’URL par sa valeur littérale', () => {
    const declaration = readFileSync('electron/crypto/venues.d.ts', 'utf8');
    for (const [name, value] of Object.entries({ FORCE_ORDER_URL, PREMIUM_INDEX_URL, TICKER_24H_URL })) {
      expect(declaration, name).toContain(`export const ${name}: '${value}';`);
    }
  });

  it('le .d.ts déclare les six genres de WsParsed', () => {
    const declaration = readFileSync('electron/crypto/venues.d.ts', 'utf8');
    for (const kind of ['ticker', 'trade', 'kline', 'heartbeat', 'error', 'ignored']) expect(declaration, kind).toContain(`kind: '${kind}'`);
  });
});
