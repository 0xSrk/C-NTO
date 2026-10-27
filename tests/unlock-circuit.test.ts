import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEAL_HORIZON, sealShapes } from '@/design/Seal';
import { glyphDelays, SEAT_DOMINO } from '@/app/seatGlyphs';
import {
  AXIS_LANE,
  buildSpread,
  FOLD_MS,
  GOLD_AFTER_MS,
  HORIZON_MS,
  LANES,
  laneOf,
  pointAt,
  poly,
  reducedTimeline,
  rgbOf,
  RING_LEAD_MS,
  RING_MS,
  RING_STEP_MS,
  ringAround,
  ringArcs,
  routes,
  SEAL_HZ_TIP,
  SEAL_HZ_Y,
  sealMap,
  TRAVEL_MS,
  UNLOCK_GLYPH_MAX,
  UNLOCK_GLYPHS,
  UNLOCK_SEAL,
  unlockTimeline,
  WORD_MS,
  type Pt,
} from '@/app/unlockCircuit';

/** Intersection propre de deux segments (les extrémités partagées ne comptent pas). */
function crosses([a, b]: [Pt, Pt], [c, d]: [Pt, Pt]): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const segmentsOf = (pts: readonly Pt[]) => pts.slice(1).map((p, i): [Pt, Pt] => [pts[i]!, p]);

