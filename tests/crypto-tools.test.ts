import { afterEach, describe, expect, it, vi } from 'vitest';
import { outputSchemaFor } from '../electron/mcp-server';
import { DESK_TOOL_HINTS, DESK_TOOL_KINDS, DESK_TOOL_TITLES } from '@/engine/agent/catalog';
import { CRYPTO_TOOL_NAMES, createCryptoTools, cryptoToolBlurb, isCryptoTool } from '@/engine/agent/cryptoTools';
import { clampToolArgs, type CryptoDeskPort, type DeskPorts } from '@/engine/agent/ports';
import { describedDeskTools, executeDeskTool, toolBlurb, toolSchemas, type ExecuteCtx } from '@/engine/agent/tools';
import { alertEvaluability, CRYPTO_ALERT_KINDS, type CryptoAlert, type EvaluabilityData } from '@/engine/crypto/alerts';
import { cryptoIndicatorById } from '@/engine/crypto/indicators';
import { CHARTABLE_MARKETS, CRYPTO_TIMEFRAMES, type CryptoBar } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { cryptoAlertViews, type CryptoChartView, type CryptoLineView, type CryptoStatusView, type CryptoWatchRow } from '@/engine/crypto/views';
import { useI18n } from '@/i18n';
import { fakePorts } from './helpers/deskPorts';

/** Le 9 octobre 2026, midi UTC (millisecondes) : l'horloge du desk. */
const NOW = Date.parse('2026-10-09T12:00:00Z');
const BTC = 'coinbase:BTC-USD';
const ONE = 'binance:ONEUSDT';
const ZIG = 'bybit:ZIGUSDT';

const READS = ['crypto_status', 'crypto_chart_read', 'crypto_watchlist_get', 'crypto_temperature', 'crypto_alert_list'];
const WRITES = ['crypto_chart_set', 'crypto_indicator_set', 'crypto_drawing_set', 'crypto_alert_set', 'crypto_watchlist_set'];

// --- Fixture : 200 bougies BTC-USD 1h et trois lignes d'indicateur -------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 1, 0, 0) / 1000;
const BARS: CryptoBar[] = Array.from({ length: 200 }, (_, i) => {
  const open = 80_000 + i * 25 + (i % 7) * 11.5;
  const close = open + ((i % 5) - 2) * 9.25;
  return {
    time: T0 + i * 3600,
    open,
    high: Math.max(open, close) + 30 + (i % 3) * 4.75,
    low: Math.min(open, close) - 28 - (i % 4) * 3.5,
    close,
    volume: 10 + (i % 9) * 1.25,
    buyVolume: 5 + (i % 6) * 0.75,
  };
});
// Des extrêmes hors des 160 dernières bougies : ni le plus haut ni le plus bas lus ne doivent les voir.
BARS[10] = { ...BARS[10]!, high: 95_000 };
BARS[15] = { ...BARS[15]!, low: 70_000 };

const VISIBLE = BARS.slice(-160);
const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function lineOf(definitionId: string, params: Record<string, number | string>, instance: string, unit: CryptoLineView['unit']): CryptoLineView {
  const line = cryptoIndicatorById(definitionId)!.compute(BARS, params).lines[0]!;
  return { id: `${instance}:${line.key}`, label: line.label, unit, data: line.data };
}
const EMA = lineOf('ema', { period: 21 }, 'i_ema', 'price');
const CVD = lineOf('cvd', {}, 'i_cvd', 'other');
/** Une ligne de prix qui s'arrête avant la fin : un NaN sur l'avant-dernière bougie, un blanc sur la dernière. */
const GAPPY: CryptoLineView = {
  id: 'i_vwap:vwap',
  label: 'VWAP',
  unit: 'price',
  data: BARS.map((b, i) => (i < 198 ? { time: b.time, value: b.close + 0.123 } : i === 198 ? { time: b.time, value: Number.NaN } : { time: b.time })),
};

const lastValue = (line: CryptoLineView): number => [...line.data].reverse().find((p) => typeof p.value === 'number' && Number.isFinite(p.value))!.value!;
const valueAt = (line: CryptoLineView, time: number): number | undefined => line.data.find((p) => p.time === time)?.value;

const CHART: CryptoChartView = { market: BTC, venue: 'coinbase', timeframe: 60, precision: 2, bars: BARS, indicators: [EMA, CVD, GAPPY], cvdAnchoredAt: BARS[120]!.time };

const STATUS: CryptoStatusView = {
  market: BTC,
  timeframe: 60,
  venues: { coinbase: 'live', binance: 'stale', bybit: 'off' },
  indicators: [
    { id: 'i_cvd', definitionId: 'cvd', params: {}, visible: true },
    { id: 'i_ema', definitionId: 'ema', params: { period: 21 }, visible: false },
  ],
  drawings: [
    { id: 'd1', market: BTC, kind: 'level', price: 82_000.004, author: 'agent', createdAt: NOW - 60_000 },
    { id: 'd2', market: ONE, kind: 'zone', from: 0.0021, to: 0.0022, label: 'range', author: 'trader', createdAt: NOW - 120_000 },
  ],
  chartError: null,
};

const WATCH: CryptoWatchRow[] = [
  { market: BTC, venue: 'coinbase', venueState: 'live', last: 82_528.127, change24hPct: 1.23456, at: NOW - 1_500 },
  { market: ZIG, venue: 'bybit', venueState: 'connecting', last: null, change24hPct: null, at: null },
];

const READING: TemperatureReading = {
  funding: { median: 0.00011, btc: 0.000123456, symbols: 412, at: NOW - 30_000 },
  breadth: { upShare: 0.38214, pairs: 390, at: NOW - 900_000 },
  liquidations: { long: 4_100_000.4, short: 1_200_000.6, since: NOW - 3_600_000, at: NOW - 5_000, lowerBound: true },
  openInterest: { btc: 0.024123, eth: -0.01, at: NOW - 60_000 },
};

