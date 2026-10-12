import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeDeskTool } from '@/engine/agent/tools';
import type { CryptoAlert } from '@/engine/crypto/alerts';
import { CRYPTO_INDICATORS, cryptoIndicatorById, offeredCatalog } from '@/engine/crypto/indicators';
import type { CryptoBar, CryptoMarketId } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { cryptoAlertViews } from '@/engine/crypto/views';
import type { IndicatorInstance } from '@/engine/indicators';
import { fakePorts } from './helpers/deskPorts';

/*
 * CRY6.2 : le port `CryptoDeskPort` tiré du store (`cryptoDeskPort()`, `src/store/crypto.ts`), celui que `livePorts().crypto`
 * donne aux dix outils `crypto_*`. Il lit ce que le trader a ouvert, sans ouvrir de flux, et écrit par les actions du store avec
 * `by: 'agent'`. La base est une table mémoire (comme `crypto-store.test.ts`) ; le store n'est jamais `ready` ici : aucun flux.
 */
const h = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  desk: {} as { crypto?: unknown },
}));

vi.mock('@/store/db', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock('@/lib/desk', () => ({ desk: h.desk }));

const { getSetting, setSetting } = await import('@/store/db');
const { useCrypto, cryptoDeskPort } = await import('@/store/crypto');

const BTC: CryptoMarketId = 'coinbase:BTC-USD';
const ONDO: CryptoMarketId = 'coinbase:ONDO-USD';
const ONE: CryptoMarketId = 'binance:ONEUSDT';
const ZIG: CryptoMarketId = 'bybit:ZIGUSDT';
const NOW = Date.parse('2026-10-12T12:00:00Z');

const s = () => useCrypto.getState();

/** 48 bougies 1 h depuis 00:00 UTC : la fenêtre couvre le début d'un jour, le VWAP et les niveaux s'y ancrent. */
const T0 = Date.UTC(2026, 9, 10, 0, 0) / 1000;
function series(base: number, step: number, size: number): CryptoBar[] {
  return Array.from({ length: 48 }, (_, i) => {
    const open = base + i * step + (i % 5) * step * 0.3;
    const close = open + ((i % 3) - 1) * step * 0.4;
    return { time: T0 + i * 3600, open, high: Math.max(open, close) + step, low: Math.min(open, close) - step, close, volume: size * (2 + (i % 7) * 0.5), buyVolume: size * (0.5 + (i % 4) * 0.5) };
  });
}
const BARS = series(82_000, 12.5, 1);
const PROXY = series(81_950, 12, 40);

const INSTANCES: IndicatorInstance[] = [
  { id: 'i_cvd', definitionId: 'cvd', params: {}, visible: true },
  { id: 'i_vwap', definitionId: 'vwap-utc', params: { bands: '1' }, visible: true },
  { id: 'i_ema', definitionId: 'ema', params: { period: 9 }, visible: false },
  { id: 'i_atr', definitionId: 'atr', params: { period: 14 }, visible: true },
  { id: 'i_rvol', definitionId: 'volume-ma', params: { period: 20 }, visible: true },
  { id: 'i_lvl', definitionId: 'levels-utc', params: {}, visible: true },
  { id: 'i_cvdb', definitionId: 'cvd-binance', params: {}, visible: true },
  { id: 'i_sma', definitionId: 'sma', params: { period: 5 }, visible: true },
];

/** Les points d'une ligne calculée directement par la définition du catalogue, sur les bougies données. */
function dataOf(definitionId: string, params: Record<string, number | string>, bars: readonly CryptoBar[], key: string) {
  return cryptoIndicatorById(definitionId)!
    .compute([...bars], params)
    .lines.find((line) => line.key === key)!.data;
}

const READING: TemperatureReading = {
  funding: { median: 0.0001, btc: 0.00012, symbols: 410, at: NOW - 30_000 },
  breadth: { upShare: 0.41, pairs: 388, at: NOW - 3_600_000 },
  liquidations: { long: 1_200_000, short: 800_000, since: NOW - 3_600_000, at: NOW - 2_000, lowerBound: true },
  openInterest: { btc: 0.012, eth: -0.004, at: NOW - 60_000 },
};

const alert = (over: Partial<CryptoAlert>): CryptoAlert => ({ id: 'a', target: BTC, kind: 'price_above', level: 85_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW - 86_400_000, ...over });

/** La table et le store à neuf, sans `load()` : le store n'est pas prêt, aucun flux ne s'ouvre ; la première écriture lit la table. */
function seed(rows: Record<string, unknown> = {}) {
  h.rows.clear();
  for (const [key, value] of Object.entries(rows)) h.rows.set(key, structuredClone(value));
  vi.mocked(getSetting)
    .mockReset()
    .mockImplementation(async (key: string, fallback: unknown) => (h.rows.has(key) ? h.rows.get(key) : fallback));
  vi.mocked(setSetting)
    .mockReset()
    .mockImplementation(async (key: string, value: unknown) => {
      h.rows.set(key, structuredClone(value));
    });
  useCrypto.setState(useCrypto.getInitialState(), true);
}

beforeEach(() => {
  delete h.desk.crypto;
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRY6.2 offeredCatalog, extrait vers le moteur', () => {
  const ids = (market: Parameters<typeof offeredCatalog>[0], timeframe: Parameters<typeof offeredCatalog>[1]) => offeredCatalog(market, timeframe).map((def) => def.id);

  it('le CVD Binance pour un marché qui a sa série Binance, rien d’ancré au jour UTC en 1j, l’ordre du catalogue', () => {
    expect(ids(BTC, 60)).toEqual(CRYPTO_INDICATORS.map((def) => def.id));
    expect(ids(ONDO, 5)).toContain('cvd-binance');
    expect(ids(ONE, 60)).toEqual(['ema', 'sma', 'volume-ma', 'atr', 'vwap-utc', 'levels-utc', 'cvd']);
    expect(ids(ZIG, 1440)).toEqual(['ema', 'sma', 'volume-ma', 'atr', 'cvd']);
    expect(ids(BTC, 1440)).toEqual(['ema', 'sma', 'volume-ma', 'atr', 'cvd', 'cvd-binance']);
    // Les définitions mêmes du catalogue, jamais des copies.
    for (const def of offeredCatalog(BTC, 60)) expect(def).toBe(cryptoIndicatorById(def.id));
  });

  it('l’onglet et le port lisent la même fonction : aucune copie dans l’onglet', () => {
    const tab = readFileSync('src/modules/crypto/Crypto.tsx', 'utf8');
    expect(tab).not.toMatch(/function offeredCatalog/);
    expect(tab).toMatch(/import \{[^}]*\bofferedCatalog\b[^}]*\} from '@\/engine\/crypto\/indicators'/);
    const store = readFileSync('src/store/crypto.ts', 'utf8');
    expect(store).toMatch(/import \{[^}]*\bofferedCatalog\b[^}]*\} from '@\/engine\/crypto\/indicators'/);
  });
});

