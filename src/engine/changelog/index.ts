/**
 * Journal des versions, source unique.
 * Importé par le renderer, et par le process principal via le lien
 * `electron/changelog` (même motif que l'instantané calendrier).
 * Aucun accès réseau, aucun DOM : la lecture de l'asset GitHub reste dans `electron/`.
 */

import raw from './changelog.json';

export const CHANGELOG_KINDS = ['correctif', 'fonctionnalite', 'majeur'] as const;
export type ChangelogKind = (typeof CHANGELOG_KINDS)[number];

export const CHANGELOG_LOCALES = ['fr', 'en', 'es'] as const;
export type ChangelogLocale = (typeof CHANGELOG_LOCALES)[number];

/** Plafond de l'asset `changelog.json` lu sur la Release. */
export const CHANGELOG_MAX_BYTES = 64 * 1024;

export interface ChangelogHighlights {
  fr: string[];
  en: string[];
  es: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  kind: ChangelogKind;
  highlights: ChangelogHighlights;
}

export interface ChangelogFile {
  schemaVersion: 1;
  entries: ChangelogEntry[];
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Même sémantique que `electron/semver.ts` : 1 si a > b, -1 si a < b, 0 si égal. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function stripVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map((x) => Number(x));
  if (y === undefined || m === undefined || d === undefined) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parsePoints(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const points: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return null;
    points.push(item);
  }
  return points;
}

function parseEntry(value: unknown): ChangelogEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.version !== 'string' || !VERSION_RE.test(value.version)) return null;
  if (typeof value.date !== 'string' || !isRealDate(value.date)) return null;
  if (typeof value.kind !== 'string' || !CHANGELOG_KINDS.includes(value.kind as ChangelogKind)) return null;
  if (!isRecord(value.highlights)) return null;
  const fr = parsePoints(value.highlights.fr);
  const en = parsePoints(value.highlights.en);
  const es = parsePoints(value.highlights.es);
  if (!fr || !en || !es) return null;
  if (fr.length !== en.length || fr.length !== es.length) return null;
  return { version: value.version, date: value.date, kind: value.kind as ChangelogKind, highlights: { fr, en, es } };
}

/** `null` si le document ne respecte pas le schéma (versions uniques, tri croissant). */
export function parseChangelog(value: unknown): ChangelogFile | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) return null;
  const entries: ChangelogEntry[] = [];
  let previous: string | null = null;
  for (const item of value.entries) {
    const entry = parseEntry(item);
    if (!entry) return null;
    if (previous !== null && compareSemver(entry.version, previous) <= 0) return null;
    previous = entry.version;
    entries.push(entry);
  }
  return { schemaVersion: 1, entries };
}

/**
 * Texte d'un asset Release. Rejette au-delà de 64 Ko, le JSON illisible et le schéma invalide.
 * Le rendu ne reçoit jamais ce texte brut : seulement l'objet validé, affiché en texte.
 */
export function parseChangelogPayload(payload: string): ChangelogFile | null {
  if (typeof payload !== 'string') return null;
  if (new TextEncoder().encode(payload).byteLength > CHANGELOG_MAX_BYTES) return null;
  try {
    return parseChangelog(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

/** URL https dont l'hôte est GitHub ou un CDN `githubusercontent.com`. */
export function isGithubHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com');
}

const parsed = parseChangelog(raw);
if (!parsed) throw new Error('src/engine/changelog/changelog.json est invalide');

export const changelog: ChangelogFile = parsed;

/** Versions strictement postérieures à `version`, de la plus ancienne à la plus récente. */
export function entriesSince(version: string, doc: ChangelogFile = changelog): ChangelogEntry[] {
  const key = stripVersion(version);
  if (!VERSION_RE.test(key)) return [];
  return doc.entries.filter((entry) => compareSemver(entry.version, key) > 0);
}

export function entryFor(version: string, doc: ChangelogFile = changelog): ChangelogEntry | null {
  const key = stripVersion(version);
  return doc.entries.find((entry) => entry.version === key) ?? null;
}