const ALERTS: CryptoAlert[] = [
  { id: 'a_ok', target: BTC, kind: 'price_above', level: 85_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW - 86_400_000 },
  { id: 'a_venue', target: ONE, kind: 'price_below', level: 0.002, mode: 'rearm', author: 'agent', state: 'armed', createdAt: NOW - 3_600_000, lastTriggeredAt: NOW - 600_000 },
  { id: 'a_price', target: ZIG, kind: 'price_above', level: 0.1, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW - 3_600_000 },
  { id: 'a_stale', target: 'temperature', kind: 'breadth_above', level: 40, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW - 3_600_000 },
  { id: 'a_paused', target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'once', author: 'trader', state: 'paused', createdAt: NOW - 3_600_000 },
];
const EVAL_DATA: EvaluabilityData = {
  venues: { coinbase: 'live', binance: 'live', bybit: 'live' },
  tickers: { [BTC]: { market: BTC, last: 84_000, change24hPct: 1, time: NOW - 1_000 } },
  temperature: { ...READING, breadth: { ...READING.breadth!, at: NOW - 3_600_000 } },
  now: NOW,
};

// --- Faux port -----------------------------------------------------------------------------------------------------------

type Call = { method: string; args: unknown };

function fakeCrypto(over: Partial<CryptoDeskPort> = {}) {
  const calls: Call[] = [];
  const write = (method: string, id?: string) =>
    vi.fn(async (args: unknown) => {
      calls.push({ method, args });
      return id ? { ok: true as const, id } : { ok: true as const };
    });
  const port: CryptoDeskPort = {
    enabled: () => true,
    tabOpen: () => true,
    status: () => STATUS,
    chart: vi.fn(() => CHART),
    watchlist: () => WATCH,
    temperature: () => READING,
    alerts: () => cryptoAlertViews(ALERTS, EVAL_DATA),
    setChart: write('setChart'),
    setIndicator: write('setIndicator', 'ind_new'),
    setDrawing: write('setDrawing', 'drw_new'),
    setAlert: write('setAlert', 'alr_new'),
    setWatchlist: write('setWatchlist'),
    ...over,
  };
  return { port, calls };
}

function ports(crypto: CryptoDeskPort | null | undefined, over: Partial<DeskPorts> = {}): DeskPorts {
  return fakePorts({ ...(crypto === undefined ? {} : { crypto: () => crypto }), now: () => NOW, ...over });
}

/** Un appel par le point d'entrée réel, source `llm` ; l'opérateur accepte (sauf `ctx`). */
async function call<T = Record<string, unknown>>(p: DeskPorts, name: string, args: Record<string, unknown> = {}, ctx?: Partial<ExecuteCtx>): Promise<T> {
  return (await executeDeskTool(p, name, args, { source: 'llm', confirmFn: async () => true, ...ctx })) as T;
}

/** Chaque nombre d'une sortie, à toute profondeur. */
function numbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbers(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbers(v, out);
  return out;
}

afterEach(() => {
  useI18n.setState({ locale: 'fr' });
});

// --- Catalogue -----------------------------------------------------------------------------------------------------------

describe('catalogue des dix outils crypto', () => {
  it('dix noms préfixés crypto_, cinq lectures et cinq écritures, au catalogue partagé', () => {
    expect([...CRYPTO_TOOL_NAMES].sort()).toEqual([...READS, ...WRITES].sort());
    for (const name of READS) expect(DESK_TOOL_KINDS[name as keyof typeof DESK_TOOL_KINDS], name).toBe('read');
    for (const name of WRITES) expect(DESK_TOOL_KINDS[name as keyof typeof DESK_TOOL_KINDS], name).toBe('write');
    expect(Object.keys(DESK_TOOL_KINDS).filter((n) => n.startsWith('crypto_')).sort()).toEqual([...CRYPTO_TOOL_NAMES].sort());
    for (const name of CRYPTO_TOOL_NAMES) expect(isCryptoTool(name), name).toBe(true);
    for (const name of ['desk_overview', 'propose_order', 'crypto', 'crypto_order', '']) expect(isCryptoTool(name), name).toBe(false);
  });

  it('indications du brief : lectures en lecture seule, écritures confirmées', () => {
    const read = { readOnly: true, destructive: false, idempotent: true, openWorld: false };
    for (const name of READS) expect(DESK_TOOL_HINTS[name as keyof typeof DESK_TOOL_HINTS], name).toEqual(read);
    expect(DESK_TOOL_HINTS.crypto_chart_set).toEqual({ readOnly: false, destructive: false, idempotent: true, openWorld: true });
    for (const name of ['crypto_indicator_set', 'crypto_drawing_set', 'crypto_alert_set'] as const) {
      expect(DESK_TOOL_HINTS[name], name).toEqual({ readOnly: false, destructive: true, idempotent: false, openWorld: false });
    }
    expect(DESK_TOOL_HINTS.crypto_watchlist_set).toEqual({ readOnly: false, destructive: true, idempotent: false, openWorld: true });
  });

  it('titres en trois langues, ceux du brief', () => {
    expect(DESK_TOOL_TITLES.crypto_status).toEqual(['État du module crypto', 'Crypto module status', 'Estado del módulo cripto']);
    expect(DESK_TOOL_TITLES.crypto_chart_read).toEqual(['Lire le chart crypto', 'Read the crypto chart', 'Leer el gráfico cripto']);
    expect(DESK_TOOL_TITLES.crypto_watchlist_get).toEqual(['Marchés crypto suivis', 'Watched crypto markets', 'Mercados cripto seguidos']);
    expect(DESK_TOOL_TITLES.crypto_temperature).toEqual(['Température du marché crypto', 'Crypto market temperature', 'Temperatura del mercado cripto']);
    expect(DESK_TOOL_TITLES.crypto_alert_list).toEqual(['Alertes crypto', 'Crypto alerts', 'Alertas cripto']);
    expect(DESK_TOOL_TITLES.crypto_chart_set).toEqual(['Changer le chart crypto', 'Change the crypto chart', 'Cambiar el gráfico cripto']);
    expect(DESK_TOOL_TITLES.crypto_indicator_set).toEqual(['Indicateur du chart crypto', 'Crypto chart indicator', 'Indicador del gráfico cripto']);
    expect(DESK_TOOL_TITLES.crypto_drawing_set).toEqual(['Tracé du chart crypto', 'Crypto chart drawing', 'Trazado del gráfico cripto']);
    expect(DESK_TOOL_TITLES.crypto_alert_set).toEqual(['Poser ou retirer une alerte crypto', 'Set or remove a crypto alert', 'Poner o quitar una alerta cripto']);
    expect(DESK_TOOL_TITLES.crypto_watchlist_set).toEqual(['Watchlist crypto', 'Crypto watchlist', 'Watchlist cripto']);
  });

  it('R3 : createCryptoTools rend toujours les dix définitions, même sans port crypto, et leur run refuse', async () => {
    const tools = createCryptoTools(fakePorts());
    expect(tools.map((t) => t.name)).toEqual([...CRYPTO_TOOL_NAMES]);
    for (const tool of tools) expect(tool.kind, tool.name).toBe(DESK_TOOL_KINDS[tool.name as keyof typeof DESK_TOOL_KINDS]);
    for (const tool of tools) expect(await tool.run({}), tool.name).toEqual({ ok: false, reason: 'crypto_disabled' });
  });
});

