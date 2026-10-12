import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMcpHttp, McpGateway, outputSchemaFor, type McpContext, type McpRelay } from '../electron/mcp-server';
import { DESK_TOOL_KINDS } from '@/engine/agent/catalog';
import { CRYPTO_TOOL_NAMES } from '@/engine/agent/cryptoTools';
import type { CryptoDeskPort } from '@/engine/agent/ports';
import { describedDeskTools, executeDeskTool } from '@/engine/agent/tools';
import type { CryptoBar } from '@/engine/crypto/markets';
import { fakePorts } from './helpers/deskPorts';

/*
 * CRY6.2 : la passerelle MCP ne donne les dix outils `crypto_*` qu'avec l'interrupteur du process principal allumé
 * (`McpContext.cryptoEnabled`, sixième paramètre de `McpGateway`). Éteint ou absent : masqués de `tools/list` et refusés à
 * l'appel, avant le relais, même quand le renderer les décrit. Le faux bureau est le relais du renderer : `desk.describe`
 * (`describedDeskTools({ crypto: true })`) et `executeDeskTool` (source `orch`) sur un port crypto fixe.
 */

const TOKEN = 'jeton-de-test-assez-long-pour-passer';
const NOW = Date.parse('2026-10-12T12:00:00Z');
const BTC = 'coinbase:BTC-USD';

const READS = CRYPTO_TOOL_NAMES.filter((name) => DESK_TOOL_KINDS[name as keyof typeof DESK_TOOL_KINDS] === 'read');
const WRITES = CRYPTO_TOOL_NAMES.filter((name) => DESK_TOOL_KINDS[name as keyof typeof DESK_TOOL_KINDS] === 'write');

const OFF = {
  fr: 'Module crypto éteint dans CΛNTO : le trader l’allume dans l’onglet 09 · CRY.',
  en: 'Crypto module off in CΛNTO: the trader turns it on in tab 09 · CRY.',
  es: 'Módulo cripto apagado en CΛNTO: el trader lo enciende en la pestaña 09 · CRY.',
} as const;

const T0 = Date.UTC(2026, 9, 12, 0, 0) / 1000;
const BARS: CryptoBar[] = Array.from({ length: 12 }, (_, i) => ({ time: T0 + i * 3600, open: 82_000 + i, high: 82_010 + i, low: 81_990 + i, close: 82_005 + i, volume: 3 + i, buyVolume: 1 + i }));

/** Un module crypto allumé, onglet ouvert, chart rempli ; `bare` : onglet fermé, sans relevé, sans alerte (l'autre forme des sorties). */
function cryptoPort(bare = false): CryptoDeskPort {
  const refused = async () => ({ ok: false as const, reason: 'not_ready' });
  return {
    enabled: () => true,
    tabOpen: () => !bare,
    status: () => ({ market: BTC, timeframe: 60, venues: { coinbase: 'live', binance: 'live', bybit: 'off' }, indicators: [], drawings: [], chartError: null }),
    chart: () => (bare ? null : { market: BTC, venue: 'coinbase', timeframe: 60, precision: 2, bars: BARS, indicators: [], cvdAnchoredAt: null }),
    watchlist: () => (bare ? [] : [{ market: BTC, venue: 'coinbase', venueState: 'live', last: 82_016, change24hPct: 1.2, at: NOW - 1_000 }]),
    temperature: () =>
      bare
        ? null
        : {
            funding: { median: 0.0001, btc: 0.0001, symbols: 400, at: NOW - 10_000 },
            breadth: { upShare: 0.4, pairs: 390, at: NOW - 10_000 },
            liquidations: { long: 1_000, short: 2_000, since: NOW - 3_600_000, at: NOW - 1_000, lowerBound: true },
            openInterest: { btc: 0.01, eth: 0.02, at: NOW - 10_000 },
          },
    alerts: () => (bare ? [] : [{ id: 'a1', target: BTC, kind: 'price_above', level: 85_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW - 60_000, evaluable: true }]),
    setChart: refused,
    setIndicator: refused,
    setDrawing: refused,
    setAlert: refused,
    setWatchlist: refused,
  };
}

/** Le relais du renderer : catalogue de `desk.describe` module allumé, appels par `executeDeskTool` ; `calls` garde chaque appel relayé. */
function deskRelay(port: CryptoDeskPort = cryptoPort(), allowWrite = false) {
  const calls: string[] = [];
  const ports = fakePorts({ crypto: () => port, now: () => NOW });
  const relay: McpRelay = {
    tools: async () => describedDeskTools({ crypto: true }),
    call: async (name, args) => {
      calls.push(name);
      return { result: await executeDeskTool(ports, name, args, { source: 'orch', allowWrite }) };
    },
  };
  return { relay, calls };
}

