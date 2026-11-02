/**
 * La frise du desk (OROS5.12) : une journée CME de 18:00 à 17:00 ET, ses couloirs, son curseur, ce qui borne l'heure qui
 * vient — en vigueur d'abord, puis à venir avec son délai — et ce que les modules en lisent (étude d'événement, deux
 * semaines de journées). Repris du prototype C · Frise (d3), corrigé : à l'instant du curseur, la frise ne sait que ce
 * qu'on savait alors (`knownAt`), la hachure de la perte du jour comprise, et une perte atteinte reste en vigueur.
 * Pur : l'instant est passé en argument, les dates sont celles de New York ; aucun store, aucun DOM.
 */
import { CATALYST_MIN_IMPACT } from '@/engine/agent/events';
import type { CalEvent } from '@/engine/calendar';
import { dailyLimit, detectDrifts, detectRuleBreaches, entryOfTrade, majorCatalysts, type DisciplineFinding, type TraderRules } from '@/engine/discipline';
import { familyKey } from '@/engine/macroMerge';
import { SAMPLE_FAIBLE } from '@/engine/ontology/confidence';
import type { PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { cmeSession } from './cmeClosed';
import { addDays, ET_ZONE, pad2, parseDateKey, tradingDayKey, weekday, zonedToUtc } from './time';

export const MIN = 60_000;
/** Un cran du curseur : ← →. */
export const FINE_STEP = 5 * MIN;
/** Maj + ← → : une heure. */
export const COARSE_STEP = 60 * MIN;
/** L'heure qui vient : ce que la frise répond, à partir du curseur. */
export const NEXT_HOUR = 60 * MIN;
/** Étude d'événement : de t0 − 30 min à t0 + 90 min. */
export const COMPARE_BEFORE_MIN = 30;
export const COMPARE_AFTER_MIN = 90;
/** Sous ce nombre de séances, une ligne de l'étude se lit en veille (`SAMPLE_FAIBLE`, l'échantillon de l'ontologie). */
export const COMPARE_WEAK_N = SAMPLE_FAIBLE;
/** La nuit de Globex, de 18:00 à 07:00 ET, tient au tiers de l'axe ; la journée, de 07:00 à 17:00, aux deux tiers. */
export const NIGHT_END = '07:00';
export const NIGHT_SHARE = 1 / 3;
/** Deux marques plus proches que ce pas (px) se fondent en une seule, comptée (×n). */
export const MERGE_PX = 8;

/* ─── Le curseur ne vit que là où on le lit ─── */

/** Les modules qui lisent le curseur de temps : Métrique et le Calendrier. Ailleurs, le présent. */
export const CURSOR_TABS = ['metrique', 'calendrier'] as const;

/** Le curseur après un changement d'onglet : gardé dans Métrique et le Calendrier, rendu au présent (`null`) ailleurs. */
export function cursorOnTab(tab: string, cursor: number | null): number | null {
  return (CURSOR_TABS as readonly string[]).includes(tab) ? cursor : null;
}

/* ─── La journée CME ─── */

/** Journée CME d'un instant : elle bascule à 18:00 ET (le dimanche 18:30 compte pour le lundi). La journée de la frise. */
export function cmeDay(ms: number): string {
  return tradingDayKey(ms, 18, ET_ZONE);
}

export interface DaySpan {
  day: string;
  /** 18:00 ET la veille. */
  start: number;
  /** 07:00 ET le jour : la nuit compressée s'arrête là. */
  dawn: number;
  /** 17:00 ET le jour. */
  end: number;
}

export function daySpan(day: string): DaySpan {
  return { day, start: zonedToUtc(addDays(day, -1), '18:00', ET_ZONE), dawn: zonedToUtc(day, NIGHT_END, ET_ZONE), end: zonedToUtc(day, '17:00', ET_ZONE) };
}

export function isWeekday(day: string): boolean {
  const w = weekday(day);
  return w >= 1 && w <= 5;
}

/** `n` journées ouvrées plus tard (ou plus tôt si `n` < 0) : le week-end est sauté. */
export function shiftDay(day: string, n: number): string {
  let d = day;
  let left = Math.abs(Math.trunc(n));
  const dir = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDays(d, dir);
    if (isWeekday(d)) left--;
  }
  return d;
}