// --- Schémas -------------------------------------------------------------------------------------------------------------

describe('schémas des outils crypto', () => {
  type Prop = { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; exclusiveMinimum?: number; maxLength?: number };
  const schemaOf = (name: string) => toolSchemas({ crypto: true }).find((t) => t.name === name)!.parameters as { type: string; properties: Record<string, Prop>; additionalProperties: boolean };

  it('toolSchemas() n’en contient aucun ; toolSchemas({ crypto: true }) les dix ; describedDeskTools suit', () => {
    expect(toolSchemas().filter((t) => t.name.startsWith('crypto_'))).toEqual([]);
    expect(toolSchemas({ crypto: false }).filter((t) => t.name.startsWith('crypto_'))).toEqual([]);
    const all = toolSchemas({ crypto: true });
    expect(all.filter((t) => t.name.startsWith('crypto_')).map((t) => t.name).sort()).toEqual([...CRYPTO_TOOL_NAMES].sort());
    expect(all.length).toBe(Object.keys(DESK_TOOL_KINDS).length);
    expect(describedDeskTools().some((t) => isCryptoTool(t.name))).toBe(false);
    const described = describedDeskTools({ crypto: true }).filter((t) => isCryptoTool(t.name));
    expect(described).toHaveLength(10);
    for (const tool of described) expect(tool.kind, tool.name).toBe(DESK_TOOL_KINDS[tool.name as keyof typeof DESK_TOOL_KINDS]);
    expect(described.find((t) => t.name === 'crypto_status')?.title).toBe('État du module crypto');
  });

  it('objets fermés ; marché en enum des quatre marchés, timeframe en entier énuméré, bars de 0 à 300, label ≤ 40', () => {
    for (const name of CRYPTO_TOOL_NAMES) expect(schemaOf(name), name).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schemaOf('crypto_status').properties).toEqual({});
    expect(schemaOf('crypto_chart_read').properties.bars).toMatchObject({ type: 'integer', minimum: 0, maximum: 300 });
    expect(schemaOf('crypto_chart_set').properties.market).toMatchObject({ type: 'string', enum: [...CHARTABLE_MARKETS] });
    expect(schemaOf('crypto_chart_set').properties.timeframe).toMatchObject({ type: 'integer', enum: [...CRYPTO_TIMEFRAMES], minimum: 1, maximum: 1440 });
    expect(schemaOf('crypto_drawing_set').properties.market).toMatchObject({ type: 'string', enum: [...CHARTABLE_MARKETS] });
    expect(schemaOf('crypto_watchlist_set').properties.market).toMatchObject({ type: 'string', enum: [...CHARTABLE_MARKETS] });
    expect(schemaOf('crypto_alert_set').properties.target).toMatchObject({ type: 'string', enum: [...CHARTABLE_MARKETS, 'temperature'] });
    expect(schemaOf('crypto_drawing_set').properties.label).toMatchObject({ type: 'string', maxLength: 40 });
    for (const key of ['price', 'from', 'to']) expect(schemaOf('crypto_drawing_set').properties[key], key).toMatchObject({ type: 'number', exclusiveMinimum: 0 });
    expect(schemaOf('crypto_alert_set').properties.level).toMatchObject({ type: 'number' });
    expect(schemaOf('crypto_alert_set').properties.kind).toMatchObject({ type: 'string', enum: [...CRYPTO_ALERT_KINDS] });
    expect(schemaOf('crypto_alert_set').properties.mode).toMatchObject({ type: 'string', enum: ['once', 'rearm'] });
    expect(schemaOf('crypto_alert_set').properties.action).toMatchObject({ enum: ['create', 'delete'] });
    expect(schemaOf('crypto_drawing_set').properties.kind).toMatchObject({ enum: ['level', 'zone'] });
    for (const name of ['crypto_indicator_set', 'crypto_drawing_set', 'crypto_watchlist_set']) expect(schemaOf(name).properties.action, name).toMatchObject({ enum: ['add', 'remove'] });
    for (const name of ['crypto_indicator_set', 'crypto_drawing_set', 'crypto_alert_set']) expect(schemaOf(name).properties.id, name).toMatchObject({ type: 'string', maxLength: 64 });
    expect(schemaOf('crypto_indicator_set').properties.indicator).toMatchObject({ type: 'string', enum: ['ema', 'sma', 'volume-ma', 'atr', 'vwap-utc', 'levels-utc', 'cvd', 'cvd-binance'] });
  });

  it('chaque description cite son équivalent OpenMarket, en français, anglais et espagnol', () => {
    const equivalents: Record<string, string[]> = {
      crypto_status: ['chart_status'],
      crypto_chart_read: ['chart_read'],
      crypto_watchlist_get: ['watchlist_get'],
      crypto_temperature: [],
      crypto_alert_list: ['alert_list'],
      crypto_chart_set: ['chart_symbol', 'chart_interval'],
      crypto_indicator_set: ['chart_indicator_add', 'chart_indicator_remove'],
      crypto_drawing_set: ['chart_drawing_add', 'chart_drawing_remove'],
      crypto_alert_set: ['alert_create', 'alert_delete'],
      crypto_watchlist_set: ['watchlist_add_symbols', 'watchlist_remove_symbols'],
    };
    const texts: string[] = [];
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      for (const tool of toolSchemas({ crypto: true }).filter((t) => isCryptoTool(t.name))) {
        expect(tool.description, `${locale} ${tool.name}`).toContain('OpenMarket');
        for (const eq of equivalents[tool.name]!) expect(tool.description, `${locale} ${tool.name}`).toContain(eq);
        texts.push(tool.description);
      }
    }
    // Trois langues réellement différentes, et `toolBlurb` se replie sur `cryptoToolBlurb`.
    expect(new Set(texts).size).toBe(30);
    useI18n.setState({ locale: 'en' });
    expect(toolBlurb('crypto_status', 'fr')).toBe(cryptoToolBlurb('crypto_status', 'fr'));
    expect(cryptoToolBlurb('desk_overview', 'x')).toBeNull();
  });

  it('market et label sont des arguments courts (≤ 64)', () => {
    for (const k of ['market', 'label']) {
      expect(clampToolArgs({ [k]: 'x'.repeat(65) }), k).toEqual({ ok: false, reason: 'args_too_large' });
      expect(clampToolArgs({ [k]: 'x'.repeat(64) }).ok, k).toBe(true);
    }
  });
});

