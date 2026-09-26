export const ENTITY_TYPES = ['note', 'session', 'trade', 'instrument', 'strategie', 'evenement', 'compte'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityRef {
  type: EntityType;
  /** Clé de la table source : note.id, session.id, trade.id, instrument.symbol, evenement.id, nom de compte. */
  id: string;
}

export const PREDICATES = ['mentionne', 'pendant', 'de-la-seance', 'applique', 'soutient', 'contredit', 'raffine', 'partie-de', 'cause', 'relie'] as const;
export type Predicate = (typeof PREDICATES)[number];

export const LINK_KINDS = ['structurel', 'affirme', 'hypothese', 'rejete'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_AUTHORS = ['moteur', 'utilisateur'] as const;
export type LinkAuthor = (typeof LINK_AUTHORS)[number];

export interface Link {
  /** `${from.type}:${from.id}|${predicate}|${to.type}:${to.id}` */
  id: string;
  from: EntityRef;
  to: EntityRef;
  predicate: Predicate;
  kind: LinkKind;
  /** Similarité 0..1. Hypothèses seulement. */
  score?: number;
  by: LinkAuthor;
  createdAt: number;
  updatedAt: number;
}

export function entityKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

export function linkId(from: EntityRef, predicate: Predicate, to: EntityRef): string {
  return `${entityKey(from)}|${predicate}|${entityKey(to)}`;
}

/** Paire non ordonnée : une hypothèse lexicale est symétrique. */
export function unorderedPairKey(a: EntityRef, b: EntityRef): string {
  const ka = entityKey(a);
  const kb = entityKey(b);
  return ka <= kb ? `${ka}||${kb}` : `${kb}||${ka}`;
}

export function canonicalPair(a: EntityRef, b: EntityRef): [EntityRef, EntityRef] {
  return entityKey(a) <= entityKey(b) ? [a, b] : [b, a];
}
