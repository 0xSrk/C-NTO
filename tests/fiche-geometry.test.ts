import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorCounts,
  dayMargin,
  EGO_COMPACT_BELOW,
  EGO_MAX_RAYS,
  egoBox,
  egoFrame,
  egoLayout,
  egoNodes,
  groupNeighbors,
  kindCounts,
  mirror,
  neighborsOf,
  orderGroups,
  planReading,
  rDomain,
  rScale,
  type EgoNode,
} from '@/engine/ontology';
import { SAMPLE_FAIBLE, SAMPLE_MOYEN, SAMPLE_SOLIDE } from '@/engine/ontology/confidence';
import { linkId, type EntityRef, type Link } from '@/engine/ontology/schema';
import type { Session, Trade } from '@/engine/types';
import { fmtUsd } from '@/lib/format';

/** OROS5.6 : la géométrie de la fiche vient du moteur, en fonctions pures. */

const S: EntityRef = { type: 'session', id: 's1' };

function link(from: EntityRef, predicate: Link['predicate'], to: EntityRef, kind: Link['kind'] = 'structurel', by: Link['by'] = 'moteur', score?: number): Link {
  return { id: linkId(from, predicate, to), from, to, predicate, kind, score, by, createdAt: 0, updatedAt: 0 };
}

const node = (id: string, type: EgoNode['type'], kind: EgoNode['kind'] = 'structurel', score?: number): EgoNode => ({ id, group: `g:${type}`, type, kind, score, count: 1 });