function ctx(over: Partial<McpContext> = {}): McpContext {
  return { token: TOKEN, port: 47118, allowWrites: false, serverVersion: '3.3.4', relay: deskRelay().relay, ...over };
}

const HEADERS = { host: '127.0.0.1:47118', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const rpc = (method: string, params: unknown = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });

type Listed = { name: string; outputSchema?: { type: string; properties: Record<string, unknown>; additionalProperties: boolean } };
type Called = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

async function call(c: McpContext, method: string, params: unknown = {}) {
  const reply = await handleMcpHttp({ method: 'POST', url: '/mcp', headers: HEADERS, body: JSON.stringify(rpc(method, params)) }, c);
  return JSON.parse(reply.body ?? '{}') as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

const listed = async (c: McpContext) => ((await call(c, 'tools/list')).result?.tools ?? []) as Listed[];
const called = async (c: McpContext, name: string, args: Record<string, unknown> = {}) => (await call(c, 'tools/call', { name, arguments: args })).result as Called;
const cryptoNames = (tools: Listed[]) => tools.map((t) => t.name).filter((name) => name.startsWith('crypto_'));

describe('CRY6.2 passerelle MCP · interrupteur crypto éteint', () => {
  it('cryptoEnabled absent ou faux : tools/list sans crypto_*, même quand le desk les décrit et que l’écriture est autorisée', async () => {
    for (const cryptoEnabled of [undefined, false]) {
      for (const allowWrites of [false, true]) {
        const tools = await listed(ctx({ cryptoEnabled, allowWrites }));
        expect(tools.length, `${cryptoEnabled} · ${allowWrites}`).toBeGreaterThan(0);
        expect(cryptoNames(tools), `${cryptoEnabled} · ${allowWrites}`).toEqual([]);
        // Le reste du catalogue ne bouge pas : desk_overview reste, create_note suit l'autorisation d'écrire.
        expect(tools.map((t) => t.name)).toContain('desk_overview');
        expect(tools.map((t) => t.name).includes('create_note')).toBe(allowWrites);
      }
    }
  });

  it('tools/call de crypto_status : isError avec le message, en trois langues, sans relayer l’appel', async () => {
    for (const locale of ['fr', 'en', 'es'] as const) {
      const { relay, calls } = deskRelay();
      const out = await called(ctx({ relay, locale }), 'crypto_status');
      expect(out.isError, locale).toBe(true);
      expect(out.content, locale).toEqual([{ type: 'text', text: OFF[locale] }]);
      expect(out.structuredContent).toBeUndefined();
      expect(calls, locale).toEqual([]);
    }
  });

  it('chaque outil crypto, lecture comme écriture, est refusé par ce message ; écriture autorisée ou non, cryptoEnabled faux ou absent', async () => {
    for (const cryptoEnabled of [undefined, false]) {
      for (const allowWrites of [false, true]) {
        for (const name of CRYPTO_TOOL_NAMES) {
          const { relay, calls } = deskRelay(cryptoPort(), true);
          const out = await called(ctx({ relay, cryptoEnabled, allowWrites, locale: 'en' }), name, name === 'crypto_chart_set' ? { market: BTC } : {});
          expect(out.isError, `${name} · ${cryptoEnabled} · ${allowWrites}`).toBe(true);
          expect(out.content[0]?.text, name).toBe(OFF.en);
          expect(calls, name).toEqual([]);
        }
      }
    }
  });

  it('un nom crypto hors catalogue reste un outil inconnu ; un outil hors crypto passe comme avant', async () => {
    const unknown = await call(ctx({ locale: 'en' }), 'tools/call', { name: 'crypto_unknown', arguments: {} });
    expect(unknown.error?.code).toBe(-32602);
    expect(unknown.error?.message).toMatch(/Unknown tool: crypto_unknown/);
    const { relay, calls } = deskRelay();
    const overview = await called(ctx({ relay }), 'desk_overview');
    expect(overview.isError).toBeUndefined();
    expect(calls).toEqual(['desk_overview']);
  });
});

describe('CRY6.2 passerelle MCP · interrupteur crypto allumé', () => {
  it('les cinq lectures listées avec leur outputSchema ; crypto_status répond sans erreur', async () => {
    const tools = await listed(ctx({ cryptoEnabled: true }));
    expect(cryptoNames(tools)).toEqual(READS);
    expect(READS).toEqual(['crypto_status', 'crypto_chart_read', 'crypto_watchlist_get', 'crypto_temperature', 'crypto_alert_list']);
    for (const name of READS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.outputSchema, name).toEqual(outputSchemaFor(name));
      expect(Object.keys(tool?.outputSchema?.properties ?? {}).length, name).toBeGreaterThan(0);
    }
    const status = await called(ctx({ cryptoEnabled: true }), 'crypto_status');
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({ tabOpen: true, market: BTC, timeframe: 60, venues: { coinbase: 'live', binance: 'live', bybit: 'off' } });
  });

  it('chaque lecture rend les clés de sa tête de sortie, onglet ouvert comme fermé et sans relevé', async () => {
    const missing: string[] = [];
    for (const bare of [false, true]) {
      const { relay, calls } = deskRelay(cryptoPort(bare));
      const c = ctx({ relay, cryptoEnabled: true });
      const tools = await listed(c);
      for (const name of READS) {
        const out = await called(c, name);
        expect(out.isError, `${name} · ${bare}`).toBeUndefined();
        const heads = Object.keys(tools.find((t) => t.name === name)?.outputSchema?.properties ?? {});
        for (const key of heads) if (!Object.hasOwn(out.structuredContent ?? {}, key)) missing.push(`${name} · ${bare} · ${key}`);
      }
      expect(calls).toEqual(READS);
    }
    expect(missing).toEqual([]);
  });

  it('allowWrites faux : aucune écriture crypto listée, et l’appel est refusé comme toute écriture ; vrai : les cinq écritures listées', async () => {
    expect(cryptoNames(await listed(ctx({ cryptoEnabled: true, allowWrites: false })))).toEqual(READS);
    const { relay, calls } = deskRelay();
    const refused = await called(ctx({ relay, cryptoEnabled: true, allowWrites: false, locale: 'en' }), 'crypto_chart_set', { market: BTC });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/Writing is disabled/);
    expect(calls).toEqual([]);
    const open = await listed(ctx({ cryptoEnabled: true, allowWrites: true }));
    expect(cryptoNames(open)).toEqual([...READS, ...WRITES]);
    for (const name of WRITES) expect(open.find((t) => t.name === name)?.outputSchema, name).toBeUndefined();
  });

  it('écriture autorisée des deux côtés : l’écriture crypto est relayée au desk, qui rend le refus de son port', async () => {
    const { relay, calls } = deskRelay(cryptoPort(), true);
    const out = await called(ctx({ relay, cryptoEnabled: true, allowWrites: true }), 'crypto_chart_set', { market: BTC });
    expect(calls).toEqual(['crypto_chart_set']);
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0]!.text.slice(out.content[0]!.text.indexOf('{')))).toEqual({ ok: false, reason: 'not_ready' });
  });
});

