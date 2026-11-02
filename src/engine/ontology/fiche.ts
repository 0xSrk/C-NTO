/**
 * Fiche d'objet (OROS5.6) : le voisinage typé d'un objet de l'ontologie, et la géométrie des instruments de la
 * fiche — M.016 graphe d'ego, M.022 échelle en R, M.036 lecture miroir — avec la lecture du plan suivi.
 * Pur : ni store, ni module, ni Electron, ni DOM. Une valeur absente se rend absente (`null`, « — » à l'écran),
 * jamais une aiguille à zéro ; chaque repère vient d'une donnée ou d'une constante nommée.
 */
import { computeTradeStats } from '@/engine/metrics';
import type { PlanMargin, PropEvaluation } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { sampleOf, type ClaimConfidence } from './confidence';
import { entityKey, LINK_AUTHORS, LINK_KINDS, type EntityRef, type EntityType, type Link, type LinkAuthor, type LinkKind, type Predicate } from './schema';

/* ─── Voisinage ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** `out` : l'objet est la source du lien ; `in` : il en est la cible. */
export type Side = 'out' | 'in';

export interface Neighbor {
  ref: EntityRef;
  link: Link;
  side: Side;
}

/** Les liens qui touchent un objet, vus depuis lui. */
export function neighborsOf(ref: EntityRef, links: readonly Link[]): Neighbor[] {
  const key = entityKey(ref);
  const out: Neighbor[] = [];
  for (const link of links) {
    if (entityKey(link.from) === key) out.push({ ref: link.to, link, side: 'out' });
    else if (entityKey(link.to) === key) out.push({ ref: link.from, link, side: 'in' });
  }
  return out;
}

export interface NeighborGroup {
  /** `${side}:${predicate}:${type}` */
  id: string;
  predicate: Predicate;
  side: Side;
  type: EntityType;
  /** Les liens vivants du groupe : structurels, affirmés, hypothèses. */
  items: Neighbor[];
  /** Le compte des liens vivants (`items.length`) : la fiche le dit en tête du groupe. */
  count: number;
  /** Hypothèses rejetées : comptées, masquées par défaut. */
  rejected: number;
  /** Genre de chaque lien du groupe, rejetés compris : le trait de la ligne. */
  kinds: Record<LinkKind, number>;
  /** Auteur de chaque lien du groupe, rejetés compris : moteur, vous ou agent. */
  authors: Record<LinkAuthor, number>;
}

/** Ordre de lecture d'une fiche : ce qui compose l'objet, puis ce qui l'encadre, puis ce qui en parle. */
export const GROUP_ORDER: readonly string[] = [
  'in:de-la-seance:trade',
  'out:de-la-seance:session',
  'out:pendant:evenement',
  'in:pendant:session',
  'in:pendant:trade',
  'out:applique:strategie',
  'in:applique:session',
  'in:applique:trade',
  'in:de-la-seance:note',
  'in:pendant:note',
  'in:mentionne:note',
  'out:mentionne:instrument',
  'out:mentionne:strategie',
  'out:mentionne:compte',
];

function groupRank(id: string): number {
  const i = GROUP_ORDER.indexOf(id);
  return i < 0 ? GROUP_ORDER.length : i;
}

function zeroKinds(): Record<LinkKind, number> {
  return Object.fromEntries(LINK_KINDS.map((k) => [k, 0])) as Record<LinkKind, number>;
}

function zeroAuthors(): Record<LinkAuthor, number> {
  return Object.fromEntries(LINK_AUTHORS.map((a) => [a, 0])) as Record<LinkAuthor, number>;
}

/**
 * Les liens groupés par prédicat, sens et type, dans l'ordre de lecture (`GROUP_ORDER`, puis l'identifiant), avec
 * leur compte, leur genre et leur auteur. Les rejetés ne sont pas des voisins : ils sont comptés à part.
 */
