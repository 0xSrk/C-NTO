import { describe, expect, it } from 'vitest';
import { takeToolCalls } from '@/engine/agent/ports';
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

describe('executeDeskTool', () => {
  it('write llm + confirm false → store fake non muté', async () => {
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'create_note', { title: 'N', body: 'x' }, { source: 'llm', confirmFn: async () => false });
    expect(r).toEqual({ ok: false, reason: 'operator_denied' });
    expect(log.writes).toBe(0);
  });

  it('write orch + allowWrite false → refus', async () => {
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'create_note', { title: 'N', body: 'x' }, { source: 'orch', allowWrite: false });
    expect(r).toEqual({ ok: false, reason: 'write_disabled' });
    expect(log.writes).toBe(0);
  });

  it('9e call du même tour → refus (limite 8)', () => {
    const calls = Array.from({ length: 9 }, (_, i) => ({ name: 'desk_overview', i }));
    const taken = takeToolCalls(calls, toolKind);
    expect(taken.length).toBe(8);
    expect(taken.map((c) => c.i)).not.toContain(8);
  });

  it('tool inconnu → refus', async () => {
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'copy.order', {}, { source: 'llm', confirmFn: async () => true });
    expect(r).toEqual({ ok: false, reason: 'unknown_tool' });
    expect(log.writes).toBe(0);
  });

  it('write orch + allowWrite true → mutation', async () => {
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'create_note', { title: 'N', body: 'ok' }, { source: 'orch', allowWrite: true });
    expect(r).toEqual({ id: 'n1', title: 'N' });
    expect(log.writes).toBe(1);
  });

  it('cap body 20_000 dans le runner, avant mutation', async () => {
    const log = { writes: 0 };
    const r = await executeDeskTool(mockPorts(log), 'create_note', { title: 'N', body: 'x'.repeat(20_001) }, { source: 'orch', allowWrite: true });
    expect(r).toEqual({ ok: false, reason: 'args_too_large' });
    expect(log.writes).toBe(0);
  });
});
