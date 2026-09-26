import { describe, expect, it } from 'vitest';
import { buildCorpus, similarity, suggestLinks } from '@/engine/ontology';
import type { Link } from '@/engine/ontology/schema';
import type { OntologyNote } from '@/engine/ontology/structural';

function note(id: string, title: string, body: string, tags: string[] = []): OntologyNote {
  return { id, title, body, tags };
}

describe('similarité lexicale', () => {
  const a = note('a', 'ORB du matin', 'Le breakout de l’ouverture tient quand le volume confirme le niveau.', ['orb']);
  const copy = note('b', 'ORB du matin', 'Le breakout de l’ouverture tient quand le volume confirme le niveau.', ['orb']);
  const other = note('c', 'Cuisine', 'Recette de soupe aux lentilles et au cumin.', ['recette']);
  const coded = note('d', 'extrait', 'Rien de commun ici.\n```\nbreakout ouverture volume niveau\n```\n', []);
  const prose = note('e', 'autre', 'breakout ouverture volume niveau', []);

  it('est déterministe', () => {
    const notes = [a, copy, other, coded, prose];
    const first = suggestLinks(notes, buildCorpus(notes), { topK: 5, min: 0.35, now: 10 });
    const second = suggestLinks(notes, buildCorpus(notes), { topK: 5, min: 0.35, now: 10 });
    expect(second).toEqual(first);
    const corpus = buildCorpus(notes);
    expect(similarity(a, copy, corpus)).toBe(similarity(a, copy, buildCorpus(notes)));
  });

  it('vaut 1 pour deux notes identiques et 0 sans mot ni tag en commun', () => {
    const corpus = buildCorpus([a, copy, other]);
    expect(similarity(a, copy, corpus)).toBe(1);
    expect(similarity(a, other, corpus)).toBe(0);
  });

  it('ignore les blocs de code', () => {
    const corpus = buildCorpus([coded, prose]);
    expect(similarity(coded, prose, corpus)).toBe(0);
  });

  it('ne resuggère pas une paire rejetée, une seule hypothèse par paire', () => {
    const notes = [a, copy];
    const corpus = buildCorpus(notes);
    const first = suggestLinks(notes, corpus, { topK: 5, min: 0.35, now: 1 });
    expect(first).toHaveLength(1);
    expect(first[0]?.kind).toBe('hypothese');
    expect(first[0]?.predicate).toBe('relie');
    expect(first[0]?.score).toBe(1);
    const rejected: Link = { ...first[0]!, kind: 'rejete', by: 'utilisateur' };
    const second = suggestLinks(notes, corpus, { topK: 5, min: 0.35, existing: [rejected], now: 2 });
    expect(second).toEqual([]);
  });
});
