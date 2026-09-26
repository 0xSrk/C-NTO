import { parseNoteHeader, writeNoteStatut } from '@/engine/ontology/header';
import { splitCode } from '@/engine/ontology/text';
import { tr } from '@/i18n';
import { create } from 'zustand';
import { uid } from '@/lib/id';
import { db, type Note } from './db';
import { scheduleOntologyRecompute } from './ontology-schedule';

export { splitCode };

export const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;

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

const WELCOME_BODY_EN = `# Welcome to the vault

This vault works like **Obsidian**: Markdown notes linked with \`[[double brackets]]\`.

- Type \`[[\` to link an existing note or create one: [[Trading plan]]
- Hash words become tags: #method #discipline
- The *Backlinks* panel shows what points at the current note.
- The **Graph** view draws your note network.

## Session ritual

1. Before the open: reread [[Trading plan]] and today's calendar.
2. After the session: create the daily note from **Metrics** (*Journal* button).
3. On the weekend: weekly review → [[Weekly review]].

> The daily note is one click: **Note of the day** button.
`;

const WELCOME_BODY_ES = `# Bienvenida a la caja

Esta caja funciona como **Obsidian**: notas Markdown unidas por enlaces \`[[doble corchete]]\`.

- Escribe \`[[\` para enlazar una nota o crear una: [[Plan de trading]]
- Las palabras con almohadilla son etiquetas: #método #disciplina
- El panel *Enlaces entrantes* muestra quién apunta a la nota actual.
- La vista **Grafo** dibuja la red de tus notas.

## Ritual de sesión

1. Antes de la apertura: releer [[Plan de trading]] y el calendario del día.
2. Después de la sesión: crear la nota del día desde **Métrica** (botón *Diario*).
3. El fin de semana: revisión semanal → [[Revisión semanal]].

> La nota del día se crea en un clic: botón **Nota del día**.
`;

const PLAN_BODY_EN = `# Trading plan

**Instrument**: NQ / MNQ (CME Globex)
**Window**: 15:30 → 17:30 Paris (9:30 → 11:30 ET)
**Max risk / trade**: 0.5% · **Max loss / day**: 1.5%

## Allowed setups
- Opening Range Breakout 15 min (see [[Welcome to the vault]])
- VWAP reclaim in trend

## Forbidden
- Trading 10 min around a release #calendar
- Re-entering after 2 consecutive losses #discipline
`;

const PLAN_BODY_ES = `# Plan de trading

**Instrumento**: NQ / MNQ (CME Globex)
**Ventana**: 15:30 → 17:30 París (9:30 → 11:30 ET)
**Riesgo máx. / trade**: 0,5 % · **Pérdida máx. / día**: 1,5 %

## Setups permitidos
- Opening Range Breakout 15 min (ver [[Bienvenida a la caja]])
- Recuperación del VWAP en tendencia

## Prohibido
- Operar 10 min alrededor de una publicación #calendario
- Reentrar tras 2 pérdidas seguidas #disciplina
`;

interface NotesState {
  ready: boolean;
  notes: Note[];
  activeId: string | null;
  load: () => Promise<void>;
  create: (title?: string, body?: string, tags?: string[]) => Promise<Note>;
  update: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'statut'>>) => Promise<void>;
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
      const welcomeTitle = tr('Bienvenue dans le coffre', 'Welcome to the vault', 'Bienvenida a la caja');
      const welcomeBody = tr(WELCOME_BODY, WELCOME_BODY_EN, WELCOME_BODY_ES);
      const planTitle = tr('Plan de trading', 'Trading plan', 'Plan de trading');
      const planBody = tr(PLAN_BODY, PLAN_BODY_EN, PLAN_BODY_ES);
      const seed: Note[] = [
        { id: uid('n'), title: welcomeTitle, body: welcomeBody, tags: extractTags(welcomeBody), pinned: true, createdAt: now, updatedAt: now },
        { id: uid('n'), title: planTitle, body: planBody, tags: extractTags(planBody), pinned: true, createdAt: now - 1, updatedAt: now - 1 },
      ];
      await db.notes.bulkAdd(seed);
      return seed;
    });
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    const current = get().activeId;
    set({ notes, ready: true, activeId: current && notes.some((n) => n.id === current) ? current : notes[0]?.id ?? null });
  },

  async create(title = tr('Nouvelle note', 'New note', 'Nueva nota'), body = '', tags = []) {
    const now = Date.now();
    let finalTitle = title;
    let i = 2;
    while (byTitle(get().notes, finalTitle)) finalTitle = `${title} ${i++}`;
    const header = parseNoteHeader(body);
    const note: Note = {
      id: uid('n'),
      title: finalTitle,
      body,
      tags: [...new Set([...tags, ...extractTags(body)])],
      ...(header.statut ? { statut: header.statut } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await db.notes.add(note);
    set({ notes: [note, ...get().notes], activeId: note.id });
    scheduleOntologyRecompute();
    return note;
  },

  async update(id, patch) {
    if (!get().notes.some((n) => n.id === id)) return;
    // Mise à jour partielle : aucun instantané pris avant l'attente n'est réécrit, donc deux
    // patches entrelacés (épingle + corps différé) se cumulent au lieu de s'écraser.
    const delta: Partial<Note> = { ...patch, updatedAt: Date.now() };
    if (patch.statut !== undefined && patch.body === undefined) {
      const cur = get().notes.find((n) => n.id === id);
      if (cur) delta.body = writeNoteStatut(cur.body, patch.statut);
    } else if (patch.body !== undefined && patch.statut !== undefined) {
      delta.body = writeNoteStatut(patch.body, patch.statut);
    }
    if (delta.body !== undefined) {
      delta.tags = extractTags(delta.body);
      if (patch.statut === undefined) {
        const header = parseNoteHeader(delta.body);
        if (header.statut) delta.statut = header.statut;
      }
    }
    await db.notes.update(id, delta);
    set((s) => {
      const cur = s.notes.find((n) => n.id === id);
      if (!cur) return {};
      const next: Note = { ...cur, ...delta };
      return { notes: [next, ...s.notes.filter((n) => n.id !== id)] };
    });
    scheduleOntologyRecompute();
  },

  async remove(id) {
    await db.notes.delete(id);
    const notes = get().notes.filter((n) => n.id !== id);
    set({ notes, activeId: get().activeId === id ? notes[0]?.id ?? null : get().activeId });
    scheduleOntologyRecompute();
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
    const body = seed ?? tr(`# ${title}\n\n## Contexte\n\n\n## Exécution\n\n\n## Leçon du jour\n\n\n#journal`, `# ${title}\n\n## Context\n\n\n## Execution\n\n\n## Lesson of the day\n\n\n#journal`, `# ${title}\n\n## Contexto\n\n\n## Ejecución\n\n\n## Lección del día\n\n\n#journal`);
    return get().create(title, body);
  },
}));