/** Écart en jours calendaires de `from` à `to` (J−n quand `to` précède). */
export function dayGap(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000);
}

/**
 * Position dans la journée, de 0 (18:00 ET) à 1 (17:00 ET), par morceaux : la nuit (18:00 → 07:00) au tiers, la journée
 * (07:00 → 17:00) aux deux tiers. Hors de la journée, rabattue.
 */
export function dayFraction(ms: number, span: DaySpan): number {
  if (!(span.end > span.start)) return 0;
  if (ms <= span.start) return 0;
  if (ms >= span.end) return 1;
  const dawn = Math.min(span.end, Math.max(span.start, span.dawn));
  if (ms < dawn) return ((ms - span.start) / (dawn - span.start || 1)) * NIGHT_SHARE;
  return NIGHT_SHARE + ((ms - dawn) / (span.end - dawn || 1)) * (1 - NIGHT_SHARE);
}

/** L'inverse de `dayFraction` : l'instant d'une position de l'axe. */
export function fractionToMs(f: number, span: DaySpan): number {
  const v = Math.min(1, Math.max(0, f));
  const dawn = Math.min(span.end, Math.max(span.start, span.dawn));
  if (v < NIGHT_SHARE) return span.start + (v / NIGHT_SHARE) * (dawn - span.start);
  return dawn + ((v - NIGHT_SHARE) / (1 - NIGHT_SHARE)) * (span.end - dawn);
}

export function snap(ms: number, step = FINE_STEP): number {
  return Math.round(ms / step) * step;
}

export type CursorMove = 'left' | 'right' | 'hourLeft' | 'hourRight' | 'dayBack' | 'dayForward' | 'home' | 'end';

/**
 * Le curseur d'un cran : ← → 5 min, Maj + ← → 1 h, Pg préc. / Pg suiv. une journée ouvrée (l'heure du jour gardée),
 * Début / Fin de la journée. Les crans se posent sur la grille de 5 min.
 */
export function moveCursor(ms: number, move: CursorMove): number {
  const span = daySpan(cmeDay(ms));
  const inDay = Math.min(span.end, Math.max(span.start, ms));
  switch (move) {
    case 'left':
      return snap(ms) - FINE_STEP;
    case 'right':
      return snap(ms) + FINE_STEP;
    case 'hourLeft':
      return snap(ms) - COARSE_STEP;
    case 'hourRight':
      return snap(ms) + COARSE_STEP;
    case 'home':
      return span.start;
    case 'end':
      return span.end;
    case 'dayBack':
    case 'dayForward': {
      const next = daySpan(shiftDay(span.day, move === 'dayBack' ? -1 : 1));
      return Math.min(next.end, next.start + (inDay - span.start));
    }
  }
}

/** Le même moment de la journée CME, porté sur `day` : un clic sur une journée garde l'heure du curseur. */
export function sameTimeOn(day: string, ref: number): number {
  const from = daySpan(cmeDay(ref));
  const to = daySpan(day);
  const offset = Math.min(from.end, Math.max(from.start, ref)) - from.start;
  return Math.min(to.end, to.start + offset);
}

/** Les heures pleines de la journée, de 18 à 17 ; `night` dit celles de la nuit compressée. */
export function hourTicks(span: DaySpan): { at: number; hour: number; night: boolean }[] {
  const out: { at: number; hour: number; night: boolean }[] = [];
  for (let h = 18; h <= 23; h++) out.push({ at: zonedToUtc(addDays(span.day, -1), `${pad2(h)}:00`, ET_ZONE), hour: h, night: true });
  for (let h = 0; h <= 17; h++) out.push({ at: zonedToUtc(span.day, `${pad2(h)}:00`, ET_ZONE), hour: h, night: h < 7 });
  return out;
}

/* ─── Couloir Séance ─── */

export type PhaseKind = 'globex' | 'europe' | 'rth' | 'lunch' | 'post';

export interface Phase {
  kind: PhaseKind;
  from: number;
  to: number;
}

