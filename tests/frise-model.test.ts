import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@/engine/calendar';
import type { Session, Trade } from '@/engine/types';
import {
  cmeDay,
  compareEvent,
  COMPARE_WEAK_N,
  CURSOR_TABS,
  cursorOnTab,
  dayEvents,
  dayFraction,
  daySpan,
  dayWindows,
  fractionToMs,
  groupNear,
  hourAt,
  inForceAt,
  lossLimitInstant,
  MIN,
  moveCursor,
  nextBoundaries,
  NIGHT_SHARE,
  sameTimeOn,
  sessionPlan,
  shiftDay,
  stemGroups,
  twoWeeks,
  weekRingPoint,
} from '@/lib/frise';
import { SAMPLE_FAIBLE } from '@/engine/ontology/confidence';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/** OROS5.12 : ce qui borne l'heure qui vient — les dix-sept cas du prototype C · Frise (d3), et deux régressions. */

const et = (day: string, time: string) => zonedToUtc(day, time, ET_ZONE);

const cpi = (date: string): CalEvent => ({ id: `cpi-${date}`, date, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, description: '', estimated: true });

function session(id: string, date: string, pnl: number): Session {
  return { id, date, instruments: ['MNQ'], source: 'demo', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, entry: number, exit: number, pnl: number): Trade {
  return { id, sessionId, instrument: 'MNQ', direction: 'long', qty: 1, entryTime: entry, exitTime: exit, entryPrice: 0, exitPrice: 0, pnl, commission: 0 };
}

describe('frise : la journée CME et son curseur', () => {
  it('une journée CME va de 18:00 ET la veille à 17:00 ET, 23 heures', () => {
    const span = daySpan('2026-10-14');
    expect(span.start).toBe(et('2026-10-13', '18:00'));
    expect(span.dawn).toBe(et('2026-10-14', '07:00'));
    expect(span.end).toBe(et('2026-10-14', '17:00'));
    expect((span.end - span.start) / 3_600_000).toBe(23);
  });

  it('la journée bascule à 18:00 ET : le dimanche 18:30 compte pour le lundi, le mardi 18:30 pour le mercredi', () => {
    expect(cmeDay(et('2026-10-25', '18:30'))).toBe('2026-10-26');
    expect(cmeDay(et('2026-10-27', '17:30'))).toBe('2026-10-27');
    expect(cmeDay(et('2026-10-27', '18:30'))).toBe('2026-10-28');
    expect(cmeDay(et('2026-10-27', '09:12'))).toBe('2026-10-27');
  });

  it('la nuit (18:00 → 07:00) tient au tiers de l’axe, la journée (07:00 → 17:00) aux deux tiers ; l’inverse rend l’instant', () => {
    const span = daySpan('2026-10-14');
    expect(dayFraction(span.start, span)).toBe(0);
    expect(dayFraction(et('2026-10-14', '07:00'), span)).toBeCloseTo(NIGHT_SHARE, 10);
    expect(dayFraction(et('2026-10-14', '12:00'), span)).toBeCloseTo(NIGHT_SHARE + (5 / 10) * (1 - NIGHT_SHARE), 10);
    expect(dayFraction(span.end, span)).toBe(1);
    // Une minute de journée pèse plus de deux fois une minute de nuit.
    const dayMin = dayFraction(et('2026-10-14', '10:01'), span) - dayFraction(et('2026-10-14', '10:00'), span);
    const nightMin = dayFraction(et('2026-10-14', '01:01'), span) - dayFraction(et('2026-10-14', '01:00'), span);
    expect(dayMin / nightMin).toBeCloseTo(2 / 3 / 600 / (1 / 3 / 780), 5);
    for (const time of ['18:00', '23:40', '06:59']) {
      const day = time >= '18:00' ? '2026-10-13' : '2026-10-14';
      expect(fractionToMs(dayFraction(et(day, time), span), span)).toBeCloseTo(et(day, time), -1);
    }
    for (const time of ['07:00', '08:30', '16:59']) expect(fractionToMs(dayFraction(et('2026-10-14', time), span), span)).toBeCloseTo(et('2026-10-14', time), -1);
  });

  it('← → posent le curseur sur la grille de 5 min ; Pg préc. garde l’heure et saute le week-end', () => {
    const at = et('2026-10-27', '09:12');
    expect(moveCursor(at, 'left')).toBe(et('2026-10-27', '09:05'));
    expect(moveCursor(at, 'hourLeft')).toBe(et('2026-10-27', '08:10'));
    expect(moveCursor(at, 'dayBack')).toBe(et('2026-10-26', '09:12'));
    expect(moveCursor(et('2026-10-26', '08:30'), 'dayBack')).toBe(et('2026-10-23', '08:30'));
    expect(shiftDay('2026-10-27', -9)).toBe('2026-10-14');
    expect(sameTimeOn('2026-10-14', at)).toBe(et('2026-10-14', '09:12'));
  });

  it('le couloir Séance : RTH 09:30–16:00 avec la pause, le week-end et le CME fermé ne portent aucune phase', () => {
    const plan = sessionPlan(daySpan('2026-10-14'));
    expect(plan.closed).toBeNull();
    const rth = plan.phases.filter((p) => p.kind === 'rth');
    expect(rth[0]?.from).toBe(et('2026-10-14', '09:30'));
    expect(rth.at(-1)?.to).toBe(et('2026-10-14', '16:00'));
    expect(plan.phases.some((p) => p.kind === 'lunch')).toBe(true);
    expect(sessionPlan(daySpan('2026-10-17')).closed).toBe('weekend');
    expect(sessionPlan(daySpan('2026-12-25')).closed).toBe('holiday');
  });

  it('le curseur ne vit que là où on le lit : ouvrir Visual le rend au présent, Métrique et le Calendrier le gardent', () => {
    expect([...CURSOR_TABS].sort()).toEqual(['calendrier', 'metrique']);
    const at = et('2026-10-14', '08:30');
    expect(cursorOnTab('calendrier', at)).toBe(at);
    expect(cursorOnTab('metrique', at)).toBe(at);
    expect(cursorOnTab('visual', at)).toBeNull();
    expect(cursorOnTab('agent', at)).toBeNull();
  });
});

describe('frise : ce qui borne l’heure qui vient — en vigueur, puis à venir', () => {
  const span = daySpan('2026-10-14');
  const plan = sessionPlan(span);
  const { timed } = dayEvents([cpi('2026-10-14'), { ...cpi('2026-10-14'), id: 'retail', title: 'Ventes au détail', impact: 2 }], span);

  it('deux publications à la même minute font une seule tige, l’impact le plus fort', () => {
    const groups = stemGroups(timed);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.impact).toBe(3);
    expect(groups[0]?.events).toHaveLength(2);
  });

  it('des marques à moins de 8 px se fondent en une seule, posée à la première et comptée', () => {
    const rows = [{ x: 10 }, { x: 14 }, { x: 17.9 }, { x: 18 }, { x: 40 }];
    expect(groupNear(rows, (r) => r.x).map((g) => [g.x, g.rows.length])).toEqual([
      [10, 3],
      [18, 1],
      [40, 1],
    ]);
  });

  it('la fenêtre de la règle (± 15 min) : à 08:00 elle est à venir ; à 08:30 elle vaut, sa fin ne se redit pas à venir', () => {
    expect(dayWindows(span, timed, { catalystBlackoutMin: 0 }, null)).toEqual([]);
    const windows = dayWindows(span, timed, { catalystBlackoutMin: 15 }, null);
    expect(windows).toHaveLength(1);
    const before = et('2026-10-14', '08:00');
    expect(inForceAt(before, span, plan, windows, { lossAt: null, kill: false })).toEqual([]);
    const coming = nextBoundaries(before, span, plan, timed, windows);
    expect(coming.map((b) => b.kind)).toEqual(['windowOpen', 'catalyst', 'windowClose']);
    // chaque borne à venir dit son délai : « 15 min · 08:15 », « 30 min · 08:30 »…
    expect(coming.map((b) => b.delayMs / MIN)).toEqual([15, 30, 45]);
    const on = et('2026-10-14', '08:30');
    expect(inForceAt(on, span, plan, windows, { lossAt: null, kill: false })).toEqual([{ kind: 'window', since: et('2026-10-14', '08:15'), until: et('2026-10-14', '08:45'), event: windows[0]!.event, minutes: 15 }]);
    const ahead = nextBoundaries(on, span, plan, timed, windows);
    // Sous le curseur, la publication est la première borne (« maintenant », délai nul) ; la fin de fenêtre est dite en vigueur.
    expect(ahead[0]).toMatchObject({ kind: 'catalyst', delayMs: 0 });
    expect(ahead.map((b) => b.kind)).not.toContain('windowClose');
    expect(ahead.map((b) => b.kind)).toContain('rthOpen');
  });

  it('le kill switch vaut d’abord ; la journée fermée et la pause de 17:00 se lisent en vigueur', () => {
    const at = et('2026-10-14', '10:00');
    expect(inForceAt(at, span, plan, [], { lossAt: null, kill: true })[0]?.kind).toBe('kill');
    const sunday = daySpan('2026-10-18');
    expect(inForceAt(et('2026-10-18', '12:00'), sunday, sessionPlan(sunday), [], { lossAt: null, kill: false })).toEqual([{ kind: 'closed', closed: 'weekend' }]);
    expect(inForceAt(et('2026-10-14', '17:20'), span, plan, [], { lossAt: null, kill: false })[0]?.kind).toBe('pause');
  });
});