// --- Interrupteur ----------------------------------------------------------------------------------------------------------

describe('interrupteur éteint : crypto_disabled, avant la confirmation', () => {
  it('lecture et écriture refusées, la confirmation n’est jamais demandée, le port n’est pas lu', async () => {
    const { port, calls } = fakeCrypto({ enabled: () => false });
    const confirmFn = vi.fn(async () => true);
    expect(await call(ports(port), 'crypto_status', {}, { confirmFn })).toEqual({ ok: false, reason: 'crypto_disabled' });
    expect(await call(ports(port), 'crypto_chart_read', {}, { confirmFn })).toEqual({ ok: false, reason: 'crypto_disabled' });
    expect(port.chart).not.toHaveBeenCalled();
    expect(await call(ports(port), 'crypto_watchlist_set', { action: 'add', market: ONE }, { confirmFn })).toEqual({ ok: false, reason: 'crypto_disabled' });
    expect(await call(ports(port), 'crypto_alert_set', { action: 'delete', id: 'a_ok' }, { confirmFn })).toEqual({ ok: false, reason: 'crypto_disabled' });
    expect(confirmFn).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('sans port crypto (ou port nul, ou qui lève) : même refus, pour les dix outils et les deux sources', async () => {
    const confirmFn = vi.fn(async () => true);
    const throwing = fakeCrypto({
      enabled: () => {
        throw new Error('panne');
      },
    }).port;
    for (const p of [ports(undefined), ports(null), ports(throwing)]) {
      for (const name of CRYPTO_TOOL_NAMES) {
        expect(await call(p, name, {}, { confirmFn }), name).toEqual({ ok: false, reason: 'crypto_disabled' });
        expect(await executeDeskTool(p, name, {}, { source: 'orch', allowWrite: true }), name).toEqual({ ok: false, reason: 'crypto_disabled' });
      }
    }
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('allumé, une écriture passe par la confirmation de l’opérateur ; un refus ne touche pas le port', async () => {
    const { port, calls } = fakeCrypto();
    const confirmFn = vi.fn(async () => false);
    expect(await call(ports(port), 'crypto_indicator_set', { action: 'remove', id: 'i_cvd' }, { confirmFn })).toEqual({ ok: false, reason: 'operator_denied' });
    expect(confirmFn).toHaveBeenCalledTimes(1);
    const [title, detail] = confirmFn.mock.calls[0] as unknown as [string, string];
    expect(title).toContain('crypto_indicator_set');
    // L'identifiant d'un indicateur n'est pas une séance.
    expect(detail).toContain('Identifiant : i_cvd');
    expect(detail).not.toContain('Séance cible');
    expect(calls).toEqual([]);
    // Côté orchestrateur, l'écriture reste coupée sans `allowWrite`.
    expect(await executeDeskTool(ports(port), 'crypto_watchlist_set', { action: 'add', market: ONE }, { source: 'orch' })).toEqual({ ok: false, reason: 'write_disabled' });
    expect(calls).toEqual([]);
  });
});

// --- Lectures --------------------------------------------------------------------------------------------------------------

describe('lectures sur un faux port', () => {
  it('crypto_chart_read : valeurs exactes sur les 160 dernières bougies de 200', async () => {
    const out = await call(ports(fakeCrypto().port), 'crypto_chart_read');
    const first = VISIBLE[0]!;
    const last = VISIBLE[VISIBLE.length - 1]!;
    expect(out).toEqual({
      available: true,
      market: BTC,
      label: 'BTC-USD · Coinbase',
      venue: 'coinbase',
      timeframe: 60,
      precision: 2,
      visibleBars: 160,
      from: new Date(first.time * 1000).toISOString(),
      to: new Date(last.time * 1000).toISOString(),
      last: r(last.close, 2),
      high: r(Math.max(...VISIBLE.map((b) => b.high)), 2),
      low: r(Math.min(...VISIBLE.map((b) => b.low)), 2),
      changePct: r(((last.close - first.open) / first.open) * 100, 2),
      indicators: [
        { id: 'i_ema:ema', label: 'EMA 21', value: r(lastValue(EMA), 2) },
        { id: 'i_cvd:cvd', label: 'CVD', value: r(lastValue(CVD), 6) },
        { id: 'i_vwap:vwap', label: 'VWAP', value: r(BARS[197]!.close + 0.123, 2) },
      ],
      cvd: { source: 'live_trades', anchoredAt: new Date(BARS[120]!.time * 1000).toISOString(), binanceProxy: 'binance:BTCUSDT' },
    });
    // Les extrêmes posés hors de la fenêtre ne sont pas lus.
    expect(out.high).not.toBe(95_000);
    expect(out.low).not.toBe(70_000);
  });

  it('crypto_chart_read bars: 3 : les trois dernières bougies, avec la valeur de chaque ligne', async () => {
    const out = await call<{ bars: Record<string, unknown>[] }>(ports(fakeCrypto().port), 'crypto_chart_read', { bars: 3 });
    expect(out.bars).toHaveLength(3);
    expect(out.bars).toEqual(
      BARS.slice(-3).map((b, k) => ({
        t: b.time,
        o: r(b.open, 2),
        h: r(b.high, 2),
        l: r(b.low, 2),
        c: r(b.close, 2),
        v: r(b.volume, 6),
        buy: r(b.buyVolume!, 6),
        'i_ema:ema': r(valueAt(EMA, b.time)!, 2),
        'i_cvd:cvd': r(valueAt(CVD, b.time)!, 6),
        // Bougie 197 : une valeur ; 198 : NaN ; 199 : un blanc.
        'i_vwap:vwap': k === 0 ? r(b.close + 0.123, 2) : null,
      })),
    );
    expect((await call(ports(fakeCrypto().port), 'crypto_chart_read', { bars: 0 })).bars).toBeUndefined();
    // Au-delà de 160 : les n dernières bougies du chart, pas seulement la fenêtre visible.
    expect((await call<{ bars: unknown[] }>(ports(fakeCrypto().port), 'crypto_chart_read', { bars: 300 })).bars).toHaveLength(200);
    expect((await call<{ bars: unknown[] }>(ports(fakeCrypto().port), 'crypto_chart_read', { bars: 900 })).bars).toHaveLength(200);
  });

  it('crypto_chart_read, onglet fermé : tab_closed, sans lire le chart ; sans bougie : no_bars', async () => {
    const closed = fakeCrypto({ tabOpen: () => false });
    expect(await call(ports(closed.port), 'crypto_chart_read', { bars: 3 })).toEqual({ available: false, reason: 'tab_closed' });
    expect(closed.port.chart).not.toHaveBeenCalled();
    expect(await call(ports(fakeCrypto({ chart: () => null }).port), 'crypto_chart_read')).toEqual({ available: false, reason: 'no_bars' });
    expect(await call(ports(fakeCrypto({ chart: () => ({ ...CHART, bars: [] }) }).port), 'crypto_chart_read')).toEqual({ available: false, reason: 'no_bars' });
  });

  it('crypto_chart_read : CVD Binance complet, sans série Binance pour ZIG', async () => {
    const one = await call(ports(fakeCrypto({ chart: () => ({ ...CHART, market: ONE, venue: 'binance', precision: 6, cvdAnchoredAt: BARS[0]!.time }) }).port), 'crypto_chart_read');
    expect(one.cvd).toEqual({ source: 'history', anchoredAt: new Date(BARS[0]!.time * 1000).toISOString(), binanceProxy: null });
    const zig = await call(ports(fakeCrypto({ chart: () => ({ ...CHART, market: ZIG, venue: 'bybit', precision: 5, cvdAnchoredAt: null }) }).port), 'crypto_chart_read');
    expect(zig.cvd).toEqual({ source: 'live_trades', anchoredAt: null, binanceProxy: null });
  });

  it('crypto_status : onglet, chart, venues, indicateurs et tracés posés', async () => {
    expect(await call(ports(fakeCrypto().port), 'crypto_status')).toEqual({
      tabOpen: true,
      market: BTC,
      label: 'BTC-USD · Coinbase',
      venue: 'coinbase',
      timeframe: 60,
      venues: { coinbase: 'live', binance: 'stale', bybit: 'off' },
      indicators: [
        { id: 'i_cvd', indicator: 'cvd', visible: true, params: {} },
        { id: 'i_ema', indicator: 'ema', visible: false, params: { period: 21 } },
      ],
      drawings: [
        { id: 'd1', market: BTC, kind: 'level', price: 82_000, author: 'agent', createdAt: new Date(NOW - 60_000).toISOString() },
        { id: 'd2', market: ONE, kind: 'zone', from: 0.0021, to: 0.0022, label: 'range', author: 'trader', createdAt: new Date(NOW - 120_000).toISOString() },
      ],
      chartError: null,
      asOf: new Date(NOW).toISOString(),
    });
  });

  it('crypto_watchlist_get : prix à la précision du marché, âge, registre', async () => {
    expect(await call(ports(fakeCrypto().port), 'crypto_watchlist_get')).toEqual({
      count: 2,
      markets: [
        { market: BTC, label: 'BTC-USD · Coinbase', venue: 'coinbase', venueState: 'live', last: 82_528.13, change24hPct: 1.23, at: new Date(NOW - 1_500).toISOString(), ageMs: 1_500 },
        { market: ZIG, label: 'ZIGUSDT · Bybit', venue: 'bybit', venueState: 'connecting', last: null, change24hPct: null, at: null, ageMs: null },
      ],
      registry: [...CHARTABLE_MARKETS],
      asOf: new Date(NOW).toISOString(),
    });
  });

  it('crypto_temperature : unités des alertes, heure et fraîcheur de chaque relevé, liquidations en minorant', async () => {
    const out = await call<Record<string, unknown> & { liquidations: Record<string, unknown> }>(ports(fakeCrypto().port), 'crypto_temperature');
    expect(out).toMatchObject({
      available: true,
      funding: { medianPct: 0.011, btcPct: 0.0123, symbols: 412, at: new Date(NOW - 30_000).toISOString(), stale: false },
      breadth: { upPct: 38.2, pairs: 390, at: new Date(NOW - 900_000).toISOString(), stale: true },
      liquidations: { longUsd: 4_100_000, shortUsd: 1_200_001, since: new Date(NOW - 3_600_000).toISOString(), at: new Date(NOW - 5_000).toISOString(), stale: false, lowerBound: true },
      openInterest: { btcPct: 2.41, ethPct: -1, at: new Date(NOW - 60_000).toISOString(), stale: false },
      asOf: new Date(NOW).toISOString(),
    });
    expect(String(out.liquidations.note)).toMatch(/minorant/);
    expect(String(out.liquidations.note)).toMatch(/lancement/);
    useI18n.setState({ locale: 'en' });
    expect(String((await call<{ liquidations: { note: string } }>(ports(fakeCrypto().port), 'crypto_temperature')).liquidations.note)).toMatch(/lower bound/);
    expect(await call(ports(fakeCrypto({ temperature: () => null }).port), 'crypto_temperature')).toEqual({ available: false, reason: 'no_reading' });
  });

  it('crypto_alert_list : évaluabilité tirée de alertEvaluability, la règle de l’onglet', async () => {
    const data: EvaluabilityData = { ...EVAL_DATA, venues: { coinbase: 'live', binance: 'stale', bybit: 'live' } };
    const views = cryptoAlertViews(ALERTS, data);
    // La vue d'une alerte armée porte exactement le verdict partagé ; une alerte en pause n'est pas évaluée, sans motif.
    for (const [i, alert] of ALERTS.entries()) {
      const verdict = alertEvaluability(alert, data);
      if (alert.state === 'armed') expect(views[i], alert.id).toEqual({ ...alert, evaluable: verdict.ok, ...(verdict.ok ? {} : { reason: verdict.reason }) });
      else expect(views[i], alert.id).toEqual({ ...alert, evaluable: false });
    }
    const out = await call<{ count: number; alerts: Record<string, unknown>[] }>(ports(fakeCrypto({ alerts: () => views }).port), 'crypto_alert_list');
    expect(out.count).toBe(5);
    expect(out.alerts.map((a) => [a.id, a.evaluable, a.reason ?? null])).toEqual([
      ['a_ok', true, null],
      ['a_venue', false, { code: 'venue', venue: 'binance', state: 'stale' }],
      ['a_price', false, { code: 'no_price' }],
      ['a_stale', false, { code: 'venue', venue: 'binance', state: 'stale' }],
      ['a_paused', false, null],
    ]);
    expect(out.alerts[1]).toEqual({
      id: 'a_venue',
      target: ONE,
      kind: 'price_below',
      level: 0.002,
      mode: 'rearm',
      author: 'agent',
      state: 'armed',
      createdAt: new Date(NOW - 3_600_000).toISOString(),
      lastTriggeredAt: new Date(NOW - 600_000).toISOString(),
      evaluable: false,
      reason: { code: 'venue', venue: 'binance', state: 'stale' },
    });
    // Binance en direct : la largeur d'il y a une heure est périmée (deux cadences de 5 min dépassées).
    const fresh = await call<{ alerts: Record<string, unknown>[] }>(ports(fakeCrypto({ alerts: () => cryptoAlertViews(ALERTS, EVAL_DATA) }).port), 'crypto_alert_list');
    expect(fresh.alerts.find((a) => a.id === 'a_stale')).toMatchObject({ evaluable: false, reason: { code: 'stale_reading', source: 'breadth' } });
  });

  it('les têtes de sortie MCP déclarées existent dans la vraie sortie de chaque lecture', async () => {
    const outputs: Record<string, Record<string, unknown>[]> = {
      crypto_status: [await call(ports(fakeCrypto().port), 'crypto_status')],
      crypto_chart_read: [await call(ports(fakeCrypto().port), 'crypto_chart_read'), await call(ports(fakeCrypto({ tabOpen: () => false }).port), 'crypto_chart_read')],
      crypto_watchlist_get: [await call(ports(fakeCrypto().port), 'crypto_watchlist_get')],
      crypto_temperature: [await call(ports(fakeCrypto().port), 'crypto_temperature'), await call(ports(fakeCrypto({ temperature: () => null }).port), 'crypto_temperature')],
      crypto_alert_list: [await call(ports(fakeCrypto().port), 'crypto_alert_list')],
    };
    for (const name of READS) {
      const heads = Object.keys(outputSchemaFor(name)?.properties ?? {});
      expect(heads.length, name).toBeGreaterThan(0);
      for (const out of outputs[name]!) for (const key of heads) expect(Object.hasOwn(out, key), `${name} · ${key}`).toBe(true);
    }
    for (const name of WRITES) expect(outputSchemaFor(name), name).toBeUndefined();
  });
});

// --- Écritures -------------------------------------------------------------------------------------------------------------

describe('écritures : le port reçoit les bons arguments, la sortie dit ce qui a changé', () => {
  it('crypto_chart_set', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_chart_set', { market: ONE, timeframe: 15 })).toEqual({ ok: true, changed: { market: ONE, timeframe: 15 } });
    expect(await call(ports(port), 'crypto_chart_set', { timeframe: 1440 })).toEqual({ ok: true, changed: { timeframe: 1440 } });
    expect(await call(ports(port), 'crypto_chart_set', { market: ZIG })).toEqual({ ok: true, changed: { market: ZIG } });
    expect(calls).toEqual([
      { method: 'setChart', args: { market: ONE, timeframe: 15 } },
      { method: 'setChart', args: { timeframe: 1440 } },
      { method: 'setChart', args: { market: ZIG } },
    ]);
  });

  it('crypto_indicator_set', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_indicator_set', { action: 'add', indicator: 'ema', params: { period: 50 } })).toEqual({ ok: true, added: { id: 'ind_new', indicator: 'ema', params: { period: 50 } } });
    expect(await call(ports(port), 'crypto_indicator_set', { action: 'add', indicator: 'vwap-utc' })).toEqual({ ok: true, added: { id: 'ind_new', indicator: 'vwap-utc' } });
    expect(await call(ports(port), 'crypto_indicator_set', { action: 'remove', id: 'i_cvd' })).toEqual({ ok: true, removed: 'i_cvd' });
    expect(calls).toEqual([
      { method: 'setIndicator', args: { action: 'add', indicator: 'ema', params: { period: 50 } } },
      { method: 'setIndicator', args: { action: 'add', indicator: 'vwap-utc' } },
      { method: 'setIndicator', args: { action: 'remove', id: 'i_cvd' } },
    ]);
  });

  it('crypto_drawing_set : seuls les champs du genre partent au port', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 85_000, label: 'résistance', from: 1, to: 2 })).toEqual({
      ok: true,
      added: { id: 'drw_new', market: BTC, kind: 'level', price: 85_000, label: 'résistance' },
    });
    expect(await call(ports(port), 'crypto_drawing_set', { action: 'add', kind: 'zone', market: ONE, from: 0.0021, to: 0.0022, price: 9 })).toEqual({
      ok: true,
      added: { id: 'drw_new', market: ONE, kind: 'zone', from: 0.0021, to: 0.0022 },
    });
    expect(await call(ports(port), 'crypto_drawing_set', { action: 'remove', id: 'd1' })).toEqual({ ok: true, removed: 'd1' });
    expect(calls).toEqual([
      { method: 'setDrawing', args: { action: 'add', kind: 'level', market: BTC, price: 85_000, label: 'résistance' } },
      { method: 'setDrawing', args: { action: 'add', kind: 'zone', market: ONE, from: 0.0021, to: 0.0022 } },
      { method: 'setDrawing', args: { action: 'remove', id: 'd1' } },
    ]);
  });

  it('crypto_alert_set', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_alert_set', { action: 'create', target: BTC, kind: 'price_above', level: 90_000, mode: 'once' })).toEqual({
      ok: true,
      created: { id: 'alr_new', target: BTC, kind: 'price_above', level: 90_000, mode: 'once' },
    });
    expect(await call(ports(port), 'crypto_alert_set', { action: 'create', target: 'temperature', kind: 'funding_median_below', level: -0.005, mode: 'rearm' })).toMatchObject({ ok: true });
    expect(await call(ports(port), 'crypto_alert_set', { action: 'delete', id: 'a_ok' })).toEqual({ ok: true, deleted: 'a_ok' });
    expect(calls).toEqual([
      { method: 'setAlert', args: { action: 'create', target: BTC, kind: 'price_above', level: 90_000, mode: 'once' } },
      { method: 'setAlert', args: { action: 'create', target: 'temperature', kind: 'funding_median_below', level: -0.005, mode: 'rearm' } },
      { method: 'setAlert', args: { action: 'delete', id: 'a_ok' } },
    ]);
  });

  it('crypto_watchlist_set', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_watchlist_set', { action: 'add', market: ONE })).toEqual({ ok: true, added: ONE });
    expect(await call(ports(port), 'crypto_watchlist_set', { action: 'remove', market: ZIG })).toEqual({ ok: true, removed: ZIG });
    expect(calls).toEqual([
      { method: 'setWatchlist', args: { action: 'add', market: ONE } },
      { method: 'setWatchlist', args: { action: 'remove', market: ZIG } },
    ]);
  });

  it('un refus du port passe tel quel', async () => {
    const { port } = fakeCrypto({ setWatchlist: async () => ({ ok: false, reason: 'market_has_alerts' }) });
    expect(await call(ports(port), 'crypto_watchlist_set', { action: 'remove', market: BTC })).toEqual({ ok: false, reason: 'market_has_alerts' });
  });

  it('un port qui rejette (persistance refusée) : persist_failed, aucune exception ne sort', async () => {
    const fail = async () => {
      throw new Error('QuotaExceededError');
    };
    const { port } = fakeCrypto({ setChart: fail, setIndicator: fail, setDrawing: fail, setAlert: fail, setWatchlist: fail });
    const cases: [string, Record<string, unknown>][] = [
      ['crypto_chart_set', { market: ONE }],
      ['crypto_indicator_set', { action: 'remove', id: 'i_cvd' }],
      ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 1 }],
      ['crypto_alert_set', { action: 'delete', id: 'a_ok' }],
      ['crypto_watchlist_set', { action: 'add', market: ONE }],
    ];
    for (const [name, args] of cases) {
      expect(await call(ports(port), name, args), name).toEqual({ ok: false, reason: 'persist_failed' });
      // Par le chemin de l'orchestrateur aussi.
      expect(await executeDeskTool(ports(port), name, args, { source: 'orch', allowWrite: true }), name).toEqual({ ok: false, reason: 'persist_failed' });
    }
  });
});

