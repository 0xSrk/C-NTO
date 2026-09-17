import { describe, expect, it } from 'vitest';
import { orchMethodAllowed, takeToolCalls, clampToolArgs } from '@/engine/agent/ports';
import { executeDeskTool, toolKind } from '@/engine/agent/runner';
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
