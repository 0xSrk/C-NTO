import { describe, expect, it } from 'vitest';
import { executeDeskTool } from '@/engine/agent/runner';
import type { DeskNote, DeskPorts } from '@/engine/agent/ports';
import { PREDICATES } from '@/engine/ontology/schema';
import { prepareVaultRestore } from '@/store/db';
import { branchChild } from '@/store/notes';

const parentBody = 'Le passage secret du parent ne doit pas être copié dans l’enfant.';

describe('branche de note', () => {
  it('une sélection crée un enfant sans copier le parent', () => {
    const parent = { id: 'p1', title: 'Plan de séance', body: parentBody };
    const selection = 'passage secret';
    const child = branchChild(parent, selection, 'Pourquoi ce passage ?');
    expect(child.parentId).toBe('p1');
    expect(child.ancre).toBe(selection);
    expect(child.question).toBe('Pourquoi ce passage ?');
    expect(child.body.startsWith('Pourquoi ce passage ?')).toBe(true);
    expect(child.body).toContain('[[Plan de séance]]');
    expect(child.body).not.toContain(parentBody);
    expect(child.body).not.toContain(selection);
    expect(branchChild(parent, 'x'.repeat(800), 'q').ancre).toHaveLength(500);
    expect(branchChild(parent, 'a', 'q'.repeat(250)).question).toHaveLength(200);
  });

  it('read_note voit l’ancre et le titre de l’enfant, pas son corps', async () => {
    const notes: DeskNote[] = [
      { id: 'p1', title: 'Plan', body: 'corps parent', tags: [], updatedAt: 1, ancre: 'passage secret', question: 'Pourquoi ?', parentId: 'root' },
      { id: 'c1', title: 'Suite', body: 'CORPS-ENFANT-SECRET', tags: [], updatedAt: 2, parentId: 'p1' },
    ];
    const ports: DeskPorts = {
      sessions: () => [],
      trades: () => [],
      startingBalance: () => 0,
      planId: () => '',
      updateSession: async () => undefined,
      notes: () => notes,
      createNote: async (title) => ({ id: 'n', title }),
      branchNote: async () => null,
      linkNotes: async () => null,
      calendarEntries: () => [],
    };
    const read = (await executeDeskTool(ports, 'read_note', { id: 'p1' }, { source: 'llm' })) as { ancre?: string; question?: string; parentId?: string; children?: string[]; body?: string };
    expect(read.ancre).toBe('passage secret');
    expect(read.question).toBe('Pourquoi ?');
    expect(read.parentId).toBe('root');
    expect(read.children).toEqual(['Suite']);
    expect(JSON.stringify(read)).not.toContain('CORPS-ENFANT-SECRET');
  });

  it('un prédicat hors liste est refusé', async () => {
    let writes = 0;
    const notes: DeskNote[] = [
      { id: 'a', title: 'A', body: 'a', tags: [], updatedAt: 1 },
      { id: 'b', title: 'B', body: 'b', tags: [], updatedAt: 1 },
    ];
    const ports: DeskPorts = {
      sessions: () => [],
      trades: () => [],
      startingBalance: () => 0,
      planId: () => '',
      updateSession: async () => undefined,
      notes: () => notes,
      createNote: async (title) => ({ id: 'n', title }),
      branchNote: async () => null,
      linkNotes: async () => {
        writes++;
        return { id: 'lien' };
      },
      calendarEntries: () => [],
    };
    const refused = (await executeDeskTool(ports, 'link_notes', { from: 'a', to: 'b', predicate: 'invente' }, { source: 'orch', allowWrite: true })) as { error?: string };
    expect(typeof refused.error).toBe('string');
    expect(writes).toBe(0);
    expect(PREDICATES).not.toContain('invente');
    const ok = (await executeDeskTool(ports, 'link_notes', { from: 'A', to: 'b', predicate: 'soutient' }, { source: 'orch', allowWrite: true })) as { id?: string; error?: string };
    expect(ok.error).toBeUndefined();
    expect(ok.id).toBe('lien');
    expect(writes).toBe(1);
  });

  it('une note ancienne sans les champs nouveaux se charge', () => {
    const v = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], notes: [{ id: 'old', title: 'Ancienne', body: 'texte', tags: [], updatedAt: 1 }] }));
    expect(v.notes).toHaveLength(1);
    expect(v.notes[0]).toMatchObject({ id: 'old', title: 'Ancienne', body: 'texte' });
    expect(v.notes[0]?.parentId).toBeUndefined();
    expect(v.notes[0]?.ancre).toBeUndefined();
    expect(v.notes[0]?.question).toBeUndefined();
    expect(v.skipped.notes ?? 0).toBe(0);
  });
});