describe('arguments refusés avant le port', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    // Marché hors registre : la série Binance du CVD n'est pas un marché affichable.
    ['crypto_chart_set', { market: 'binance:BTCUSDT' }, 'unknown_market'],
    ['crypto_chart_set', { market: 'https://evil.example' }, 'unknown_market'],
    ['crypto_chart_set', { market: 42 }, 'unknown_market'],
    ['crypto_chart_set', {}, 'nothing_to_change'],
    ['crypto_chart_set', { timeframe: 30 }, 'bad_timeframe'],
    ['crypto_chart_set', { timeframe: '60' }, 'bad_timeframe'],
    ['crypto_chart_set', { market: BTC, timeframe: 2 }, 'bad_timeframe'],
    ['crypto_indicator_set', { action: 'toggle', id: 'i_cvd' }, 'bad_action'],
    ['crypto_indicator_set', { indicator: 'ema' }, 'bad_action'],
    ['crypto_indicator_set', { action: 'add', indicator: 'vwap' }, 'unknown_indicator'],
    ['crypto_indicator_set', { action: 'add' }, 'unknown_indicator'],
    ['crypto_indicator_set', { action: 'add', indicator: 'ema', params: [21] }, 'bad_params'],
    ['crypto_indicator_set', { action: 'add', indicator: 'ema', params: { length: 21 } }, 'bad_params'],
    ['crypto_indicator_set', { action: 'add', indicator: 'ema', params: { period: Number.NaN } }, 'bad_params'],
    ['crypto_indicator_set', { action: 'add', indicator: 'ema', params: { period: '21' } }, 'bad_params'],
    ['crypto_indicator_set', { action: 'add', indicator: 'ema', params: JSON.parse('{"__proto__":{"period":1}}') as Record<string, unknown> }, 'bad_params'],
    ['crypto_indicator_set', { action: 'remove' }, 'bad_id'],
    ['crypto_indicator_set', { action: 'remove', id: '' }, 'bad_id'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: 'binance:BTCUSDT', price: 1 }, 'unknown_market'],
    ['crypto_drawing_set', { action: 'add', kind: 'ray', market: BTC, price: 1 }, 'bad_kind'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 0 }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: -5 }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: Number.POSITIVE_INFINITY }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'zone', market: BTC, from: 2, to: 1 }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'zone', market: BTC, from: 1, to: 1 }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'zone', market: BTC, from: 1 }, 'bad_price'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 1, label: 'x'.repeat(41) }, 'label_too_long'],
    ['crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 1, label: 7 }, 'bad_label'],
    ['crypto_drawing_set', { action: 'remove', id: 42 }, 'bad_id'],
    ['crypto_drawing_set', { action: 'delete', id: 'd1' }, 'bad_action'],
    ['crypto_alert_set', { action: 'create', target: 'binance:BTCUSDT', kind: 'price_above', level: 1, mode: 'once' }, 'unknown_market'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'price_cross', level: 1, mode: 'once' }, 'bad_kind'],
    ['crypto_alert_set', { action: 'create', target: 'temperature', kind: 'price_above', level: 1, mode: 'once' }, 'bad_target'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'breadth_above', level: 40, mode: 'once' }, 'bad_target'],
    ['crypto_alert_set', { action: 'create', kind: 'price_above', level: 1, mode: 'once' }, 'bad_target'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'price_above', level: 0, mode: 'once' }, 'bad_level'],
    ['crypto_alert_set', { action: 'create', target: 'temperature', kind: 'breadth_below', level: 140, mode: 'once' }, 'bad_level'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'price_above', level: Number.NaN, mode: 'once' }, 'bad_level'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'price_above', level: 1 }, 'bad_mode'],
    ['crypto_alert_set', { action: 'create', target: BTC, kind: 'price_above', level: 1, mode: 'always' }, 'bad_mode'],
    ['crypto_alert_set', { action: 'delete' }, 'bad_id'],
    ['crypto_alert_set', { action: 'remove', id: 'a_ok' }, 'bad_action'],
    ['crypto_watchlist_set', { action: 'add', market: 'binance:BTCUSDT' }, 'unknown_market'],
    ['crypto_watchlist_set', { action: 'add', market: 'binance:ONDOUSDT' }, 'unknown_market'],
    ['crypto_watchlist_set', { action: 'remove' }, 'unknown_market'],
    ['crypto_watchlist_set', { action: 'pin', market: BTC }, 'bad_action'],
  ];

  it.each(cases)('%s %j → %s, sans appel au port', async (name, args, reason) => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), name, args)).toEqual({ ok: false, reason });
    expect(calls).toEqual([]);
  });

  it('binance:BTCUSDT → unknown_market sans appel, quel que soit l’outil qui prend un marché', async () => {
    const { port, calls } = fakeCrypto();
    for (const [name, args] of [
      ['crypto_chart_set', { market: 'binance:BTCUSDT' }],
      ['crypto_drawing_set', { action: 'add', kind: 'level', market: 'binance:BTCUSDT', price: 82_000 }],
      ['crypto_alert_set', { action: 'create', target: 'binance:BTCUSDT', kind: 'price_above', level: 82_000, mode: 'once' }],
      ['crypto_watchlist_set', { action: 'add', market: 'binance:BTCUSDT' }],
    ] as const) {
      expect(await call(ports(port), name, args), name).toEqual({ ok: false, reason: 'unknown_market' });
    }
    expect(calls).toEqual([]);
  });

  it('un argument trop long est arrêté par la borne commune (args_too_large) avant l’outil', async () => {
    const { port, calls } = fakeCrypto();
    expect(await call(ports(port), 'crypto_drawing_set', { action: 'add', kind: 'level', market: BTC, price: 1, label: 'x'.repeat(65) })).toEqual({ ok: false, reason: 'args_too_large' });
    expect(await call(ports(port), 'crypto_indicator_set', { action: 'remove', id: 'x'.repeat(65) })).toEqual({ ok: false, reason: 'args_too_large' });
    expect(calls).toEqual([]);
  });
});

