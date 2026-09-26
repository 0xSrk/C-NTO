export const NOTE_STATUTS = ['fait', 'modele', 'chiffre-non-verifie', 'opinion'] as const;
export type NoteStatut = (typeof NOTE_STATUTS)[number];

export interface NoteHeader {
  statut?: NoteStatut;
  /** Journée de trading `YYYY-MM-DD`, si l'en-tête la porte. */
  date?: string;
  /** Alias de tag d'une note stratégie (`tag: orb` → `#orb`). */
  tag?: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const KEY_LINE = /^(statut|date|tag)\s*:/;

function hasKnownKey(block: string): boolean {
  return /^(statut|date|tag)\s*:/m.test(block);
}

/** En-tête YAML (`---`) ou lignes `clé: valeur` en tête. Le reste du corps est rendu tel quel. */
export function splitFrontMatter(body: string): { header: string | null; rest: string } {
  const fenced = FENCE.exec(body);
  if (fenced && fenced[1] !== undefined && hasKnownKey(fenced[1])) {
    return { header: fenced[1], rest: body.slice(fenced[0].length) };
  }
  const lines = body.split(/\r?\n/);
  const head: string[] = [];
  let i = 0;
  while (i < lines.length && KEY_LINE.test(lines[i] ?? '')) {
    head.push(lines[i] ?? '');
    i++;
  }
  if (head.length === 0) return { header: null, rest: body };
  return { header: head.join('\n'), rest: lines.slice(i).join('\n') };
}

export function bodyWithoutHeader(body: string): string {
  return splitFrontMatter(body).rest;
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).trim();
  return v;
}

export function parseNoteHeader(body: string): NoteHeader {
  const { header } = splitFrontMatter(body);
  if (!header) return {};
  const out: NoteHeader = {};
  for (const line of header.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = unquote(m[2] ?? '');
    if (key === 'statut' && (NOTE_STATUTS as readonly string[]).includes(value)) out.statut = value as NoteStatut;
    if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.date = value;
    if (key === 'tag') {
      const slug = value.toLowerCase().replace(/[^\p{L}\p{N}_/-]+/gu, '');
      if (slug) out.tag = slug;
    }
  }
  return out;
}

/** Titre → alias de tag. Les accents tombent, le reste non alphanumérique devient un tiret. */
export function slugifyTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Écrit `statut:` dans l'en-tête, sans toucher `date` ni `tag`. */
export function writeNoteStatut(body: string, statut: NoteStatut): string {
  const fenced = FENCE.exec(body);
  if (fenced && fenced[1] !== undefined && hasKnownKey(fenced[1])) {
    const lines = fenced[1].split(/\r?\n/).filter((l) => l.trim().length > 0 && !/^\s*statut\s*:/.test(l));
    const rest = body.slice(fenced[0].length).replace(/^\r?\n/, '');
    return `---\nstatut: ${statut}\n${lines.join('\n')}${lines.length ? '\n' : ''}---\n${rest}`;
  }
  const { header, rest } = splitFrontMatter(body);
  if (header) {
    const lines = header.split(/\r?\n/).filter((l) => l.trim().length > 0 && !/^\s*statut\s*:/.test(l));
    const tail = rest.replace(/^\r?\n/, '');
    return `---\nstatut: ${statut}\n${lines.join('\n')}${lines.length ? '\n' : ''}---\n${tail}`;
  }
  return `---\nstatut: ${statut}\n---\n${body}`;
}
