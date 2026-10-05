import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : `db.notes` et `db.links` sont des tables en mémoire.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) {
      return fn();
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { executeDeskTool } from '@/engine/agent/runner';
import { buildVaultV2 } from '@/engine/vault';
import { db, prepareVaultRestore, type Note } from '@/store/db';
import type { Link } from '@/engine/ontology';

function memTable<T extends { id: string }>() {
  const rows = new Map<string, T>();
  return {
    rows,
    async add(row: T) {
      rows.set(row.id, row);
    },
    async put(row: T) {
      rows.set(row.id, row);
    },
    async get(id: string) {
      return rows.get(id);
    },
    async delete(id: string) {
      rows.delete(id);
    },
    async toArray() {
      return [...rows.values()];
    },
  };
}

const notes = memTable<Note>();
const links = memTable<Link>();
Object.assign(db as unknown as Record<string, unknown>, { notes, links });

const { useNotes } = await import('@/store/notes');
const { useLinks } = await import('@/store/links');
const { livePorts } = await import('@/store/agent');

const A = { type: 'note', id: 'a' } as const;
const B = { type: 'note', id: 'b' } as const;
const note = (id: string, title: string): Note => ({ id, title, body: title, tags: [], createdAt: 1, updatedAt: 1 });

describe('écritures signées agent', () => {
  beforeEach(() => {
    notes.rows.clear();
    links.rows.clear();
    for (const n of [note('a', 'A'), note('b', 'B')]) notes.rows.set(n.id, n);
    useNotes.setState({ notes: [...notes.rows.values()], activeId: 'a', ready: true });
    useLinks.setState({ links: [], ready: true });
  });

  it('un lien et une note écrits par l’agent portent by = agent ; ceux du trader non', async () => {
    const ports = livePorts();
    await ports.linkNotes('a', 'b', 'soutient');
    expect([...links.rows.values()].map((l) => [l.predicate, l.by])).toEqual([['soutient', 'agent']]);

    const created = await ports.createNote('Idée', 'corps', ['agent']);
    expect(notes.rows.get(created.id)?.by).toBe('agent');
    const child = await ports.branchNote('a', 'A', 'Pourquoi ?');
    expect(child && notes.rows.get(child.id)?.by).toBe('agent');

    const read = (await executeDeskTool(livePorts(), 'read_note', { id: created.id }, { source: 'llm' })) as { by?: string };
    expect(read.by).toBe('agent');

    const mine = await useNotes.getState().create('À moi', 'corps');
    expect(notes.rows.get(mine.id)).not.toHaveProperty('by');
    await useLinks.getState().affirm(A, B, 'contredit');
    expect(links.rows.get('note:a|contredit|note:b')?.by).toBe('utilisateur');
  });

  it('l’agent ne reprend pas la signature d’un lien du trader ; le trader reprend celle de l’agent', async () => {
    await useLinks.getState().affirm(A, B, 'soutient');
    const before = links.rows.get('note:a|soutient|note:b');
    await livePorts().linkNotes('a', 'b', 'soutient');
    expect(links.rows.get('note:a|soutient|note:b')).toEqual(before);

    await livePorts().linkNotes('b', 'a', 'raffine');
    expect(links.rows.get('note:b|raffine|note:a')?.by).toBe('agent');
    await useLinks.getState().affirm(B, A, 'raffine');
    expect(links.rows.get('note:b|raffine|note:a')?.by).toBe('utilisateur');
  });

  it('le coffre restaure la signature agent et refuse un auteur inconnu', () => {
    const now = 1_760_000_000_000;
    const lien = (id: string, by: string) => ({ id, from: A, to: B, predicate: 'soutient', kind: 'affirme', by, createdAt: now, updatedAt: now });
    const vault = buildVaultV2({
      appVersion: '3.3.4',
      sessions: [],
      trades: [],
      notes: [
        { ...note('n1', 'Agent'), by: 'agent' },
        { ...note('n2', 'Robot'), by: 'robot' } as unknown as Note,
      ],
      links: [lien('l1', 'agent'), lien('l2', 'robot')] as unknown as Link[],
    });
    const prepared = prepareVaultRestore(JSON.stringify(vault));
    expect(prepared.notes.map((n) => [n.id, n.by])).toEqual([['n1', 'agent']]);
    expect(prepared.links.map((l) => [l.id, l.by])).toEqual([['l1', 'agent']]);
  });
});
