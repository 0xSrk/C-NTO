import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.1.2' },
}));

import { WebSocket } from 'ws';
import { Orchestrator } from '../electron/orchestrator';

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout'));
    }, 2000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('unexpected-response', () => {
      clearTimeout(timer);
      reject(new Error('rejected'));
    });
    ws.once('error', () => {
      /* la fermeture ou unexpected-response suit */
    });
  });
}

describe('orchestrateur · slots', () => {
  let orch = new Orchestrator();

  afterEach(() => {
    orch.stop();
    orch = new Orchestrator();
  });

  it('ferme un mauvais jeton sans occuper un slot', async () => {
    const { port } = await orch.start(0);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/?token=nope`);
    const code = await new Promise<number>((resolve) => bad.once('close', (c) => resolve(c)));
    expect(code).toBe(1008);
    expect(orch.status().clients).toBe(0);
    const good = await openSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(orch.copyToken())}`);
    expect(orch.status().clients).toBe(1);
    good.close();
  });

  it('n’établit pas plus de 8 connexions sur 10 en parallèle', async () => {
    const { port } = await orch.start(0);
    const token = encodeURIComponent(orch.copyToken());
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        openSocket(`ws://127.0.0.1:${port}/?token=${token}`).then(
          (ws) => ({ ok: true as const, ws }),
          () => ({ ok: false as const, ws: null }),
        ),
      ),
    );
    const open = results.filter((r) => r.ok);
    expect(open.length).toBe(8);
    expect(orch.status().clients).toBeLessThanOrEqual(8);
    for (const r of open) r.ws?.close();
  });

  it('ferme une authentification différée au bout de 5 s', async () => {
    const { port } = await orch.start(0);
    const ws = await openSocket(`ws://127.0.0.1:${port}/`);
    expect(orch.status().clients).toBe(1);
    const code = await new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
    expect(code).toBe(1008);
    await vi.waitFor(() => expect(orch.status().clients).toBe(0));
  }, 8_000);
});
