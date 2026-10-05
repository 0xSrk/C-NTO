import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '3.3.4' },
}));

import { WebSocket } from 'ws';
import { executionFill } from '../electron/nt-bridge/execution-csv';
import type { ExecutionPayload } from '../electron/nt-bridge/protocol';
import { BROADCAST_MAX_BYTES, Orchestrator } from '../electron/orchestrator';

function nextMessage(ws: WebSocket, method: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (msg.method !== method) return;
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

describe('événements poussés par l’orchestrateur', () => {
  const orch = new Orchestrator();
  afterEach(() => orch.stop());

  it('desk.event aux clients authentifiés ; type inconnu ou trame trop grosse refusés', async () => {
    const { port } = await orch.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(orch.copyToken())}`);
    await nextMessage(ws, 'desk.hello');
    const anon = new WebSocket(`ws://127.0.0.1:${port}/`);
    await nextMessage(anon, 'desk.hello');
    const anonSeen: unknown[] = [];
    anon.on('message', (raw) => anonSeen.push(JSON.parse(raw.toString())));

    expect(orch.broadcast('order.submit', {})).toBe(false);
    expect(orch.broadcast('fill', { pad: 'x'.repeat(BROADCAST_MAX_BYTES) })).toBe(false);
    const got = nextMessage(ws, 'desk.event');
    expect(orch.broadcast('fill', { seq: 1, data: { instrument: 'NQ 12-26' } })).toBe(true);
    const msg = (await got) as { params: { event: string; payload: { seq: number }; at: number } };
    expect(msg.params.event).toBe('fill');
    expect(msg.params.payload.seq).toBe(1);
    expect(typeof msg.params.at).toBe('number');
    await new Promise((r) => setTimeout(r, 50));
    expect(anonSeen.filter((m) => (m as { method?: string }).method === 'desk.event')).toEqual([]);
    ws.close();
    anon.close();
  });

  it('le fill transmis au renderer ne porte ni identifiant d’ordre ni connexion', () => {
    const row: ExecutionPayload = { instrument: 'NQ 12-26', action: 'Buy', quantity: 1, price: 21_000, time: 1, id: 'x1', entryExit: 'Entry', position: '1 L', orderId: 'o9', name: 'Entry', commission: 1.2, rate: 1, account: 'Sim101', connection: 'Rithmic' };
    expect(executionFill(row)).toEqual({ account: 'Sim101', instrument: 'NQ 12-26', action: 'Buy', quantity: 1, price: 21_000, time: 1, entryExit: 'Entry' });
  });
});

describe('collecte des événements dans le desk', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fill, lien du pont, marge prop et catalyseur rangés et poussés', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 2, 12, 20));
    const pushed: [string, { seq: number; cursor: string; data: Record<string, unknown> }][] = [];
    let onExecution: ((p: unknown) => void) | null = null;
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        orchestrator: { broadcast: (event: string, payload: never) => pushed.push([event, payload]) },
        ntbridge: {
          onExecution: (cb: (p: unknown) => void) => {
            onExecution = cb;
            return () => (onExecution = null);
          },
        },
      },
    });
    vi.resetModules();
    const { useDeskEvents, deskEventLog, PROP_THROTTLE_MS, CATALYST_TICK_MS } = await import('@/store/deskEvents');
    const { useBridge } = await import('@/store/bridge');
    const { useJournal } = await import('@/store/journal');
    const { useMacro } = await import('@/store/macro');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');

    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'PA-1' } });
    useJournal.setState({ sessions: [], trades: [] });
    useMacro.setState({ events: [{ id: 'bls:nfp', sourceId: 'bls', date: '2026-10-02', timeET: '08:30', title: 'Employment Situation', category: 'emploi', impact: 3, instruments: [], estimated: false, syncedAt: 0 }] });
    const nt = (link: 'live' | 'lost', unrealizedPnl = 0) => ({ link, addonVersion: '2.1.1', accounts: [{ name: 'PA-1', cashValue: 50_000, realizedPnl: 0, unrealizedPnl, positions: [] }] }) as never;
    useBridge.setState({ nt: nt('live') });

    const stop = useDeskEvents.getState().start();
    expect(useDeskEvents.getState().start()).toBe(stop);
    // Catalyseur : NFP à 08:30 New York, il est 08:20.
    expect(pushed.map(([k, p]) => [k, p.data.title])).toEqual([['catalyst', 'Employment Situation']]);
    await vi.advanceTimersByTimeAsync(CATALYST_TICK_MS);
    expect(pushed.filter(([k]) => k === 'catalyst')).toHaveLength(1);

    // Fill reçu du pont.
    onExecution!({ csv: '', executionId: 'x1', fill: { account: 'PA-1', instrument: 'NQ 12-26', action: 'Sell', quantity: 1, price: 21_000, time: Date.now() } });
    expect(pushed.at(-1)?.[0]).toBe('fill');

    // Marge : premier rejeu silencieux, puis latent −1300 sur 2500 → sous 50 %, puis séance −700 → sous 25 %.
    await vi.advanceTimersByTimeAsync(PROP_THROTTLE_MS);
    expect(pushed.filter(([k]) => k === 'prop_buffer')).toEqual([]);
    useBridge.setState({ nt: nt('live', -1300) });
    await vi.advanceTimersByTimeAsync(PROP_THROTTLE_MS);
    useJournal.setState({ sessions: [{ id: 's1', date: '2026-10-01', account: 'PA-1', instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl: -700, grossProfit: 0, grossLoss: -700, commission: 0, tags: [], createdAt: 0, updatedAt: 0 }] });
    await vi.advanceTimersByTimeAsync(PROP_THROTTLE_MS);
    expect(pushed.filter(([k]) => k === 'prop_buffer').map(([, p]) => [p.data.threshold, p.data.liveBuffer])).toEqual([
      [0.5, 1200],
      [0.25, 500],
    ]);

    // Lien perdu.
    useBridge.setState({ nt: nt('lost', -1300) });
    expect(pushed.at(-1)).toMatchObject(['bridge_link', { data: { from: 'live', to: 'lost' } }]);

    const page = deskEventLog.read({ cursor: `${deskEventLog.epoch}.0` });
    expect(page.events.map((e) => e.kind)).toEqual(['catalyst', 'fill', 'prop_buffer', 'prop_buffer', 'bridge_link']);
    expect(pushed.map(([, p]) => p.cursor)).toEqual(page.events.map((e) => `${deskEventLog.epoch}.${e.seq}`));
    expect(useDeskEvents.getState().count).toBe(5);

    stop();
    expect(useDeskEvents.getState().running).toBe(false);
    expect(onExecution).toBeNull();
  });
});
