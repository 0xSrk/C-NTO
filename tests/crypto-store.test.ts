import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERTS_MAX, sanitizeAlerts } from '@/engine/crypto/alerts';
import { DEFAULT_CRYPTO_INDICATORS } from '@/engine/crypto/indicators';
import { CHARTABLE_MARKETS, DEFAULT_CRYPTO_MARKET, DEFAULT_CRYPTO_TIMEFRAME } from '@/engine/crypto/markets';
import { DRAWINGS_MAX, INDICATORS_MAX, LABEL_MAX, sanitizeCryptoChart, sanitizeDrawings, sanitizeWatchlist } from '@/engine/crypto/persist';
import { useI18n } from '@/i18n';

/*
 * La base du renderer est remplacée par une table mémoire (comme `notes-update.test.ts` remplace `db.notes`) : `rows` est la
 * table `settings`, `desk` le `window.canto` que lit le store. `setSetting` y range une copie, comme le ferait IndexedDB.
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
const { useCrypto } = await import('@/store/crypto');

const BTC = 'coinbase:BTC-USD';
const ONDO = 'coinbase:ONDO-USD';
const ONE = 'binance:ONEUSDT';
const ZIG = 'bybit:ZIGUSDT';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const ema = { id: 'i_ema', definitionId: 'ema', params: { period: 20 }, visible: true };
const storedAlert = (over: Record<string, unknown> = {}) => ({ id: 'a1', target: BTC, kind: 'price_above', level: 82_528, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW, ...over });
const storedLevel = (over: Record<string, unknown> = {}) => ({ id: 'd1', market: BTC, kind: 'level', price: 82_528, author: 'trader', createdAt: NOW, ...over });

const SANITIZERS: Record<string, (v: unknown) => unknown> = {
  'crypto.chart': sanitizeCryptoChart,
  'crypto.watchlist': sanitizeWatchlist,
  'crypto.alerts': sanitizeAlerts,
  'crypto.drawings': sanitizeDrawings,
};

const s = () => useCrypto.getState();
const lastWrite = (key: string): unknown => vi.mocked(setSetting).mock.calls.filter((call) => call[0] === key).at(-1)?.[1];
const writtenKeys = (): string[] => vi.mocked(setSetting).mock.calls.map((call) => call[0]);
const clone = <T,>(v: T): T => structuredClone(v);

/** Ce que la table garde après les écritures : relu par l'assainisseur de sa clé, il doit revenir identique. */
function expectRowsSurvive() {
  expect(h.rows.size).toBeGreaterThan(0);
  for (const [key, value] of h.rows) expect(SANITIZERS[key]?.(value), key).toEqual(value);
}

/** La lecture d'une ligne de la table mémoire, comme `getSetting`. */
const readRows = async (key: string, fallback: unknown) => (h.rows.has(key) ? h.rows.get(key) : fallback);

/** La table et le store comme à l'ouverture du desk, avant tout `load()` : les lignes sont posées, rien n'est lu. */
function seed(rows: Record<string, unknown> = {}) {
  h.rows.clear();
  for (const [key, value] of Object.entries(rows)) h.rows.set(key, clone(value));
  vi.mocked(getSetting).mockReset().mockImplementation(readRows);
  vi.mocked(setSetting).mockReset().mockImplementation(async (key: string, value: unknown) => {
    h.rows.set(key, clone(value));
  });
  useCrypto.setState(useCrypto.getInitialState(), true);
}

/** Comme `seed`, puis le premier `load()` de l'onglet ; les compteurs d'appels repartent de zéro. */
async function fresh(rows: Record<string, unknown> = {}) {
  seed(rows);
  await s().load();
  vi.mocked(getSetting).mockClear();
  vi.mocked(setSetting).mockClear();
}

beforeEach(async () => {
  delete h.desk.crypto;
  await fresh();
});

afterEach(() => {
  vi.restoreAllMocks();
  useI18n.setState({ locale: 'fr' });
});