describe('CRY6.2 port du store · lectures', () => {
  it('enabled suit l’interrupteur du store, tabOpen le chart à l’écran', () => {
    const port = cryptoDeskPort();
    expect(port.enabled()).toBe(false);
    expect(port.tabOpen()).toBe(false);
    useCrypto.setState({ enabled: true });
    s().openChart();
    expect(port.enabled()).toBe(true);
    expect(port.tabOpen()).toBe(true);
    s().closeChart();
    useCrypto.setState({ enabled: false });
    expect(port.enabled()).toBe(false);
    expect(port.tabOpen()).toBe(false);
  });

  it('status : marché, unité de temps, voyants, indicateurs, tracés et refus du flux, tels que le store les tient', () => {
    // Avant toute lecture du process principal, les voyants existent déjà (éteints) : `crypto_temperature` les lit.
    expect(cryptoDeskPort().status()).toEqual({
      market: BTC,
      timeframe: 60,
      venues: { coinbase: 'off', binance: 'off', bybit: 'off' },
      indicators: s().indicators,
      drawings: [],
      chartError: null,
    });
    const drawings = [{ id: 'd1', market: ONE, kind: 'level' as const, price: 0.0021, author: 'agent' as const, createdAt: NOW }];
    const venues = { coinbase: 'live' as const, binance: 'stale' as const, bybit: 'blocked' as const };
    useCrypto.setState({ market: ZIG, timeframe: 15, venues, indicators: INSTANCES, drawings, chartError: 'rate_limited' });
    expect(cryptoDeskPort().status()).toEqual({ market: ZIG, timeframe: 15, venues, indicators: INSTANCES, drawings, chartError: 'rate_limited' });
  });

  it('chart : null onglet fermé, même avec des bougies ; null onglet ouvert sans bougie', () => {
    useCrypto.setState({ bars: BARS, indicators: INSTANCES });
    expect(cryptoDeskPort().chart()).toBeNull();
    useCrypto.setState({ bars: [] });
    s().openChart();
    expect(cryptoDeskPort().chart()).toBeNull();
  });

  it('chart : bougies, venue, précision et ancrage du CVD ; une ligne par ligne d’indicateur visible, comme l’onglet', () => {
    useCrypto.setState({ market: BTC, timeframe: 60, bars: BARS, proxyBars: PROXY, cvdAnchoredAt: BARS[3]!.time, indicators: INSTANCES });
    s().openChart();
    const view = cryptoDeskPort().chart();
    expect(view).not.toBeNull();
    expect(view).toMatchObject({ market: BTC, venue: 'coinbase', timeframe: 60, precision: 2, cvdAnchoredAt: BARS[3]!.time });
    expect(view!.bars).toEqual(BARS);
    // Ordre des instances, indicateur masqué (EMA) absent ; `unit` : `price` pour une ligne du prix et l'ATR, `other` sinon.
    expect(view!.indicators.map((line) => [line.id, line.label, line.unit])).toEqual([
      ['i_cvd:cvd', 'CVD', 'other'],
      ['i_vwap:vwap', 'VWAP', 'price'],
      ['i_vwap:up1', '+1σ', 'price'],
      ['i_vwap:dn1', '−1σ', 'price'],
      ['i_atr:atr', 'ATR 14', 'price'],
      ['i_rvol:rvol', 'RVOL 20', 'other'],
      ['i_lvl:pdh', 'PDH', 'price'],
      ['i_lvl:pdl', 'PDL', 'price'],
      ['i_lvl:pdc', 'PDC', 'price'],
      ['i_cvdb:cvd', 'CVD Binance', 'other'],
      ['i_sma:sma', 'SMA 5', 'price'],
    ]);
    const line = (id: string) => view!.indicators.find((l) => l.id === id)!.data;
    expect(line('i_cvd:cvd')).toEqual(dataOf('cvd', {}, BARS, 'cvd'));
    expect(line('i_vwap:up1')).toEqual(dataOf('vwap-utc', { bands: '1' }, BARS, 'up1'));
    expect(line('i_atr:atr')).toEqual(dataOf('atr', { period: 14 }, BARS, 'atr'));
    expect(line('i_lvl:pdh').some((p) => typeof p.value === 'number')).toBe(true);
    // Le CVD Binance lit la série Binance du même actif (`inputBarsFor`), jamais les bougies du chart.
    expect(line('i_cvdb:cvd')).toEqual(dataOf('cvd-binance', {}, PROXY, 'cvd'));
    expect(line('i_cvdb:cvd')).not.toEqual(line('i_cvd:cvd'));
    // Les bougies du store ne sont jamais mutées par un calcul.
    expect(s().bars).toBe(BARS);
  });

  it('chart : le catalogue offert de l’onglet — sans CVD Binance sur ONE, sans VWAP ni niveaux en 1j', () => {
    useCrypto.setState({ market: ONE, timeframe: 1440, bars: BARS, proxyBars: PROXY, indicators: INSTANCES });
    s().openChart();
    const view = cryptoDeskPort().chart();
    expect(view).toMatchObject({ market: ONE, venue: 'binance', timeframe: 1440, precision: 6, cvdAnchoredAt: null });
    expect(view!.indicators.map((line) => line.id)).toEqual(['i_cvd:cvd', 'i_atr:atr', 'i_rvol:rvol', 'i_sma:sma']);
  });

  it('watchlist : chaque marché suivi, sa venue et son voyant, le dernier ticker reçu ou null', () => {
    useCrypto.setState({
      watchlist: [BTC, ZIG, ONE],
      venues: { coinbase: 'live', binance: 'reconnecting', bybit: 'connecting' },
      tickers: { [BTC]: { market: BTC, last: 82_528.12, change24hPct: 1.5, time: NOW - 1_000 }, [ONE]: { market: ONE, last: 0.0021, change24hPct: null, time: NOW - 5_000 } },
    });
    expect(cryptoDeskPort().watchlist()).toEqual([
      { market: BTC, venue: 'coinbase', venueState: 'live', last: 82_528.12, change24hPct: 1.5, at: NOW - 1_000 },
      { market: ZIG, venue: 'bybit', venueState: 'connecting', last: null, change24hPct: null, at: null },
      { market: ONE, venue: 'binance', venueState: 'reconnecting', last: 0.0021, change24hPct: null, at: NOW - 5_000 },
    ]);
  });

  it('temperature : le relevé du store, ou null', () => {
    expect(cryptoDeskPort().temperature()).toBeNull();
    useCrypto.setState({ temperature: READING });
    expect(cryptoDeskPort().temperature()).toBe(READING);
  });

  it('alerts : cryptoAlertViews sur les voyants, les tickers, la température et l’horloge du moment', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const alerts = [
      alert({ id: 'a_ok', target: BTC }),
      alert({ id: 'a_no_price', target: ONDO, kind: 'price_below', level: 0.5 }),
      alert({ id: 'a_venue', target: ZIG, level: 0.1 }),
      alert({ id: 'a_funding', target: 'temperature', kind: 'funding_median_above', level: 0.02 }),
      alert({ id: 'a_breadth', target: 'temperature', kind: 'breadth_below', level: 40 }),
      alert({ id: 'a_paused', target: 'temperature', kind: 'breadth_above', level: 60, state: 'paused' }),
    ];
    const venues = { coinbase: 'live' as const, binance: 'live' as const, bybit: 'stale' as const };
    const tickers = { [BTC]: { market: BTC, last: 84_000, change24hPct: 1, time: NOW - 1_000 } };
    useCrypto.setState({ alerts, venues, tickers, temperature: READING });
    const views = cryptoDeskPort().alerts();
    expect(views).toEqual(cryptoAlertViews(alerts, { venues, tickers, temperature: READING, now: NOW }));
    expect(views.map((v) => [v.id, v.evaluable, v.reason?.code ?? null])).toEqual([
      ['a_ok', true, null],
      ['a_no_price', false, 'no_price'],
      ['a_venue', false, 'venue'],
      ['a_funding', true, null],
      // La largeur date d'une heure : périmée à cette horloge (règle partagée `alertEvaluability`).
      ['a_breadth', false, 'stale_reading'],
      ['a_paused', false, null],
    ]);
  });
});

