import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeskRelay, MCP_CLIENT_ID, mcpRelay } from '../electron/desk-relay';
import { McpGateway } from '../electron/mcp-server';
import type { DeskPorts } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind, toolSchemas } from '@/engine/agent/tools';
import { coerceSettings, DEFAULT_SETTINGS, pickRestorableSettings } from '@/store/settings';

type Req = { id: string; clientId: string; method: string; params: unknown };

describe('relais main → renderer', () => {
  it('pose la question avec le clientId mcp et rend la réponse du renderer', async () => {
    const sent: Req[] = [];
    const relay = new DeskRelay((req) => {
      sent.push(req);
      return true;
    });
    const pending = relay.ask('tool.desk_overview', { a: 1 });
    expect(sent[0]).toMatchObject({ clientId: MCP_CLIENT_ID, method: 'tool.desk_overview', params: { a: 1 } });
    expect(relay.settle(sent[0]!.id, { ok: true })).toBe(true);
    expect(await pending).toEqual({ result: { ok: true }, error: undefined });
    expect(relay.settle(sent[0]!.id, 'deux fois')).toBe(false);
  });

  it('fenêtre fermée ou renderer muet : une erreur lisible, jamais une attente sans fin', async () => {
    expect(await new DeskRelay(() => false).ask('desk.describe', {})).toMatchObject({ result: null, error: expect.stringMatching(/indisponible/) });
    expect(await new DeskRelay(() => true, 20).ask('desk.describe', {})).toMatchObject({ result: null, error: expect.stringMatching(/délai/) });
  });

  it('catalogue : entrées invalides écartées, gardé quelques secondes', async () => {
    let asked = 0;
    let t = 0;
    const relay = new DeskRelay((req) => {
      asked++;
      queueMicrotask(() =>
        relay.settle(req.id, { tools: [{ name: 'desk_overview', description: 'd', parameters: { type: 'object' }, kind: 'read' }, { name: 'sans_kind', description: 'd', parameters: {} }] }),
      );
      return true;
    });
    const r = mcpRelay(relay, 5_000, () => t);
    expect((await r.tools()).map((x) => x.name)).toEqual(['desk_overview']);
    await r.tools();
    expect(asked).toBe(1);
    t = 6_000;
    await r.tools();
    expect(asked).toBe(2);
  });
});

/** Renderer simulé : le même contrat que `useAgent.load` (desk.describe, tool.<nom> par executeDeskTool, source orch). */
function fakeRenderer(ports: DeskPorts, allowWrite: () => boolean) {
  const relay: DeskRelay = new DeskRelay((req) => {
    queueMicrotask(async () => {
      if (req.method === 'desk.describe') {
        relay.settle(req.id, { tools: toolSchemas().map((t) => ({ ...t, kind: toolKind(t.name) })) });
        return;
      }
      const result = await executeDeskTool(ports, req.method.replace(/^tool\./, ''), (req.params as Record<string, unknown>) ?? {}, { source: 'orch', allowWrite: allowWrite() });
      const rec = result as { reason?: string; error?: string };
      relay.settle(req.id, result, rec.reason === 'write_disabled' ? 'Écriture désactivée' : rec.error);
    });
    return true;
  });
  return relay;
}

describe('de bout en bout : HTTP MCP → main → renderer → outil du desk', () => {
  const gateways: McpGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((g) => g.stop()));
  });

  const notes: string[] = [];
  const ports: DeskPorts = {
    sessions: () => [],
    trades: () => [],
    startingBalance: () => 50_000,
    planId: () => 'topstep-50',
    planAccount: () => '',
    updateSession: async () => undefined,
    notes: () => [],
    createNote: async (title) => {
      notes.push(title);
      return { id: 'n1', title };
    },
    branchNote: async () => null,
    linkNotes: async () => null,
    calendarEntries: () => [],
    officialEvents: () => [],
    bridge: async () => ({ nt: null, copier: null }),
    workingOrders: async () => null,
    portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
    barSeries: async () => [],
    events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
    proposeOrder: async () => ({ ok: false, status: 'refused', reason: 'disabled', detail: '' }),
  };

  it('lecture libre ; écriture seulement si le desk l’autorise, côté main comme côté renderer', async () => {
    let allow = false;
    const gw = new McpGateway(mkdtempSync(path.join(tmpdir(), 'canto-e2e-')), mcpRelay(fakeRenderer(ports, () => allow)), '3.3.4');
    gateways.push(gw);
    const { port } = await gw.start(0, false);
    const conn = (await gw.connection())!;
    const rpc = async (method: string, params: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return ((await res.json()) as { result: { tools?: { name: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> } }).result;
    };

    const list = await rpc('tools/list', {});
    expect(list.tools?.map((t) => t.name)).toContain('desk_overview');
    expect(list.tools?.map((t) => t.name)).not.toContain('create_note');
    const overview = await rpc('tools/call', { name: 'desk_overview', arguments: {} });
    expect(overview.isError).toBeUndefined();
    expect(overview.structuredContent).toMatchObject({ sessions: 0, plan: { id: 'topstep-50' } });

    const refused = await rpc('tools/call', { name: 'create_note', arguments: { title: 'T', body: 'B' } });
    expect(refused.isError).toBe(true);
    expect(notes).toEqual([]);

    allow = true;
    await gw.start(port, true);
    const written = await rpc('tools/call', { name: 'create_note', arguments: { title: 'Revue', body: 'B' } });
    expect(written.isError).toBeUndefined();
    expect(notes).toEqual(['Revue']);
  });
});

describe('réglages de la passerelle', () => {
  it('fermée par défaut, port borné, jamais restaurée depuis un coffre', () => {
    expect(DEFAULT_SETTINGS.mcpEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.mcpPort).toBe(47118);
    expect(coerceSettings({ mcpPort: 80, mcpEnabled: 'oui' }, DEFAULT_SETTINGS)).toMatchObject({ mcpPort: 47118, mcpEnabled: false });
    expect(pickRestorableSettings({ mcpEnabled: true, mcpPort: 50000, callsign: 'OP' })).toEqual({ callsign: 'OP' });
  });
});