export interface SessionPlan {
  phases: Phase[];
  /** Repères : publications 08:30 et 10:00, clôture cash (MOC). */
  marks: { at: number; key: 'macro' | 'ten' | 'moc' }[];
  /** Journée sans séance : week-end, ou CME fermé. */
  closed: 'weekend' | 'holiday' | null;
  /** Clôture anticipée (demi-séance), sinon `null`. */
  earlyClose: number | null;
}

/** Les phases d'une journée CME, d'après les repères fixes de la séance et `cmeSession`. */
export function sessionPlan(span: DaySpan): SessionPlan {
  if (!isWeekday(span.day)) return { phases: [], marks: [], closed: 'weekend', earlyClose: null };
  const cme = cmeSession(span.day);
  if (cme.closed) return { phases: [], marks: [], closed: 'holiday', earlyClose: null };
  const at = (time: string) => zonedToUtc(span.day, time, ET_ZONE);
  const early = cme.earlyCloseMinute != null ? at(`${pad2(Math.floor(cme.earlyCloseMinute / 60))}:${pad2(cme.earlyCloseMinute % 60)}`) : null;
  const rthEnd = early ?? at('16:00');
  const phases: Phase[] = [
    { kind: 'globex', from: span.start, to: at('02:00') },
    { kind: 'europe', from: at('02:00'), to: at('09:30') },
    { kind: 'rth', from: at('09:30'), to: Math.min(at('11:30'), rthEnd) },
  ];
  if (rthEnd > at('11:30')) phases.push({ kind: 'lunch', from: at('11:30'), to: Math.min(at('13:30'), rthEnd) });
  if (rthEnd > at('13:30')) phases.push({ kind: 'rth', from: at('13:30'), to: rthEnd });
  if (!early) phases.push({ kind: 'post', from: at('16:00'), to: span.end });
  const marks: SessionPlan['marks'] = [
    { at: at('08:30'), key: 'macro' },
    { at: at('10:00'), key: 'ten' },
  ];
  if (!early) marks.push({ at: at('15:50'), key: 'moc' });
  return { phases, marks, closed: null, earlyClose: early };
}

/* ─── Couloir Catalyseurs ─── */

export interface TimedEvent {
  event: CalEvent;
  at: number;
}

/** Instant d'une publication datée ; une journée entière (sans heure) n'en a pas. */
export function eventInstant(e: Pick<CalEvent, 'date' | 'timeET' | 'allDay'>): number | null {
  if (e.allDay || !e.timeET || !/^\d{2}:\d{2}$/.test(e.timeET)) return null;
  return zonedToUtc(e.date, e.timeET, ET_ZONE);
}

/** Les publications d'une journée CME : datées (posées à leur instant), et de journée entière. */
export function dayEvents(events: readonly CalEvent[], span: DaySpan): { timed: TimedEvent[]; allDay: CalEvent[] } {
  const timed: TimedEvent[] = [];
  const allDay: CalEvent[] = [];
  const prev = addDays(span.day, -1);
  for (const e of events) {
    if (e.date !== span.day && e.date !== prev) continue;
    const at = eventInstant(e);
    if (at === null) {
      if (e.date === span.day) allDay.push(e);
      continue;
    }
    if (at >= span.start && at <= span.end) timed.push({ event: e, at });
  }
  timed.sort((a, b) => a.at - b.at || b.event.impact - a.event.impact);
  return { timed, allDay };
}

/** Publications à la même minute : une seule tige, l'impact le plus fort, toutes nommées. */
export function stemGroups(timed: readonly TimedEvent[]): { at: number; impact: 1 | 2 | 3; events: CalEvent[] }[] {
  const out: { at: number; impact: 1 | 2 | 3; events: CalEvent[] }[] = [];
  for (const row of timed) {
    const last = out[out.length - 1];
    if (last && last.at === row.at) {
      last.events.push(row.event);
      if (row.event.impact > last.impact) last.impact = row.event.impact;
    } else out.push({ at: row.at, impact: row.event.impact, events: [row.event] });
  }
  return out;
}

/** Des marques triées par abscisse, fondues à moins de `gap` px de la première du groupe : une marque qui compte les autres. */
export function groupNear<T>(rows: readonly T[], xOf: (row: T) => number, gap = MERGE_PX): { x: number; rows: T[] }[] {
  const sorted = [...rows].sort((a, b) => xOf(a) - xOf(b));
  const out: { x: number; rows: T[] }[] = [];
  for (const row of sorted) {
    const x = xOf(row);
    const last = out[out.length - 1];
    if (last && x - last.x < gap) last.rows.push(row);
    else out.push({ x, rows: [row] });
  }
  return out;
}