describe('CRY6.2 McpGateway · sixième paramètre', () => {
  const gateways: McpGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((g) => g.stop()));
  });

  async function open(gw: McpGateway) {
    gateways.push(gw);
    const { port } = await gw.start(0, false);
    const conn = (await gw.connection())!;
    return async (method: string, params: unknown = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(rpc(method, params)),
      });
      return ((await res.json()) as { result: { tools?: Listed[] } & Partial<Called> }).result;
    };
  }

  it('sans sixième paramètre, la passerelle reste éteinte côté crypto', async () => {
    const post = await open(new McpGateway(mkdtempSync(path.join(tmpdir(), 'canto-cry-')), deskRelay().relay, '3.3.4'));
    expect(cryptoNames((await post('tools/list')).tools ?? [])).toEqual([]);
    const out = await post('tools/call', { name: 'crypto_status', arguments: {} });
    expect(out.isError).toBe(true);
    expect(out.content?.[0]?.text).toBe(OFF.fr);
  });

  it('l’interrupteur est relu à chaque requête : éteint, allumé, éteint', async () => {
    let on = false;
    const { relay } = deskRelay();
    const post = await open(new McpGateway(mkdtempSync(path.join(tmpdir(), 'canto-cry-')), relay, '3.3.4', undefined, () => 'en', () => on));
    expect(cryptoNames((await post('tools/list')).tools ?? [])).toEqual([]);
    expect((await post('tools/call', { name: 'crypto_status', arguments: {} })).content?.[0]?.text).toBe(OFF.en);
    on = true;
    expect(cryptoNames((await post('tools/list')).tools ?? [])).toEqual(READS);
    const status = await post('tools/call', { name: 'crypto_status', arguments: {} });
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({ market: BTC });
    on = false;
    expect(cryptoNames((await post('tools/list')).tools ?? [])).toEqual([]);
  });

  it('le process principal passe l’interrupteur du runtime crypto à la passerelle', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const construction = main.slice(main.indexOf('new McpGateway('), main.indexOf('return mcp;'));
    expect(construction).toContain('() => cryptoRuntime?.enabled() ?? false');
  });
});
