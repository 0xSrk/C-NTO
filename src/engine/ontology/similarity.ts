import { bodyWithoutHeader } from './header';
import { canonicalPair, linkId, unorderedPairKey, type Link } from './schema';
import type { OntologyNote } from './structural';
import { proseOf } from './text';

/**
 * Poids du titre dans le TF. Le corps compte pour 1.
 * Dans ce coffre les liens structurels portent la vérité : le lexical ne fait que suggérer.
 * C'est l'inverse d'un wiki de prose, d'où un plancher haut (`SUGGEST_MIN`) et un Jaccard minoritaire.
 */
export const TITLE_TF_WEIGHT = 3;
export const COSINE_WEIGHT = 0.7;
export const JACCARD_WEIGHT = 0.3;
export const SUGGEST_MIN = 0.35;
export const SUGGEST_TOP_K = 5;

/** Liste courte. `es` (espagnol) est un mot vide : le symbole ES, lui, passe par le lien structurel. */
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'à', 'a', 'en', 'dans', 'pour', 'par', 'sur', 'avec', 'sans', 'ce', 'cet', 'cette', 'ces', 'qui', 'que', 'ne', 'pas', 'plus', 'est', 'sont', 'au', 'aux', 'on', 'il', 'elle', 'nous', 'vous', 'je', 'tu', 'se', 'son', 'sa', 'ses', 'leur', 'leurs', 'mais', 'donc', 'car', 'ni', 'comme', 'si', 'tout', 'tous',
  'the', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'without', 'is', 'are', 'was', 'were', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'not', 'but',
  'el', 'los', 'las', 'una', 'del', 'y', 'para', 'por', 'con', 'sin', 'es', 'son', 'su', 'sus', 'al', 'lo',
]);

const TOKEN = /[\p{L}\p{N}_]+/gu;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    const t = m[0];
    if (!t || t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

interface DocVec {
  weights: Map<string, number>;
  norm: number;
  tags: Set<string>;
}

export interface Corpus {
  docs: Map<string, DocVec>;
}

function termFreq(note: OntologyNote): Map<string, number> {
  const tf = new Map<string, number>();
  const add = (tokens: string[], weight: number) => {
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + weight);
  };
  add(tokenize(note.title), TITLE_TF_WEIGHT);
  add(tokenize(proseOf(bodyWithoutHeader(note.body))), 1);
  return tf;
}

export function buildCorpus(notes: readonly OntologyNote[]): Corpus {
  const prepared = notes.map((note) => ({
    id: note.id,
    tf: termFreq(note),
    tags: new Set(note.tags.map((t) => t.toLowerCase())),
  }));
  const df = new Map<string, number>();
  for (const doc of prepared) {
    for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = notes.length;
  const idf = new Map<string, number>();
  for (const [term, d] of df) idf.set(term, Math.log((n + 1) / (d + 1)) + 1);
  const docs = new Map<string, DocVec>();
  for (const doc of prepared) {
    const weights = new Map<string, number>();
    let sum = 0;
    for (const [term, tf] of doc.tf) {
      const w = tf * (idf.get(term) ?? 0);
      weights.set(term, w);
      sum += w * w;
    }
    docs.set(doc.id, { weights, norm: Math.sqrt(sum), tags: doc.tags });
  }
  return { docs };
}

function vectorsEqual(a: DocVec, b: DocVec): boolean {
  if (a.weights.size !== b.weights.size) return false;
  for (const [k, v] of a.weights) if (b.weights.get(k) !== v) return false;
  return true;
}

function tagsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function cosine(a: DocVec, b: DocVec): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  let dot = 0;
  const [small, big] = a.weights.size <= b.weights.size ? [a.weights, b.weights] : [b.weights, a.weights];
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (a.norm * b.norm);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function normalized(note: OntologyNote): string {
  return `${note.title.trim().toLowerCase()}\n${proseOf(bodyWithoutHeader(note.body)).trim().toLowerCase()}`;
}

/** Similarité dans [0, 1]. Deux contenus identiques (mots et tags) valent 1. Aucun mot ni tag en commun vaut 0. */
export function similarity(a: OntologyNote, b: OntologyNote, corpus: Corpus): number {
  const da = corpus.docs.get(a.id);
  const db = corpus.docs.get(b.id);
  if (!da || !db) return 0;
  if (vectorsEqual(da, db) && tagsEqual(da.tags, db.tags)) {
    if (da.weights.size > 0 || da.tags.size > 0) return 1;
    return normalized(a) === normalized(b) ? 1 : 0;
  }
  const score = COSINE_WEIGHT * cosine(da, db) + JACCARD_WEIGHT * jaccard(da.tags, db.tags);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return round6(Math.min(1, score));
}

export interface SuggestOptions {
  topK: number;
  min: number;
  existing?: readonly Link[];
  now?: number;
}

/**
 * Hypothèses `relie` seulement. Une paire non ordonnée, un seul lien.
 * Un lien déjà `affirme` ou `rejete` sur la même paire n'est jamais resuggéré.
 */
export function suggestLinks(notes: readonly OntologyNote[], corpus: Corpus, opts: SuggestOptions): Link[] {
  const blocked = new Set<string>();
  for (const link of opts.existing ?? []) {
    if (link.kind === 'affirme' || link.kind === 'rejete') blocked.add(unorderedPairKey(link.from, link.to));
  }
  const ordered = [...notes].sort((a, b) => a.id.localeCompare(b.id));
  const best = new Map<string, Link>();
  const now = opts.now ?? 0;
  for (const note of ordered) {
    const ranked: { other: OntologyNote; score: number }[] = [];
    for (const other of ordered) {
      if (other.id === note.id) continue;
      const fromRef = { type: 'note' as const, id: note.id };
      const toRef = { type: 'note' as const, id: other.id };
      if (blocked.has(unorderedPairKey(fromRef, toRef))) continue;
      const score = similarity(note, other, corpus);
      if (score < opts.min) continue;
      ranked.push({ other, score });
    }
    ranked.sort((a, b) => b.score - a.score || a.other.id.localeCompare(b.other.id));
    for (const hit of ranked.slice(0, opts.topK)) {
      const [from, to] = canonicalPair({ type: 'note', id: note.id }, { type: 'note', id: hit.other.id });
      const id = linkId(from, 'relie', to);
      const prev = best.get(id);
      if (prev && (prev.score ?? 0) >= hit.score) continue;
      best.set(id, {
        id,
        from,
        to,
        predicate: 'relie',
        kind: 'hypothese',
        score: hit.score,
        by: 'moteur',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}