/* ─── Couloir Fenêtres ─── */

export interface TimeWindow {
  kind: 'rule' | 'afterLimit';
  from: number;
  to: number;
  /** Catalyseur de la fenêtre (règle). */
  at?: number;
  event?: CalEvent;
  minutes?: number;
}

/**
 * Premier instant de la journée où la perte réalisée atteint la limite retenue (règle ou plan) ; `null` sinon. `knownAt`
 * borne les sorties lues : à l'instant du curseur, on ne sait que les sorties déjà faites. Une perte atteinte le reste :
 * c'est la première sortie qui l'a atteinte qui la date.
 */
export function lossLimitInstant(trades: readonly Trade[], span: DaySpan, limit: number | null, knownAt = Number.POSITIVE_INFINITY): number | null {
  if (!limit || !(limit > 0)) return null;
  const exits = trades
    .filter((t) => Number.isFinite(t.pnl) && Number.isFinite(t.exitTime) && t.exitTime >= span.start && t.exitTime <= span.end && t.exitTime <= knownAt)
    .sort((a, b) => a.exitTime - b.exitTime);
  let realized = 0;
  for (const t of exits) {
    realized += t.pnl;
    if (-realized >= limit) return t.exitTime;
  }
  return null;
}

/**
 * Les fenêtres de la journée : ± `catalystBlackoutMin` autour de chaque catalyseur majeur (règle du trader, inactive à
 * 0), puis, une fois la perte du jour atteinte, le reste de la journée (hachuré). Une règle inactive ne dessine rien.
 * `lossAt` est la perte connue à l'instant lu : jamais celle d'après le curseur.
 */
export function dayWindows(span: DaySpan, timed: readonly TimedEvent[], rules: Pick<TraderRules, 'catalystBlackoutMin'>, lossAt: number | null): TimeWindow[] {
  const out: TimeWindow[] = [];
  if (rules.catalystBlackoutMin > 0) {
    const half = rules.catalystBlackoutMin * MIN;
    for (const row of timed) {
      if (row.event.impact < CATALYST_MIN_IMPACT) continue;
      out.push({ kind: 'rule', from: row.at - half, to: row.at + half, at: row.at, event: row.event, minutes: rules.catalystBlackoutMin });
    }
  }
  if (lossAt !== null) out.push({ kind: 'afterLimit', from: lossAt, to: span.end });
  return out;
}

/* ─── Couloir Desk : le journal rejoué ─── */

/**
 * Écarts de discipline rejoués sur le journal : dérives après une perte (`detectDrifts`) et écarts aux règles du trader
 * (`detectRuleBreaches`), les mêmes fonctions que la veille au fill d'entrée. Lecture seule.
 */
export function replayDiscipline(trades: readonly Trade[], events: readonly CalEvent[], rules: TraderRules, plan: Pick<PropPlan, 'dailyLossLimit'> | null | undefined, planAccount: string): DisciplineFinding[] {
  const entries = trades.filter((t) => Number.isFinite(t.entryTime)).map(entryOfTrade);
  const drifts = detectDrifts(entries, trades, rules);
  const breaches = detectRuleBreaches(entries, { rules, closed: trades, catalysts: majorCatalysts(events), limit: dailyLimit(rules, plan), limitAccount: planAccount });
  return [...drifts, ...breaches].sort((a, b) => a.at.localeCompare(b.at));
}

/* ─── Ce qui borne l'heure qui vient : en vigueur, puis à venir ─── */

/**
 * Ce qui vaut à l'instant `t` : le kill switch engagé (la soumission reste fermée jusqu'au redémarrage), la perte du jour
 * déjà atteinte, une fenêtre de règle ouverte, le CME fermé ou la pause de 17:00. Une perte qui n'est atteinte qu'après
 * `t` n'y est pas : à l'instant du curseur, personne ne la savait.
 */
export type InForceKind = 'kill' | 'lossReached' | 'window' | 'closed' | 'pause';

