import { describe, expect, it } from 'vitest';
import { DESK_TOOLS } from '@/engine/agent/tools';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { traderMemory } from '@/engine/agent/memory';
import type { DeskNote } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { prepareVaultRestore } from '@/store/db';
import { fakePorts } from './helpers/deskPorts';

const lesson = (id: string, adoptedAt?: number): DeskNote => ({
  id,
  title: `Leçon ${id}`,
  body: 'Je coupe après deux pertes. #leçon',
  tags: ['leçon'],
  updatedAt: Date.UTC(2026, 9, 6),
  by: 'agent',
  ...(adoptedAt !== undefined ? { adoptedAt } : {}),
});

describe('A15.1 adopter une leçon', () => {
  it('coffre ancien lisible, adoptedAt non numérique rejeté, leçon adoptée seule en mémoire, aucun outil ne la pose', async () => {
    const old = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], notes: [{ id: 'old', title: 'T', body: 'b', tags: [], updatedAt: 1 }] }));
    expect(old.notes.map((n) => n.id)).toEqual(['old']);
    const bad = prepareVaultRestore(
      JSON.stringify({
        artefact: 'CΛNTO',
        sessions: [],
        notes: [
          { id: 'bad', title: 'T', body: 'b', tags: [], updatedAt: 1, adoptedAt: 'demain' },
          { id: 'ok', title: 'T', body: 'b', tags: [], updatedAt: 1, adoptedAt: 50, by: 'agent' },
        ],
      }),
    );
    expect(bad.notes.map((n) => n.id)).toEqual(['ok']);
    expect(bad.skipped.notes).toBe(1);

    const adopted = lesson('a1', Date.UTC(2026, 9, 7));
    const loose = lesson('a2');
    const memory = traderMemory({ rules: DEFAULT_TRADER_RULES, plan: null, planAccount: '', notes: [adopted, loose] });
    expect(memory.lessons.map((n) => n.id)).toEqual(['a1']);
    expect(memory.excludedAgentNotes).toBe(1);

    const seen: unknown[][] = [];
    await executeDeskTool(
      fakePorts({
        createNote: async (...args) => {
          seen.push(args);
          return { id: 'n', title: String(args[0]) };
        },
      }),
      'create_note',
      { title: 'Leçon', body: 'texte #leçon', tags: ['leçon'], adoptedAt: 123 },
      { source: 'llm', confirmFn: async () => true },
    );
    expect(seen).toEqual([['Leçon', 'texte #leçon', ['leçon']]]);
    expect(JSON.stringify(DESK_TOOLS)).not.toContain('adoptedAt');
  });
});
