import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMcpHttp, loadOrCreateToken, McpGateway, MCP_PROTOCOL_VERSIONS, type McpContext, type McpRelay, type McpToolInfo } from '../electron/mcp-server';

const TOKEN = 'jeton-de-test-assez-long-pour-passer';
const TOOLS: McpToolInfo[] = [
  { name: 'desk_overview', description: 'Vue d’ensemble', parameters: { type: 'object', properties: {}, additionalProperties: false }, kind: 'read' },
  { name: 'create_note', description: 'Crée une note', parameters: { type: 'object', properties: { title: { type: 'string' } } }, kind: 'write' },
  { name: 'annotate_session', description: 'Annote', parameters: { type: 'object', properties: {} }, kind: 'write' },
];

function relay(calls: { name: string; args: unknown }[] = [], answer: (name: string) => { result: unknown; error?: string } = () => ({ result: { netPnl: 1250 } })): McpRelay {
  return {
    tools: async () => TOOLS,
    call: async (name, args) => {
      calls.push({ name, args });
      return answer(name);
    },
  };
}

function ctx(over: Partial<McpContext> = {}): McpContext {
  return { token: TOKEN, port: 47118, allowWrites: false, serverVersion: '3.3.4', relay: relay(), ...over };
}

const HEADERS = { host: '127.0.0.1:47118', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

function post(body: unknown, headers: Record<string, string | undefined> = {}) {
  return { method: 'POST', url: '/mcp', headers: { ...HEADERS, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

const rpc = (method: string, params: unknown = {}, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params });

async function result(reply: { body?: string }) {
  return JSON.parse(reply.body ?? '{}') as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

describe('passerelle MCP · garde-fous HTTP', () => {
  it('refuse sans jeton, avec un mauvais jeton, depuis un navigateur ou un autre hôte', async () => {
    expect((await handleMcpHttp(post(rpc('ping'), { authorization: undefined }), ctx())).status).toBe(401);
    const wrong = await handleMcpHttp(post(rpc('ping'), { authorization: 'Bearer faux' }), ctx());
    expect(wrong.status).toBe(401);
    expect(wrong.headers['WWW-Authenticate']).toMatch(/^Bearer/);
    expect((await handleMcpHttp(post(rpc('ping'), { origin: 'https://evil.example' }), ctx())).status).toBe(403);
    expect((await handleMcpHttp(post(rpc('ping'), { host: 'evil.example:47118' }), ctx())).status).toBe(403);
    expect((await handleMcpHttp({ ...post(rpc('ping')), url: '/autre' }, ctx())).status).toBe(404);
  });

  it('le jeton passe avant la taille : un inconnu ne fait jamais lire un gros corps', async () => {
    expect((await handleMcpHttp(post(rpc('ping'), { authorization: undefined, 'content-length': '99999999' }), ctx())).status).toBe(401);
    expect((await handleMcpHttp(post(rpc('ping'), { 'content-length': '99999999' }), ctx())).status).toBe(413);
  });

  it('sans état : GET et DELETE rendent 405, un lot est refusé, une notification reçoit 202', async () => {
    expect((await handleMcpHttp({ ...post(''), method: 'GET' }, ctx())).status).toBe(405);
    expect((await handleMcpHttp({ ...post(''), method: 'DELETE' }, ctx())).status).toBe(405);
    expect((await handleMcpHttp(post([rpc('ping')]), ctx())).status).toBe(400);
    const notif = await handleMcpHttp(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), ctx());
    expect(notif).toEqual({ status: 202, headers: {} });
    expect((await handleMcpHttp(post('{pas du json'), ctx())).status).toBe(400);
    expect((await handleMcpHttp(post(rpc('ping'), { 'content-type': 'text/plain' }), ctx())).status).toBe(415);
    expect((await handleMcpHttp(post(rpc('ping'), { 'mcp-protocol-version': '1999-01-01' }), ctx())).status).toBe(400);
  });
});

describe('passerelle MCP · protocole', () => {
  it('initialize : version du client si connue, sinon la plus récente ; capacité tools seulement', async () => {
    const known = await result(await handleMcpHttp(post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })), ctx()));
    expect(known.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'canto', version: '3.3.4' } });
    expect(typeof known.result?.instructions).toBe('string');
    const unknown = await result(await handleMcpHttp(post(rpc('initialize', { protocolVersion: '2099-01-01' })), ctx()));
    expect(unknown.result?.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it('tools/list : les écritures sont masquées tant qu’elles ne sont pas autorisées', async () => {
    const off = await result(await handleMcpHttp(post(rpc('tools/list')), ctx()));
    const names = (off.result?.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(['desk_overview']);
    const on = await result(await handleMcpHttp(post(rpc('tools/list')), ctx({ allowWrites: true })));
    const tools = on.result?.tools as { name: string; inputSchema: unknown; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name)).toEqual(['desk_overview', 'create_note', 'annotate_session']);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tools[1]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tools[2]?.annotations.destructiveHint).toBe(true);
    expect(tools[0]?.inputSchema).toEqual(TOOLS[0]?.parameters);
  });

  it('tools/call : relaie au desk, rend texte et contenu structuré', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const out = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'desk_overview', arguments: { x: 1 } })), ctx({ relay: relay(calls) })));
    expect(calls).toEqual([{ name: 'desk_overview', args: { x: 1 } }]);
    expect(out.result).toEqual({ content: [{ type: 'text', text: '{"netPnl":1250}' }], structuredContent: { netPnl: 1250 } });
  });

  it('tools/call : écriture non autorisée refusée sans atteindre le desk ; outil inconnu = erreur de protocole', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const denied = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'create_note', arguments: { title: 'x' } })), ctx({ relay: relay(calls) })));
    expect(denied.result).toMatchObject({ isError: true });
    expect(calls).toEqual([]);
    const unknown = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'place_order' })), ctx()));
    expect(unknown.error?.code).toBe(-32602);
  });

  it('tools/call : un refus du desk ou un desk muet devient isError, pas une erreur de protocole', async () => {
    const refused = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'desk_overview' })), ctx({ relay: relay([], () => ({ result: { ok: false, reason: 'write_disabled' } })) })));
    expect(refused.result).toMatchObject({ isError: true });
    const silent = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'desk_overview' })), ctx({ relay: relay([], () => ({ result: null, error: 'Desk indisponible' })) })));
    expect(silent.result).toEqual({ content: [{ type: 'text', text: 'Desk indisponible' }], isError: true });
  });

  it('desk fermé (catalogue vide) : isError lisible, pas « outil inconnu »', async () => {
    const closed: McpRelay = { tools: async () => [], call: async () => ({ result: null }) };
    const out = await result(await handleMcpHttp(post(rpc('tools/call', { name: 'desk_overview' })), ctx({ relay: closed })));
    expect(out.error).toBeUndefined();
    expect(out.result).toMatchObject({ isError: true });
    expect(JSON.stringify(out.result)).toMatch(/indisponible/);
  });

  it('méthode inconnue : -32601', async () => {
    const out = await result(await handleMcpHttp(post(rpc('resources/list')), ctx()));
    expect(out.error?.code).toBe(-32601);
  });
});