// --- Aucun nombre non fini ----------------------------------------------------------------------------------------------

describe('aucun NaN ni infini ne parvient à l’agent', () => {
  it('un port qui rend des nombres non finis : chaque sortie n’a que des nombres finis', async () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const bars: CryptoBar[] = BARS.slice(-20).map((b, i) => (i % 4 === 1 ? { ...b, close: bad[i % 3]! } : i % 4 === 2 ? { ...b, volume: bad[i % 3]!, buyVolume: bad[(i + 1) % 3]! } : b));
    const line: CryptoLineView = { id: 'i_x:x', label: 'X', unit: 'other', data: bars.map((b, i) => ({ time: b.time, value: i % 2 ? bad[i % 3]! : 1e300 * 10 })) };
    const { port } = fakeCrypto({
      status: () => ({
        ...STATUS,
        indicators: [{ id: 'i_x', definitionId: 'ema', params: { period: Number.NaN }, visible: true }],
        drawings: [{ id: 'dz', market: BTC, kind: 'level', price: Number.POSITIVE_INFINITY, author: 'agent', createdAt: Number.NaN }],
      }),
      chart: () => ({ ...CHART, precision: Number.NaN, bars, indicators: [line], cvdAnchoredAt: Number.NaN }),
      watchlist: () => [{ market: BTC, venue: 'coinbase', venueState: 'live', last: Number.NaN, change24hPct: Number.POSITIVE_INFINITY, at: Number.NaN }],
      temperature: () => ({
        funding: { median: Number.NaN, btc: Number.POSITIVE_INFINITY, symbols: Number.NaN, at: Number.NaN },
        breadth: { upShare: Number.POSITIVE_INFINITY, pairs: 3, at: NOW },
        liquidations: { long: Number.NaN, short: Number.NEGATIVE_INFINITY, since: Number.NaN, at: NOW, lowerBound: true },
        openInterest: { btc: Number.NaN, eth: null, at: Number.POSITIVE_INFINITY },
      }),
      alerts: () => [{ ...ALERTS[0]!, level: Number.NaN, createdAt: Number.POSITIVE_INFINITY, evaluable: true }],
    });
    for (const [name, args] of [
      ['crypto_status', {}],
      ['crypto_chart_read', { bars: 20 }],
      ['crypto_watchlist_get', {}],
      ['crypto_temperature', {}],
      ['crypto_alert_list', {}],
    ] as const) {
      const out = await call(ports(port), name, args);
      const nums = numbers(out);
      expect(nums.length, name).toBeGreaterThan(0);
      for (const n of nums) expect(Number.isFinite(n), `${name} : ${n}`).toBe(true);
    }
    // Une bougie dont le prix n'est pas fini est écartée, jamais propagée.
    const read = await call<{ bars: { c: number }[]; visibleBars: number }>(ports(port), 'crypto_chart_read', { bars: 20 });
    expect(read.visibleBars).toBe(15);
    expect(read.bars).toHaveLength(15);
  });
});