describe('frise : la perte du jour, constatée et jamais prédite', () => {
  // Le 6 octobre : −300 $ à 10:20, −320 $ à 10:56, +80 $ à 11:40 ; la perte maximale du jour est de 600 $.
  const day = '2026-10-06';
  const span = daySpan(day);
  const plan = sessionPlan(span);
  const trades = [trade('a', 's6', et(day, '10:05'), et(day, '10:20'), -300), trade('b', 's6', et(day, '10:40'), et(day, '10:56'), -320), trade('c', 's6', et(day, '11:20'), et(day, '11:40'), 80)];
  const lossAt = lossLimitInstant(trades, span, 600);

  it('le relevé de la journée garde l’instant réel : la sortie qui atteint la limite', () => {
    expect(lossAt).toBe(et(day, '10:56'));
    expect(lossLimitInstant(trades, span, 0)).toBeNull();
    const windows = dayWindows(span, [], { catalystBlackoutMin: 15 }, lossAt);
    expect(windows).toEqual([{ kind: 'afterLimit', from: et(day, '10:56'), to: span.end }]);
  });

  it('le 6 octobre à 10:10, la réponse ne sait rien d’une perte à venir : rien en vigueur, rien de tel à venir', () => {
    const at = et(day, '10:10');
    const known = lossLimitInstant(trades, span, 600, at);
    expect(known).toBeNull();
    const windows = dayWindows(span, [], { catalystBlackoutMin: 15 }, known);
    expect(inForceAt(at, span, plan, windows, { lossAt: known, kill: false })).toEqual([]);
    const ahead = nextBoundaries(at, span, plan, [], windows);
    expect(ahead.map((b) => b.kind)).toEqual([]);
    expect(ahead.some((b) => (b.kind as string) === 'afterLimit')).toBe(false);
  });

  it('le 6 octobre à 11:10, la perte du jour est en vigueur depuis 10:56, et la pause déjeuner reste à venir', () => {
    const at = et(day, '11:10');
    const known = lossLimitInstant(trades, span, 600, at);
    expect(known).toBe(et(day, '10:56'));
    const windows = dayWindows(span, [], { catalystBlackoutMin: 15 }, known);
    expect(inForceAt(at, span, plan, windows, { lossAt: known, kill: false })).toEqual([{ kind: 'lossReached', since: et(day, '10:56') }]);
    expect(nextBoundaries(at, span, plan, [], windows).map((b) => b.kind)).toEqual(['lunch']);
  });

  it('régression (d5a) : à 10:10, la hachure de la perte n’est pas tracée devant le curseur ; au présent, elle part de 10:56', () => {
    const input = { now: et(day, '16:00'), events: [], trades, rules: { catalystBlackoutMin: 15 }, limit: 600, kill: false };
    const early = hourAt({ ...input, at: et(day, '10:10') });
    expect(early.lossAt).toBeNull();
    expect(early.windows.filter((w) => w.kind === 'afterLimit')).toEqual([]);
    expect(early.inForce).toEqual([]);
    expect(early.ahead.map((b) => b.kind)).toEqual([]);
    // au présent, le relevé de la journée : la hachure part de la sortie qui a atteint la limite
    const now = hourAt({ ...input, at: input.now });
    expect(now.windows).toContainEqual({ kind: 'afterLimit', from: et(day, '10:56'), to: span.end });
  });

  it('régression : une perte atteinte n’est pas oubliée — à 11:10 et à 11:30, « atteinte depuis 10:56 » reste en vigueur, jamais à venir', () => {
    const input = { now: et(day, '16:00'), events: [], trades, rules: { catalystBlackoutMin: 0 }, limit: 600, kill: false };
    for (const time of ['10:56', '11:10', '11:30']) {
      const answer = hourAt({ ...input, at: et(day, time) });
      expect(answer.inForce, time).toContainEqual({ kind: 'lossReached', since: et(day, '10:56') });
      expect(answer.ahead.some((b) => (b.kind as string) === 'afterLimit' || (b.kind as string) === 'lossReached'), time).toBe(false);
      expect(answer.windows, time).toContainEqual({ kind: 'afterLimit', from: et(day, '10:56'), to: span.end });
    }
    // le kill switch ne se prête pas au passé : il ne vaut qu'au présent et après
    expect(hourAt({ ...input, at: et(day, '11:10'), kill: true }).inForce.map((f) => f.kind)).toEqual(['lossReached']);
    expect(hourAt({ ...input, at: input.now, kill: true }).inForce[0]?.kind).toBe('kill');
  });
});

