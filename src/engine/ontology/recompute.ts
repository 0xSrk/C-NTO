import { SUGGEST_MIN, SUGGEST_TOP_K, buildCorpus, suggestLinks } from './similarity';
import type { Link } from './schema';
import { unorderedPairKey } from './schema';
import { deriveStructuralLinks, reconcileStructural, type StructuralInput } from './structural';

/** Au-delà, le recalcul quitte le fil du renderer. */
export const ONTOLOGY_WORKER_NOTES = 2_000;
export const ONTOLOGY_WORKER_TRADES = 20_000;

function pairKey(link: Link): string {
  return unorderedPairKey(link.from, link.to);
}

/** Remplace les hypothèses moteur. Conserve `createdAt` si la paire et le score n'ont pas bougé. */
export function mergeHypotheses(base: readonly Link[], suggestions: readonly Link[], now: number): Link[] {
  const kept = base.filter((l) => l.kind !== 'hypothese');
  const prev = new Map(base.filter((l) => l.kind === 'hypothese').map((l) => [pairKey(l), l]));
  const next: Link[] = [];
  for (const suggestion of suggestions) {
    const old = prev.get(pairKey(suggestion));
    if (!old) {
      next.push({ ...suggestion, createdAt: now, updatedAt: now });
      continue;
    }
    if (old.score === suggestion.score && old.predicate === suggestion.predicate && old.id === suggestion.id) {
      next.push(old);
      continue;
    }
    next.push({
      ...old,
      id: suggestion.id,
      from: suggestion.from,
      to: suggestion.to,
      predicate: suggestion.predicate,
      score: suggestion.score,
      updatedAt: now,
    });
  }
  return [...kept, ...next].sort((a, b) => a.id.localeCompare(b.id));
}

/** Structurel réconcilié, puis hypothèses lexicales. Pur et déterministe à `now` près. */
export function recomputeOntology(input: StructuralInput, existing: readonly Link[], now: number): Link[] {
  const derived = deriveStructuralLinks(input);
  const kept = reconcileStructural(existing, derived, now);
  const corpus = buildCorpus(input.notes);
  const suggestions = suggestLinks(input.notes, corpus, {
    topK: SUGGEST_TOP_K,
    min: SUGGEST_MIN,
    existing: kept,
    now,
  });
  return mergeHypotheses(kept, suggestions, now);
}