describe('passerelle MCP · serveur', () => {
  const gateways: McpGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((g) => g.stop()));
  });

  it('jeton persistant en 0600, stable d’un lancement à l’autre, renouvelable', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-mcp-'));
    const first = await loadOrCreateToken(dir);
    expect(await loadOrCreateToken(dir)).toBe(first);
    if (process.platform !== 'win32') expect(statSync(path.join(dir, 'mcp-token.json')).mode & 0o777).toBe(0o600);
    const gw = new McpGateway(dir, relay(), '3.3.4');
    gateways.push(gw);
    await gw.rotateToken();
    expect((await gw.connection())?.token).not.toBe(first);
    expect(JSON.stringify(gw.status())).not.toContain(readFileSync(path.join(dir, 'mcp-token.json'), 'utf8').slice(10, 30));
  });

  it('échange HTTP réel sur 127.0.0.1 : initialize puis tools/call', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-mcp-'));
    const statuses: number[] = [];
    const gw = new McpGateway(dir, relay(), '3.3.4', (s) => statuses.push(s.calls));
    gateways.push(gw);
    const st = await gw.start(0);
    expect(st.running).toBe(true);
    const conn = await gw.connection();
    expect(conn?.url).toBe(`http://127.0.0.1:${st.port}/mcp`);
    const call = (body: unknown) =>
      fetch(conn!.url, { method: 'POST', headers: { authorization: `Bearer ${conn!.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    const init = await call(rpc('initialize', { protocolVersion: '2025-11-25' }));
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-11-25');
    const out = await call(rpc('tools/call', { name: 'desk_overview' }, 2));
    expect(((await out.json()) as { result: { structuredContent: unknown } }).result.structuredContent).toEqual({ netPnl: 1250 });
    expect(gw.status().calls).toBe(2);
    const big = await fetch(conn!.url, { method: 'POST', headers: { authorization: `Bearer ${conn!.token}`, 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 10) });
    expect(big.status).toBe(413);
    await gw.stop();
    expect(gw.status().running).toBe(false);
  });
});