describe('frise : étude d’événement', () => {
  const events = [cpi('2026-09-09'), cpi('2026-10-14'), cpi('2026-11-11')];
  const sessions = [session('s1', '2026-09-09', 100), session('s2', '2026-10-14', -50), session('s3', '2026-10-15', 30)];
  const trades = [
    trade('t0', 's1', et('2026-09-09', '08:00'), et('2026-09-09', '08:20'), 40),
    trade('t1', 's1', et('2026-09-09', '08:40'), et('2026-09-09', '09:00'), 60),
    trade('t2', 's2', et('2026-10-14', '09:40'), et('2026-10-14', '10:30'), -50),
    trade('t3', 's3', et('2026-10-15', '08:35'), et('2026-10-15', '08:50'), 30),
  ];
  const until = et('2026-10-27', '09:12');

  it('rebasée sur t0 : chaque séance passe par zéro à la publication ; la table mesure la même fenêtre que la courbe', () => {
    const cmp = compareEvent(events, 'cpi', sessions, trades, until);
    // La publication de novembre est à venir : elle ne compte pas.
    expect(cmp.occurrences.map((o) => o.date)).toEqual(['2026-09-09', '2026-10-14']);
    expect(cmp.base).toBe('t0');
    // 9 septembre : +40 à 08:20 (avant t0), +60 à 09:00 ; rebasé, −40 au départ, 0 à t0, +60 à +90.
    expect(cmp.series[0]?.points).toEqual([
      [-30, -40],
      [-10, 0],
      [30, 60],
      [90, 60],
    ]);
    expect(cmp.series[0]?.window).toBe(100);
    expect(cmp.series[1]?.points.at(-1)).toEqual([90, 0]);
    // La table : P&L de t0 − 30 à t0 + 90, pas le P&L de la séance entière.
    expect(cmp.with.n).toBe(2);
    expect(cmp.with.mean).toBe(50);
    expect(cmp.with.winRate).toBe(0.5);
    expect(cmp.with.rows.map((r) => [r.date, r.window, r.sessionPnl])).toEqual([
      ['2026-09-09', 100, 100],
      ['2026-10-14', 0, -50],
    ]);
    // Sans CPI : la même fenêtre, à la même heure de New York (08:30), les autres séances.
    expect(cmp.without.rows.map((r) => [r.date, r.window])).toEqual([['2026-10-15', 30]]);
    // la ligne se lit en veille sous SAMPLE_FAIBLE séances
    expect(COMPARE_WEAK_N).toBe(SAMPLE_FAIBLE);
    expect(cmp.with.weak).toBe(true);
  });

  it('la moyenne est un escalier exact, sa bande min–max aux mêmes marches ; l’option t0 − 30 part de zéro', () => {
    const cmp = compareEvent(events, 'cpi', sessions, trades, until);
    expect(cmp.mean.at(-1)).toEqual([90, 30]);
    expect(cmp.mean.find(([m]) => m === 30)).toEqual([30, 30]);
    expect(cmp.band.find(([m]) => m === 30)).toEqual([30, 0, 60]);
    const start = compareEvent(events, 'cpi', sessions, trades, until, 'start');
    expect(start.series[0]?.points[0]).toEqual([-30, 0]);
    expect(start.series[0]?.points.at(-1)).toEqual([90, 100]);
  });
});

