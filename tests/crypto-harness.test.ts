import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRYPTO_MARKETS, cryptoMarket, type CryptoBar, type CryptoFeedEvent, type CryptoSeriesId } from '@/engine/crypto/markets';
import { aggregateBars, parseCandles } from '@/engine/crypto/venues';
import type { CryptoApi, DeskApi } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';
import { DEFAULT_OUT, DEFAULT_OUT_COLUMN, PAGE_URL, browserArgs, pageUrl, resolveBrowser, standardBrowserPaths } from '../scripts/capture-crypto.mjs';
import { fakeCryptoDesk, fakeDeskApi, fixtureTemperature } from '../scripts/harness/fakeCryptoDesk';
import { recordedFixtures } from '../scripts/harness/recorded';

/** Le banc de capture de l'onglet 09 · CRY (CRY4.4) : un faux desk nourri des réponses réelles du 9 octobre 2026. */

/** Chaque méthode de `CryptoApi` : une méthode ajoutée à l'interface sans figurer ici ne compile plus (`npm run typecheck`). */
const CRYPTO_METHODS = {
  status: true,
  enable: true,
  disable: true,
  history: true,
  subscribe: true,
  unsubscribe: true,
  temperature: true,
  onEvent: true,
  onTemperature: true,
  onStatus: true,
} satisfies Record<keyof CryptoApi, true>;

/** Les membres obligatoires de `DeskApi` : même garde de typage. */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
const DESK_REQUIRED = {
  isDesk: true,
  platform: true,
  version: true,
  update: true,
  bridge: true,
  secrets: true,
  window: true,
  files: true,
  orchestrator: true,
} satisfies Record<RequiredKeys<DeskApi>, true>;

/** Les noms de premier niveau d'une interface de `src/lib/desk.ts`, relus dans la source : une méthode ajoutée fait échouer le test même sans typage. */
function interfaceMembers(name: string, optional: boolean): string[] {
  const source = readFileSync('src/lib/desk.ts', 'utf8');
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, `interface ${name}`).toBeGreaterThanOrEqual(0);
  const block = source.slice(start, source.indexOf('\n}', start));
  const pattern = optional ? /^ {2}(\w+)\??: /gm : /^ {2}(\w+): /gm;
  return [...block.matchAll(pattern)].map((m) => m[1] ?? '').sort();
}

const NOW_MS = 1791543600000 + 90_000; // 9 octobre 2026, 11:01:30 UTC : la bougie 1 h de 10:00 vient de se clore.
const clock = () => NOW_MS;

const SERIES_WITH_DATA = Object.keys(recordedFixtures.responses) as CryptoSeriesId[];

/** Les bougies de la réponse réelle, lues par `parseCandles` : tout ce que le faux desk sert doit s'y retrouver. */
function parsedHourly(series: CryptoSeriesId): CryptoBar[] {
  const venue = cryptoMarket(series)?.venue;
  if (!venue) throw new Error(`série hors registre : ${series}`);
  const pages = recordedFixtures.responses[series] ?? [];
  return aggregateBars(
    pages.flatMap((page) => parseCandles(venue, page)),
    60,
    1,
  );
}

async function historyOf(api: CryptoApi, series: CryptoSeriesId, timeframe: 60 | 240 | 1440 = 60): Promise<CryptoBar[]> {
  const res = await api.history({ series, timeframe });
  if (!res.ok) throw new Error(res.detail);
  return res.bars;
}

describe('fakeCryptoDesk : la surface de CryptoApi', () => {
  it('expose chaque méthode de CryptoApi, la liste étant celle de src/lib/desk.ts', () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    expect(Object.keys(CRYPTO_METHODS).sort()).toEqual(interfaceMembers('CryptoApi', true));
    for (const method of Object.keys(CRYPTO_METHODS)) expect(typeof (api as unknown as Record<string, unknown>)[method], method).toBe('function');
  });

  it('porte aussi l’orchestrateur, que DeskApi exige', () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    expect(Object.keys(api.orchestrator).sort()).toEqual(['broadcast', 'copyToken', 'onRequest', 'onStatus', 'respond', 'rotateToken', 'start', 'status', 'stop']);
  });

  it('interrupteur allumé, trois venues en direct, un statut neuf à chaque lecture', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    expect(await api.status()).toEqual({ enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } });
    expect(await api.enable()).toEqual(await api.status());
    // Le banc n'a pas d'interrupteur à éteindre : disable() ne change rien.
    expect((await api.disable()).enabled).toBe(true);
    const a = await api.status();
    a.venues.coinbase = 'off';
    expect((await api.status()).venues.coinbase).toBe('live');
  });

  it('chaque abonnement d’écoute rend un désabonnement', () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    for (const stop of [api.onEvent(() => {}), api.onTemperature(() => {}), api.onStatus(() => {})]) expect(typeof stop).toBe('function');
  });
});

