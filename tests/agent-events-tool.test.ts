import { describe, expect, it } from 'vitest';
import { executeDeskTool } from '@/engine/agent/runner';
import { DeskEventLog } from '@/engine/agent/events';
import { DESK_TOOLS } from '@/engine/agent/tools';
import { fakePorts } from './helpers/deskPorts';

type Page = { cursor: string; count: number; more?: boolean; reset?: boolean; dropped?: number; events: { seq: number; at: string; kind: string; data: Record<string, unknown> }[]; error?: string };

describe('outil desk_events', () => {
  it('lecture : les plus récents, puis les suivants seulement, filtre par type', async () => {
    const log = new DeskEventLog('run1');
    const ports = fakePorts({ events: (o) => log.read(o) });
    log.push('catalyst', { title: 'CPI', at: '2026-10-14T12:30:00.000Z' }, Date.UTC(2026, 9, 14, 12, 15));
    log.push('fill', { instrument: 'NQ 12-26' }, Date.UTC(2026, 9, 14, 12, 31));

    const first = (await executeDeskTool(ports, 'desk_events', {}, { source: 'orch' })) as Page;
    expect(first.events.map((e) => e.kind)).toEqual(['catalyst', 'fill']);
    // La date de publication du catalyseur reste dans `data`, l'horodatage de l'événement à côté.
    expect(first.events[0]).toEqual({ seq: 1, at: '2026-10-14T12:15:00.000Z', kind: 'catalyst', data: { title: 'CPI', at: '2026-10-14T12:30:00.000Z' } });
    expect(first.cursor).toBe('run1.2');

    log.push('prop_buffer', { threshold: 0.25 });
    log.push('bridge_link', { from: 'live', to: 'lost' });
    const next = (await executeDeskTool(ports, 'desk_events', { cursor: first.cursor, kinds: ['prop_buffer', 'order.submit'] }, { source: 'orch' })) as Page;
    expect(next.events.map((e) => e.kind)).toEqual(['prop_buffer']);
    expect(next.cursor).toBe('run1.4');
    expect((await executeDeskTool(ports, 'desk_events', { cursor: next.cursor }, { source: 'llm' })) as Page).toMatchObject({ count: 0, events: [] });

    const other = (await executeDeskTool(ports, 'desk_events', { cursor: 'run0.3', limit: 1 }, { source: 'orch' })) as Page;
    expect(other.reset).toBe(true);
    expect(other.events.map((e) => e.seq)).toEqual([4]);
  });

  it('lecture seule, curseur borné, schéma limité aux types connus', async () => {
    const tool = DESK_TOOLS.find((t) => t.name === 'desk_events');
    expect(tool?.kind).toBe('read');
    expect(JSON.stringify(tool?.parameters)).toContain('"enum":["fill","order","prop_buffer","catalyst","bridge_link","agent_order","daily_loss","discipline"]');
    expect(await executeDeskTool(fakePorts(), 'desk_events', { cursor: 'x'.repeat(65) }, { source: 'orch' })).toEqual({ ok: false, reason: 'args_too_large' });
  });
});