describe('frise : dix journées, deux semaines ancrées à une journée', () => {
  it('cette semaine et la suivante ; la précédente et celle-ci ; un samedi, la semaine qui vient', () => {
    expect(twoWeeks('2026-10-27', 1)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(twoWeeks('2026-10-27', -1)[0]).toBe('2026-10-19');
    expect(twoWeeks('2026-10-27', -1).at(-1)).toBe('2026-10-30');
    expect(twoWeeks('2026-10-31', 1)[0]).toBe('2026-11-02');
    expect(twoWeeks('2026-10-31', -1).at(-1)).toBe('2026-10-30');
  });

  it('l’anneau : deux arcs de cinq, lundi à 1 h, vendredi à 5 h, le week-end à 6 h et à midi restent vides', () => {
    const [x0, y0] = weekRingPoint(0, 50, 50, 40);
    expect(x0).toBeCloseTo(70, 2);
    expect(y0).toBeCloseTo(50 - 40 * Math.sin(Math.PI / 3), 2);
    expect(weekRingPoint(4, 50, 50, 40)[0]).toBeGreaterThan(50);
    expect(weekRingPoint(5, 50, 50, 40)[0]).toBeLessThan(50);
    const angles = Array.from({ length: 10 }, (_, i) => {
      const [x, y] = weekRingPoint(i, 50, 50, 40);
      return Math.round((Math.atan2(y - 50, x - 50) * 180) / Math.PI);
    });
    expect(angles).toEqual([-60, -30, 0, 30, 60, 120, 150, 180, -150, -120]);
  });
});