export interface InForce {
  kind: InForceKind;
  since?: number;
  until?: number;
  event?: CalEvent;
  minutes?: number;
  closed?: 'weekend' | 'holiday';
}

export function inForceAt(t: number, span: DaySpan, plan: SessionPlan, windows: readonly TimeWindow[], known: { lossAt: number | null; kill: boolean }): InForce[] {
  const out: InForce[] = [];
  if (known.kill) out.push({ kind: 'kill' });
  if (plan.closed) out.push({ kind: 'closed', closed: plan.closed });
  else if (t > span.end) out.push({ kind: 'pause', since: span.end, until: span.end + 60 * MIN });
  if (known.lossAt !== null && known.lossAt <= t) out.push({ kind: 'lossReached', since: known.lossAt });
  for (const w of windows) {
    if (w.kind === 'rule' && w.from <= t && t < w.to) out.push({ kind: 'window', since: w.from, until: w.to, event: w.event, minutes: w.minutes });
  }
  return out;
}

/** « À venir » : ce qui est prévu. La perte du jour n'y entre jamais : elle n'est pas prévue, elle se constate. */
export type BoundaryKind = 'catalyst' | 'windowOpen' | 'windowClose' | 'rthOpen' | 'lunch' | 'rthReopen' | 'moc' | 'rthClose' | 'globexClose';

export interface Boundary {
  at: number;
  /** Le délai depuis l'instant lu, en ms (0 pour une publication sous le curseur). */
  delayMs: number;
  kind: BoundaryKind;
  /** Publication (catalyseur ou fenêtre de règle). */
  event?: CalEvent;
  /** Publications de la même minute, réunies sur une seule borne. */
  events?: CalEvent[];
  impact?: number;
  minutes?: number;
}

/**
 * Ce qui borne l'heure qui suit `t`, prévu seulement : publications (celle qui tombe sous le curseur compte, à la minute
 * près), ouvertures et fins de fenêtre, bascules de la séance. La fin d'une fenêtre déjà ouverte se lit en vigueur
 * (« jusqu'à 08:45 ») : elle n'est pas redite. Trié, au plus `limit`, chaque borne avec son délai.
 */
export function nextBoundaries(t: number, span: DaySpan, plan: SessionPlan, timed: readonly TimedEvent[], windows: readonly TimeWindow[], horizon = NEXT_HOUR, limit = 3): Boundary[] {
  const out: Omit<Boundary, 'delayMs'>[] = [];
  const within = (at: number) => at >= t - MIN / 2 && at <= t + horizon;
  const ahead = (at: number) => at > t && at <= t + horizon;
  for (const g of stemGroups(timed)) if (within(g.at)) out.push({ at: g.at, kind: 'catalyst', event: g.events[0], events: g.events, impact: g.impact });
  for (const w of windows) {
    if (w.kind !== 'rule') continue;
    const open = w.from <= t && t < w.to;
    if (ahead(w.from)) out.push({ at: w.from, kind: 'windowOpen', event: w.event, minutes: w.minutes });
    if (!open && ahead(w.to)) out.push({ at: w.to, kind: 'windowClose', event: w.event, minutes: w.minutes });
  }
  if (!plan.closed) {
    for (const p of plan.phases) {
      if (p.kind === 'rth' && ahead(p.from)) out.push({ at: p.from, kind: plan.phases.some((q) => q.kind === 'lunch' && q.to === p.from) ? 'rthReopen' : 'rthOpen' });
      if (p.kind === 'lunch' && ahead(p.from)) out.push({ at: p.from, kind: 'lunch' });
    }
    for (const m of plan.marks) if (m.key === 'moc' && ahead(m.at)) out.push({ at: m.at, kind: 'moc' });
    const rthClose = plan.earlyClose ?? plan.phases.filter((p) => p.kind === 'rth').at(-1)?.to;
    if (rthClose !== undefined && ahead(rthClose)) out.push({ at: rthClose, kind: 'rthClose' });
    if (ahead(span.end)) out.push({ at: span.end, kind: 'globexClose' });
  }
  const rank: Record<BoundaryKind, number> = { windowOpen: 1, catalyst: 2, windowClose: 3, rthOpen: 4, rthReopen: 5, lunch: 6, moc: 7, rthClose: 8, globexClose: 9 };
  return out
    .sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind])
    .slice(0, limit)
    .map((b) => ({ ...b, delayMs: Math.max(0, b.at - t) }));
}