describe('CRY6.2 port du store · écritures', () => {
  const spy = <K extends 'setMarket' | 'setTimeframe' | 'addIndicator' | 'removeIndicator' | 'addDrawing' | 'removeDrawing' | 'createAlert' | 'deleteAlert' | 'addToWatchlist' | 'removeFromWatchlist'>(name: K) =>
    vi.spyOn(useCrypto.getState(), name);

  it('setChart : marché puis unité de temps, chacun avec by agent', async () => {
    const market = spy('setMarket');
    const timeframe = spy('setTimeframe');
    expect(await cryptoDeskPort().setChart({ market: ONE, timeframe: 5 })).toEqual({ ok: true });
    expect(market.mock.calls).toEqual([[ONE, 'agent']]);
    expect(timeframe.mock.calls).toEqual([[5, 'agent']]);
    expect(market.mock.invocationCallOrder[0]!).toBeLessThan(timeframe.mock.invocationCallOrder[0]!);
    expect(s()).toMatchObject({ market: ONE, timeframe: 5 });
    expect(s().agentLog.map((line) => line.tool)).toEqual(['crypto_chart_set', 'crypto_chart_set']);
    expect(await cryptoDeskPort().setChart({ timeframe: 240 })).toEqual({ ok: true });
    expect(await cryptoDeskPort().setChart({ market: ZIG })).toEqual({ ok: true });
    expect(market.mock.calls).toEqual([[ONE, 'agent'], [ZIG, 'agent']]);
    expect(timeframe.mock.calls).toEqual([[5, 'agent'], [240, 'agent']]);
    expect(s()).toMatchObject({ market: ZIG, timeframe: 240 });
  });

  it('setChart s’arrête au premier refus : l’unité de temps n’est pas demandée', async () => {
    const market = spy('setMarket').mockResolvedValueOnce({ ok: false, reason: 'not_ready' });
    const timeframe = spy('setTimeframe');
    expect(await cryptoDeskPort().setChart({ market: ONE, timeframe: 5 })).toEqual({ ok: false, reason: 'not_ready' });
    expect(market).toHaveBeenCalledTimes(1);
    expect(timeframe).not.toHaveBeenCalled();
    // Refus du store lui-même : rien n'est écrit, l'unité de temps reste.
    expect(await cryptoDeskPort().setChart({ market: 'binance:btcusdt' as never, timeframe: 5 })).toEqual({ ok: false, reason: 'unknown_market' });
    expect(timeframe).not.toHaveBeenCalled();
    expect(s()).toMatchObject({ market: BTC, timeframe: 60, agentLog: [] });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('setIndicator : ajout avec ses paramètres, retrait par id, avec by agent', async () => {
    const add = spy('addIndicator');
    const remove = spy('removeIndicator');
    const added = await cryptoDeskPort().setIndicator({ action: 'add', indicator: 'ema', params: { period: 34 } });
    expect(add.mock.calls).toEqual([['ema', { period: 34 }, 'agent']]);
    expect(added).toEqual({ ok: true, id: expect.any(String) });
    const id = (added as { id: string }).id;
    expect(s().indicators.find((i) => i.id === id)).toEqual({ id, definitionId: 'ema', params: { period: 34 }, visible: true });
    expect(await cryptoDeskPort().setIndicator({ action: 'remove', id: 'i_cvd' })).toEqual({ ok: true });
    expect(remove.mock.calls).toEqual([['i_cvd', 'agent']]);
    expect(s().indicators.map((i) => i.id)).toEqual(['i_vwap', id]);
    expect(await cryptoDeskPort().setIndicator({ action: 'remove', id: 'i_cvd' })).toEqual({ ok: false, reason: 'unknown_indicator' });
    expect(s().agentLog.map((line) => line.tool)).toEqual(['crypto_indicator_set', 'crypto_indicator_set']);
  });

  it('setDrawing : niveau et zone avec les seuls champs de leur genre, retrait par id ; le tracé porte l’auteur agent', async () => {
    const add = spy('addDrawing');
    const remove = spy('removeDrawing');
    const level = await cryptoDeskPort().setDrawing({ action: 'add', kind: 'level', market: BTC, price: 82_500, label: 'pivot' });
    const zone = await cryptoDeskPort().setDrawing({ action: 'add', kind: 'zone', market: ONE, from: 0.002, to: 0.0022 });
    expect(add.mock.calls).toEqual([
      [{ market: BTC, kind: 'level', price: 82_500, label: 'pivot' }, 'agent'],
      [{ market: ONE, kind: 'zone', from: 0.002, to: 0.0022 }, 'agent'],
    ]);
    expect(level).toEqual({ ok: true, id: expect.any(String) });
    expect(zone).toEqual({ ok: true, id: expect.any(String) });
    expect(s().drawings.map((d) => [d.id, d.market, d.kind, d.price ?? null, d.from ?? null, d.to ?? null, d.label ?? null, d.author])).toEqual([
      [(level as { id: string }).id, BTC, 'level', 82_500, null, null, 'pivot', 'agent'],
      [(zone as { id: string }).id, ONE, 'zone', null, 0.002, 0.0022, null, 'agent'],
    ]);
    expect(await cryptoDeskPort().setDrawing({ action: 'remove', id: (level as { id: string }).id })).toEqual({ ok: true });
    expect(remove.mock.calls).toEqual([[(level as { id: string }).id, 'agent']]);
    expect(s().drawings.map((d) => d.id)).toEqual([(zone as { id: string }).id]);
  });

  it('setAlert : création et suppression avec by agent ; l’alerte porte l’auteur agent', async () => {
    const create = spy('createAlert');
    const remove = spy('deleteAlert');
    const created = await cryptoDeskPort().setAlert({ action: 'create', target: 'temperature', kind: 'breadth_below', level: 40, mode: 'rearm' });
    expect(create.mock.calls).toEqual([[{ target: 'temperature', kind: 'breadth_below', level: 40, mode: 'rearm' }, 'agent']]);
    expect(created).toEqual({ ok: true, id: expect.any(String) });
    const id = (created as { id: string }).id;
    expect(s().alerts).toEqual([expect.objectContaining({ id, target: 'temperature', kind: 'breadth_below', level: 40, mode: 'rearm', author: 'agent', state: 'armed' })]);
    expect(await cryptoDeskPort().setAlert({ action: 'delete', id })).toEqual({ ok: true });
    expect(remove.mock.calls).toEqual([[id, 'agent']]);
    expect(s().alerts).toEqual([]);
    expect(s().agentLog.map((line) => line.tool)).toEqual(['crypto_alert_set', 'crypto_alert_set']);
  });

  it('setWatchlist : ajout et retrait avec by agent ; le refus du store (marché qui porte une alerte) passe tel quel', async () => {
    const add = spy('addToWatchlist');
    const remove = spy('removeFromWatchlist');
    expect(await cryptoDeskPort().setWatchlist({ action: 'remove', market: ZIG })).toEqual({ ok: true });
    expect(await cryptoDeskPort().setWatchlist({ action: 'add', market: ZIG })).toEqual({ ok: true });
    expect(add.mock.calls).toEqual([[ZIG, 'agent']]);
    expect(remove.mock.calls).toEqual([[ZIG, 'agent']]);
    expect(s().watchlist).toEqual([BTC, ONDO, ONE, ZIG]);
    useCrypto.setState({ alerts: [alert({ id: 'a1', target: ONE, level: 0.003 })] });
    expect(await cryptoDeskPort().setWatchlist({ action: 'remove', market: ONE })).toEqual({ ok: false, reason: 'market_has_alerts' });
    expect(s().watchlist).toContain(ONE);
  });

  it('un enregistrement refusé par la base rejette : chaque écriture laisse remonter le rejet de setSetting', async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error('quota'));
    const port = cryptoDeskPort();
    await expect(port.setChart({ market: ONE })).rejects.toThrow('quota');
    await expect(port.setChart({ timeframe: 5 })).rejects.toThrow('quota');
    await expect(port.setIndicator({ action: 'add', indicator: 'sma' })).rejects.toThrow('quota');
    await expect(port.setIndicator({ action: 'remove', id: 'i_cvd' })).rejects.toThrow('quota');
    await expect(port.setDrawing({ action: 'add', kind: 'level', market: BTC, price: 80_000 })).rejects.toThrow('quota');
    await expect(port.setAlert({ action: 'create', target: BTC, kind: 'price_above', level: 90_000, mode: 'once' })).rejects.toThrow('quota');
    await expect(port.setWatchlist({ action: 'remove', market: ZIG })).rejects.toThrow('quota');
    // Un rejet du marché arrête le changement : l'unité de temps n'est pas demandée.
    const timeframe = spy('setTimeframe');
    await expect(port.setChart({ market: ZIG, timeframe: 15 })).rejects.toThrow('quota');
    expect(timeframe).not.toHaveBeenCalled();
  });
});