describe('fakeCryptoDesk : l’historique vient des réponses réelles', () => {
  it('les fixtures couvrent les quatre marchés affichables et les deux sources du CVD', () => {
    expect(SERIES_WITH_DATA.sort()).toEqual(CRYPTO_MARKETS.map((m) => m.id).sort());
  });

  it('BTC-USD en 1 h : de quoi remplir un chart lisible, bien au-delà de 150 bougies', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const bars = await historyOf(api, 'coinbase:BTC-USD');
    expect(bars.length).toBeGreaterThanOrEqual(500);
  });

  it('chaque bougie servie sort de parseCandles, pour chaque série et chaque timeframe offert', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    for (const series of SERIES_WITH_DATA) {
      const hourly = parsedHourly(series);
      expect(hourly.length, series).toBeGreaterThan(0);
      const served = await historyOf(api, series);
      const known = new Set(hourly.map((b) => JSON.stringify(b)));
      for (const bar of served) expect(known.has(JSON.stringify(bar)), `${series} ${bar.time}`).toBe(true);
      // Les dernières bougies sont rejouées en direct : l'historique et le direct se recollent sur toute la fenêtre.
      expect(served.length, series).toBeLessThan(hourly.length);
      expect(served.map((b) => b.time), series).toEqual(hourly.slice(0, served.length).map((b) => b.time));
    }
  });

  it('4 h et 1 j sont les regroupements des bougies 1 h réelles', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const hourly = parsedHourly('coinbase:BTC-USD');
    const four = aggregateBars(hourly, 60, 4);
    const day = aggregateBars(hourly, 60, 24);
    const served4 = await historyOf(api, 'coinbase:BTC-USD', 240);
    const servedD = await historyOf(api, 'coinbase:BTC-USD', 1440);
    expect(served4).toEqual(four.slice(0, served4.length));
    expect(servedD).toEqual(day.slice(0, servedD.length));
    expect(served4.length).toBeGreaterThan(100);
  });

  it('en secondes UTC, croissantes, sans doublon, et jamais un nombre qui ne soit pas fini', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    for (const series of SERIES_WITH_DATA) {
      const bars = await historyOf(api, series);
      bars.forEach((b, i) => {
        expect(Object.values(b).every(Number.isFinite), `${series} ${i}`).toBe(true);
        expect(b.time % 3600, `${series} ${i}`).toBe(0);
        if (i > 0) expect(b.time, `${series} ${i}`).toBeGreaterThan(bars[i - 1]?.time ?? 0);
      });
    }
  });

  it('le volume acheteur n’existe que chez Binance : Coinbase et Bybit n’en portent pas dans l’historique', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    for (const series of SERIES_WITH_DATA) {
      const bars = await historyOf(api, series);
      const venue = cryptoMarket(series)?.venue;
      expect(bars.every((b) => (b.buyVolume !== undefined) === (venue === 'binance')), series).toBe(true);
    }
  });

  it('une série sans réponse, ou un timeframe que le banc n’a pas, répond no_history sans lever', async () => {
    const api = fakeCryptoDesk({ responses: { 'coinbase:BTC-USD': recordedFixtures.responses['coinbase:BTC-USD'] ?? [] } }, { clock });
    expect(await api.history({ series: 'bybit:ZIGUSDT', timeframe: 60 })).toEqual({ ok: false, detail: 'no_history' });
    expect(await api.history({ series: 'coinbase:BTC-USD', timeframe: 5 })).toEqual({ ok: false, detail: 'no_history' });
    expect(await api.history({ series: 'coinbase:BTC-USD', timeframe: 1 })).toEqual({ ok: false, detail: 'no_history' });
  });

  it('une réponse illisible donne un refus, pas une exception', async () => {
    const api = fakeCryptoDesk({ responses: { 'bybit:ZIGUSDT': [{ retCode: 10001, retMsg: 'Not supported symbols' }] } }, { clock });
    expect(await api.history({ series: 'bybit:ZIGUSDT', timeframe: 60 })).toEqual({ ok: false, detail: 'Not supported symbols' });
  });

  it('rend des tableaux neufs : modifier une réponse ne change pas la suivante', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const first = await historyOf(api, 'coinbase:BTC-USD');
    const length = first.length;
    first.pop();
    expect(await historyOf(api, 'coinbase:BTC-USD')).toHaveLength(length);
  });
});

