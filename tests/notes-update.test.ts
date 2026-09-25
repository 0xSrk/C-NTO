import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/store/db';

/*
 * Dexie exige IndexedDB : on remplace `db.notes` par une table mémoire dont `update`
 * fusionne un patch (sémantique Dexie) avec un délai contrôlé pour entrelacer deux appels.
 */
const table = new Map<string, Note>();
const gate: { release: (() => void) | null } = { release: null };

vi.mock('@/store/db', () => ({
  db: {
    notes: {
      async update(id: string, patch: Partial<Note>) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        const cur = table.get(id);
        if (!cur) return 0;
        table.set(id, { ...cur, ...patch });
        return 1;
      },
      async put(note: Note) {
        table.set(note.id, note);
      },
      async add(note: Note) {
        table.set(note.id, note);
      },
      async delete(id: string) {
        table.delete(id);
      },
      async toArray() {
        return [...table.values()];
      },
    },
    transaction: async (_mode: string, _t: unknown, fn: () => Promise<unknown>) => fn(),
  },
}));

const { useNotes } = await import('@/store/notes');

const seed = (): Note => ({ id: 'n1', title: 'Plan', body: 'corps', tags: [], pinned: false, createdAt: 1, updatedAt: 1 });

describe('notes.update (F10) — patches entrelacés', () => {
  beforeEach(() => {
    table.clear();
    table.set('n1', seed());
    useNotes.setState({ notes: [seed()], activeId: 'n1', ready: true });
  });

  it('épingle + corps différé : les deux patches survivent', async () => {
    const pin = useNotes.getState().update('n1', { pinned: true });
    // Le second appel part avant que le premier put ne soit terminé.
    await Promise.resolve();
    const firstGate = gate.release;
    const body = useNotes.getState().update('n1', { body: 'nouveau #tag' });
    await Promise.resolve();
    const secondGate = gate.release;
    expect(firstGate).not.toBeNull();
    expect(secondGate).not.toBe(firstGate);
    firstGate?.();
    await pin;
    secondGate?.();
    await body;
    const inStore = useNotes.getState().notes.find((n) => n.id === 'n1');
    expect(inStore?.pinned).toBe(true);
    expect(inStore?.body).toBe('nouveau #tag');
    expect(inStore?.tags).toEqual(['tag']);
    const inDb = table.get('n1');
    expect(inDb?.pinned).toBe(true);
    expect(inDb?.body).toBe('nouveau #tag');
  });

  it('ordre inverse de résolution : aucun patch perdu non plus', async () => {
    const pin = useNotes.getState().update('n1', { pinned: true });
    await Promise.resolve();
    const firstGate = gate.release;
    const title = useNotes.getState().update('n1', { title: 'Plan v2' });
    await Promise.resolve();
    const secondGate = gate.release;
    secondGate?.();
    await title;
    firstGate?.();
    await pin;
    const inStore = useNotes.getState().notes.find((n) => n.id === 'n1');
    expect(inStore?.pinned).toBe(true);
    expect(inStore?.title).toBe('Plan v2');
  });

  it('ignore un identifiant inconnu', async () => {
    await useNotes.getState().update('absent', { pinned: true });
    expect(useNotes.getState().notes).toHaveLength(1);
  });
});
