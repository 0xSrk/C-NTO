/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : les tables du coffre sont en mémoire, les stores restent les vrais.
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

import { DESK_TOOL_KINDS } from '@/engine/agent/catalog';
import { executeDeskTool } from '@/engine/agent/runner';
import { db, type Note } from '@/store/db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    async bulkPut(list: T[]) {
      for (const row of list) rows.set(row.id, row);
    },
    async get(id: string) {
      return rows.get(id);
    },
    async update(id: string, patch: Partial<T>) {
      const cur = rows.get(id);
      if (!cur) return 0;
      rows.set(id, { ...cur, ...patch });
      return 1;
    },
    async delete(id: string) {
      rows.delete(id);
    },
    async bulkDelete(ids: string[]) {
      for (const id of ids) rows.delete(id);
    },
    async toArray() {
      return [...rows.values()];
    },
  };
}

const notes = memTable<Note>();
const links = memTable<{ id: string; predicate: string; by: string }>();
const sessions = memTable<{ id: string }>();
Object.assign(db as unknown as Record<string, unknown>, { notes, links, sessions, trades: memTable(), calendarEvents: memTable() });

const { canAdopt, useNotes } = await import('@/store/notes');
const { useLinks } = await import('@/store/links');
const { livePorts } = await import('@/store/agent');
const { useI18n } = await import('@/i18n');
const { default: NoteModule } = await import('@/modules/note/Note');

const ADOPTED_AT = Date.UTC(2026, 9, 7, 9, 30);
const ADOPTED_BODY = 'Je coupe après deux pertes. #leçon';
const adopted = (): Note => ({ id: 'n_adopt', title: 'Deux pertes', body: ADOPTED_BODY, tags: ['leçon'], by: 'agent', adoptedAt: ADOPTED_AT, createdAt: 1, updatedAt: 2 });
const proposed = (): Note => ({ id: 'n_agent', title: 'Proposée', body: 'Pas de trade avant 9 h 45. #leçon', tags: ['leçon'], by: 'agent', createdAt: 1, updatedAt: 3 });
const mine = (): Note => ({ id: 'n_trader', title: 'Revue', body: 'Revue de septembre. #revue', tags: ['revue'], createdAt: 1, updatedAt: 1 });

function seed(list: Note[]) {
  notes.rows.clear();
  links.rows.clear();
  sessions.rows.clear();
  for (const n of list) notes.rows.set(n.id, n);
  useNotes.setState({ notes: list.map((n) => ({ ...n })), activeId: list[0]?.id ?? null, ready: true });
  useLinks.setState({ links: [], ready: true });
}

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  seed([adopted(), proposed(), mine()]);
});

describe('A15.2 bouton Adopter', () => {
  it('existe pour une note d’agent, pas pour une note du trader ni une note déjà adoptée', () => {
    expect(canAdopt({ by: 'agent' })).toBe(true);
    expect(canAdopt({})).toBe(false);
    expect(canAdopt({ by: 'agent', adoptedAt: 1_700_000_000_000 })).toBe(false);
  });
});

const WRITE_TOOLS = Object.entries(DESK_TOOL_KINDS)
  .filter(([, kind]) => kind === 'write')
  .map(([name]) => name);

/** Chaque outil d'écriture, visé sur la note adoptée ; `done` prouve que l'outil a bien agi. */
const AIMED: Record<string, { args: Record<string, unknown>; done: (result: Record<string, unknown>) => void }> = {
  // L'identifiant de la note passé pour une séance : l'outil n'écrit que dans les séances.
  annotate_session: { args: { id: 'n_adopt', note: 'réécrite', tags: ['piégé'] }, done: (r) => expect(r).toEqual({ ok: true }) },
  // Même titre, autre corps, et un `adoptedAt` glissé : une note nouvelle, non adoptée.
  create_note: {
    args: { title: 'Deux pertes', body: 'remplacée #leçon', tags: ['leçon'], adoptedAt: 1 },
    done: (r) => expect(notes.rows.get(String(r.id))).toMatchObject({ title: 'Deux pertes 2', body: 'remplacée #leçon', by: 'agent' }),
  },
  branch_note: {
    args: { id: 'n_adopt', ancre: 'Je coupe', question: 'Et après trois pertes ?' },
    done: (r) => expect(notes.rows.get(String(r.id))).toMatchObject({ parentId: 'n_adopt', ancre: 'Je coupe', by: 'agent' }),
  },
  link_notes: {
    args: { from: 'n_adopt', to: 'n_trader', predicate: 'contredit' },
    done: (r) => expect(links.rows.get(String(r.id))).toMatchObject({ predicate: 'contredit', by: 'agent' }),
  },
  // Sans le desk de bureau, la proposition est refusée : rien d'autre ne bouge.
  propose_order: {
    args: { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, reason: 'Deux pertes : la leçon le permet' },
    done: (r) => expect(r).toMatchObject({ ok: false, status: 'refused', reason: 'disabled' }),
  },
};