describe('CRY6.2 port du store derrière les outils crypto', () => {
  const ports = () => fakePorts({ crypto: () => cryptoDeskPort(), now: () => NOW });
  const llm = { source: 'llm' as const, confirmFn: async () => true };

  it('module éteint : crypto_disabled ; allumé : les lectures répondent, onglet fermé et sans relevé compris', async () => {
    expect(await executeDeskTool(ports(), 'crypto_status', {}, { source: 'llm' })).toEqual({ ok: false, reason: 'crypto_disabled' });
    useCrypto.setState({ enabled: true });
    const status = (await executeDeskTool(ports(), 'crypto_status', {}, { source: 'llm' })) as Record<string, unknown>;
    expect(status).toMatchObject({ tabOpen: false, market: BTC, timeframe: 60, venues: { coinbase: 'off', binance: 'off', bybit: 'off' } });
    expect(await executeDeskTool(ports(), 'crypto_chart_read', {}, { source: 'llm' })).toEqual({ available: false, reason: 'tab_closed' });
    expect(await executeDeskTool(ports(), 'crypto_temperature', {}, { source: 'llm' })).toEqual({ available: false, reason: 'no_reading' });
    useCrypto.setState({ temperature: READING, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } });
    const temperature = (await executeDeskTool(ports(), 'crypto_temperature', {}, { source: 'llm' })) as { available: boolean; funding: { stale: boolean } };
    expect(temperature.available).toBe(true);
    expect(temperature.funding.stale).toBe(false);
    s().openChart();
    useCrypto.setState({ bars: BARS, proxyBars: PROXY, indicators: INSTANCES });
    const chart = (await executeDeskTool(ports(), 'crypto_chart_read', { bars: 2 }, { source: 'llm' })) as { available: boolean; indicators: { id: string; value: number | null }[]; bars: Record<string, unknown>[] };
    expect(chart.available).toBe(true);
    const atr = dataOf('atr', { period: 14 }, BARS, 'atr').at(-1)!.value!;
    // L'ATR, en unité de prix, est arrondi à la précision du marché (2) ; le CVD à 6 décimales.
    expect(chart.indicators.find((line) => line.id === 'i_atr:atr')?.value).toBe(Math.round(atr * 100) / 100);
    expect(chart.bars).toHaveLength(2);
  });

  it('une écriture confirmée passe par le store avec l’auteur agent ; un enregistrement refusé rend persist_failed', async () => {
    useCrypto.setState({ enabled: true });
    expect(await executeDeskTool(ports(), 'crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 81_000 }, llm)).toMatchObject({ ok: true, added: { market: BTC, kind: 'level', price: 81_000 } });
    expect(s().drawings).toEqual([expect.objectContaining({ market: BTC, price: 81_000, author: 'agent' })]);
    vi.mocked(setSetting).mockRejectedValue(new Error('quota'));
    expect(await executeDeskTool(ports(), 'crypto_chart_set', { timeframe: 15 }, llm)).toEqual({ ok: false, reason: 'persist_failed' });
  });
});