describe('load : réglages', () => {
  it('sans réglage enregistré : les défauts, sans rien écrire', async () => {
    h.rows.clear();
    useCrypto.setState(useCrypto.getInitialState(), true);
    await s().load();
    expect(s()).toMatchObject({ ready: true, market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME, alerts: [], drawings: [], chartOpen: false, agentLog: [] });
    expect(s().indicators).toEqual(DEFAULT_CRYPTO_INDICATORS);
    expect(s().watchlist).toEqual([...CHARTABLE_MARKETS]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('les défauts sont des copies : agir sur les indicateurs ne touche jamais DEFAULT_CRYPTO_INDICATORS', async () => {
    const before = JSON.stringify(DEFAULT_CRYPTO_INDICATORS);
    expect(s().indicators).not.toBe(DEFAULT_CRYPTO_INDICATORS);
    s().indicators.forEach((indicator, i) => {
      expect(indicator).not.toBe(DEFAULT_CRYPTO_INDICATORS[i]);
      expect(indicator.params).not.toBe(DEFAULT_CRYPTO_INDICATORS[i]?.params);
    });
    await s().updateIndicator('i_vwap', { bands: '2' });
    await s().toggleIndicator('i_cvd');
    await s().removeIndicator('i_cvd');
    expect(JSON.stringify(DEFAULT_CRYPTO_INDICATORS)).toBe(before);
    // Un premier chargement sans ligne repart d'une copie neuve des défauts, pas des indicateurs modifiés.
    seed();
    useCrypto.setState({ indicators: [] });
    await s().load();
    expect(s().indicators).toEqual(DEFAULT_CRYPTO_INDICATORS);
    expect(s().indicators[1]).not.toBe(DEFAULT_CRYPTO_INDICATORS[1]);
  });

  it('lit exactement les quatre lignes du § 8, et n’écrit rien', async () => {
    seed();
    await s().load();
    expect(vi.mocked(getSetting).mock.calls.map((call) => call[0]).sort()).toEqual(['crypto.alerts', 'crypto.chart', 'crypto.drawings', 'crypto.watchlist']);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('réglages enregistrés : repris après assainissement', async () => {
    await fresh({
      'crypto.chart': { market: ONE, timeframe: 15, indicators: [ema, { id: 'x', definitionId: 'vwap', params: {}, visible: true }] },
      'crypto.watchlist': [ONE, BTC, 'binance:BTCUSDT', ONE],
      'crypto.alerts': [storedAlert({ target: ONE, level: 0.0023 }), storedAlert({ id: 'a2', level: -1 })],
      'crypto.drawings': [storedLevel(), storedLevel({ id: 'd2', price: 0 })],
    });
    expect(s()).toMatchObject({ market: ONE, timeframe: 15 });
    // L'indicateur du desk (VWAP de séance) n'est pas au catalogue crypto : écarté seul.
    expect(s().indicators).toEqual([ema]);
    expect(s().watchlist).toEqual([ONE, BTC]);
    expect(s().alerts).toEqual([storedAlert({ target: ONE, level: 0.0023 })]);
    expect(s().drawings).toEqual([storedLevel()]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('une ligne chart invalide retombe sur les défauts ; une watchlist vide enregistrée reste vide', async () => {
    await fresh({ 'crypto.chart': { market: 'binance:BTCUSDT', timeframe: 30, indicators: [] }, 'crypto.watchlist': [] });
    expect(s()).toMatchObject({ market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME, watchlist: [] });
    expect(s().indicators).toEqual(DEFAULT_CRYPTO_INDICATORS);
  });

  it('un chart enregistré sans indicateur reste sans indicateur', async () => {
    await fresh({ 'crypto.chart': { market: BTC, timeframe: 5, indicators: [] } });
    expect(s().indicators).toEqual([]);
  });

  it('une base illisible : les défauts, et load ne rejette pas', async () => {
    vi.mocked(getSetting).mockRejectedValue(new Error('IndexedDB indisponible'));
    useCrypto.setState(useCrypto.getInitialState(), true);
    await expect(s().load()).resolves.toBeUndefined();
    expect(s()).toMatchObject({ ready: true, market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME });
    expect(s().watchlist).toEqual([...CHARTABLE_MARKETS]);
  });

  it('une ligne illisible garde l’état connu, les autres sont reprises', async () => {
    seed({ 'crypto.chart': { market: ONE, timeframe: 15, indicators: [] }, 'crypto.watchlist': [ONE], 'crypto.alerts': [storedAlert({ target: ONE })] });
    vi.mocked(getSetting).mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'crypto.alerts') throw new Error('ligne illisible');
      return readRows(key, fallback);
    });
    await expect(s().load()).resolves.toBeUndefined();
    expect(s()).toMatchObject({ ready: true, market: ONE, timeframe: 15, indicators: [], watchlist: [ONE], alerts: [] });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('un second load() relit le statut, pas les réglages', async () => {
    const venues = { coinbase: 'connecting', binance: 'connecting', bybit: 'connecting' };
    const status = vi.fn(async () => ({ enabled: true, venues }));
    h.desk.crypto = { status, onStatus: vi.fn(() => () => {}) };
    await s().load();
    await s().load();
    expect(status).toHaveBeenCalledTimes(2);
    expect(s()).toMatchObject({ ready: true, enabled: true, venues });
    // `fresh()` a lu les quatre lignes au premier load : les suivants n'y retournent pas.
    expect(getSetting).not.toHaveBeenCalled();
  });

  it('une alerte de prix dont le marché manque à la watchlist le ramène en mémoire, sans la supprimer ni écrire', async () => {
    await fresh({
      'crypto.watchlist': [ONE],
      'crypto.alerts': [storedAlert(), storedAlert({ id: 'a2', target: ONDO, kind: 'price_below', level: 0.7 }), storedAlert({ id: 'a3', target: BTC, level: 90_000 }), storedAlert({ id: 'a4', target: 'temperature', kind: 'breadth_above', level: 60 })],
    });
    expect(s().watchlist).toEqual([ONE, BTC, ONDO]);
    expect(s().alerts.map((alert) => alert.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(setSetting).not.toHaveBeenCalled();
    // Une alerte de température ne demande aucun marché.
    await fresh({ 'crypto.watchlist': [], 'crypto.alerts': [storedAlert({ id: 'a4', target: 'temperature', kind: 'breadth_above', level: 60 })] });
    expect(s().watchlist).toEqual([]);
  });

  it('les réglages se chargent aussi quand desk.crypto existe, même si son statut est illisible', async () => {
    h.rows.set('crypto.chart', { market: ZIG, timeframe: 240, indicators: [] });
    h.desk.crypto = { status: vi.fn(async () => Promise.reject(new Error('canal fermé'))), onStatus: vi.fn(() => () => {}) };
    useCrypto.setState(useCrypto.getInitialState(), true);
    await s().load();
    expect(s()).toMatchObject({ ready: true, enabled: false, market: ZIG, timeframe: 240 });
  });

  it('les réglages se chargent sans desk.crypto (navigateur)', async () => {
    h.rows.set('crypto.watchlist', [ZIG]);
    useCrypto.setState(useCrypto.getInitialState(), true);
    await s().load();
    expect(s()).toMatchObject({ ready: true, enabled: false, watchlist: [ZIG] });
  });

  it('une écriture encore en vol n’est pas écrasée par un rechargement', async () => {
    let release: () => void = () => {};
    vi.mocked(setSetting).mockImplementationOnce(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      h.rows.set(key, clone(value));
    });
    const write = s().removeFromWatchlist(ZIG);
    const reload = s().load();
    await Promise.resolve();
    release();
    await write;
    await reload;
    expect(s().watchlist).toEqual([BTC, ONDO, ONE]);
  });

  it('une écriture faite pendant la première lecture l’attend, puis s’applique sur ce qu’elle a lu', async () => {
    seed({ 'crypto.watchlist': [ONE, ZIG, BTC] });
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    vi.mocked(getSetting).mockImplementation(async (key: string, fallback: unknown) => {
      const value = await readRows(key, fallback);
      await gate;
      return value;
    });
    const load = s().load();
    await vi.waitFor(() => expect(getSetting).toHaveBeenCalledTimes(4));
    const write = s().removeFromWatchlist(ZIG);
    open();
    await load;
    expect(await write).toEqual({ ok: true });
    expect(s().watchlist).toEqual([ONE, BTC]);
    expect(h.rows.get('crypto.watchlist')).toEqual([ONE, BTC]);
    expect(getSetting).toHaveBeenCalledTimes(4);
  });
});

/*
 * Les outils de l'agent (CRY6.1) écrivent que l'onglet ait été ouvert ou non : `load()` n'a alors jamais tourné. Une écriture
 * qui partirait des défauts écraserait les lignes enregistrées. Chaque écriture lit donc d'abord les quatre lignes, par la même
 * étape que `load()` : une seule lecture, partagée, jamais refaite une fois réussie.
 */
describe('écrire avant tout load', () => {
  const STORED = {
    'crypto.chart': { market: ONE, timeframe: 15, indicators: [ema] },
    'crypto.watchlist': [ONE, BTC],
    'crypto.alerts': [storedAlert({ target: ONE, level: 0.0023 })],
    'crypto.drawings': [storedLevel()],
  };
  const price = { target: BTC, kind: 'price_above', level: 90_000, mode: 'once' } as const;
  const chart = (over: Record<string, unknown>) => ({ market: ONE, timeframe: 15, indicators: [ema], ...over });

  it('createAlert prolonge les alertes enregistrées au lieu de les remplacer', async () => {
    seed(STORED);
    const result = await s().createAlert(price, 'agent');
    if (!result.ok) throw new Error('création refusée');
    const written = lastWrite('crypto.alerts') as { id: string; author: string }[];
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(STORED['crypto.alerts'][0]);
    expect(written[1]).toMatchObject({ id: result.id, target: BTC, author: 'agent' });
    expect(s().alerts).toEqual(written);
  });

  it('setMarket garde les indicateurs, le timeframe et la watchlist enregistrés', async () => {
    seed(STORED);
    expect(await s().setMarket(ZIG)).toEqual({ ok: true });
    expect(lastWrite('crypto.chart')).toEqual(chart({ market: ZIG }));
    expect(s()).toMatchObject({ market: ZIG, timeframe: 15, indicators: [ema], watchlist: [ONE, BTC], drawings: [storedLevel()] });
    expectRowsSurvive();
  });

  // Une écriture par action : l'état de départ est celui de la base, jamais celui des défauts.
  const actions: [string, () => Promise<unknown>, string, unknown][] = [
    ['setMarket', () => s().setMarket(ZIG), 'crypto.chart', chart({ market: ZIG })],
    ['setTimeframe', () => s().setTimeframe(5), 'crypto.chart', chart({ timeframe: 5 })],
    ['addIndicator', () => s().addIndicator('sma'), 'crypto.chart', chart({ indicators: [ema, expect.objectContaining({ definitionId: 'sma' })] })],
    ['updateIndicator', () => s().updateIndicator('i_ema', { period: 30 }), 'crypto.chart', chart({ indicators: [{ ...ema, params: { period: 30 } }] })],
    ['toggleIndicator', () => s().toggleIndicator('i_ema'), 'crypto.chart', chart({ indicators: [{ ...ema, visible: false }] })],
    ['removeIndicator', () => s().removeIndicator('i_ema'), 'crypto.chart', chart({ indicators: [] })],
    ['addDrawing', () => s().addDrawing({ market: BTC, kind: 'level', price: 80_000 }), 'crypto.drawings', [storedLevel(), expect.objectContaining({ market: BTC, price: 80_000 })]],
    ['removeDrawing', () => s().removeDrawing('d1'), 'crypto.drawings', []],
    ['createAlert', () => s().createAlert(price), 'crypto.alerts', [STORED['crypto.alerts'][0], expect.objectContaining({ target: BTC, level: 90_000 })]],
    ['deleteAlert', () => s().deleteAlert('a1'), 'crypto.alerts', []],
    ['setAlertState', () => s().setAlertState('a1', 'paused'), 'crypto.alerts', [{ ...STORED['crypto.alerts'][0], state: 'paused' }]],
    ['addToWatchlist', () => s().addToWatchlist(ZIG), 'crypto.watchlist', [ONE, BTC, ZIG]],
    ['removeFromWatchlist', () => s().removeFromWatchlist(BTC), 'crypto.watchlist', [ONE]],
  ];

  it.each(actions)('%s part des lignes enregistrées, après une seule lecture', async (_name, run, key, expected) => {
    seed(STORED);
    await run();
    expect(lastWrite(key)).toEqual(expected);
    expect(getSetting).toHaveBeenCalledTimes(4);
    expect(writtenKeys()).toEqual([key]);
    expectRowsSurvive();
  });

  it('deux écritures lancées sans attendre, avant tout load, se composent dans l’ordre sur les lignes enregistrées', async () => {
    seed(STORED);
    const first = s().createAlert(price);
    const second = s().createAlert({ ...price, level: 91_000 });
    const third = s().addDrawing({ market: BTC, kind: 'level', price: 80_000 });
    const [a, b, c] = await Promise.all([first, second, third]);
    if (!a.ok || !b.ok || !c.ok) throw new Error('écriture refusée');
    expect(s().alerts.map((alert) => alert.id)).toEqual(['a1', a.id, b.id]);
    expect(s().drawings.map((drawing) => drawing.id)).toEqual(['d1', c.id]);
    const alertWrites = vi.mocked(setSetting).mock.calls.filter((call) => call[0] === 'crypto.alerts').map((call) => (call[1] as { id: string }[]).map((alert) => alert.id));
    expect(alertWrites).toEqual([
      ['a1', a.id],
      ['a1', a.id, b.id],
    ]);
    expect(h.rows.get('crypto.alerts')).toEqual(s().alerts);
    expect(h.rows.get('crypto.drawings')).toEqual(s().drawings);
    expect(getSetting).toHaveBeenCalledTimes(4);
  });

  it('une écriture et un load() lancés ensemble partagent la même lecture', async () => {
    seed(STORED);
    const write = s().createAlert(price);
    const load = s().load();
    await Promise.all([write, load]);
    expect(getSetting).toHaveBeenCalledTimes(4);
    expect(s()).toMatchObject({ ready: true, market: ONE, timeframe: 15 });
    expect(s().alerts).toHaveLength(2);
  });

  it('load() après une écriture ne relit pas et n’écrase pas l’écriture encore en vol', async () => {
    seed(STORED);
    let release: () => void = () => {};
    vi.mocked(setSetting).mockImplementationOnce(async (key: string, value: unknown) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      h.rows.set(key, clone(value));
    });
    const write = s().createAlert(price);
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1));
    try {
      // La base ne porte pas encore l'alerte : une relecture la ferait disparaître de l'état.
      expect(getSetting).toHaveBeenCalledTimes(4);
      await s().load();
      expect(getSetting).toHaveBeenCalledTimes(4);
      expect(s().alerts).toHaveLength(2);
    } finally {
      release();
    }
    expect(await write).toMatchObject({ ok: true });
    expect(h.rows.get('crypto.alerts')).toEqual(s().alerts);
  });
});

describe('réglages illisibles', () => {
  const stored = { 'crypto.chart': { market: ONE, timeframe: 15, indicators: [ema] }, 'crypto.alerts': [storedAlert({ target: ONE })], 'crypto.watchlist': [ONE, BTC] };
  const price = { target: BTC, kind: 'price_above', level: 90_000, mode: 'once' } as const;
  const down = () => vi.mocked(getSetting).mockRejectedValue(new Error('IndexedDB indisponible'));
  const up = () => vi.mocked(getSetting).mockImplementation(readRows);
  const notReady = { ok: false, reason: 'not_ready' };

  it('les écritures qui rendent un résultat refusent not_ready, les autres ne font rien, et rien n’est écrit', async () => {
    seed(stored);
    down();
    const before = s();
    const results = await Promise.all([
      s().setMarket(ZIG),
      s().setTimeframe(5),
      s().addIndicator('sma'),
      s().removeIndicator('i_cvd'),
      s().addDrawing({ market: BTC, kind: 'level', price: 80_000 }),
      s().removeDrawing('d1'),
      s().createAlert(price),
      s().deleteAlert('a1'),
      s().addToWatchlist(ZIG),
      s().removeFromWatchlist(ZIG),
    ]);
    for (const result of results) expect(result).toEqual(notReady);
    await expect(Promise.all([s().updateIndicator('i_cvd', { bands: '2' }), s().toggleIndicator('i_cvd'), s().setAlertState('a1', 'paused')])).resolves.toEqual([undefined, undefined, undefined]);
    expect(setSetting).not.toHaveBeenCalled();
    expect(s()).toMatchObject({ market: before.market, timeframe: before.timeframe, indicators: before.indicators, watchlist: before.watchlist, alerts: [], drawings: [], agentLog: [] });
    expect(h.rows.get('crypto.alerts')).toEqual(stored['crypto.alerts']);
  });

  it('une seule ligne illisible suffit à refuser, même pour une écriture qui n’y touche pas', async () => {
    seed(stored);
    vi.mocked(getSetting).mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'crypto.drawings') throw new Error('ligne illisible');
      return readRows(key, fallback);
    });
    expect(await s().addToWatchlist(ZIG, 'agent')).toEqual(notReady);
    expect(setSetting).not.toHaveBeenCalled();
    expect(s().agentLog).toEqual([]);
  });

  it('la lecture suivante recommence : rétablie, l’écriture passe sur les lignes enregistrées', async () => {
    seed(stored);
    down();
    expect(await s().createAlert(price)).toEqual(notReady);
    expect(await s().createAlert(price)).toEqual(notReady);
    // Deux refus, deux lectures : l'échec n'est pas gardé.
    expect(getSetting).toHaveBeenCalledTimes(8);
    up();
    const result = await s().createAlert(price);
    expect(result).toMatchObject({ ok: true });
    expect(getSetting).toHaveBeenCalledTimes(12);
    expect(lastWrite('crypto.alerts')).toHaveLength(2);
    expect(s()).toMatchObject({ market: ONE, timeframe: 15 });
    // Réussie, la lecture n'est plus refaite.
    expect(await s().deleteAlert('a1')).toEqual({ ok: true });
    expect(getSetting).toHaveBeenCalledTimes(12);
  });

  it('plusieurs appels pendant la même lecture ratée partagent son échec, puis le suivant la refait', async () => {
    seed(stored);
    down();
    await Promise.all([s().createAlert(price), s().createAlert(price), s().load()]);
    expect(getSetting).toHaveBeenCalledTimes(4);
    up();
    expect(await s().createAlert(price)).toMatchObject({ ok: true });
    expect(getSetting).toHaveBeenCalledTimes(8);
  });

  it('load() ne rejette pas et montre l’écran, puis le load() suivant relit et reprend les lignes', async () => {
    seed(stored);
    down();
    await expect(s().load()).resolves.toBeUndefined();
    expect(s()).toMatchObject({ ready: true, market: DEFAULT_CRYPTO_MARKET, alerts: [] });
    expect(await s().deleteAlert('a1')).toEqual(notReady);
    up();
    await s().load();
    expect(s()).toMatchObject({ ready: true, market: ONE, timeframe: 15, watchlist: [ONE, BTC] });
    expect(s().alerts).toEqual(stored['crypto.alerts']);
    expect(await s().deleteAlert('a1')).toEqual({ ok: true });
    expect(setSetting).toHaveBeenCalledTimes(1);
  });
});

/*
 * `restoreVault` (CRY3.1) peut réécrire les quatre lignes sous un store déjà lu : sans relecture, l'état en mémoire date d'avant
 * la restauration et la prochaine écriture (trader ou agent) poserait cet état par-dessus les lignes restaurées.
 * `reloadSettings()` efface le mémo de la lecture et relit par la même étape que `load()` ; `Metrique.tsx` l'appelle après la restauration.
 */
describe('relecture après une restauration du coffre', () => {
  const STALE = {
    'crypto.chart': { market: ZIG, timeframe: 5, indicators: [] },
    'crypto.watchlist': [ZIG, BTC],
    'crypto.alerts': [storedAlert({ id: 'old', target: BTC })],
    'crypto.drawings': [storedLevel({ id: 'old-d' })],
  };
  const RESTORED = {
    'crypto.chart': { market: ONE, timeframe: 240, indicators: [ema] },
    'crypto.watchlist': [ONE, ONDO, BTC],
    'crypto.alerts': [storedAlert({ id: 'new', target: ONE, level: 0.0023 })],
    'crypto.drawings': [storedLevel({ id: 'new-d', market: ONE, price: 0.002 })],
  };
  const price = { target: ONE, kind: 'price_above', level: 0.0025, mode: 'once' } as const;
  /** La restauration vue de la table : les lignes sont remplacées sous le store, qui ne le sait pas. */
  const restoreRows = (rows: Record<string, unknown>) => {
    h.rows.clear();
    for (const [key, value] of Object.entries(rows)) h.rows.set(key, clone(value));
  };
  /** Retient une lecture de la base jusqu'à `open()`. Toute barrière est ouverte en fin de test : une assertion qui échoue ne laisse pas une lecture suspendue au test suivant. */
  const gates: { open: () => void }[] = [];
  const gate = () => {
    let open: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    const made = { promise, open };
    gates.push(made);
    return made;
  };
  afterEach(() => {
    for (const made of gates.splice(0)) made.open();
  });
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('applique les lignes restaurées à l’état, par une lecture des quatre lignes, sans rien écrire', async () => {
    await fresh(STALE);
    expect(s()).toMatchObject({ market: ZIG, timeframe: 5 });
    restoreRows(RESTORED);
    await expect(s().reloadSettings()).resolves.toBeUndefined();
    expect(s()).toMatchObject({ settingsRead: true, market: ONE, timeframe: 240, indicators: [ema], watchlist: [ONE, ONDO, BTC] });
    expect(s().alerts).toEqual(RESTORED['crypto.alerts']);
    expect(s().drawings).toEqual(RESTORED['crypto.drawings']);
    expect(vi.mocked(getSetting).mock.calls.map((call) => call[0]).sort()).toEqual(['crypto.alerts', 'crypto.chart', 'crypto.drawings', 'crypto.watchlist']);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('passe par les mêmes assainisseurs et la même réparation de la watchlist que load()', async () => {
    await fresh(STALE);
    restoreRows({
      // Pas de ligne chart : les défauts. Une alerte de prix sur un marché que la watchlist restaurée n'a pas : le marché revient en mémoire.
      'crypto.watchlist': [ONE],
      'crypto.alerts': [storedAlert({ id: 'a1', target: ONDO, level: 0.9 }), storedAlert({ id: 'a2', level: -1 })],
      'crypto.drawings': [storedLevel({ id: 'd1' }), storedLevel({ id: 'd2', price: 0 })],
    });
    await s().reloadSettings();
    expect(s()).toMatchObject({ market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME, watchlist: [ONE, ONDO] });
    expect(s().indicators).toEqual(DEFAULT_CRYPTO_INDICATORS);
    expect(s().indicators).not.toBe(DEFAULT_CRYPTO_INDICATORS);
    expect(s().alerts.map((alert) => alert.id)).toEqual(['a1']);
    expect(s().drawings.map((drawing) => drawing.id)).toEqual(['d1']);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('une écriture faite ensuite se pose sur les lignes restaurées, pas sur l’état d’avant', async () => {
    await fresh(STALE);
    restoreRows(RESTORED);
    await s().reloadSettings();
    const alert = await s().createAlert(price, 'agent');
    if (!alert.ok) throw new Error('création refusée');
    expect(lastWrite('crypto.alerts')).toEqual([RESTORED['crypto.alerts'][0], expect.objectContaining({ id: alert.id, target: ONE, author: 'agent' })]);
    expect(await s().setTimeframe(15)).toEqual({ ok: true });
    expect(lastWrite('crypto.chart')).toEqual({ market: ONE, timeframe: 15, indicators: [ema] });
    expect(await s().addToWatchlist(ZIG)).toEqual({ ok: true });
    expect(lastWrite('crypto.watchlist')).toEqual([ONE, ONDO, BTC, ZIG]);
    expect(await s().addDrawing({ market: ONE, kind: 'level', price: 0.0021 })).toMatchObject({ ok: true });
    expect(lastWrite('crypto.drawings')).toEqual([RESTORED['crypto.drawings'][0], expect.objectContaining({ market: ONE, price: 0.0021 })]);
    // Rien de l'état d'avant n'a été reposé, et la lecture réussie n'est pas refaite.
    const ids = (key: string) => (h.rows.get(key) as { id: string }[]).map((entry) => entry.id);
    expect(ids('crypto.alerts')).not.toContain('old');
    expect(ids('crypto.drawings')).not.toContain('old-d');
    expect(getSetting).toHaveBeenCalledTimes(4);
    expectRowsSurvive();
  });

  it('une écriture lancée pendant la relecture l’attend, puis se pose sur ce qu’elle a lu', async () => {
    await fresh(STALE);
    restoreRows(RESTORED);
    const read = gate();
    vi.mocked(getSetting).mockImplementation(async (key: string, fallback: unknown) => {
      const value = await readRows(key, fallback);
      await read.promise;
      return value;
    });
    const reload = s().reloadSettings();
    await vi.waitFor(() => expect(getSetting).toHaveBeenCalledTimes(4));
    expect(s().settingsRead).toBe(false);
    const write = s().createAlert(price);
    await tick();
    // Elle attend : l'état est encore celui d'avant et rien n'est écrit.
    expect(setSetting).not.toHaveBeenCalled();
    expect(s().alerts.map((alert) => alert.id)).toEqual(['old']);
    read.open();
    await reload;
    const result = await write;
    if (!result.ok) throw new Error('création refusée');
    expect(lastWrite('crypto.alerts')).toEqual([RESTORED['crypto.alerts'][0], expect.objectContaining({ id: result.id, target: ONE })]);
    expect(s()).toMatchObject({ market: ONE, timeframe: 240 });
    // La relecture et l'écriture partagent la même lecture.
    expect(getSetting).toHaveBeenCalledTimes(4);
  });

  it('une relecture qui échoue ne rejette pas et laisse le mémo effacé : l’écriture suivante relit, refuse not_ready tant que la base ne se lit pas', async () => {
    await fresh(STALE);
    restoreRows(RESTORED);
    vi.mocked(getSetting).mockRejectedValue(new Error('IndexedDB indisponible'));
    await expect(s().reloadSettings()).resolves.toBeUndefined();
    expect(s().settingsRead).toBe(false);
    // L'état connu reste (aucune ligne n'a pu être lue).
    expect(s()).toMatchObject({ market: ZIG, timeframe: 5 });
    expect(getSetting).toHaveBeenCalledTimes(4);
    expect(await s().createAlert(price)).toEqual({ ok: false, reason: 'not_ready' });
    expect(getSetting).toHaveBeenCalledTimes(8);
    expect(setSetting).not.toHaveBeenCalled();
    // La base revient : la prochaine écriture relit, puis se pose sur les lignes restaurées.
    vi.mocked(getSetting).mockImplementation(readRows);
    const result = await s().createAlert(price);
    if (!result.ok) throw new Error('création refusée');
    expect(getSetting).toHaveBeenCalledTimes(12);
    expect(lastWrite('crypto.alerts')).toEqual([RESTORED['crypto.alerts'][0], expect.objectContaining({ id: result.id })]);
    expect(s()).toMatchObject({ settingsRead: true, market: ONE, timeframe: 240 });
  });

  it('une lecture déjà en vol au moment de la relecture n’est pas appliquée : ceux qui l’attendaient reçoivent la relecture', async () => {
    seed(STALE);
    // Les quatre premières lectures lisent les lignes d'avant, les quatre suivantes celles restaurées ; chaque série est retenue à part.
    const series = [gate(), gate()];
    let calls = 0;
    vi.mocked(getSetting).mockImplementation(async (key: string, fallback: unknown) => {
      const value = readRows(key, fallback);
      await series[Math.floor(calls++ / 4)]?.promise;
      return value;
    });
    const write = s().createAlert(price, 'agent');
    await vi.waitFor(() => expect(getSetting).toHaveBeenCalledTimes(4));
    restoreRows(RESTORED);
    const reload = s().reloadSettings();
    await vi.waitFor(() => expect(getSetting).toHaveBeenCalledTimes(8));
    // La lecture d'avant se termine la première : elle n'applique rien et n'ouvre pas la voie à l'écriture.
    series[0]?.open();
    await tick();
    expect(s()).toMatchObject({ settingsRead: false, market: DEFAULT_CRYPTO_MARKET, alerts: [] });
    expect(setSetting).not.toHaveBeenCalled();
    series[1]?.open();
    await reload;
    const result = await write;
    if (!result.ok) throw new Error('création refusée');
    expect(lastWrite('crypto.alerts')).toEqual([RESTORED['crypto.alerts'][0], expect.objectContaining({ id: result.id, target: ONE, author: 'agent' })]);
    expect(s()).toMatchObject({ settingsRead: true, market: ONE, timeframe: 240, watchlist: [ONE, ONDO, BTC] });
    expect(getSetting).toHaveBeenCalledTimes(8);
  });

  it('Metrique relit le store crypto après restoreVault, dans la liste des stores rechargés', () => {
    const src = readFileSync('src/modules/metrique/Metrique.tsx', 'utf8');
    expect(src).toMatch(/import \{ useCrypto \} from '@\/store\/crypto';/);
    const restore = src.slice(src.indexOf('await restoreVault('), src.indexOf('const skippedNote'));
    expect(restore).toContain('useCrypto.getState().reloadSettings()');
    // Dans le `Promise.all` des rechargements, avec les autres stores.
    expect(restore.indexOf('Promise.all([')).toBeGreaterThan(-1);
    expect(restore.indexOf('useCrypto.getState().reloadSettings()')).toBeGreaterThan(restore.indexOf('Promise.all(['));
    expect(restore.indexOf('useCrypto.getState().reloadSettings()')).toBeLessThan(restore.indexOf(']);'));
  });
});

describe('chart : marché et timeframe', () => {
  it.each(['binance:BTCUSDT', 'binance:ONDOUSDT', 'coinbase:ETH-USD', '', 'x'])('refuse le marché %j', async (id) => {
    expect(await s().setMarket(id)).toEqual({ ok: false, reason: 'unknown_market' });
    expect(s().market).toBe(DEFAULT_CRYPTO_MARKET);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuse un timeframe hors des six', async () => {
    for (const tf of [0, 3, 30, 61, 10_080, -5, Number.NaN, Number.POSITIVE_INFINITY, '60' as unknown as number]) {
      expect(await s().setTimeframe(tf), String(tf)).toEqual({ ok: false, reason: 'bad_timeframe' });
    }
    expect(s().timeframe).toBe(DEFAULT_CRYPTO_TIMEFRAME);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('setMarket et setTimeframe changent l’état tout de suite et écrivent la ligne chart assainie', async () => {
    const pending = s().setMarket(ONE);
    expect(s().market).toBe(ONE);
    expect(await pending).toEqual({ ok: true });
    expect(await s().setTimeframe(15)).toEqual({ ok: true });
    expect(lastWrite('crypto.chart')).toEqual({ market: ONE, timeframe: 15, indicators: DEFAULT_CRYPTO_INDICATORS });
    expect(writtenKeys()).toEqual(['crypto.chart', 'crypto.chart']);
    expectRowsSurvive();
  });

  it('un nouveau marché ou timeframe vide les bougies de l’ancien, un choix identique les garde', async () => {
    const bar = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 3 };
    useCrypto.setState({ bars: [bar], proxyBars: [bar], cvdAnchoredAt: 1 });
    await s().setMarket(DEFAULT_CRYPTO_MARKET);
    await s().setTimeframe(DEFAULT_CRYPTO_TIMEFRAME);
    expect(s()).toMatchObject({ bars: [bar], proxyBars: [bar], cvdAnchoredAt: 1 });
    await s().setTimeframe(5);
    expect(s()).toMatchObject({ bars: [], proxyBars: [], cvdAnchoredAt: null });
    useCrypto.setState({ bars: [bar], proxyBars: [bar], cvdAnchoredAt: 1 });
    await s().setMarket(ZIG);
    expect(s()).toMatchObject({ bars: [], proxyBars: [], cvdAnchoredAt: null });
  });
});

describe('indicateurs', () => {
  it('refuse un indicateur hors du catalogue crypto, dont ceux de séance du desk', async () => {
    for (const id of ['', 'rsi', 'vwap', 'opening-range', 'levels']) {
      expect(await s().addIndicator(id), id).toEqual({ ok: false, reason: 'unknown_indicator' });
    }
    expect(s().indicators).toEqual(DEFAULT_CRYPTO_INDICATORS);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('ajoute avec les paramètres par défaut puis ceux demandés, et écrit la ligne chart', async () => {
    const plain = await s().addIndicator('ema');
    expect(plain).toMatchObject({ ok: true });
    const long = await s().addIndicator('ema', { period: 200 });
    const proxy = await s().addIndicator('cvd-binance');
    if (!plain.ok || !long.ok || !proxy.ok) throw new Error('ajout refusé');
    expect(plain.id).not.toBe(long.id);
    const byId = (id?: string) => s().indicators.find((indicator) => indicator.id === id);
    expect(byId(plain.id)).toEqual({ id: plain.id, definitionId: 'ema', params: { period: 21 }, visible: true });
    expect(byId(long.id)?.params).toEqual({ period: 200 });
    expect(byId(proxy.id)).toMatchObject({ definitionId: 'cvd-binance', params: {}, visible: true });
    expect(lastWrite('crypto.chart')).toEqual({ market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME, indicators: s().indicators });
    expectRowsSurvive();
  });

  it('refuse des paramètres que le catalogue ne connaît pas ou que la ligne ne garderait pas', async () => {
    const bad: [string, unknown][] = [
      ['ema', { period: 1 }],
      ['ema', { period: 501 }],
      ['ema', { period: Number.NaN }],
      ['ema', { period: Number.POSITIVE_INFINITY }],
      ['ema', { period: '20' }],
      ['ema', { period: 20, depth: 3 }],
      ['ema', { bands: '1' }],
      ['ema', 'period'],
      ['ema', null],
      ['vwap-utc', { bands: '3' }],
      ['vwap-utc', { bands: 1 }],
      ['cvd', { x: 1 }],
      ['ema', JSON.parse('{"__proto__": 1}')],
    ];
    for (const [id, params] of bad) {
      expect(await s().addIndicator(id, params as Record<string, number | string>), `${id} ${JSON.stringify(params)}`).toEqual({ ok: false, reason: 'bad_params' });
    }
    expect(await s().addIndicator('vwap-utc', { bands: '2' })).toMatchObject({ ok: true });
    expect(setSetting).toHaveBeenCalledTimes(1);
  });

  it('refuse le 51e indicateur : la ligne n’en garde pas plus', async () => {
    for (let i = s().indicators.length; i < INDICATORS_MAX; i++) expect(await s().addIndicator('sma')).toMatchObject({ ok: true });
    expect(s().indicators).toHaveLength(INDICATORS_MAX);
    expect(await s().addIndicator('sma')).toEqual({ ok: false, reason: 'indicators_full' });
    expect(s().indicators).toHaveLength(INDICATORS_MAX);
    expectRowsSurvive();
    expect((h.rows.get('crypto.chart') as { indicators: unknown[] }).indicators).toHaveLength(INDICATORS_MAX);
  });

  it('updateIndicator, toggleIndicator et removeIndicator écrivent la ligne chart', async () => {
    await s().updateIndicator('i_vwap', { bands: '2' });
    expect(s().indicators.find((indicator) => indicator.id === 'i_vwap')?.params).toEqual({ bands: '2' });
    await s().toggleIndicator('i_cvd');
    expect(s().indicators.find((indicator) => indicator.id === 'i_cvd')?.visible).toBe(false);
    // Une valeur hors domaine, une clé inconnue ou un id inconnu ne changent rien.
    const before = s().indicators;
    vi.mocked(setSetting).mockClear();
    await s().updateIndicator('i_vwap', { bands: '9' });
    await s().updateIndicator('i_vwap', { period: 3 });
    await s().updateIndicator('absent', { bands: '1' });
    await s().toggleIndicator('absent');
    expect(s().indicators).toEqual(before);
    expect(setSetting).not.toHaveBeenCalled();
    expect(await s().removeIndicator('i_cvd')).toEqual({ ok: true });
    expect(s().indicators.map((indicator) => indicator.id)).toEqual(['i_vwap']);
    expect(lastWrite('crypto.chart')).toMatchObject({ indicators: [{ id: 'i_vwap', params: { bands: '2' } }] });
    expect(await s().removeIndicator('i_cvd')).toEqual({ ok: false, reason: 'unknown_indicator' });
    expectRowsSurvive();
  });
});

describe('tracés', () => {
  const level = { market: BTC, kind: 'level', price: 82_528 } as const;
  const zone = { market: ONE, kind: 'zone', from: 0.002163, to: 0.0023, label: 'offre' } as const;

  it('ajoute un niveau et une zone, avec id, date et auteur, et écrit la ligne assainie', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const a = await s().addDrawing(level);
    const b = await s().addDrawing(zone);
    if (!a.ok || !b.ok) throw new Error('ajout refusé');
    expect(s().drawings).toEqual([
      { id: a.id, market: BTC, kind: 'level', price: 82_528, author: 'trader', createdAt: NOW },
      { id: b.id, market: ONE, kind: 'zone', from: 0.002163, to: 0.0023, label: 'offre', author: 'trader', createdAt: NOW },
    ]);
    expect(lastWrite('crypto.drawings')).toEqual(s().drawings);
    expectRowsSurvive();
  });

  it('ne copie que les champs de son genre', async () => {
    await s().addDrawing({ ...level, from: 1, to: 2, label: undefined } as never);
    await s().addDrawing({ ...zone, price: 5 } as never);
    expect(s().drawings[0]).not.toHaveProperty('from');
    expect(s().drawings[0]).not.toHaveProperty('label');
    expect(s().drawings[1]).not.toHaveProperty('price');
    expectRowsSurvive();
  });

  it('refuse un marché inconnu et un genre inconnu', async () => {
    expect(await s().addDrawing({ ...level, market: 'binance:BTCUSDT' } as never)).toEqual({ ok: false, reason: 'unknown_market' });
    expect(await s().addDrawing({ ...level, kind: 'line' } as never)).toEqual({ ok: false, reason: 'bad_kind' });
    expect(s().drawings).toEqual([]);
  });

  it('refuse un prix, from ou to nul, négatif ou non fini, et une zone à l’envers', async () => {
    const prices = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '82000' as unknown as number, undefined as unknown as number];
    for (const price of prices) expect(await s().addDrawing({ ...level, price }), String(price)).toEqual({ ok: false, reason: 'bad_price' });
    for (const from of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(await s().addDrawing({ ...zone, from }), `from ${from}`).toEqual({ ok: false, reason: 'bad_price' });
    for (const to of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(await s().addDrawing({ ...zone, to }), `to ${to}`).toEqual({ ok: false, reason: 'bad_price' });
    expect(await s().addDrawing({ ...zone, from: 0.0023, to: 0.002163 })).toEqual({ ok: false, reason: 'bad_price' });
    expect(await s().addDrawing({ ...zone, from: 0.002, to: 0.002 })).toEqual({ ok: false, reason: 'bad_price' });
    expect(s().drawings).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('label : 40 caractères passent, 41 sont refusés, un non-texte aussi', async () => {
    expect(await s().addDrawing({ ...level, label: 'x'.repeat(LABEL_MAX) })).toMatchObject({ ok: true });
    expect(await s().addDrawing({ ...level, label: 'x'.repeat(LABEL_MAX + 1) })).toEqual({ ok: false, reason: 'label_too_long' });
    expect(await s().addDrawing({ ...level, label: 12 as unknown as string })).toEqual({ ok: false, reason: 'bad_label' });
    expect(s().drawings).toHaveLength(1);
    expectRowsSurvive();
  });

  it('refuse le 101e tracé', async () => {
    for (let i = 0; i < DRAWINGS_MAX; i++) expect(await s().addDrawing({ ...level, price: 80_000 + i })).toMatchObject({ ok: true });
    expect(await s().addDrawing(level)).toEqual({ ok: false, reason: 'drawings_full' });
    expect(s().drawings).toHaveLength(DRAWINGS_MAX);
    expect((h.rows.get('crypto.drawings') as unknown[]).length).toBe(DRAWINGS_MAX);
    expectRowsSurvive();
  });

  it('removeDrawing retire par id, refuse un id inconnu', async () => {
    const a = await s().addDrawing(level);
    const b = await s().addDrawing(zone);
    if (!a.ok || !b.ok) throw new Error('ajout refusé');
    expect(await s().removeDrawing(a.id ?? '')).toEqual({ ok: true });
    expect(s().drawings.map((drawing) => drawing.id)).toEqual([b.id]);
    expect(lastWrite('crypto.drawings')).toEqual(s().drawings);
    expect(await s().removeDrawing(a.id ?? '')).toEqual({ ok: false, reason: 'unknown_drawing' });
  });
});

describe('alertes', () => {
  const price = { target: BTC, kind: 'price_above', level: 90_000, mode: 'once' } as const;
  const funding = { target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm' } as const;

  it('crée une alerte armée, avec id, date et auteur, et écrit la ligne assainie', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const a = await s().createAlert(price);
    const b = await s().createAlert(funding);
    if (!a.ok || !b.ok) throw new Error('création refusée');
    expect(s().alerts).toEqual([
      { id: a.id, target: BTC, kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW },
      { id: b.id, target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm', author: 'trader', state: 'armed', createdAt: NOW },
    ]);
    expect(lastWrite('crypto.alerts')).toEqual(s().alerts);
    expectRowsSurvive();
  });

  it('ne reprend ni id, ni état, ni auteur, ni date du demandeur', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const result = await s().createAlert({ ...price, id: 'choisi', state: 'triggered', author: 'agent', createdAt: 1, lastTriggeredAt: 5 } as never);
    expect(result.ok && result.id).not.toBe('choisi');
    expect(s().alerts[0]).toEqual({ id: result.ok ? result.id : '', target: BTC, kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW });
  });

  it('refuse un mode hors once | rearm', async () => {
    for (const mode of ['', 'always', 'ONCE', undefined, null, 1]) {
      expect(await s().createAlert({ ...price, mode } as never), String(mode)).toEqual({ ok: false, reason: 'bad_mode' });
    }
    expect(s().alerts).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuse un auteur hors trader | agent porté par l’entrée elle-même', async () => {
    expect(await s().createAlert({ ...price, author: 'robot' } as never)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().addDrawing({ market: BTC, kind: 'level', price: 1, author: 'robot' } as never)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().createAlert({ ...price, author: null } as never)).toEqual({ ok: false, reason: 'bad_mode' });
    expect([s().alerts, s().drawings]).toEqual([[], []]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuse un acteur hors trader | agent, pour toute écriture', async () => {
    const bot = 'bot' as never;
    expect(await s().createAlert(price, bot)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().addDrawing({ market: BTC, kind: 'level', price: 1 }, bot)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().setMarket(ONE, bot)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().setTimeframe(5, null as never)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(await s().addToWatchlist(BTC, bot)).toEqual({ ok: false, reason: 'bad_mode' });
    expect(s()).toMatchObject({ alerts: [], drawings: [], market: DEFAULT_CRYPTO_MARKET, agentLog: [] });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('reprend les raisons de validateAlert', async () => {
    expect(await s().createAlert({ ...price, kind: 'price_sideways' } as never)).toEqual({ ok: false, reason: 'bad_kind' });
    expect(await s().createAlert({ ...price, target: 'temperature' })).toEqual({ ok: false, reason: 'bad_target' });
    expect(await s().createAlert({ ...price, target: 'binance:BTCUSDT' } as never)).toEqual({ ok: false, reason: 'bad_target' });
    expect(await s().createAlert({ ...funding, target: BTC })).toEqual({ ok: false, reason: 'bad_target' });
    expect(s().alerts).toEqual([]);
  });

  it('niveau : le domaine de validateAlert, jamais hors de lui', async () => {
    const refused: [Record<string, unknown>, string][] = [
      [{ ...price, level: 0 }, 'prix nul'],
      [{ ...price, level: -1 }, 'prix négatif'],
      [{ ...price, level: Number.NaN }, 'prix NaN'],
      [{ ...price, level: Number.POSITIVE_INFINITY }, 'prix infini'],
      [{ ...price, level: '90000' }, 'prix texte'],
      [{ target: 'temperature', kind: 'liquidations_long_1h_above', level: 0, mode: 'once' }, 'liquidations nulles'],
      [{ target: 'temperature', kind: 'liquidations_short_1h_above', level: -5, mode: 'once' }, 'liquidations négatives'],
      [{ target: 'temperature', kind: 'breadth_above', level: 100.5, mode: 'once' }, 'largeur > 100'],
      [{ target: 'temperature', kind: 'breadth_below', level: -0.5, mode: 'once' }, 'largeur < 0'],
      [{ ...funding, level: Number.NaN }, 'funding NaN'],
    ];
    for (const [input, name] of refused) expect(await s().createAlert(input as never), name).toEqual({ ok: false, reason: 'bad_level' });
    expect(s().alerts).toEqual([]);
    // Les bornes admises : largeur 0 et 100, funding négatif, prix minuscule.
    for (const input of [
      { target: 'temperature', kind: 'breadth_above', level: 100, mode: 'once' },
      { target: 'temperature', kind: 'breadth_below', level: 0, mode: 'once' },
      { ...funding, kind: 'funding_median_below', level: -0.02 },
      { target: ONE, kind: 'price_below', level: 0.002163, mode: 'rearm' },
    ]) expect(await s().createAlert(input as never), JSON.stringify(input)).toMatchObject({ ok: true });
    expectRowsSurvive();
  });

  it('une alerte de prix hors de la watchlist est refusée, une alerte de température non', async () => {
    await s().removeFromWatchlist(ZIG);
    expect(await s().createAlert({ ...price, target: ZIG })).toEqual({ ok: false, reason: 'not_in_watchlist' });
    expect(await s().createAlert(funding)).toMatchObject({ ok: true });
    await s().addToWatchlist(ZIG);
    expect(await s().createAlert({ ...price, target: ZIG, level: 1 })).toMatchObject({ ok: true });
  });

  it('refuse la 51e alerte ; les ids sont uniques et tiennent en 64 caractères', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= ALERTS_MAX; i++) {
      const result = await s().createAlert({ ...price, level: i });
      if (!result.ok || !result.id) throw new Error('création refusée');
      ids.push(result.id);
    }
    expect(new Set(ids).size).toBe(ALERTS_MAX);
    expect(ids.every((id) => id.length > 0 && id.length <= 64)).toBe(true);
    expect(await s().createAlert(price)).toEqual({ ok: false, reason: 'alerts_full' });
    expect(await s().createAlert(funding)).toEqual({ ok: false, reason: 'alerts_full' });
    expect(s().alerts).toHaveLength(ALERTS_MAX);
    expect((h.rows.get('crypto.alerts') as unknown[]).length).toBe(ALERTS_MAX);
    expectRowsSurvive();
  });

  it('deleteAlert retire par id, refuse un id inconnu', async () => {
    const a = await s().createAlert(price);
    const b = await s().createAlert(funding);
    if (!a.ok || !b.ok) throw new Error('création refusée');
    expect(await s().deleteAlert(a.id ?? '')).toEqual({ ok: true });
    expect(s().alerts.map((alert) => alert.id)).toEqual([b.id]);
    expect(lastWrite('crypto.alerts')).toEqual(s().alerts);
    expect(await s().deleteAlert(a.id ?? '')).toEqual({ ok: false, reason: 'unknown_alert' });
  });

  it('setAlertState change l’état et la date de franchissement, et écrit la ligne', async () => {
    const a = await s().createAlert(price);
    if (!a.ok || !a.id) throw new Error('création refusée');
    await s().setAlertState(a.id, 'triggered', NOW + 5);
    expect(s().alerts[0]).toMatchObject({ state: 'triggered', lastTriggeredAt: NOW + 5 });
    // Une alerte qui se réarme garde sa dernière date si aucune n'est donnée.
    await s().setAlertState(a.id, 'armed');
    expect(s().alerts[0]).toMatchObject({ state: 'armed', lastTriggeredAt: NOW + 5 });
    // Franchie sans date donnée : l'horloge du store.
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 9);
    await s().setAlertState(a.id, 'triggered');
    expect(s().alerts[0]).toMatchObject({ state: 'triggered', lastTriggeredAt: NOW + 9 });
    await s().setAlertState(a.id, 'paused');
    expect(s().alerts[0]).toMatchObject({ state: 'paused', lastTriggeredAt: NOW + 9 });
    expect(lastWrite('crypto.alerts')).toEqual(s().alerts);
    expectRowsSurvive();
    // Un état inconnu, une date non finie ou un id inconnu ne changent rien.
    const before = s().alerts;
    vi.mocked(setSetting).mockClear();
    await s().setAlertState(a.id, 'ringing' as never);
    await s().setAlertState(a.id, 'armed', Number.NaN);
    await s().setAlertState('absent', 'paused');
    expect(s().alerts).toEqual(before);
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('watchlist', () => {
  it('refuse un marché hors des quatre affichables, dont les sources du CVD', async () => {
    for (const id of ['binance:BTCUSDT', 'binance:ONDOUSDT', 'coinbase:ETH-USD', '']) {
      expect(await s().addToWatchlist(id), id).toEqual({ ok: false, reason: 'unknown_market' });
      expect(await s().removeFromWatchlist(id), id).toEqual({ ok: false, reason: 'unknown_market' });
    }
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('retire et rajoute dans l’ordre du trader, et écrit la ligne assainie', async () => {
    expect(await s().removeFromWatchlist(BTC)).toEqual({ ok: true });
    expect(await s().removeFromWatchlist(ONE)).toEqual({ ok: true });
    expect(s().watchlist).toEqual([ONDO, ZIG]);
    expect(await s().addToWatchlist(BTC)).toEqual({ ok: true });
    expect(s().watchlist).toEqual([ONDO, ZIG, BTC]);
    // Déjà présent : rien ne change.
    expect(await s().addToWatchlist(BTC)).toEqual({ ok: true });
    expect(s().watchlist).toEqual([ONDO, ZIG, BTC]);
    expect(lastWrite('crypto.watchlist')).toEqual([ONDO, ZIG, BTC]);
    expect(await s().removeFromWatchlist(ONE)).toEqual({ ok: false, reason: 'not_in_watchlist' });
    expectRowsSurvive();
  });

  it('refuse de retirer un marché qui porte une alerte, quel que soit son état', async () => {
    const a = await s().createAlert({ target: BTC, kind: 'price_above', level: 90_000, mode: 'once' });
    if (!a.ok || !a.id) throw new Error('création refusée');
    expect(await s().removeFromWatchlist(BTC)).toEqual({ ok: false, reason: 'market_has_alerts' });
    await s().setAlertState(a.id, 'paused');
    expect(await s().removeFromWatchlist(BTC)).toEqual({ ok: false, reason: 'market_has_alerts' });
    expect(s().watchlist).toContain(BTC);
    await s().deleteAlert(a.id);
    expect(await s().removeFromWatchlist(BTC)).toEqual({ ok: true });
  });
});

describe('agent : auteur et journal', () => {
  it('une écriture de l’agent marque ses alertes et ses tracés author: agent, celles du trader trader', async () => {
    const alert = await s().createAlert({ target: BTC, kind: 'price_below', level: 70_000, mode: 'once' }, 'agent');
    const mine = await s().createAlert({ target: BTC, kind: 'price_below', level: 71_000, mode: 'once' });
    const drawing = await s().addDrawing({ market: BTC, kind: 'level', price: 80_000 }, 'agent');
    const mineDrawing = await s().addDrawing({ market: BTC, kind: 'level', price: 81_000 }, 'trader');
    expect(s().alerts.map((a) => a.author)).toEqual(['agent', 'trader']);
    expect(s().drawings.map((d) => d.author)).toEqual(['agent', 'trader']);
    expect([alert, mine, drawing, mineDrawing].every((r) => r.ok)).toBe(true);
    expectRowsSurvive();
    expect((h.rows.get('crypto.alerts') as { author: string }[]).map((a) => a.author)).toEqual(['agent', 'trader']);
  });

  it('chaque écriture de l’agent inscrit une ligne au nom de l’outil CRY6.1, la plus récente d’abord', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const steps: [string, () => Promise<unknown>][] = [
      ['crypto_chart_set', () => s().setMarket(ONE, 'agent')],
      ['crypto_chart_set', () => s().setTimeframe(15, 'agent')],
      ['crypto_indicator_set', () => s().addIndicator('ema', { period: 200 }, 'agent')],
      ['crypto_indicator_set', () => s().removeIndicator('i_cvd', 'agent')],
      ['crypto_drawing_set', () => s().addDrawing({ market: ONE, kind: 'zone', from: 0.002, to: 0.0023, label: 'offre' }, 'agent')],
      ['crypto_alert_set', () => s().createAlert({ target: ONE, kind: 'price_above', level: 0.0023, mode: 'once' }, 'agent')],
      ['crypto_watchlist_set', () => s().removeFromWatchlist(ZIG, 'agent')],
      ['crypto_watchlist_set', () => s().addToWatchlist(ZIG, 'agent')],
    ];
    for (const [tool, run] of steps) {
      const before = s().agentLog.length;
      expect(await run(), tool).toMatchObject({ ok: true });
      expect(s().agentLog).toHaveLength(before + 1);
      expect(s().agentLog[0]).toMatchObject({ at: NOW, tool });
      expect(s().agentLog[0]?.effect.length).toBeGreaterThan(0);
    }
    const drawingId = s().drawings[0]?.id ?? '';
    const alertId = s().alerts[0]?.id ?? '';
    expect(await s().removeDrawing(drawingId, 'agent')).toEqual({ ok: true });
    expect(s().agentLog[0]?.tool).toBe('crypto_drawing_set');
    expect(await s().deleteAlert(alertId, 'agent')).toEqual({ ok: true });
    expect(s().agentLog[0]?.tool).toBe('crypto_alert_set');
    expect(s().agentLog.map((line) => line.tool)).toEqual([
      'crypto_alert_set',
      'crypto_drawing_set',
      'crypto_watchlist_set',
      'crypto_watchlist_set',
      'crypto_alert_set',
      'crypto_drawing_set',
      'crypto_indicator_set',
      'crypto_indicator_set',
      'crypto_chart_set',
      'crypto_chart_set',
    ]);
    expectRowsSurvive();
  });

  it('le trader n’inscrit rien au journal, un refus de l’agent non plus', async () => {
    await s().setMarket(ONE);
    await s().createAlert({ target: BTC, kind: 'price_above', level: 90_000, mode: 'once' });
    await s().removeFromWatchlist(ZIG, 'trader');
    expect(s().agentLog).toEqual([]);
    expect(await s().setMarket('binance:BTCUSDT', 'agent')).toMatchObject({ ok: false });
    expect(await s().setTimeframe(7, 'agent')).toMatchObject({ ok: false });
    expect(await s().addIndicator('vwap', {}, 'agent')).toMatchObject({ ok: false });
    expect(await s().createAlert({ target: BTC, kind: 'price_above', level: -1, mode: 'once' }, 'agent')).toMatchObject({ ok: false });
    expect(await s().removeFromWatchlist(BTC, 'agent')).toEqual({ ok: false, reason: 'market_has_alerts' });
    expect(await s().deleteAlert('absent', 'agent')).toMatchObject({ ok: false });
    expect(s().agentLog).toEqual([]);
  });

  it('le journal tient 20 lignes au plus, les plus anciennes tombent', async () => {
    let clock = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock++);
    for (let i = 0; i < 25; i++) await s().setTimeframe(i % 2 === 0 ? 5 : 15, 'agent');
    expect(s().agentLog).toHaveLength(20);
    const times = s().agentLog.map((line) => line.at);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // La 25e écriture (indice 24, timeframe 5) est en tête ; la 6e (indice 5, timeframe 15) est la plus ancienne gardée.
    expect(s().agentLog[0]?.effect).toContain('5 min');
    expect(s().agentLog[0]?.effect).not.toContain('15 min');
    expect(s().agentLog.at(-1)?.effect).toContain('15 min');
  });

  it('l’effet est écrit dans la langue active au moment de l’écriture', async () => {
    const effects: string[] = [];
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      await s().setMarket(locale === 'fr' ? ONE : locale === 'en' ? ZIG : ONDO, 'agent');
      effects.push(s().agentLog[0]?.effect ?? '');
    }
    expect(new Set(effects).size).toBe(3);
    expect(effects[0]).toContain('ONEUSDT · Binance');
    expect(effects[1]).toContain('ZIGUSDT · Bybit');
    expect(effects[2]).toContain('ONDO-USD · Coinbase');
    expect(effects[0]).toMatch(/Marché/);
    expect(effects[1]).toMatch(/market/);
    expect(effects[2]).toMatch(/Mercado/);
  });
});

describe('persistance', () => {
  it('deux écritures lancées sans attendre se composent : l’état les porte tout de suite, la dernière ligne aussi', async () => {
    const releases: (() => void)[] = [];
    vi.mocked(setSetting).mockImplementation(
      (key: string, value: unknown) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            h.rows.set(key, clone(value));
            resolve();
          });
        }),
    );
    const first = s().removeFromWatchlist(ZIG);
    const second = s().removeFromWatchlist(ONE);
    expect(s().watchlist).toEqual([BTC, ONDO]);
    expect(releases).toHaveLength(2);
    for (const release of releases) release();
    await Promise.all([first, second]);
    expect(h.rows.get('crypto.watchlist')).toEqual([BTC, ONDO]);
  });

  it('une écriture refusée par la base rejette l’action sans rien laisser traîner, et la suivante repart de l’état', async () => {
    vi.mocked(setSetting).mockRejectedValueOnce(new Error('quota dépassé'));
    await expect(s().removeFromWatchlist(ZIG)).rejects.toThrow('quota dépassé');
    // L'état a suivi (comme le store de `chart.indicators`) ; l'écriture suivante porte les deux retraits.
    expect(s().watchlist).toEqual([BTC, ONDO, ONE]);
    await s().removeFromWatchlist(ONE);
    expect(h.rows.get('crypto.watchlist')).toEqual([BTC, ONDO]);
    // Le journal de l'agent, lui, n'est jamais perdu par l'échec de la base.
    vi.mocked(setSetting).mockRejectedValueOnce(new Error('quota dépassé'));
    await expect(s().setTimeframe(5, 'agent')).rejects.toThrow('quota dépassé');
    expect(s().agentLog).toHaveLength(1);
    // Un déclenchement ou un rechargement ensuite n'a rien d'en suspens.
    await s().load();
    expect(s().watchlist).toEqual([BTC, ONDO]);
  });

  it('un setSetting qui lève tout de suite est rejeté de même', async () => {
    vi.mocked(setSetting).mockImplementationOnce(() => {
      throw new Error('base fermée');
    });
    await expect(s().setMarket(ONE)).rejects.toThrow('base fermée');
    expect(s().market).toBe(ONE);
  });

  it('chaque ligne écrite repasse par son assainisseur à l’identique après une suite mêlée', async () => {
    await s().setMarket(ONDO);
    await s().setTimeframe(1440);
    await s().addIndicator('sma', { period: 50 });
    await s().addIndicator('cvd-binance', {}, 'agent');
    await s().updateIndicator('i_vwap', { bands: '0' });
    await s().toggleIndicator('i_cvd');
    await s().removeFromWatchlist(ZIG);
    await s().createAlert({ target: ONDO, kind: 'price_above', level: 0.9, mode: 'rearm' }, 'agent');
    await s().createAlert({ target: 'temperature', kind: 'liquidations_long_1h_above', level: 5_000_000, mode: 'once' });
    await s().addDrawing({ market: ONDO, kind: 'zone', from: 0.7, to: 0.8, label: 'demande' }, 'agent');
    await s().addDrawing({ market: BTC, kind: 'level', price: 82_528 });
    expect([...new Set(writtenKeys())].sort()).toEqual(['crypto.alerts', 'crypto.chart', 'crypto.drawings', 'crypto.watchlist']);
    expectRowsSurvive();
    // Et l'état rechargé depuis ces lignes est l'état d'avant.
    const before = { market: s().market, timeframe: s().timeframe, indicators: s().indicators, watchlist: s().watchlist, alerts: s().alerts, drawings: s().drawings };
    useCrypto.setState(useCrypto.getInitialState(), true);
    await s().load();
    expect({ market: s().market, timeframe: s().timeframe, indicators: s().indicators, watchlist: s().watchlist, alerts: s().alerts, drawings: s().drawings }).toEqual(before);
  });
});