/** La prochaine publication datée après `t` d'impact ≥ `minImpact` (majeur par défaut), parmi `events`. */
export function nextCatalyst(events: readonly CalEvent[], t: number, minImpact = CATALYST_MIN_IMPACT): TimedEvent | null {
  let best: TimedEvent | null = null;
  for (const e of events) {
    if (e.impact < minImpact) continue;
    const at = eventInstant(e);
    if (at === null || at <= t) continue;
    if (!best || at < best.at) best = { event: e, at };
  }
  return best;
}

export interface HourInput {
  /** L'instant lu : le curseur, ou maintenant. */
  at: number;
  /** Maintenant : le kill switch ne vaut qu'au présent et après. */
  now: number;
  events: readonly CalEvent[];
  /** Trades du compte lu (le journal). */
  trades: readonly Trade[];
  rules: Pick<TraderRules, 'catalystBlackoutMin'>;
  /** Limite du jour retenue (`dailyLimit`), `null` sans règle ni plan. */
  limit: number | null;
  /** Kill switch engagé (le verrou du renderer). */
  kill: boolean;
}

export interface HourAnswer {
  span: DaySpan;
  plan: SessionPlan;
  timed: TimedEvent[];
  /** La perte du jour connue à l'instant lu (`knownAt`) : `null` tant qu'aucune sortie faite ne l'a atteinte. */
  lossAt: number | null;
  /** Les fenêtres telles qu'on les savait à l'instant lu : la hachure ne part que d'une perte déjà constatée. */
  windows: TimeWindow[];
  /** Ce qui vaut à l'instant lu, d'abord. */
  inForce: InForce[];
  /** Puis ce qui vient dans l'heure, avec son délai. */
  ahead: Boundary[];
}

/**
 * La réponse de la frise à l'instant lu, d'un seul calcul : la journée CME, ses publications, la perte connue à cet
 * instant, les fenêtres qui en découlent, ce qui vaut, puis ce qui vient. Aucune part ne lit une sortie postérieure au
 * curseur : la hachure de la perte ne précède jamais le moment où on l'a sue.
 */
export function hourAt(input: HourInput): HourAnswer {
  const span = daySpan(cmeDay(input.at));
  const plan = sessionPlan(span);
  const { timed } = dayEvents(input.events, span);
  const lossAt = lossLimitInstant(input.trades, span, input.limit, input.at);
  const windows = dayWindows(span, timed, input.rules, lossAt);
  const inForce = inForceAt(input.at, span, plan, windows, { lossAt, kill: input.kill && input.at >= input.now - MIN });
  const ahead = nextBoundaries(input.at, span, plan, timed, windows);
  return { span, plan, timed, lossAt, windows, inForce, ahead };
}

/* ─── Étude d'événement ─── */

export interface Occurrence {
  date: string;
  at: number;
  title: string;
}