describe('fakeCryptoDesk : le direct rejoué', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function collect(api: CryptoApi): CryptoFeedEvent[] {
    const events: CryptoFeedEvent[] = [];
    api.onEvent((e) => events.push(e));
    return events;
  }

  it('rejoue les dernières bougies, contiguës à l’historique, la dernière non close, toutes avec un volume acheteur admissible', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const events = collect(api);
    const history = await historyOf(api, 'coinbase:BTC-USD');
    const sub = await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 60 });
    expect(sub.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const bars = events.flatMap((e) => (e.kind === 'bar' ? [e] : []));
    const hourly = parsedHourly('coinbase:BTC-USD');
    expect(bars.map((e) => e.bar.time)).toEqual(hourly.slice(history.length).map((b) => b.time));
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0]?.bar.time).toBe((history.at(-1)?.time ?? 0) + 3600);
    expect(bars.map((e) => e.final)).toEqual(bars.map((_, i) => i < bars.length - 1));
    for (const e of bars) {
      expect([e.series, e.timeframe]).toEqual(['coinbase:BTC-USD', 60]);
      expect(e.bar.buyVolume, `${e.bar.time}`).toBeGreaterThanOrEqual(0);
      expect(e.bar.buyVolume, `${e.bar.time}`).toBeLessThanOrEqual(e.bar.volume);
    }
  });

  it('la part acheteuse de Coinbase vient du volume acheteur réel de Binance pour le même actif et la même heure', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const events = collect(api);
    await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 60 });
    await vi.advanceTimersByTimeAsync(20_000);
    const proxy = parsedHourly('binance:BTCUSDT');
    const live = events.flatMap((e) => (e.kind === 'bar' ? [e.bar] : []));
    expect(live.length).toBeGreaterThan(0);
    for (const bar of live) {
      const reference = proxy.find((p) => p.time === bar.time);
      expect(reference, `${bar.time}`).toBeDefined();
      if (!reference || reference.buyVolume === undefined) throw new Error('la référence Binance manque');
      expect((bar.buyVolume ?? 0) / bar.volume, `${bar.time}`).toBeCloseTo(reference.buyVolume / reference.volume, 6);
    }
  });

  it('Binance garde son propre volume acheteur, sans le recalculer', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const events = collect(api);
    await api.subscribe({ series: 'binance:ONEUSDT', kind: 'bars', timeframe: 60 });
    await vi.advanceTimersByTimeAsync(20_000);
    const hourly = parsedHourly('binance:ONEUSDT');
    for (const e of events) {
      if (e.kind !== 'bar') continue;
      expect(e.bar).toEqual(hourly.find((b) => b.time === e.bar.time));
    }
  });

  it('rejoue un ticker par marché : le dernier prix est la clôture réelle, l’heure est celle de l’horloge, la variation sur 24 h vient des bougies', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const events = collect(api);
    for (const market of ['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT'] as const) {
      const sub = await api.subscribe({ series: market, kind: 'ticker' });
      expect(sub.ok, market).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(20_000);
    for (const market of ['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT'] as const) {
      const ticks = events.flatMap((e) => (e.kind === 'ticker' && e.ticker.market === market ? [e.ticker] : []));
      const hourly = parsedHourly(market);
      const last = hourly.at(-1);
      const day = hourly.at(-25);
      expect(ticks.length, market).toBeGreaterThanOrEqual(2);
      expect(ticks.at(-1)?.last, market).toBe(last?.close);
      expect(ticks.every((t) => t.time === NOW_MS), market).toBe(true);
      expect(ticks.every((t) => t.last >= (last?.low ?? 0) && t.last <= (last?.high ?? 0)), market).toBe(true);
      expect(ticks.at(-1)?.change24hPct, market).toBeCloseTo(((last?.close ?? 0) / (day?.close ?? 1) - 1) * 100, 9);
    }
  });

  it('un abonnement lâché ne reçoit plus rien, et ses minuteries sont arrêtées', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const events = collect(api);
    const sub = await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    if (!sub.ok) throw new Error(sub.detail);
    expect(await api.unsubscribe(sub.subscriptionId)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(await api.unsubscribe(sub.subscriptionId)).toEqual({ ok: false });
    expect(await api.unsubscribe('sub-inconnu')).toEqual({ ok: false });
  });

  it('un désabonnement d’écoute arrête la livraison à cet écouteur seulement', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const kept: CryptoFeedEvent[] = [];
    const dropped: CryptoFeedEvent[] = [];
    api.onEvent((e) => kept.push(e));
    api.onEvent((e) => dropped.push(e))();
    await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(kept.length).toBeGreaterThan(0);
    expect(dropped).toEqual([]);
  });

  it('refuse avec les codes du process principal : série sans données, ticker d’une source de CVD, bougies sans timeframe, timeframe sans données', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    expect(await api.subscribe({ series: 'binance:BTCUSDT', kind: 'ticker' })).toEqual({ ok: false, detail: 'unknown_stream' });
    expect(await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars' })).toEqual({ ok: false, detail: 'invalid_request' });
    expect(await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'bars', timeframe: 5 })).toEqual({ ok: false, detail: 'unknown_stream' });
    const sparse = fakeCryptoDesk({ responses: {} }, { clock });
    expect(await sparse.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' })).toEqual({ ok: false, detail: 'unknown_stream' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('chaque abonnement a son identifiant', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const a = await api.subscribe({ series: 'coinbase:BTC-USD', kind: 'ticker' });
    const b = await api.subscribe({ series: 'coinbase:ONDO-USD', kind: 'ticker' });
    if (!a.ok || !b.ok) throw new Error('abonnement refusé');
    expect(a.subscriptionId).not.toBe(b.subscriptionId);
  });
});

