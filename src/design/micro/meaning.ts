import type { EntityType } from '@/engine/ontology';
import { GLYPH_ID, type GlyphName } from '../Micro';

/**
 * La table sens → numéro (Système 5 « Fiche et Frise », décision 5 de l'ADMIN, 2026-11-01). Chaque donnée que le desk
 * marque d'un glyphe — un type d'objet, un état, une garde — prend un composant de la planche des 150, un seul, et un
 * composant ne dit qu'un sens. Les signes réservés du châssis ne marquent jamais une donnée (tests/glyph-table.test.ts).
 */

/** Un glyphe par type d'objet de l'ontologie. Note, instrument et stratégie sont des masters du dépôt (`assets.ts`). */
export const TYPE_GLYPH = {
  session: 'session', // C.094, le U d'une séance
  trade: 'trade', // C.035, de l'entrée à la sortie
  evenement: 'catalyst', // C.090, le catalyseur sur l'axe du temps
  compte: 'account', // C.065, la limite qu'on règle
  instrument: 'sectorMarkets', // C.100, S.01 Marchés
  note: 'note', // C.091, l'emblème de Note
  strategie: 'layerDoctrine', // C.041, la doctrine d'emploi
} as const satisfies Readonly<Record<EntityType, GlyphName>>;

/** Les états et les gardes qu'un glyphe dit, chacun le sien ; le nom du glyphe dit le sens. */
export const STATE_GLYPHS = [
  'refused', // C.042 : ce qui n'a pas eu lieu — refus de la garde ou de l'opérateur, hypothèse rejetée, compte que le kill switch n'a pas aplati — sans rouge
  'stale', // C.013 : une valeur vive lue au-delà de son âge
  'partial', // C.054 : une source incomplète
  'drift', // C.024 : un écart de discipline
  'guard', // C.070 : la garde du process principal
  'flatten', // C.073 : une position ramenée à zéro
  'reduceRisk', // C.105 : l'ordre qui réduit le risque, qui passe toujours
  'traderRule', // C.109 : les règles du trader
  'floorTrailing', // C.125 : le plancher qui suit encore ; fixé, il prend C.126
  'margin', // C.140 : la marge avant le plancher
  'proposal', // C.092 : la proposition de l'agent, de la garde au siège de l'opérateur
] as const satisfies readonly GlyphName[];

/** Les signes réservés du châssis, chacun à son seul sens : aucun ne marque une donnée. */
export const RESERVED_GLYPHS: Readonly<Record<number, string>> = {
  131: 'signal 1, veille',
  12: 'signal 2, attention',
  123: 'signal 3, critique',
  27: 'maintenant',
  124: 'coffre',
  126: 'borne du plancher',
  141: 'restaurer',
  142: 'mire du creux',
};

/** La table sens → numéro : chaque type d'objet (`type.session`…) et chaque état, avec son numéro sur la planche. */
export const MEANING: Readonly<Record<string, number>> = Object.fromEntries([
  ...Object.entries(TYPE_GLYPH).map(([type, name]) => [`type.${type}`, GLYPH_ID[name]] as const),
  ...STATE_GLYPHS.map((name) => [name, GLYPH_ID[name]] as const),
]);