/** Les publications passées d'une famille (`familyKey`), datées, jusqu'à `until`. */
export function occurrences(events: readonly CalEvent[], family: string, until: number): Occurrence[] {
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const at = eventInstant(e);
    if (at === null || at > until || familyKey(e.title) !== family || seen.has(e.date)) continue;
    seen.add(e.date);
    out.push({ date: e.date, at, title: e.title });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface CompareSeries {
  date: string;
  at: number;
  /** [minutes depuis t0, P&L] : un pas à chaque sortie, rebasé à 0 sur la publication (ou au départ de la fenêtre). */
  points: [number, number][];
  /** Valeur à t0 + 90 min. */
  last: number;
  /** P&L des sorties de t0 − 30 à t0 + 90 min : la même mesure que la table. */
  window: number;
  sessionPnl: number;
  sessionIds: string[];
}

export interface CompareRow {
  date: string;
  sessionId: string;
  /** P&L des sorties dans la fenêtre. */
  window: number;
  sessionPnl: number;
}

export interface CompareStats {
  n: number;
  mean: number | null;
  winRate: number | null;
  /** Sous `COMPARE_WEAK_N` séances : à lire en veille. */
  weak: boolean;
  /** L'ensemble qui fait la ligne : chaque séance et son P&L de fenêtre. */
  rows: CompareRow[];
}

export interface Comparison {
  family: string;
  title: string;
  timeET: string;
  /** Publications passées de la famille, avec ou sans séance. */
  occurrences: Occurrence[];
  series: CompareSeries[];
  /** Moyenne des séances, en escalier : une marche à chaque sortie d'une des séances. */
  mean: [number, number][];
  /** Bande min–max des séances, aux mêmes marches. */
  band: [number, number, number][];
  with: CompareStats;
  without: CompareStats;
  /** Référence de l'alignement : la publication (t0) ou le départ de la fenêtre (t0 − 30). */
  base: 't0' | 'start';
}

/** Valeur d'une série en escalier à la minute `m`. */
export function valueAt(points: readonly [number, number][], m: number): number {
  let v = points[0]?.[1] ?? 0;
  for (const [x, y] of points) {
    if (x > m) break;
    v = y;
  }
  return v;
}

function statsOf(rows: CompareRow[]): CompareStats {
  if (!rows.length) return { n: 0, mean: null, winRate: null, weak: true, rows };
  const n = rows.length;
  return { n, mean: rows.reduce((sum, r) => sum + r.window, 0) / n, winRate: rows.filter((r) => r.window > 0).length / n, weak: n < COMPARE_WEAK_N, rows };
}

/**
 * Chaque publication passée de la famille, alignée sur t0 : le P&L réalisé de la séance du jour, de t0 − 30 min à
 * t0 + 90 min, rebasé à zéro sur la publication (`base` = 't0', par défaut) ou au départ de la fenêtre ; la moyenne en
 * escalier et sa bande min–max ; puis les séances avec et sans la publication, mesurées sur la même fenêtre (les jours
 * sans, à la même heure de New York) : P&L moyen de la fenêtre, réussite, n, veille sous `COMPARE_WEAK_N`.
 */
export function compareEvent(events: readonly CalEvent[], family: string, sessions: readonly Session[], trades: readonly Trade[], until: number, base: 't0' | 'start' = 't0', before = COMPARE_BEFORE_MIN, after = COMPARE_AFTER_MIN): Comparison {
  const occ = occurrences(events, family, until);
  const first = occ[0];
  const timeET = events.find((ev) => familyKey(ev.title) === family && ev.timeET && /^\d{2}:\d{2}$/.test(ev.timeET))?.timeET ?? '';
  const byDate = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const bySession = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!Number.isFinite(t.pnl) || !Number.isFinite(t.exitTime)) continue;
    const list = bySession.get(t.sessionId);
    if (list) list.push(t);
    else bySession.set(t.sessionId, [t]);
  }
  /** Le P&L des sorties d'une séance dans (t0 − before, t0 + after]. */
  const windowPnl = (s: Session, t0: number) => (bySession.get(s.id) ?? []).filter((t) => t.exitTime > t0 - before * MIN && t.exitTime <= t0 + after * MIN).reduce((sum, t) => sum + t.pnl, 0);
  const series: CompareSeries[] = [];
  const withRows: CompareRow[] = [];
  for (const o of occ) {
    const day = byDate.get(o.date);
    if (!day?.length) continue;
    for (const s of day) withRows.push({ date: o.date, sessionId: s.id, window: windowPnl(s, o.at), sessionPnl: s.pnl });
    const exits = day
      .flatMap((s) => bySession.get(s.id) ?? [])
      .filter((t) => t.exitTime > o.at - before * MIN && t.exitTime <= o.at + after * MIN)
      .sort((a, b) => a.exitTime - b.exitTime);
    // Le cumul part de zéro au départ de la fenêtre ; rebasé sur t0, il passe par zéro à la publication.
    let cum = 0;
    const raw: [number, number][] = [[-before, 0]];
    for (const t of exits) {
      cum += t.pnl;
      raw.push([Math.round(((t.exitTime - o.at) / MIN) * 10) / 10, cum]);
    }
    raw.push([after, cum]);
    const shift = base === 't0' ? valueAt(raw, 0) : 0;
    const points = raw.map(([m, v]) => [m, Math.round((v - shift) * 100) / 100] as [number, number]);
    series.push({ date: o.date, at: o.at, points, last: valueAt(points, after), window: cum, sessionPnl: day.reduce((sum, s) => sum + s.pnl, 0), sessionIds: day.map((s) => s.id) });
  }
  // La moyenne et la bande, exactes à chaque marche de l'une des séances.
  const steps = [...new Set(series.flatMap((s) => s.points.map(([m]) => m)))].sort((a, b) => a - b);
  const mean: [number, number][] = [];
  const band: [number, number, number][] = [];
  if (series.length) {
    for (const m of steps) {
      const values = series.map((s) => valueAt(s.points, m));
      mean.push([m, Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100]);
      band.push([m, Math.min(...values), Math.max(...values)]);
    }
  }
  const dates = new Set(occ.map((o) => o.date));
  const withoutRows: CompareRow[] = [];
  if (/^\d{2}:\d{2}$/.test(timeET)) {
    for (const s of sessions) {
      if (dates.has(s.date)) continue;
      const t0 = zonedToUtc(s.date, timeET, ET_ZONE);
      if (t0 > until) continue;
      withoutRows.push({ date: s.date, sessionId: s.id, window: windowPnl(s, t0), sessionPnl: s.pnl });
    }
  }
  return { family, title: first?.title ?? family, timeET, occurrences: occ, series, mean, band, with: statsOf(withRows), without: statsOf(withoutRows), base };
}