describe('fakeCryptoDesk : la température figée', () => {
  it('quatre lectures complètes, datées de l’horloge, que le funding et les liquidations soient frais pour l’écran', async () => {
    const api = fakeCryptoDesk(recordedFixtures, { clock });
    const reading = await api.temperature();
    expect(reading).toEqual(fixtureTemperature(NOW_MS));
    if (!reading) throw new Error('aucune lecture');
    expect(reading.funding && reading.breadth && reading.openInterest).toBeTruthy();
    expect(reading.liquidations.lowerBound).toBe(true);
    // Moins de 120 s pour le funding et les liquidations, moins de 10 min pour le reste : rien n'est « non évalué ».
    expect(NOW_MS - (reading.funding?.at ?? 0)).toBeLessThan(120_000);
    expect(NOW_MS - reading.liquidations.at).toBeLessThan(120_000);
    expect(NOW_MS - (reading.breadth?.at ?? 0)).toBeLessThan(600_000);
    expect(NOW_MS - (reading.openInterest?.at ?? 0)).toBeLessThan(600_000);
    for (const n of [reading.funding?.median, reading.breadth?.upShare, reading.liquidations.long, reading.liquidations.short]) expect(Number.isFinite(n)).toBe(true);
  });

  it('les liquidations partent d’une fenêtre qui précède sa lecture', () => {
    const reading = fixtureTemperature(NOW_MS);
    expect(reading.liquidations.since).toBeLessThan(reading.liquidations.at);
  });
});

