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
  glyphCapacity,
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

  it('OROS4.29 une seule pente pour toutes les montées : aucune piste n’en coupe une autre, sur la géométrie relevée du verrou comme à l’étroit', () => {
    const faults: string[] = [];
    const check = (pads: Pt[], fieldBottom: number, tip: Pt, label: string) => {
      const all = routes({ pads, fieldBottom, tip });
      if (!all.length) return all;
      if (all.length !== pads.length) faults.push(`${label} : ${all.length} pistes pour ${pads.length} pastilles`);
      // toutes les paires de pistes, toutes voies confondues : aucun croisement propre (celles d'une même voie se suivent)
      const segs = all.map(segmentsOf);
      for (let a = 0; a < all.length; a++) {
        for (let b = a + 1; b < all.length; b++) {
          for (const sa of segs[a]!) for (const sb of segs[b]!) if (crosses(sa, sb)) faults.push(`${label} : ${a}/${b} se croisent`);
        }
      }
      // des montées parallèles : un même rapport dx/dy pour toutes
      const runs = all.map((pts) => [Math.abs(pts[2]![0] - pts[3]![0]), Math.abs(pts[2]![1] - pts[3]![1])] as const).filter(([, dy]) => dy > 1e-6).map(([dx, dy]) => dx / dy);
      if (runs.some((r) => Math.abs(r - runs[0]!) > 1e-9)) faults.push(`${label} : pentes ${runs.map((r) => r.toFixed(2)).join(' ')}`);
      for (const [i, pts] of all.entries()) {
        const end = pts[pts.length - 1]!;
        if (end[0] !== tip[0] || end[1] !== tip[1]) faults.push(`${label} : ${i} ne finit pas sur la pointe`);
        // la montée part à gauche de sa pastille, jamais derrière elle
        if (pts[2]![0] > pts[0]![0] - 4 + 1e-9) faults.push(`${label} : ${i} monte derrière sa pastille`);
      }
      return all;
    };
    // relevés dans Chromium à quatorze caractères : première pastille, pas des cases, bas du champ, pointe de l'horizon
    const measured: { name: string; first: Pt; step: number; fieldBottom: number; tip: Pt }[] = [
      { name: '1180×720, relevé de la revue', first: [660.35, 419.28], step: 11.52, fieldBottom: 441.16, tip: [580.65, 359.99] },
      { name: '1180×720, zoom 1', first: [654.75, 410.37], step: (781.3 - 654.75) / 13, fieldBottom: 428.97, tip: [552.26, 359.99] },
      { name: '1280×800, zoom 1', first: [707.48, 450.37], step: (834.03 - 707.48) / 13, fieldBottom: 468.97, tip: [580.4, 399.99] },
      { name: '1440×900, zoom 1', first: [793.7, 503.35], step: (927.76 - 793.7) / 13, fieldBottom: 523.05, tip: [638.38, 449.99] },
    ];
    for (const m of measured) {
      for (const n of [1, 3, 5, 9, 14, 20, 32]) {
        const pads = Array.from({ length: n }, (_, i): Pt => [m.first[0] + i * m.step, m.first[1]]);
        // la place y est : les pistes se tracent
        expect(check(pads, m.fieldBottom, m.tip, `${m.name} · ${n}`).length, `${m.name} · ${n}`).toBe(n);
      }
    }
    // à l'étroit comme au large : pastilles de 24 à 220 px de la pointe, champ au-dessus et au-dessous de l'horizon
    const tip: Pt = [600, 400];
    for (const gap of [24, 30, 40, 60, 90, 140, 220]) {
      for (const drop of [-60, -20, 0, 20, 50, 90, 140]) {
        for (const n of [1, 2, 3, 5, 7, 9, 14, 20, 32]) {
          const pads = Array.from({ length: n }, (_, i): Pt => [tip[0] + gap + i * 11.5, tip[1] + drop - 18]);
          check(pads, tip[1] + drop, tip, `${gap} · ${drop} · ${n}`);
        }
      }
    }
    expect(faults).toEqual([]);
    // 45° dès que la place le permet
    const wide = routes({ pads: Array.from({ length: 14 }, (_, i): Pt => [tip[0] + 220 + i * 11.5, 482]), fieldBottom: 500, tip });
    for (const pts of wide) expect(Math.abs(pts[2]![0] - pts[3]![0])).toBeCloseTo(Math.abs(pts[2]![1] - pts[3]![1]), 9);
    // une pastille collée à la pointe : pas de place pour monter, pas de pistes (comme sans sceau)
    expect(routes({ pads: [[tip[0] + 20, 380]], fieldBottom: 400, tip })).toEqual([]);
  });

  it('OROS4.30 l’axe d’or est toujours pris : une phrase courte et impaire pose sa pastille du milieu dessus', () => {
    for (let n = 1; n <= 32; n++) {
      const lanes = Array.from({ length: n }, (_, i) => laneOf(i, n));
      expect(lanes, String(n)).toContain(AXIS_LANE);
      for (let i = 1; i < n; i++) expect(lanes[i]!, String(n)).toBeGreaterThanOrEqual(lanes[i - 1]!);
      expect(Math.min(...lanes), String(n)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...lanes), String(n)).toBeLessThan(LANES);
      if (n % 2 === 1 && n < LANES) {
        expect(lanes[(n - 1) / 2], String(n)).toBe(AXIS_LANE);
        // OROS4.53 les autres s'écartent de l'axe en miroir
        for (let i = 0; i < n; i++) expect(lanes[i]! - AXIS_LANE, `${n} · ${i}`).toBe(AXIS_LANE - lanes[n - 1 - i]!);
      }
    }
    expect([1, 3, 5].map((n) => Array.from({ length: n }, (_, i) => laneOf(i, n)))).toEqual([[3], [0, 3, 6], [0, 1, 3, 5, 6]]);
  });

  it('OROS4.52 la rangée de glyphes ne pose pas plus de cases que le champ ne montre de points', () => {
    // 1180 × 720, zoom 1 : 28 points visibles (pas de 11,48 px), alors que la borne haute en permet 32
    expect(glyphCapacity(330, 11.48)).toBe(28);
    expect(glyphCapacity(1000, 11.48)).toBe(UNLOCK_GLYPH_MAX);
    expect(glyphCapacity(5, 11.48)).toBe(1);
    // sans mesure (aucun rendu), la borne haute
    expect(glyphCapacity(0, 11.48)).toBe(UNLOCK_GLYPH_MAX);
    expect(glyphCapacity(330, 0)).toBe(UNLOCK_GLYPH_MAX);
    expect(glyphCapacity(Number.NaN, 11.48)).toBe(UNLOCK_GLYPH_MAX);
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