/** Familles comparables : au moins deux publications passées tombées un jour de séance ; les plus fortes d'abord. */
export function comparableFamilies(events: readonly CalEvent[], sessions: readonly Session[], until: number): { family: string; title: string; impact: number; n: number }[] {
  const dates = new Set(sessions.map((s) => s.date));
  const rows = new Map<string, { family: string; title: string; impact: number; days: Set<string> }>();
  for (const e of events) {
    const at = eventInstant(e);
    if (at === null || at > until || !dates.has(e.date)) continue;
    const family = familyKey(e.title);
    const row = rows.get(family) ?? { family, title: e.title, impact: e.impact, days: new Set<string>() };
    row.days.add(e.date);
    if (e.impact > row.impact) row.impact = e.impact;
    rows.set(family, row);
  }
  return [...rows.values()]
    .filter((row) => row.days.size >= 2)
    .map((row) => ({ family: row.family, title: row.title, impact: row.impact, n: row.days.size }))
    .sort((a, b) => b.impact - a.impact || b.n - a.n || a.title.localeCompare(b.title));
}

/* ─── Dix journées : deux semaines, ancrées à une journée donnée ─── */

/** Le lundi de la semaine de `day` (lundi → dimanche). */
export function mondayOf(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/**
 * Dix journées en deux semaines de cinq, ancrées à `today` : la semaine en cours et la suivante (`dir` = 1), ou la
 * précédente et la semaine en cours (`dir` = −1). Un samedi ou un dimanche, la semaine en cours est celle qui vient
 * (`dir` = 1) ou celle qui s'achève (`dir` = −1). Ordre chronologique.
 */
export function twoWeeks(today: string, dir: 1 | -1): string[] {
  const w = weekday(today);
  let monday = mondayOf(today);
  if (dir === 1 && (w === 0 || w === 6)) monday = addDays(monday, 7);
  const first = dir === 1 ? monday : addDays(monday, -7);
  const out: string[] = [];
  for (let k = 0; k < 2; k++) for (let d = 0; d < 5; d++) out.push(addDays(first, k * 7 + d));
  return out;
}

/**
 * Position de la journée `i` (0 à 9) sur l'anneau des deux semaines : la première semaine de 1 h (lundi) à 5 h
 * (vendredi), le week-end à 6 h, la seconde de 7 h à 11 h, le week-end à midi.
 */
export function weekRingPoint(i: number, cx: number, cy: number, r: number): [number, number] {
  const slot = i < 5 ? i : i + 1;
  const a = ((-60 + slot * 30) * Math.PI) / 180;
  return [Math.round((cx + r * Math.cos(a)) * 100) / 100, Math.round((cy + r * Math.sin(a)) * 100) / 100];
}
