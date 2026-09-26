export { NOTE_STATUTS, bodyWithoutHeader, parseNoteHeader, slugifyTitle, writeNoteStatut } from '@/engine/ontology/header';
export type { NoteHeader, NoteStatut } from '@/engine/ontology/header';

const PLACEHOLDER = /^(?:nouvelle note|new note|nueva nota)(?: \d+)?$/i;

/** Première ligne utile, si le titre est encore le placeholder. */
export function suggestNoteTitle(current: string, body: string): string | null {
  if (!PLACEHOLDER.test(current.trim())) return null;
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const text = line.replace(/^#{1,6}\s+/, '').trim();
  if (!text || PLACEHOLDER.test(text)) return null;
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}
