import { create } from 'zustand';
import { uid } from '@/lib/id';
import { db, type Note } from './db';

export const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;

export function extractLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) out.add(m[1].trim().toLowerCase());
  return [...out];
}

export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

const WELCOME_TITLE = 'Bienvenue dans le coffre';
const WELCOME_BODY = `# Bienvenue dans le coffre

Ce coffre fonctionne comme **Obsidian** : des notes en Markdown, reliées par des liens \`[[double crochet]]\`.

- Tape \`[[\` pour lier une note existante ou en créer une nouvelle : [[Plan de trading]]
- Les mots-dièse deviennent des étiquettes : #méthode #discipline
- Le panneau *Liens entrants* montre qui pointe vers la note courante.
- La vue **Graphe** dessine le réseau de tes notes.

## Rituel de séance

1. Avant l'ouverture : relire [[Plan de trading]] et le calendrier du jour.
2. Après la séance : créer la note du jour depuis **Métrique** (bouton *Journal*).
3. Le week-end : revue hebdomadaire → [[Revue hebdomadaire]].

> La note du jour se crée en un clic : bouton **Note du jour**.
`;

const PLAN_BODY = `# Plan de trading

**Instrument** : NQ / MNQ (CME Globex)
**Fenêtre** : 15:30 → 17:30 Paris (9:30 → 11:30 ET)
**Risque max / trade** : 0,5 % · **Perte max / jour** : 1,5 %

## Setups autorisés
- Opening Range Breakout 15 min (voir [[Bienvenue dans le coffre]])
- VWAP reclaim en tendance

## Interdits
- Trader 10 min autour d'une publication #calendrier
- Ré-entrer après 2 pertes consécutives #discipline
`;

interface NotesState {
  ready: boolean;
  notes: Note[];
  activeId: string | null;
  load: () => Promise<void>;
  create: (title?: string, body?: string, tags?: string[]) => Promise<Note>;
  update: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'pinned'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  openByTitle: (title: string) => Promise<Note>;
  dailyNote: (date: string, seed?: string) => Promise<Note>;
}

export function byTitle(notes: Note[], title: string): Note | undefined {
  const t = title.trim().toLowerCase();
  return notes.find((n) => n.title.trim().toLowerCase() === t);
}

export const useNotes = create<NotesState>((set, get) => ({
  ready: false,
  notes: [],
  activeId: null,

  async load() {
    let notes = await db.notes.toArray();
    if (notes.length === 0) {
      const now = Date.now();
      const seed: Note[] = [
        { id: uid('n'), title: WELCOME_TITLE, body: WELCOME_BODY, tags: extractTags(WELCOME_BODY), pinned: true, createdAt: now, updatedAt: now },
        { id: uid('n'), title: 'Plan de trading', body: PLAN_BODY, tags: extractTags(PLAN_BODY), pinned: true, createdAt: now - 1, updatedAt: now - 1 },
      ];
      await db.notes.bulkAdd(seed);
      notes = seed;
    }
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    set({ notes, ready: true, activeId: get().activeId ?? notes[0]?.id ?? null });
  },

  async create(title = 'Nouvelle note', body = '', tags = []) {
    const now = Date.now();
    let finalTitle = title;
    let i = 2;
    while (byTitle(get().notes, finalTitle)) finalTitle = `${title} ${i++}`;
    const note: Note = { id: uid('n'), title: finalTitle, body, tags: [...new Set([...tags, ...extractTags(body)])], createdAt: now, updatedAt: now };
    await db.notes.add(note);
    set({ notes: [note, ...get().notes], activeId: note.id });
    return note;
  },

  async update(id, patch) {
    const cur = get().notes.find((n) => n.id === id);
    if (!cur) return;
    const next: Note = { ...cur, ...patch, updatedAt: Date.now() };
    if (patch.body !== undefined) next.tags = extractTags(patch.body);
    await db.notes.put(next);
    set({ notes: [next, ...get().notes.filter((n) => n.id !== id)] });
  },

  async remove(id) {
    await db.notes.delete(id);
    const notes = get().notes.filter((n) => n.id !== id);
    set({ notes, activeId: get().activeId === id ? notes[0]?.id ?? null : get().activeId });
  },

  setActive: (id) => set({ activeId: id }),

  async openByTitle(title) {
    const existing = byTitle(get().notes, title);
    if (existing) {
      set({ activeId: existing.id });
      return existing;
    }
    return get().create(title.trim(), `# ${title.trim()}\n\n`);
  },

  async dailyNote(date, seed) {
    const title = `Journal ${date}`;
    const existing = byTitle(get().notes, title);
    if (existing) {
      set({ activeId: existing.id });
      return existing;
    }
    const body = seed ?? `# ${title}\n\n## Contexte\n\n\n## Exécution\n\n\n## Leçon du jour\n\n\n#journal`;
    return get().create(title, body);
  },
}));
