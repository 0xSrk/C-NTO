import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '3.6.0' },
}));

import type { BrowserWindow } from 'electron';
import { WebSocket } from 'ws';
import { Orchestrator } from '../electron/orchestrator';

interface Frame {
  id?: string | number | null;
  method?: string;
  result?: { tools?: { name: string }[] } & Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

interface Forwarded {
  id: string;
  clientId: string;
  method: string;
}

/** Ouvre une connexion authentifiée ; `next()` rend la trame suivante, `desk.hello` à part. */
function connect(url: string): Promise<{ ws: WebSocket; clientId: () => string; next: () => Promise<Frame> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: Frame[] = [];
    const waiters: ((frame: Frame) => void)[] = [];
    let clientId = '';
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame & { params?: { clientId?: string } };
      if (frame.method === 'desk.hello') {
        clientId = frame.params?.clientId ?? '';
        resolve({
          ws,
          clientId: () => clientId,
          next: () =>
            new Promise((done) => {
              const queued = frames.shift();
              if (queued) done(queued);
              else waiters.push(done);
            }),
        });
        return;
      }
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    });
    ws.once('error', reject);
  });
}

/** Une fenêtre du desk simulée : chaque `orch:request` relayé au renderer est gardé. */
function deskWindow(): { win: BrowserWindow; forwarded: Forwarded[] } {
  const forwarded: Forwarded[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: Forwarded) => {
        if (channel === 'orch:request') forwarded.push(payload);
      },
    },
  } as unknown as BrowserWindow;
  return { win, forwarded };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

/** Ce que le renderer décrirait avec le module allumé de son côté. */
const DESCRIBED = { artefact: 'CΛNTO', version: '3.6.0', tools: [{ name: 'desk_overview' }, { name: 'crypto_status' }, { name: 'crypto_chart_set' }, { name: 'create_note' }] };

describe('orchestrateur · interrupteur crypto relu dans le process principal', () => {
  let orch: Orchestrator | null = null;
  afterEach(() => {
    orch?.stop();
    orch = null;
  });

  async function open(cryptoOn: () => boolean, allowWrites = true) {
    orch = new Orchestrator(() => 'fr', cryptoOn);
    const desk = deskWindow();
    orch.attach(desk.win);
    const { port } = await orch.start(0, allowWrites);
    const client = await connect(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(orch.copyToken())}`);
    return { orch, client, forwarded: desk.forwarded };
  }

  it('module éteint : un appel crypto_*, lecture comme écriture, avec ou sans « tool. », est refusé sans atteindre le renderer', async () => {
    const { client, forwarded } = await open(() => false);
    for (const [id, method] of [
      [1, 'tool.crypto_status'],
      [2, 'crypto_chart_read'],
      [3, 'tool.crypto_chart_set'],
      [4, 'crypto_alert_set'],
    ] as const) {
      client.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: {} }));
      const frame = await client.next();
      expect(frame.id, method).toBe(id);
      expect(frame.error, method).toEqual({
        code: -32000,
        message: 'Module crypto éteint dans CΛNTO : le trader l’allume dans l’onglet 09 · CRY.',
        data: { ok: false, reason: 'crypto_disabled' },
      });
    }
    // Les autres outils passent toujours.
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tool.desk_overview' }));
    await tick();
    expect(forwarded.map((r) => r.method)).toEqual(['tool.desk_overview']);
    client.ws.close();
  });

  it('module éteint : desk.describe ne sert aucun crypto_*, même si le renderer les décrit', async () => {
    const { orch: o, client, forwarded } = await open(() => false);
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'd1', method: 'desk.describe' }));
    await tick();
    const [req] = forwarded;
    expect(req?.method).toBe('desk.describe');
    o.respond(req!.id, req!.clientId, DESCRIBED);
    const frame = await client.next();
    expect(frame.id).toBe('d1');
    expect(frame.result?.tools?.map((t) => t.name)).toEqual(['desk_overview', 'create_note']);
    expect(frame.result).toMatchObject({ artefact: 'CΛNTO', version: '3.6.0' });
    client.ws.close();
  });

  it('module éteint : un appel au même id que le desk.describe ne fait pas passer la liste crypto', async () => {
    const { orch: o, client, forwarded } = await open(() => false);
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'desk.describe' }));
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tool.desk_overview' }));
    await tick();
    const describe = forwarded.find((r) => r.method === 'desk.describe')!;
    const overview = forwarded.find((r) => r.method === 'tool.desk_overview')!;
    // L'appel est rendu d'abord, la description ensuite : elle est filtrée quand même.
    o.respond(overview.id, overview.clientId, { sessions: 3 });
    o.respond(describe.id, describe.clientId, DESCRIBED);
    const first = await client.next();
    const second = await client.next();
    expect(first.result).toEqual({ sessions: 3 });
    expect(second.result?.tools?.map((t) => t.name)).toEqual(['desk_overview', 'create_note']);
    client.ws.close();
  });

  it('module allumé : les appels crypto_* sont relayés et desk.describe les garde ; l’interrupteur est relu à chaque requête', async () => {
    let on = true;
    const { orch: o, client, forwarded } = await open(() => on);
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tool.crypto_status' }));
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'desk.describe' }));
    await tick();
    expect(forwarded.map((r) => r.method)).toEqual(['tool.crypto_status', 'desk.describe']);
    o.respond(forwarded[1]!.id, forwarded[1]!.clientId, DESCRIBED);
    expect((await client.next()).result?.tools?.map((t) => t.name)).toEqual(['desk_overview', 'crypto_status', 'crypto_chart_set', 'create_note']);

    on = false;
    client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tool.crypto_status' }));
    expect((await client.next()).error?.data).toEqual({ ok: false, reason: 'crypto_disabled' });
    expect(forwarded).toHaveLength(2);
    client.ws.close();
  });

  it('refus dans la langue du desk', async () => {
    for (const [locale, message] of [
      ['en', 'Crypto module off in CΛNTO: the trader turns it on in tab 09 · CRY.'],
      ['es', 'Módulo cripto apagado en CΛNTO: el trader lo enciende en la pestaña 09 · CRY.'],
    ] as const) {
      orch = new Orchestrator(() => locale, () => false);
      orch.attach(deskWindow().win);
      const { port } = await orch.start(0);
      const client = await connect(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(orch.copyToken())}`);
      client.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'crypto_status' }));
      expect((await client.next()).error?.message).toBe(message);
      client.ws.close();
      orch.stop();
    }
  });

  it('le process principal passe l’interrupteur du runtime crypto à l’orchestrateur, comme à la passerelle', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const start = main.indexOf('new Orchestrator(');
    const construction = main.slice(start, main.indexOf(';\n', start));
    expect(construction).toContain('() => cryptoRuntime?.enabled() ?? false');
  });
});