function session(id: string, pnl: number): Session {
  return { id, date: '2026-10-14', instruments: ['MNQ'], source: 'demo', tradeCount: 1, pnl, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, pnl: number): Trade {
  return { id, sessionId, instrument: 'MNQ', direction: 'long', qty: 1, entryTime: 0, exitTime: 1, entryPrice: 1, exitPrice: 1, pnl, commission: 0 };
}

describe('OROS5.6 · voisinage d’une fiche', () => {
  it('groupé par prédicat, sens et type, avec son compte, son genre et son auteur ; les rejetés comptés à part', () => {
    const links = [
      link({ type: 'trade', id: 't1' }, 'de-la-seance', S),
      link({ type: 'trade', id: 't2' }, 'de-la-seance', S),
      link(S, 'pendant', { type: 'evenement', id: 'bls:cpi' }),
      link({ type: 'note', id: 'n1' }, 'relie', S, 'hypothese', 'moteur', 0.6),
      link({ type: 'note', id: 'n2' }, 'relie', S, 'rejete', 'utilisateur'),
      link({ type: 'note', id: 'n3' }, 'relie', S, 'affirme', 'agent'),
      link({ type: 'trade', id: 't9' }, 'de-la-seance', { type: 'session', id: 'autre' }),
    ];
    const neighbors = neighborsOf(S, links);
    // le lien d'une autre séance n'est pas un voisin
    expect(neighbors).toHaveLength(6);
    const groups = groupNeighbors(neighbors);
    expect(groups.map((g) => [g.id, g.count, g.rejected])).toEqual([
      ['in:de-la-seance:trade', 2, 0],
      ['out:pendant:evenement', 1, 0],
      ['in:relie:note', 2, 1],
    ]);
    const notes = groups.find((g) => g.id === 'in:relie:note')!;
    expect(notes.items.map((n) => n.ref.id).sort()).toEqual(['n1', 'n3']);
    expect(notes.kinds).toEqual({ structurel: 0, affirme: 1, hypothese: 1, rejete: 1 });
    expect(notes.authors).toEqual({ moteur: 1, utilisateur: 1, agent: 1 });
    // la provenance de la fiche, par genre et par auteur
    expect(kindCounts(neighbors)).toEqual({ structurel: 3, affirme: 1, hypothese: 1, rejete: 1 });
    expect(authorCounts(neighbors)).toEqual({ moteur: 4, utilisateur: 1, agent: 1 });
  });
});

describe('OROS5.6 · M.016, le graphe d’ego', () => {
  it('deux arcs : ce qui encadre en haut, les trades en bas, de gauche à droite dans l’ordre reçu', () => {
    const nodes = [node('e', 'evenement'), node('n', 'note'), node('t1', 'trade'), node('t2', 'trade'), node('t3', 'trade')];
    const box = egoBox(nodes.length);
    const { cy, rays } = egoLayout(nodes, box);
    const top = rays.filter((r) => r.type !== 'trade');
    const bottom = rays.filter((r) => r.type === 'trade');
    for (const r of top) expect(r.y).toBeLessThan(cy);
    for (const r of bottom) expect(r.y).toBeGreaterThan(cy);
    // le temps se lit comme une ligne, dans chaque arc
    expect(top.map((r) => r.x)).toEqual([...top.map((r) => r.x)].sort((a, b) => a - b));
    expect(bottom.map((r) => r.x)).toEqual([...bottom.map((r) => r.x)].sort((a, b) => a - b));
    // un nœud seul dans son arc part droit vers le haut
    const solo = egoLayout([node('c', 'evenement')], box).rays[0]!;
    expect(solo.angle).toBe(-90);
    expect(solo.anchor).toBe('middle');
  });

  it('les rayons d’un groupe suivent le temps, pas l’ordre du coffre ; un voisin sans heure passe en dernier', () => {
    const links = ['t9', 't1', 'tx', 't5'].map((id) => link({ type: 'trade', id }, 'de-la-seance', S));
    const at: Record<string, number> = { t1: 200, t5: 300, t9: 100 };
    const order = (rows: Link[]) => egoNodes(orderGroups(groupNeighbors(neighborsOf(S, rows)), (r) => at[r.id])).map((n) => n.ref?.id);
    expect(order(links)).toEqual(['t9', 't1', 't5', 'tx']);
    // le même coffre lu dans un autre ordre dessine le même graphe
    expect(order([...links].reverse())).toEqual(['t9', 't1', 't5', 'tx']);
    const box = egoBox(4);
    const xs = egoLayout(egoNodes(orderGroups(groupNeighbors(neighborsOf(S, links)), (r) => at[r.id])), box).rays.map((r) => [r.ref?.id, r.x] as const);
    expect(xs.map(([id]) => id)).toEqual(['t9', 't1', 't5', 'tx']);
    expect(xs.map(([, x]) => x)).toEqual([...xs.map(([, x]) => x)].sort((a, b) => a - b));
  });

  it('une hypothèse sûre est plus proche ; au-delà de huit liens, un nœud par groupe qui porte son compte', () => {
    const box = egoBox(5);
    const [sure, weak] = egoLayout([node('a', 'note', 'hypothese', 0.9), node('b', 'note', 'hypothese', 0.2)], box).rays;
    expect(sure!.reach).toBeLessThan(weak!.reach);
    expect(egoLayout([node('c', 'note', 'affirme', 0.9)], box).rays[0]!.reach).toBe(1);
    const many = Array.from({ length: 12 }, (_, i) => link({ type: 'trade', id: `t${i}` }, 'de-la-seance', S));
    const nodes = egoNodes(groupNeighbors(neighborsOf(S, [...many, link(S, 'pendant', { type: 'evenement', id: 'e' })])));
    expect(nodes.length).toBeLessThanOrEqual(EGO_MAX_RAYS);
    expect(nodes.find((n) => n.type === 'trade')?.count).toBe(12);
  });

  it('boîte compacte sous quatre liens, et le cadre rogne la moitié vide', () => {
    expect(EGO_COMPACT_BELOW).toBe(4);
    expect(egoBox(EGO_COMPACT_BELOW - 1).height).toBe(144);
    expect(egoBox(EGO_COMPACT_BELOW).height).toBeGreaterThan(144);
    // une séance à un trade : la moitié haute, vide, ne garde pas sa place
    const box = egoBox(1);
    const one = egoLayout([node('t', 'trade')], box);
    const frame = egoFrame(one, box);
    expect(frame.height).toBeLessThan(box.height);
    expect(frame.y).toBeGreaterThan(0);
    // la figure tient tout ce qu'elle montre : le nœud central, chaque nœud et son étiquette
    for (const r of one.rays) {
      expect(r.y - 11).toBeGreaterThanOrEqual(frame.y);
      expect(r.ly + 16).toBeLessThanOrEqual(frame.y + frame.height);
    }
    expect(one.cy - box.core).toBeGreaterThanOrEqual(frame.y);
  });
});

describe('OROS5.6 · M.022, un axe en R par fiche', () => {
  it('0 et −1 tombent au même endroit sur chaque ligne ; sans risque connu, pas d’axe', () => {
    const inputs = [
      { risk: 100, realizedR: 1.7, plannedRr: null },
      { risk: 100, realizedR: -0.9, plannedRr: 2.5 },
      { risk: null, realizedR: null, plannedRr: null },
    ];
    const domain = rDomain(inputs)!;
    expect(domain.lo).toBeCloseTo(-1.25, 10);
    expect(domain.hi).toBeCloseTo(2.75, 10);
    const a = rScale(inputs[0]!, domain)!;
    const b = rScale(inputs[1]!, domain)!;
    expect(a.at(0)).toBeCloseTo(b.at(0), 12);
    expect(a.at(-1)).toBeCloseTo(b.at(-1), 12);
    // sans axe commun, chaque ligne aurait le sien : c'est ce que la fiche ne fait plus
    expect(rScale(inputs[0]!)!.at(0)).not.toBeCloseTo(rScale(inputs[1]!)!.at(0), 3);
    expect(rScale(inputs[2]!, domain)).toBeNull();
    expect(rDomain([{ risk: null, realizedR: 1, plannedRr: null }])).toBeNull();
  });

  it('l’axe reste dans [−3 R, +5 R] ; le réalisé qui en sort se pose au bord et le dit', () => {
    const domain = rDomain([{ risk: 100, realizedR: 9, plannedRr: null }, { risk: 100, realizedR: -6, plannedRr: null }])!;
    expect(domain).toEqual({ lo: -3, hi: 5 });
    const wild = rScale({ risk: 100, realizedR: 9, plannedRr: null }, domain)!;
    expect(wild.clipped).toBe(true);
    expect(wild.at(9)).toBe(1);
    expect(rScale({ risk: 100, realizedR: 1, plannedRr: null }, domain)!.clipped).toBe(false);
  });
});

describe('OROS5.6 · M.036, le miroir et son échantillon', () => {
  it('l’ensemble face aux autres séances du même périmètre, chaque côté avec son échantillon', () => {
    // 9 trades dans l'ensemble (insuffisant), 31 hors (moyen)
    const sessions = [session('in', 90), session('out', -20)];
    const trades = [...Array.from({ length: 9 }, (_, i) => trade(`i${i}`, 'in', 10)), ...Array.from({ length: 31 }, (_, i) => trade(`o${i}`, 'out', i % 2 ? 1 : -1))];
    const out = mirror(sessions, trades, new Set(['in']));
    expect(out.inside).toMatchObject({ sessions: 1, trades: 9, net: 90, perSession: 90, winRate: 1, sample: 'insuffisant' });
    expect(out.outside).toMatchObject({ sessions: 1, trades: 31, net: -20, sample: 'moyen' });
    // un côté vide : ni réussite ni moyenne, jamais zéro
    const empty = mirror(sessions, trades, new Set(['in', 'out']));
    expect(empty.outside).toMatchObject({ sessions: 0, trades: 0, winRate: null, perSession: null, sample: 'insuffisant' });
  });

  it('les seuils du moteur : SAMPLE_FAIBLE, SAMPLE_MOYEN, SAMPLE_SOLIDE', () => {
    const at = (n: number) => mirror([session('s', 0)], Array.from({ length: n }, (_, i) => trade(`t${i}`, 's', 1)), new Set(['s'])).inside.sample;
    expect([at(SAMPLE_FAIBLE - 1), at(SAMPLE_FAIBLE), at(SAMPLE_MOYEN - 1), at(SAMPLE_MOYEN), at(SAMPLE_SOLIDE - 1), at(SAMPLE_SOLIDE)]).toEqual(['insuffisant', 'faible', 'faible', 'moyen', 'moyen', 'solide']);
  });
});

describe('OROS5.6 · planReading, la marge du jour ou « — »', () => {
  const margin = { date: '2026-04-10', highWater: 52_600, floor: 50_100, lastLow: 52_240, margin: 2_140 };

  it('la marge n’est « du jour » que si le plan est en cours sur la dernière séance réelle', () => {
    expect(planReading(null, null, '2026-10-26')).toEqual({ kind: 'none' });
    const current = planReading({ status: 'en-cours' }, { ...margin, date: '2026-10-26' }, '2026-10-26');
    expect(current).toMatchObject({ kind: 'current', margin: 2_140, floor: 50_100 });
    expect(dayMargin(current)).toBe(2_140);
    expect(fmtUsd(dayMargin(current))).not.toBe('—');
  });

  it('un plan clos garde sa marge datée, et la valeur du jour s’écrit « — »', () => {
    const passed = planReading({ status: 'objectif', passedOn: '2026-04-10' }, margin, '2026-10-26');
    expect(passed).toEqual({ kind: 'closed', status: 'objectif', date: '2026-04-10', margin: 2_140, floor: 50_100 });
    const failed = planReading({ status: 'echec', failedOn: '2026-05-02' }, { ...margin, date: '2026-05-02' }, '2026-10-26');
    expect(failed).toMatchObject({ kind: 'closed', status: 'echec', date: '2026-05-02' });
    // en cours, mais pas sur la dernière séance : datée, pas du jour
    const stale = planReading({ status: 'en-cours' }, margin, '2026-10-26');
    expect(stale.kind).toBe('closed');
    for (const reading of [passed, failed, stale, planReading(null, null, undefined)]) {
      expect(dayMargin(reading)).toBeNull();
      expect(fmtUsd(dayMargin(reading))).toBe('—');
    }
  });
});

/* ─── Pureté du moteur ─── */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Un import d'une couche que le moteur ne connaît pas : le store, un module, le châssis, le design, Electron. */
const FOREIGN = /^\s*import\s+(type\s+)?[^;]*?from\s+['"](@\/store|@\/modules|@\/app|@\/design|electron)(\/[^'"]*)?['"]/gm;

describe('OROS5.6 · la pureté du moteur reste tenue', () => {
  it('fiche.ts n’importe ni store, ni module, ni châssis, ni design, ni Electron', () => {
    const src = readFileSync('src/engine/ontology/fiche.ts', 'utf8');
    expect(src.match(FOREIGN) ?? []).toEqual([]);
    expect(src).not.toMatch(/\b(window|document|localStorage|desk)\b\s*[.?]/);
  });

  it('aucun fichier de src/engine n’importe une valeur du store, d’un module, du châssis, du design ni d’Electron', () => {
    const values: string[] = [];
    const types: string[] = [];
    for (const file of walk('src/engine')) {
      const src = readFileSync(file, 'utf8');
      // Sous Windows, `path.join` rend des `\` : le cliquet compare des chemins POSIX.
      for (const m of src.matchAll(FOREIGN)) (m[1] ? types : values).push(`${file.split(/[/\\]/).join('/')}: ${m[0].trim()}`);
    }
    expect(values).toEqual([]);
    // Un seul import de type, effacé à la compilation, reste au HEAD : la configuration de l'agent (cliquet).
    expect(types).toEqual(["src/engine/agent/llm.ts: import type { AgentConfig } from '@/store/settings'"]);
  });
});