describe('OROS4.18 le circuit de l’ouverture', () => {
  it('les glyphes de la phrase tournent au pas du code d’accolades : même écart, même vie, même cadence', () => {
    expect(UNLOCK_GLYPHS).toBe(SEAT_DOMINO);
    for (const n of [1, 5, 14, 32]) {
      const tl = unlockTimeline(n);
      expect(tl.delays).toEqual(glyphDelays(n, SEAT_DOMINO));
      expect(tl.sets).toEqual(tl.delays.map((d) => d + SEAT_DOMINO.spin));
      expect(tl.arrivals).toEqual(tl.sets.map((s) => s + TRAVEL_MS));
      // une phrase longue resserre l'écart : le geste ne dépasse jamais sa durée
      expect(Math.max(...tl.sets)).toBeLessThanOrEqual(SEAT_DOMINO.maxTotal);
    }
    // une phrase courte garde l'écart du geste, 85 ms
    expect(unlockTimeline(5).delays).toEqual([0, 85, 170, 255, 340]);
    // la longueur seule compte, bornée à ce que le champ montre
    expect(unlockTimeline(0).count).toBe(1);
    expect(unlockTimeline(500).count).toBe(UNLOCK_GLYPH_MAX);
  });

  it('les temps se suivent : pistes, lumière du sceau, point d’or, glissement, pli, circuit, mot, châssis, voile', () => {
    for (const n of [1, 5, 14, 32]) {
      const tl = unlockTimeline(n);
      const order = [tl.trace, tl.seal, tl.gold, tl.glide, tl.fold, tl.spread, tl.word, tl.form, tl.reveal, tl.end];
      for (let i = 1; i < order.length; i++) expect(order[i]!, `${n} · ${i}`).toBeGreaterThan(order[i - 1]!);
      // la pose du premier glyphe lance la première piste ; la première arrivée allume le sceau
      expect(tl.trace).toBe(tl.sets[0]);
      expect(tl.seal).toBe(tl.arrivals[0]);
      // le point d'or attend la dernière piste et la fin de la lumière sur l'horizon et les trois anneaux
      expect(tl.gold).toBeGreaterThanOrEqual(Math.max(...tl.arrivals) + GOLD_AFTER_MS);
      expect(tl.gold).toBeGreaterThanOrEqual(tl.seal + Math.max(HORIZON_MS, RING_LEAD_MS + 2 * RING_STEP_MS + RING_MS));
      // le circuit part du sceau plié, et le mot se lit avant que le voile ne se lève
      expect(tl.spread).toBe(tl.fold + FOLD_MS);
      expect(tl.reveal - (tl.word + WORD_MS)).toBeGreaterThanOrEqual(300);
    }
    // l'ouverture entière reste une cérémonie courte, abrégeable d'une touche
    expect(unlockTimeline(14).end).toBeLessThan(4500);
    expect(unlockTimeline(UNLOCK_GLYPH_MAX).end).toBeLessThan(5000);
    // mouvement réduit : le mot, puis le voile, en moins d'une seconde
    const reduced = reducedTimeline();
    expect([reduced.count, reduced.reveal, reduced.end]).toEqual([0, 280, 520]);
    expect(UNLOCK_SEAL).toBe('DESK UNLOCKED');
  });

  it('la lumière rallume les tracés mêmes du master : trois anneaux, deux arcs chacun, aux rayons du sceau', () => {
    const rings = ringArcs(sealShapes('negative').rings.map((s) => s.d).join(' '));
    expect(rings.map((r) => r.r)).toEqual([368.38, 356.42, 274.31]);
    for (const ring of rings) expect(ring.d.match(/M/g), String(ring.r)).toHaveLength(2);
    // l'horizon du master va de pointe à pointe sur y = −12,8
    const master = readFileSync('src/design/seal/seal-negative.svg', 'utf8');
    expect(master).toContain(`M-${SEAL_HZ_TIP} ${SEAL_HZ_Y}`);
    expect(master).toContain(`${SEAL_HZ_TIP} ${SEAL_HZ_Y}C`);
  });

  it('le repère du master se pose sur le sceau tel qu’il est, glissé ou plié : son horizon reste sur la ligne', () => {
    const rect = { left: 140, top: 210, width: 520, height: 476.24 };
    const m = sealMap(rect);
    const [x0, y0] = m.at(-404, -370);
    const [x1, y1] = m.at(404, 370);
    expect(x0).toBeCloseTo(140, 6);
    expect(y0).toBeCloseTo(210, 6);
    expect(x1).toBeCloseTo(660, 6);
    expect(y1).toBeCloseTo(686.24, 6);
    expect(m.at(0, SEAL_HZ_Y)[1]).toBeCloseTo(rect.top + SEAL_HORIZON * rect.height, 6);
    // plié à 0,4 % de sa hauteur autour de la ligne de l'écran, l'horizon ne bouge pas
    const line = rect.top + SEAL_HORIZON * rect.height;
    const folded = { left: rect.left + 300, top: line - SEAL_HORIZON * rect.height * 0.004, width: rect.width, height: rect.height * 0.004 };
    expect(sealMap(folded).at(0, SEAL_HZ_Y)[1]).toBeCloseTo(line, 6);
  });

  it('les pistes ne se croisent jamais, montent à 45° quand la place le permet et se resserrent sur la pointe ; l’axe est sur l’horizon', () => {
    for (const fieldBottom of [520, 400]) {
      const tip: Pt = [660, 450];
      for (const n of [3, 7, 14, 32]) {
        const pads = Array.from({ length: n }, (_, i): Pt => [800 + i * 11.6, fieldBottom - 20]);
        const all = routes({ pads, fieldBottom, tip });
        // les voies vont de gauche à droite, sans retour
        for (let i = 1; i < n; i++) expect(laneOf(i, n)).toBeGreaterThanOrEqual(laneOf(i - 1, n));
        expect(laneOf(n - 1, n)).toBeLessThan(LANES);
        for (const [i, pts] of all.entries()) {
          expect(pts[pts.length - 1], `${n} · ${i}`).toEqual(tip);
          const [turn, elbow] = [pts[2]!, pts[3]!];
          expect(Math.abs(turn[0] - elbow[0]), `45° · ${n} · ${i}`).toBeCloseTo(Math.abs(turn[1] - elbow[1]), 6);
          if (laneOf(i, n) === AXIS_LANE) expect(elbow[1]).toBe(tip[1]);
        }
        // une piste par voie : aucune n'en coupe une autre
        const byLane = new Map<number, Pt[]>();
        all.forEach((pts, i) => byLane.set(laneOf(i, n), byLane.get(laneOf(i, n)) ?? pts));
        const lanes = [...byLane.values()];
        for (let a = 0; a < lanes.length; a++) {
          for (let b = a + 1; b < lanes.length; b++) {
            for (const sa of segmentsOf(lanes[a]!)) for (const sb of segmentsOf(lanes[b]!)) expect(crosses(sa, sb), `${fieldBottom} · ${n} · ${a}/${b}`).toBe(false);
          }
        }
      }
    }
  });

  it('du point d’or, le circuit du chargement : l’axe d’or part de l’anneau du mot, tout reste dans l’écran', () => {
    const [W, H, cx, cy] = [1600, 1000, 800, 500];
    const word = { left: 560, top: 471, width: 480, height: 58 };
    const ring = ringAround(cx, cy, [word]);
    // l'anneau contient le mot, symétrique autour du point d'or
    expect(ring.x0).toBeLessThan(word.left);
    expect(ring.x1).toBeGreaterThan(word.left + word.width);
    expect(cx - ring.x0).toBe(ring.x1 - cx);
    expect(ring.y0).toBeLessThan(word.top);
    expect(ring.y1).toBeGreaterThan(word.top + word.height);
    const plan = buildSpread(W, H, cx, cy, ring);
    const axis = plan.traces.filter((t) => t.axis);
    expect(axis).toHaveLength(2);
    for (const t of axis) {
      expect(t.path.pts.every(([, y]) => y === cy)).toBe(true);
      expect([ring.x0, ring.x1]).toContain(t.path.pts[0]![0]);
    }
    for (const t of plan.traces) for (const [x, y] of t.path.pts) expect(x >= 0 && x <= W && y >= 0 && y <= H, `${x},${y}`).toBe(true);
    // aucun nano-pixel dans l'anneau : le mot reste net
    const inside = plan.pixels.filter((p) => p.x > ring.x0 && p.x < ring.x1 && p.y > ring.y0 && p.y < ring.y1);
    expect(plan.pixels.length).toBeGreaterThan(100);
    expect(inside).toHaveLength(0);
  });

  it('outils : longueur et point le long d’une polyligne, couleurs des jetons lues pour le canevas', () => {
    const p = poly([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(p.len).toBe(20);
    expect(pointAt(p, 15)).toEqual([10, 5]);
    expect(pointAt(p, 99)).toEqual([10, 10]);
    expect(rgbOf('#ccb066', [0, 0, 0])).toEqual([204, 176, 102]);
    expect(rgbOf(' #fff ', [0, 0, 0])).toEqual([255, 255, 255]);
    expect(rgbOf('rgb(245, 242, 234)', [0, 0, 0])).toEqual([245, 242, 234]);
    expect(rgbOf('var(--x)', [1, 2, 3])).toEqual([1, 2, 3]);
  });
});