describe('fakeDeskApi : un DeskApi complet', () => {
  it('porte chaque membre obligatoire de DeskApi, la liste étant celle de src/lib/desk.ts', () => {
    const desk = fakeDeskApi(fakeCryptoDesk(recordedFixtures, { clock }));
    expect(Object.keys(DESK_REQUIRED).sort()).toEqual(interfaceMembers('DeskApi', false));
    for (const key of Object.keys(DESK_REQUIRED)) expect(desk, key).toHaveProperty(key);
    expect(desk.isDesk).toBe(true);
  });

  it('ses fonctions vides répondent sans lever, et ses écoutes rendent un désabonnement', async () => {
    const desk = fakeDeskApi(fakeCryptoDesk(recordedFixtures, { clock }));
    expect(await desk.version()).toBe(APP_VERSION);
    expect(await desk.update.check()).toBeNull();
    expect(await desk.update.changelog()).toBeNull();
    expect(await desk.bridge.status()).toBeNull();
    expect(await desk.secrets.encrypt('x')).toBeNull();
    expect(await desk.files.saveText('a.txt', 'x')).toBe(false);
    expect(() => {
      desk.window.minimize();
      desk.window.toggleMaximize();
      desk.window.close();
    }).not.toThrow();
    for (const stop of [desk.window.onMaximized(() => {}), desk.bridge.onFile(() => {}), desk.bridge.onStatus(() => {}), desk.orchestrator.onRequest(() => {}), desk.orchestrator.onStatus(() => {})]) {
      expect(typeof stop).toBe('function');
    }
    expect(await desk.orchestrator.status()).toEqual({ running: false, port: 0, clients: 0 });
  });

  it('crypto est le faux module lui-même, et seul ce module est branché', () => {
    const crypto = fakeCryptoDesk(recordedFixtures, { clock });
    const desk = fakeDeskApi(crypto);
    expect(desk.crypto).toBe(crypto);
    expect(desk.orchestrator).toBe(crypto.orchestrator);
    for (const absent of ['ntbridge', 'copier', 'agentOrders', 'seat', 'llm', 'marketdata', 'mcp', 'calendar', 'zoom', 'locale']) expect(desk, absent).not.toHaveProperty(absent);
  });
});

describe('banc et application', () => {
  const harnessFiles = ['scripts/harness/fakeCryptoDesk.ts', 'scripts/harness/recorded.ts', 'scripts/harness/crypto-harness.tsx', 'scripts/harness/crypto.html'];

  it('rien sous src/ ne charge le banc', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ts|tsx|css|html)$/.test(f));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) expect(readFileSync(`src/${file}`, 'utf8'), file).not.toMatch(/scripts\/harness|crypto-harness|fakeCryptoDesk/);
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/harness/);
  });

  it('le banc n’ouvre aucune connexion : ni fetch, ni socket, ni balise réseau', () => {
    for (const file of harnessFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource|sendBeacon|importScripts/);
    }
  });

  it('la page se limite à son origine : connect-src \'self\', aucune ressource distante', () => {
    const html = readFileSync('scripts/harness/crypto.html', 'utf8');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:\*/);
    expect([...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1] ?? '').filter((u) => /^(?:[a-z]+:)?\/\//i.test(u))).toEqual([]);
    expect(html).toContain('<script type="module" src="/scripts/harness/crypto-harness.tsx"></script>');
  });

  it('la page garde l’événement load ouvert jusqu’à ce que le banc ait fini de composer', () => {
    const html = readFileSync('scripts/harness/crypto.html', 'utf8');
    expect(html).toMatch(/<iframe[^>]*id="capture-hold"/);
    expect(html).toMatch(/contentDocument/);
    expect(html).toMatch(/\.open\(\)/);
    const harness = readFileSync('scripts/harness/crypto-harness.tsx', 'utf8');
    expect(harness).toMatch(/__releaseCapture/);
  });

  it('window.canto est posé avant le premier import de @/lib/desk, qui le lit au chargement', () => {
    const harness = readFileSync('scripts/harness/crypto-harness.tsx', 'utf8');
    const staticImports = [...harness.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1] ?? '');
    expect(staticImports.some((s) => s === '@/lib/desk' || s.startsWith('@/app') || s.startsWith('@/store') || s.startsWith('@/modules'))).toBe(false);
    const fake = readFileSync('scripts/harness/fakeCryptoDesk.ts', 'utf8');
    expect(fake).not.toMatch(/^import\s(?!type\b)[^;]*?'@\/lib\/desk'/ms);
    expect(harness.indexOf('window.canto =')).toBeGreaterThan(0);
    expect(harness.indexOf('window.canto =')).toBeLessThan(harness.indexOf("import('@/app/Shell')"));
  });

  it('monte Shell sur l’onglet crypto, sans le verrou d’ouverture', () => {
    const harness = readFileSync('scripts/harness/crypto-harness.tsx', 'utf8');
    expect(harness).toMatch(/setTab\('crypto'\)/);
    expect(harness).toMatch(/<Shell>/);
    expect(harness).not.toMatch(/Gate|Boot\b/);
  });
});

