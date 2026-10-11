/**
 * Les réponses réelles des exchanges que le banc de capture rejoue (CRY4.4), telles que reçues, dans `./fixtures`.
 *
 * Relevées le 11 octobre 2026, en lecture seule, sur les API publiques sans identifiant, pour la fenêtre du 9 octobre 2026
 * (jusqu'à la bougie de 10:00 UTC comprise, la dernière ouverte sur les captures des tests de `venues.ts`) :
 *
 *   Coinbase  BTC-USD   /products/BTC-USD/candles?granularity=3600&start=2026-09-26T23:00:00.000Z&end=2026-10-09T10:00:00.000Z
 *                       (page récente, 300 bougies) puis start=2026-09-14T11:00:00.000Z&end=2026-09-26T22:00:00.000Z (page ancienne),
 *                       les deux URL exactes que `historyRequests('coinbase:BTC-USD', 60, …)` demande ;
 *   Coinbase  ONDO-USD  la même page récente ;
 *   Binance   ONEUSDT   /api/v3/klines?symbol=ONEUSDT&interval=1h&limit=300&endTime=1791543599999 ;
 *   Bybit     ZIGUSDT   /v5/market/kline?category=spot&symbol=ZIGUSDT&interval=60&limit=300&end=1791543599999 ;
 *   Binance   BTCUSDT   /api/v3/klines?symbol=BTCUSDT&interval=1h&limit=48&endTime=1791543599999 (source du CVD Binance) ;
 *   Binance   ONDOUSDT  la même requête pour ONDOUSDT.
 *
 * Aucune ligne n'est retouchée : `fakeCryptoDesk` les lit par `parseCandles`, comme le process principal.
 */
import type { CryptoFixtures } from './fakeCryptoDesk';
import binanceBtcUsdt from './fixtures/binance-BTCUSDT-1h.json';
import binanceOndoUsdt from './fixtures/binance-ONDOUSDT-1h.json';
import binanceOneUsdt from './fixtures/binance-ONEUSDT-1h.json';
import bybitZigUsdt from './fixtures/bybit-ZIGUSDT-1h.json';
import coinbaseBtcOlder from './fixtures/coinbase-BTC-USD-1h-older.json';
import coinbaseBtcRecent from './fixtures/coinbase-BTC-USD-1h-recent.json';
import coinbaseOndo from './fixtures/coinbase-ONDO-USD-1h.json';

export const recordedFixtures: CryptoFixtures = {
  responses: {
    'coinbase:BTC-USD': [coinbaseBtcRecent, coinbaseBtcOlder],
    'coinbase:ONDO-USD': [coinbaseOndo],
    'binance:ONEUSDT': [binanceOneUsdt],
    'bybit:ZIGUSDT': [bybitZigUsdt],
    'binance:BTCUSDT': [binanceBtcUsdt],
    'binance:ONDOUSDT': [binanceOndoUsdt],
  },
};
