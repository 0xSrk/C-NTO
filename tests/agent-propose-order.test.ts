import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskRelay, mcpRelay, ORDER_RELAY_TIMEOUT_MS } from '../electron/desk-relay';
import { ORDER_TOOLS } from '@/engine/agent/catalog';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind, toolSchemas } from '@/engine/agent/tools';
import { fakePorts } from './helpers/deskPorts';

const ORDER = { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, reason: 'Reprise du VWAP après le NFP' };

describe('outil propose_order', () => {
  it('écriture, déclarée au catalogue, paramètres bornés', () => {
    expect(toolKind('propose_order')).toBe('write');
    expect(ORDER_TOOLS).toEqual(['propose_order']);
    const schema = toolSchemas().find((t) => t.name === 'propose_order');
    expect(schema?.parameters).toMatchObject({ required: ['account', 'instrument', 'side', 'qty', 'reason'], additionalProperties: false });
  });

  it('agent embarqué : le dialogue du process principal confirme, pas celui du renderer', async () => {
    const seen: Record<string, unknown>[] = [];
    const confirmFn = vi.fn(async () => true);
    const ports = fakePorts({
      proposeOrder: async (args) => {
        seen.push(args);
        return { ok: true, status: 'sent', orderId: 'o1' };
      },
    });
    const r = await executeDeskTool(ports, 'propose_order', ORDER, { source: 'llm', confirmFn });
    expect(r).toMatchObject({ ok: true, status: 'sent', orderId: 'o1' });
    expect(seen).toEqual([ORDER]);
    expect(confirmFn).not.toHaveBeenCalled();
    // Les autres écritures restent confirmées par le renderer.
    await executeDeskTool(ports, 'create_note', { title: 't', body: 'b' }, { source: 'llm', confirmFn });
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it('agent externe : rien sans « écriture autorisée »', async () => {
    const proposeOrder = vi.fn(async () => ({ ok: true }));
    const ports = fakePorts({ proposeOrder });
    expect(await executeDeskTool(ports, 'propose_order', ORDER, { source: 'orch', allowWrite: false })).toEqual({ ok: false, reason: 'write_disabled' });
    expect(proposeOrder).not.toHaveBeenCalled();
    await executeDeskTool(ports, 'propose_order', ORDER, { source: 'orch', allowWrite: true });
    expect(proposeOrder).toHaveBeenCalledTimes(1);
  });
});

describe('relais MCP des ordres proposés', () => {
  afterEach(() => vi.useRealTimers());

  it('attend la réponse du trader au-delà du délai ordinaire, jamais sans fin', async () => {
    vi.useFakeTimers();
    const sent: { id: string; method: string }[] = [];
    const relay = new DeskRelay((req) => {
      sent.push(req);
      return true;
    }, 15_000);
    const r = mcpRelay(relay);

    const read = r.call('desk_overview', {});
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await read).toMatchObject({ result: null, error: expect.stringMatching(/délai/) });

    const order = r.call('propose_order', ORDER);
    await vi.advanceTimersByTimeAsync(44_000);
    expect(relay.settle(sent[1]!.id, { ok: true, status: 'sent', orderId: 'o1' })).toBe(true);
    expect(await order).toMatchObject({ result: { status: 'sent' } });

    const silent = r.call('propose_order', ORDER);
    await vi.advanceTimersByTimeAsync(ORDER_RELAY_TIMEOUT_MS);
    expect(await silent).toMatchObject({ result: null, error: expect.stringMatching(/délai/) });
  });
});

describe('proposition depuis le desk', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('transmise au main avec la marge du plan suivi, tracée agent_order et signée agent', async () => {
    const pushed: [string, { data: Record<string, unknown> }][] = [];
    const calls: [unknown, string, number | null][] = [];
    let n = 0;
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        orchestrator: { broadcast: (event: string, payload: never) => pushed.push([event, payload]) },
        agentOrders: {
          status: async () => ({ enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false }),
          propose: async (raw: unknown, origin: string, share: number | null) => {
            calls.push([raw, origin, share]);
            return ++n === 1 ? { status: 'sent', orderId: 'o1', account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, resulting: 1 } : { status: 'refused', reason: 'not_sim', detail: 'compte réel' };
          },
        },
      },
    });
    vi.resetModules();
    const { livePorts } = await import('@/store/agent');
    const { useAgentOrders } = await import('@/store/agentOrders');
    const { deskEventLog } = await import('@/store/deskEvents');
    const { useBridge } = await import('@/store/bridge');
    const { useJournal } = await import('@/store/journal');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');

    // Plan Apex 50K (drawdown 2 500) suivi sur Sim101, latent −2 000 : il reste 20 %.
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'Sim101' } });
    useJournal.setState({ sessions: [], trades: [] });
    useBridge.setState({ nt: { link: 'live', accounts: [{ name: 'Sim101', cashValue: 50_000, realizedPnl: 0, unrealizedPnl: -2_000, positions: [] }] } as never });

    const sent = await livePorts('mcp').proposeOrder(ORDER);
    expect(sent).toMatchObject({ ok: true, status: 'sent', orderId: 'o1' });
    expect(calls[0]?.[1]).toBe('mcp');
    expect(calls[0]?.[2]).toBeCloseTo(0.2);

    const refused = await livePorts('orch').proposeOrder({ ...ORDER, account: 'PA-1' });
    expect(refused).toMatchObject({ ok: false, status: 'refused', reason: 'not_sim' });
    // Le plan suit Sim101 : aucune marge transmise pour un autre compte.
    expect(calls[1]?.[2]).toBeNull();

    const page = deskEventLog.read({ cursor: `${deskEventLog.epoch}.0` });
    expect(page.events.map((e) => [e.kind, e.data.by, e.data.origin, e.data.status])).toEqual([
      ['agent_order', 'agent', 'mcp', 'sent'],
      ['agent_order', 'agent', 'orch', 'refused'],
    ]);
    expect(page.events[0]?.data).toMatchObject({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, orderId: 'o1', why: ORDER.reason });
    expect(page.events[1]?.data).toMatchObject({ account: 'PA-1', reason: 'not_sim', detail: 'compte réel' });
    expect(pushed.map(([k]) => k)).toEqual(['agent_order', 'agent_order']);
    expect(useAgentOrders.getState().last?.outcome.status).toBe('refused');
    expect(useAgentOrders.getState().status.pending).toBe(false);
  });

  it('marge du plan suivi : le compte est reconnu sans tenir compte de la casse ni des espaces', async () => {
    const calls: (number | null)[] = [];
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        agentOrders: {
          status: async () => ({ enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false }),
          propose: async (_raw: unknown, _origin: string, share: number | null) => {
            calls.push(share);
            return { status: 'declined', detail: 'refusé par le trader' };
          },
        },
      },
    });
    vi.resetModules();
    const { livePorts } = await import('@/store/agent');
    const { useBridge } = await import('@/store/bridge');
    const { useJournal } = await import('@/store/journal');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'SimApex1' } });
    useJournal.setState({ sessions: [], trades: [] });
    useBridge.setState({ nt: { link: 'live', accounts: [{ name: 'SimApex1', cashValue: 50_000, realizedPnl: 0, unrealizedPnl: -2_000, positions: [] }] } as never });
    await livePorts('mcp').proposeOrder({ ...ORDER, account: 'SimAPEX1' });
    await livePorts('mcp').proposeOrder({ ...ORDER, account: ' simapex1 ' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeCloseTo(0.2);
    expect(calls[1]).toBeCloseTo(0.2);
  });

  it('rafale de 600 propositions : quelques événements agent_order, l’alerte de marge reste lisible', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T14:00:00Z'));
    let n = 0;
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        agentOrders: {
          status: async () => ({ enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false }),
          propose: async () => (++n <= 3 ? { status: 'declined', detail: 'refusé par le trader' } : { status: 'refused', reason: 'rate', detail: 'au plus 3 proposition(s) par minute' }),
        },
      },
    });
    vi.resetModules();
    try {
      const { livePorts } = await import('@/store/agent');
      const { AGENT_ORDER_EVENT_LIMITS } = await import('@/store/agentOrders');
      const { deskEventLog, recordDeskEvent } = await import('@/store/deskEvents');
      recordDeskEvent('prop_buffer', { threshold: 0.25, breached: false, planId: 'apex-50', account: 'Sim101' });
      const ports = livePorts('mcp');
      for (let i = 0; i < 600; i++) {
        vi.setSystemTime(new Date(Date.parse('2026-10-06T14:00:00Z') + i * 50));
        await ports.proposeOrder(ORDER);
      }
      expect(deskEventLog.read({ kinds: ['prop_buffer'] }).events.map((e) => e.data.threshold)).toEqual([0.25]);
      const all = deskEventLog.read({ cursor: `${deskEventLog.epoch}.0`, limit: 200 });
      expect(all.dropped).toBe(0);
      const orders = all.events.filter((e) => e.kind === 'agent_order');
      // Borne explicite : 10 par minute (60 par heure), les ordres envoyés toujours compris.
      expect(orders.length).toBeLessThanOrEqual(10);
      expect(AGENT_ORDER_EVENT_LIMITS).toEqual({ perMinute: 10, perHour: 60 });
      expect(orders.slice(0, 3).map((e) => e.data.status)).toEqual(['declined', 'declined', 'declined']);

      // La minute suivante, le premier événement dit combien de propositions n'ont pas été rangées.
      vi.setSystemTime(new Date('2026-10-06T14:01:31Z'));
      await ports.proposeOrder(ORDER);
      const next = deskEventLog.last();
      expect(next?.kind).toBe('agent_order');
      expect(next?.data.suppressed).toBe(600 - orders.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hors desk : refusée, tracée quand même', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    vi.resetModules();
    const { livePorts } = await import('@/store/agent');
    const { deskEventLog } = await import('@/store/deskEvents');
    expect(await livePorts().proposeOrder(ORDER)).toMatchObject({ ok: false, status: 'refused', reason: 'disabled' });
    const page = deskEventLog.read({ cursor: `${deskEventLog.epoch}.0` });
    expect(page.events.map((e) => [e.kind, e.data.origin, e.data.status])).toEqual([['agent_order', 'llm', 'refused']]);
  });
});