const kept = (n: Note | undefined) => n && { body: n.body, tags: n.tags, by: n.by, adoptedAt: n.adoptedAt };

describe('A15.5 une note adoptée reste intacte face aux outils', () => {
  it.each(WRITE_TOOLS)('%s, confirmé par l’opérateur : corps, tags et adoptedAt inchangés', async (tool) => {
    const aimed = AIMED[tool];
    if (!aimed) throw new Error(`aucun cas pour l’outil d’écriture ${tool}`);
    const result = (await executeDeskTool(livePorts(), tool, aimed.args, { source: 'llm', confirmFn: async () => true })) as Record<string, unknown>;
    aimed.done(result);
    const expected = { body: ADOPTED_BODY, tags: ['leçon'], by: 'agent', adoptedAt: ADOPTED_AT };
    expect(kept(notes.rows.get('n_adopt'))).toEqual(expected);
    expect(kept(useNotes.getState().notes.find((n) => n.id === 'n_adopt'))).toEqual(expected);
    // Aucune autre note ne devient adoptée.
    expect([...notes.rows.values()].filter((n) => n.adoptedAt !== undefined).map((n) => n.id)).toEqual(['n_adopt']);
  });
});

describe('A15.5 adopt dans le store', () => {
  afterEach(() => vi.useRealTimers());

  it('pose adoptedAt sur une note d’agent ; refuse une note du trader, une note déjà adoptée et un id inconnu', async () => {
    const at = Date.UTC(2026, 9, 8, 14, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    const adopt = useNotes.getState().adopt;
    await adopt('n_agent');
    expect(notes.rows.get('n_agent')?.adoptedAt).toBe(at);
    expect(useNotes.getState().notes.find((n) => n.id === 'n_agent')?.adoptedAt).toBe(at);

    await adopt('n_trader');
    expect(notes.rows.get('n_trader')).not.toHaveProperty('adoptedAt');
    expect(useNotes.getState().notes.find((n) => n.id === 'n_trader')).not.toHaveProperty('adoptedAt');

    await adopt('n_adopt');
    expect(notes.rows.get('n_adopt')?.adoptedAt).toBe(ADOPTED_AT);

    await expect(adopt('inconnue')).resolves.toBeUndefined();
    expect(notes.rows.has('inconnue')).toBe(false);
  });
});

describe('A15.5 bouton Adopter dans l’onglet Notes', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  const adoptButton = () => [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Adopter') ?? null;

  it('une note d’agent montre « Adopter » ; le clic l’adopte et affiche la date ; une note du trader n’a pas de bouton', async () => {
    useNotes.setState({ activeId: 'n_agent' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(NoteModule));
    });
    expect(host.textContent).toContain('Écrite par un agent IA');
    const button = adoptButton();
    expect(button).not.toBeNull();
    expect(host.textContent).not.toContain('Adoptée le');

    await act(async () => {
      button?.click();
    });
    expect(notes.rows.get('n_agent')?.adoptedAt).toBeTypeOf('number');
    expect(adoptButton()).toBeNull();
    expect(host.textContent).toContain('Adoptée le');

    await act(async () => {
      useNotes.setState({ activeId: 'n_trader' });
    });
    expect(host.textContent).not.toContain('Écrite par un agent IA');
    expect(adoptButton()).toBeNull();
    expect(host.textContent).not.toContain('Adoptée le');

    await act(async () => {
      useNotes.setState({ activeId: 'n_adopt' });
    });
    expect(adoptButton()).toBeNull();
    expect(host.textContent).toContain('Adoptée le');
  });
});