export function groupNeighbors(list: readonly Neighbor[]): NeighborGroup[] {
  const groups = new Map<string, NeighborGroup>();
  for (const n of list) {
    const id = `${n.side}:${n.link.predicate}:${n.ref.type}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, predicate: n.link.predicate, side: n.side, type: n.ref.type, items: [], count: 0, rejected: 0, kinds: zeroKinds(), authors: zeroAuthors() };
      groups.set(id, group);
    }
    group.kinds[n.link.kind] += 1;
    group.authors[n.link.by] += 1;
    if (n.link.kind === 'rejete') group.rejected += 1;
    else {
      group.items.push(n);
      group.count += 1;
    }
  }
  return [...groups.values()].sort((a, b) => groupRank(a.id) - groupRank(b.id) || a.id.localeCompare(b.id));
}

/**
 * Les voisins de chaque groupe dans l'ordre du temps (le rang donné, en ms), puis de l'identifiant : le graphe se
 * dessine pareil à chaque ouverture, quel que soit l'ordre du coffre. Un voisin sans rang passe en dernier.
 */
export function orderGroups(groups: readonly NeighborGroup[], rankOf: (ref: EntityRef) => number | undefined): NeighborGroup[] {
  const at = (ref: EntityRef): number => {
    const v = rankOf(ref);
    return v != null && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  return groups.map((g) => ({ ...g, items: [...g.items].sort((a, b) => at(a.ref) - at(b.ref) || a.ref.id.localeCompare(b.ref.id)) }));
}

/** Compte par genre de lien : la provenance de la fiche. */
export function kindCounts(list: readonly Neighbor[]): Record<LinkKind, number> {
  const out = zeroKinds();
  for (const n of list) out[n.link.kind] += 1;
  return out;
}

/** Compte par auteur de lien : moteur, vous (`utilisateur`), agent. */
export function authorCounts(list: readonly Neighbor[]): Record<LinkAuthor, number> {
  const out = zeroAuthors();
  for (const n of list) out[n.link.by] += 1;
  return out;
}

/* ─── M.016 · graphe d'ego ─────────────────────────────────────────────────────────────────────────────────── */

/** Au-delà de huit rayons, les liens se regroupent par prédicat (M.016). */
export const EGO_MAX_RAYS = 8;

export interface EgoNode {
  id: string;
  /** Groupe d'origine (prédicat, sens, type). */
  group: string;
  type: EntityType;
  kind: LinkKind;
  score?: number;
  /** Nombre d'objets portés par le nœud : 1, ou la taille du groupe replié. */
  count: number;
  /** L'objet visé, s'il est seul. */
  ref?: EntityRef;
}

/**
 * Les nœuds du graphe : un par lien tant qu'il y en a huit au plus, sinon un par groupe de plus d'un lien (le nœud
 * porte son compte). Les rejetés n'y entrent pas.
 */
export function egoNodes(groups: readonly NeighborGroup[], max = EGO_MAX_RAYS): EgoNode[] {
  const live = groups.filter((g) => g.items.length > 0);
  const total = live.reduce((sum, g) => sum + g.items.length, 0);
  const nodes: EgoNode[] = [];
  for (const g of live) {
    if (total <= max || g.items.length === 1) {
      for (const n of g.items) nodes.push({ id: n.link.id, group: g.id, type: n.ref.type, kind: n.link.kind, score: n.link.score, count: 1, ref: n.ref });
    } else {
      const hypothesis = g.items.every((n) => n.link.kind === 'hypothese');
      nodes.push({ id: g.id, group: g.id, type: g.type, kind: hypothesis ? 'hypothese' : 'structurel', count: g.items.length });
    }
  }
  return nodes.slice(0, Math.max(max, 1));
}

export interface EgoBox {
  width: number;
  height: number;
  /** Demi-axes du rayonnement (ellipse). */
  rx: number;
  ry: number;
  /** Rayon du nœud central. */
  core: number;
}

/** Moins de quatre liens : la figure se ramène à 144 px, elle ne redit pas la liste sur deux cents. */
export const EGO_COMPACT_BELOW = 4;
/** Largeur de la figure dans la fiche de 400 px (mesure locale, aucun jeton). */
export const EGO_WIDTH = 368;
export const EGO_COMPACT_HEIGHT = 144;
export const EGO_FULL_HEIGHT = 212;

export function egoBox(count: number): EgoBox {
  return count < EGO_COMPACT_BELOW
    ? { width: EGO_WIDTH, height: EGO_COMPACT_HEIGHT, rx: 92, ry: 40, core: 14 }
    : { width: EGO_WIDTH, height: EGO_FULL_HEIGHT, rx: 88, ry: 70, core: 15 };
}

/** La moitié d'un nœud : ce qui compose l'objet (les trades) en bas, ce qui l'encadre (publication, séance, stratégie, note) en haut. */
export type EgoHalf = 'top' | 'bottom';

export function egoHalfOf(node: Pick<EgoNode, 'type'>): EgoHalf {
  return node.type === 'trade' ? 'bottom' : 'top';
}

export interface EgoRay extends EgoNode {
  /** Angle en degrés, 0 = droite, sens horaire (repère SVG). */
  angle: number;
  /** Départ du rayon, au bord du nœud central. */
  x1: number;
  y1: number;
  /** Centre du nœud. */
  x: number;
  y: number;
  /** Étiquette : ancrage et position. */
  anchor: 'start' | 'middle' | 'end';
  lx: number;
  ly: number;
  /** Longueur relative, 1 au plus : `0,45 + 0,55 × (1 − score)` pour une hypothèse. */
  reach: number;
}

/**
 * Géométrie du graphe d'ego : un arc par moitié. En haut, ce qui encadre l'objet ; en bas, ce qui le compose ; dans
 * chaque arc, les nœuds vont de gauche à droite dans l'ordre reçu (l'ordre du temps, `orderGroups`) : le temps se lit
 * comme une ligne. Un lien structurel ou affirmé va au bout ; une hypothèse s'arrête à `0,45 + 0,55 × (1 − score)` :
 * plus elle est sûre, plus elle est proche.
 */
export function egoLayout(nodes: readonly EgoNode[], box: EgoBox, halfOf: (node: EgoNode) => EgoHalf = egoHalfOf): { cx: number; cy: number; rays: EgoRay[] } {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const top = nodes.filter((node) => halfOf(node) === 'top');
  const bottom = nodes.filter((node) => halfOf(node) === 'bottom');
  // Haut : de −180° (gauche) à 0° (droite), par −90° ; bas : de 180° (gauche) à 0° (droite), par 90°. Repère SVG.
  const angleOf = (node: EgoNode): number => {
    const inTop = halfOf(node) === 'top';
    const arc = inTop ? top : bottom;
    const t = (arc.indexOf(node) + 0.5) / arc.length;
    return inTop ? -180 + 180 * t : 180 - 180 * t;
  };
  const rays = nodes.map((node): EgoRay => {
    const angle = angleOf(node);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const score = node.score != null && Number.isFinite(node.score) ? Math.min(1, Math.max(0, node.score)) : null;
    const reach = node.kind === 'hypothese' && score != null ? 0.45 + 0.55 * (1 - score) : 1;
    const x = cx + box.rx * reach * cos;
    const y = cy + box.ry * reach * sin;
    const anchor: EgoRay['anchor'] = Math.abs(cos) < 0.34 ? 'middle' : cos > 0 ? 'start' : 'end';
    const lx = anchor === 'middle' ? x : x + (cos > 0 ? 13 : -13);
    // Au-dessus d'un nœud du haut, l'étiquette et sa méta montent toutes deux ; sous un nœud du bas, elles descendent.
    const ly = anchor === 'middle' ? (sin < 0 ? y - 26 : y + 22) : y - 1;
    return { ...node, angle, x1: cx + box.core * cos, y1: cy + box.core * sin, x, y, anchor, lx, ly, reach };
  });
  return { cx, cy, rays };
}

/**
 * Le cadre utile de la figure : le nœud central, les nœuds et leurs étiquettes. Une moitié vide (aucun trade, ou rien
 * qui encadre) ne garde pas sa place : la figure ne fait que la hauteur de ce qu'elle montre.
 */
export function egoFrame(layout: { cy: number; rays: readonly Pick<EgoRay, 'y' | 'ly'>[] }, box: EgoBox, pad = 6): { y: number; height: number } {
  let top = layout.cy - box.core;
  let bottom = layout.cy + box.core;
  for (const ray of layout.rays) {
    top = Math.min(top, ray.y - 11, ray.ly - 11);
    // une étiquette porte sa méta une ligne plus bas
    bottom = Math.max(bottom, ray.y + 11, ray.ly + 16);
  }
  return { y: Math.floor(top - pad), height: Math.ceil(bottom - top + pad * 2) };
}

/* ─── M.022 · échelle en R d'un trade ──────────────────────────────────────────────────────────────────────── */

export interface RScaleInput {
  /** Risque connu (stop, saisi ou fixe) : sans lui, l'échelle n'existe pas. */
  risk: number | null;
  realizedR: number | null;
  plannedRr: number | null;
}

export interface RDomain {
  lo: number;
  hi: number;
}

export interface RScale extends RDomain {
  /** Position (0..1) d'une valeur en R sur l'axe. */
  at: (r: number) => number;
  /** Le réalisé sort de l'axe : il se pose au bord, et le dit. */
  clipped: boolean;
}

/** Bornes de l'axe en R : jamais en deçà de −1 R (le stop) ni d'un objectif connu ; au plus de −3 R à +5 R. */
export const R_FLOOR = -3;
export const R_CEIL = 5;
/** Marge de l'axe au-delà de la valeur extrême, en R. */
export const R_PAD = 0.25;

const finiteOrNull = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

/**
 * Un seul axe pour toute une fiche : de `min(−1, plus bas réalisé) − 0,25` à `max(1, plus haut objectif ou réalisé)
 * + 0,25`, dans [−3 R, +5 R]. Les trades d'une séance se comparent alors en R : 0 et −1 tombent au même endroit sur
 * chaque ligne. Sans aucun risque connu, pas d'axe.
 */
export function rDomain(inputs: readonly RScaleInput[]): RDomain | null {
  const known = inputs.filter((input) => input.risk != null && input.risk > 0);
  if (known.length === 0) return null;
  let lo = -1;
  let hi = 1;
  for (const input of known) {
    const real = finiteOrNull(input.realizedR);
    const plan = finiteOrNull(input.plannedRr);
    if (real != null) {
      lo = Math.min(lo, real);
      hi = Math.max(hi, real);
    }
    if (plan != null && plan > 0) hi = Math.max(hi, plan);
  }
  return { lo: Math.max(R_FLOOR, lo - R_PAD), hi: Math.min(R_CEIL, hi + R_PAD) };
}

/** L'échelle d'un trade, sur l'axe de la fiche (`domain`) ou, faute d'axe commun, sur le sien. */
export function rScale(input: RScaleInput, domain?: RDomain | null): RScale | null {
  if (input.risk == null || !(input.risk > 0)) return null;
  const real = finiteOrNull(input.realizedR);
  const own = domain ?? rDomain([input]);
  if (!own) return null;
  const { lo, hi } = own;
  const span = hi - lo;
  const clipped = real != null && (real < lo || real > hi);
  return { lo, hi, clipped, at: (r) => (span > 0 ? Math.min(1, Math.max(0, (r - lo) / span)) : 0.5) };
}

/* ─── M.036 · lecture miroir (pendant | hors) ──────────────────────────────────────────────────────────────── */

export interface MirrorSide {
  sessions: number;
  trades: number;
  /** Réussite, `null` sans trade. */
  winRate: number | null;
  net: number;
  /** P&L net moyen par séance, `null` sans séance. */
  perSession: number | null;
  /** L'échantillon du côté, aux seuils du moteur (`SAMPLE_FAIBLE`, `SAMPLE_MOYEN`, `SAMPLE_SOLIDE`), en trades. */
  sample: ClaimConfidence['sample'];
}

/** Les séances d'un ensemble face aux autres séances du même périmètre ; chaque côté dit son échantillon. */
export function mirror(sessions: readonly Session[], trades: readonly Trade[], inSet: ReadonlySet<string>): { inside: MirrorSide; outside: MirrorSide } {
  const side = (keep: (s: Session) => boolean): MirrorSide => {
    const rows = sessions.filter(keep);
    const ids = new Set(rows.map((s) => s.id));
    const own = trades.filter((t) => ids.has(t.sessionId));
    const stats = computeTradeStats([...own]);
    const net = rows.reduce((sum, s) => sum + (Number.isFinite(s.pnl) ? s.pnl : 0), 0);
    return {
      sessions: rows.length,
      trades: stats.count,
      winRate: stats.count > 0 ? stats.winRate : null,
      net,
      perSession: rows.length > 0 ? net / rows.length : null,
      sample: sampleOf(stats.count),
    };
  };
  return { inside: side((s) => inSet.has(s.id)), outside: side((s) => !inSet.has(s.id)) };
}

/* ─── Fiche Compte : la marge datée, telle qu'elle est ─────────────────────────────────────────────────────── */

/**
 * La lecture du plan suivi pour la fiche Compte. Le rejeu s'arrête à l'objectif atteint ou à l'échec : la marge de
 * `planMargin` est alors celle de ce jour-là, pas celle d'aujourd'hui. `current` seulement si le plan est en cours et
 * que la marge porte sur la dernière séance réelle du compte ; sinon `closed`, daté, et la valeur du jour est absente.
 */
export type PlanReading =
  | { kind: 'none' }
  | { kind: 'current'; date: string; margin: number; floor: number; highWater: number }
  | { kind: 'closed'; status: PropEvaluation['status']; date: string; margin: number; floor: number };

export function planReading(ev: Pick<PropEvaluation, 'status' | 'passedOn' | 'failedOn'> | null, margin: PlanMargin | null, lastSessionDate: string | undefined): PlanReading {
  if (!ev || !margin) return { kind: 'none' };
  if (ev.status === 'en-cours' && margin.date === lastSessionDate) return { kind: 'current', date: margin.date, margin: margin.margin, floor: margin.floor, highWater: margin.highWater };
  const date = ev.status === 'objectif' ? (ev.passedOn ?? margin.date) : ev.status === 'echec' ? (ev.failedOn ?? margin.date) : margin.date;
  return { kind: 'closed', status: ev.status, date, margin: margin.margin, floor: margin.floor };
}

/**
 * La marge du jour, au numéral de la fiche Compte : celle d'un plan en cours sur la dernière séance, sinon `null` —
 * « — » à l'écran pour un plan clos ou absent ; la marge datée reste dans la légende, avec sa date.
 */
export function dayMargin(reading: PlanReading): number | null {
  return reading.kind === 'current' ? reading.margin : null;
}
