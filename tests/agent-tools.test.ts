import { describe, expect, it } from 'vitest';
import { orchMethodAllowed, takeToolCalls, clampToolArgs } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind } from '@/engine/agent/tools';
import type { DeskPorts } from '@/engine/agent/ports';

function mockPorts(log: { writes: number }): DeskPorts {
  return {
    sessions: () => [],
    trades: () => [],
    startingBalance: () => 50_000,
    planId: () => 'apex-50',
    updateSession: async () => {
      log.writes++;
    },
    notes: () => [],
    createNote: async (title) => {
      log.writes++;
      return { id: 'n1', title };
    },
    calendarEntries: () => [],
  };
}

describe('agent tools', () => {
  it('deny / operator_denied : zéro mutation', async () => {
    const log = { writes: 0 };
    const denied = { ok: false, reason: 'operator_denied' };
    expect(denied.ok).toBe(false);
    expect(log.writes).toBe(0);
    await executeDeskTool(mockPorts(log), 'desk_overview', {}, { source: 'llm' });
    expect(log.writes).toBe(0);
  });

  it('cap 8 appels par tour', () => {
    const calls = Array.from({ length: 12 }, (_, i) => ({ name: 'desk_overview', i }));
    expect(takeToolCalls(calls, toolKind).length).toBe(8);
  });

  it('cap 2 écritures par tour', () => {
    const calls = [
      { name: 'create_note' },
      { name: 'annotate_session' },
      { name: 'create_note' },
      { name: 'desk_overview' },
    ];
    const taken = takeToolCalls(calls, toolKind);
    expect(taken.filter((c) => toolKind(c.name) === 'write').length).toBe(2);
    expect(taken.some((c) => c.name === 'desk_overview')).toBe(true);
  });

  it('cap taille body / tags', async () => {
    expect(clampToolArgs({ body: 'x'.repeat(20001) })).toEqual({ ok: false, reason: 'args_too_large' });
    expect(clampToolArgs({ note: 'x'.repeat(20001) }).ok).toBe(false);
    expect(clampToolArgs({ tags: Array.from({ length: 21 }, () => 'a') }).ok).toBe(false);
    expect(clampToolArgs({ tags: ['x'.repeat(41)] }).ok).toBe(false);
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'create_note', { title: 'N', body: 'x'.repeat(20001) }, { source: 'orch', allowWrite: true });
    expect(r).toEqual({ ok: false, reason: 'args_too_large' });
    expect(log.writes).toBe(0);
  });

  it('cap titre ≤ 200 et arguments courts ≤ 64', () => {
    expect(clampToolArgs({ title: 'x'.repeat(201) })).toEqual({ ok: false, reason: 'args_too_large' });
    expect(clampToolArgs({ title: 'x'.repeat(200) }).ok).toBe(true);
    for (const k of ['query', 'id', 'date', 'from', 'to', 'planId']) {
      expect(clampToolArgs({ [k]: 'x'.repeat(65) }).ok, k).toBe(false);
      expect(clampToolArgs({ [k]: 'x'.repeat(64) }).ok, k).toBe(true);
    }
  });

  it('retire les arguments non déclarés par l’outil (et le prototype)', async () => {
    const r = clampToolArgs({ title: 'T', body: 'B', evil: 1 }, ['title', 'body']);
    expect(r).toEqual({ ok: true, args: { title: 'T', body: 'B' } });
    const proto = clampToolArgs(JSON.parse('{"__proto__":{"x":1},"constructor":{},"title":"T"}') as Record<string, unknown>);
    expect(proto.ok && Object.keys(proto.args)).toEqual(['title']);
    let seen: string[] = [];
    const ports: DeskPorts = {
      ...mockPorts({ writes: 0 }),
      createNote: async (title, body, tags) => {
        seen = [title, body, String(tags.length)];
        return { id: 'n1', title };
      },
    };
    await executeDeskTool(ports, 'create_note', { title: 'T', body: 'B', pinned: true, sessionId: 'x' }, { source: 'orch', allowWrite: true });
    expect(seen).toEqual(['T', 'B', '0']);
  });

  it('calendar_events rejette les dates hors YYYY-MM-DD', async () => {
    const ports = mockPorts({ writes: 0 });
    const bad = (await executeDeskTool(ports, 'calendar_events', { from: '2026/09/01', to: '2026-09-30' }, { source: 'llm' })) as { error?: string };
    expect(typeof bad.error).toBe('string');
    const bad2 = (await executeDeskTool(ports, 'calendar_events', { from: '2026-09-01', to: 'next week' }, { source: 'orch' })) as { error?: string };
    expect(typeof bad2.error).toBe('string');
    const missing = (await executeDeskTool(ports, 'calendar_events', {}, { source: 'llm' })) as { error?: string };
    expect(typeof missing.error).toBe('string');
    const ok = (await executeDeskTool(ports, 'calendar_events', { from: '2026-09-01', to: '2026-09-30' }, { source: 'llm' })) as { events?: unknown[]; error?: string };
    expect(ok.error).toBeUndefined();
    expect(Array.isArray(ok.events)).toBe(true);
  });

  it('aperçu de confirmation : titre, tags, séance cible et corps tronqué explicitement', async () => {
    let detail = '';
    const confirmFn = async (_title: string, d: string) => {
      detail = d;
      return false;
    };
    await executeDeskTool(mockPorts({ writes: 0 }), 'create_note', { title: 'Plan', body: 'x'.repeat(5000), tags: ['a', 'b'] }, { source: 'llm', confirmFn });
    expect(detail).toContain('Plan');
    expect(detail).toContain('a, b');
    expect(detail).toMatch(/tronqué|truncated|truncado/);
    expect(detail.length).toBeLessThan(2600);
    await executeDeskTool(mockPorts({ writes: 0 }), 'annotate_session', { id: 's_42', note: 'courte' }, { source: 'llm', confirmFn });
    expect(detail).toContain('s_42');
    expect(detail).toContain('courte');
    expect(detail).not.toMatch(/tronqué|truncated|truncado/);
  });

  it('write tools ont kind write', () => {
    expect(toolKind('create_note')).toBe('write');
    expect(toolKind('annotate_session')).toBe('write');
    expect(toolKind('desk_overview')).toBe('read');
  });
});

describe('orchestrator allowlist', () => {
  it('allowlist write rejetée par défaut', () => {
    expect(orchMethodAllowed('create_note', false)).toBe(false);
    expect(orchMethodAllowed('tool.annotate_session', false)).toBe(false);
    expect(orchMethodAllowed('desk_overview', false)).toBe(true);
    expect(orchMethodAllowed('desk.ping', false)).toBe(true);
    expect(orchMethodAllowed('copy.order', false)).toBe(false);
    expect(orchMethodAllowed('create_note', true)).toBe(true);
    expect(orchMethodAllowed('unknown.method', false)).toBe(false);
  });
});
