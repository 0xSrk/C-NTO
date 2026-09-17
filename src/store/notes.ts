import { create } from 'zustand';
import { uid } from '@/lib/id';
import { db, type Note } from './db';

export const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;

/** Segmente un Markdown en parties texte / code (blocs ``` et `inline`) pour ne transformer que le texte. */
export function splitCode(body: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: body.slice(last, i), code: false });
    parts.push({ text: m[0], code: true });
    last = i + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), code: false });
  return parts;
}

function prose(body: string): string {
  return splitCode(body)
    .filter((p) => !p.code)
    .map((p) => p.text)
    .join('\n');
}

export function extractLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of prose(body).matchAll(WIKILINK_RE)) {
    const t = m[1];
    if (t) out.add(t.trim().toLowerCase());
  }
  return [...out];
}

export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of prose(body).matchAll(TAG_RE)) {
    const t = m[2];
    if (t) out.add(t.toLowerCase());
  }
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
    const notes = await db.transaction('rw', db.notes, async () => {
      const existing = await db.notes.toArray();
      if (existing.length > 0) return existing;
      const now = Date.now();
      const seed: Note[] = [
        { id: uid('n'), title: WELCOME_TITLE, body: WELCOME_BODY, tags: extractTags(WELCOME_BODY), pinned: true, createdAt: now, updatedAt: now },
        { id: uid('n'), title: 'Plan de trading', body: PLAN_BODY, tags: extractTags(PLAN_BODY), pinned: true, createdAt: now - 1, updatedAt: now - 1 },
      ];
      await db.notes.bulkAdd(seed);
      return seed;
    });
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    const current = get().activeId;
    set({ notes, ready: true, activeId: current && notes.some((n) => n.id === current) ? current : notes[0]?.id ?? null });
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