describe('capture-crypto : le navigateur et ses drapeaux', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' };
  const win = standardBrowserPaths('win32', env);
  const present = (...paths: string[]) => (p: string) => paths.includes(p);

  it('cherche Edge avant Chrome parmi les emplacements standard, sur chaque système', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const { edge, chrome } = standardBrowserPaths(platform, env);
      expect(edge.length, platform).toBeGreaterThan(0);
      expect(chrome.length, platform).toBeGreaterThan(0);
      expect(edge.some((p) => /edge/i.test(p)), platform).toBe(true);
      expect(chrome.some((p) => /chrome|chromium/i.test(p)), platform).toBe(true);
    }
    expect(win.chrome).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(win.edge).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('EDGE_PATH, puis CHROME_PATH, puis les chemins d’Edge, puis ceux de Chrome', () => {
    const e = win.edge[0] ?? '';
    const c = win.chrome[0] ?? '';
    expect(resolveBrowser({ ...env, EDGE_PATH: 'E', CHROME_PATH: 'C' }, present('E', 'C', e, c), 'win32')).toBe('E');
    expect(resolveBrowser({ ...env, CHROME_PATH: 'C' }, present('C', e, c), 'win32')).toBe('C');
    expect(resolveBrowser(env, present(e, c), 'win32')).toBe(e);
    expect(resolveBrowser(env, present(c), 'win32')).toBe(c);
  });

  it('un EDGE_PATH ou un CHROME_PATH qui ne mène à rien est une erreur claire, pas un repli silencieux', () => {
    const c = win.chrome[0] ?? '';
    expect(() => resolveBrowser({ ...env, EDGE_PATH: 'absent' }, present(c), 'win32')).toThrow(/EDGE_PATH/);
    expect(() => resolveBrowser({ ...env, CHROME_PATH: 'absent' }, present(c), 'win32')).toThrow(/CHROME_PATH/);
  });

  it('sans navigateur, l’erreur dit quoi faire', () => {
    expect(() => resolveBrowser(env, present(), 'win32')).toThrow(/EDGE_PATH.*CHROME_PATH|CHROME_PATH.*EDGE_PATH/);
  });

  it('lance exactement les drapeaux du plan, avec un profil jetable', () => {
    expect(PAGE_URL).toBe('http://127.0.0.1:5173/scripts/harness/crypto.html?lang=en');
    expect(browserArgs('/tmp/out.png', '/tmp/profile')).toEqual([
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1600,1000',
      '--user-data-dir=/tmp/profile',
      '--screenshot=/tmp/out.png',
      PAGE_URL,
    ]);
  });

  it('la capture du bas de la colonne ouvre la même page avec scroll=end, et le banc la fait défiler', () => {
    expect(pageUrl(undefined)).toBe(PAGE_URL);
    expect(pageUrl('end')).toBe(`${PAGE_URL}&scroll=end`);
    expect(browserArgs('/tmp/out.png', '/tmp/profile', pageUrl('end')).at(-1)).toBe('http://127.0.0.1:5173/scripts/harness/crypto.html?lang=en&scroll=end');
    expect(readFileSync('scripts/harness/crypto-harness.tsx', 'utf8')).toMatch(/get\('scroll'\) === 'end'/);
  });

  it('écrit par défaut sous docs/design/crypto', () => {
    expect(DEFAULT_OUT.replace(/\\/g, '/')).toMatch(/\/docs\/design\/crypto\/09-cry\.png$/);
    expect(DEFAULT_OUT_COLUMN.replace(/\\/g, '/')).toMatch(/\/docs\/design\/crypto\/09-cry-column\.png$/);
  });
});
