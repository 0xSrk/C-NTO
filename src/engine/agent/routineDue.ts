/**
 * Quand proposer le brief et le débrief à l'agent embarqué.
 * Hors de `routines.ts`, qui reste sans import (process principal).
 */

import { cmeSession } from '@/lib/cmeClosed';
import { ET_ZONE, etDateKey, tradingDayKey, weekday, zonedToUtc } from '@/lib/time';

export interface RoutineSeen {
  /** Journée CME où le brief a déjà été proposé. */
  brief?: string;
  /** Journée CME où le débrief a déjà été proposé. */
  debrief?: string;
}

export interface RoutineDueContext {
  /** Trades de la journée CME en cours. */
  tradesToday: number;
  /**
   * Perte de la journée à 100 % de la limite retenue (seuil du `daily_loss` à 100 %), recalculée du journal
   * par l'onglet (`dailyLossReached`) : elle tient après un redémarrage du desk.
   */
  dailyLossFull: boolean;
  seen?: RoutineSeen;
}

export interface RoutineDue {
  /** Journée CME (18 h → 17 h, heure de New York). */
  day: string;
  brief: boolean;
  debrief: boolean;
}

const BRIEF_START = 8 * 60 + 30;
const BRIEF_END = 9 * 60 + 30;
const DEBRIEF_START = 16 * 60 + 15;

/** Minutes entamées depuis minuit, heure de New York : 8 h 29 min 30 s compte 8 h 29, pas 8 h 30. */
function minutesET(now: number): number {
  const date = etDateKey(now);
  return Math.floor((now - zonedToUtc(date, '00:00', ET_ZONE)) / 60_000);
}

/** Lundi à vendredi, hors journée marquée fermée. */
function openSession(day: string): boolean {
  const dow = weekday(day);
  return dow >= 1 && dow <= 5 && !cmeSession(day).closed;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Journée vue, ou `undefined` si la valeur n'est pas lisible (coffre ancien : la clé est absente). */
export function coerceRoutineSeen(value: unknown): RoutineSeen | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const pick = (key: 'brief' | 'debrief'): string | undefined | null => {
    if (row[key] === undefined) return undefined;
    return typeof row[key] === 'string' && DATE_KEY.test(row[key]) ? row[key] : null;
  };
  const brief = pick('brief');
  const debrief = pick('debrief');
  if (brief === null || debrief === null) return undefined;
  const out: RoutineSeen = {};
  if (brief) out.brief = brief;
  if (debrief) out.debrief = debrief;
  return out;
}

export type RoutineCue = 'brief' | 'debrief';

/**
 * Routine lancée par chaque bouton de l'onglet Agent. Rien ne part sans clic du trader ; la journée CME
 * n'est retenue que si la routine part (`runRoutine` rend vrai).
 */
export const ROUTINE_OF = { brief: 'pre_session_brief', debrief: 'session_debrief' } as const;

/**
 * Brief : jour de séance, 8 h 30 à 9 h 30 heure de New York.
 * Débrief : après 16 h 15 s'il y a des trades, ou dès que la perte du jour atteint la limite (`daily_loss` à 100 %).
 * Rien le samedi, le dimanche (hors séance) ni un jour fermé.
 * Une routine déjà proposée pour cette journée CME ne l'est plus.
 */
export function routineDue(now: number, ctx: RoutineDueContext): RoutineDue {
  const day = tradingDayKey(now, 18, ET_ZONE);
  if (!openSession(day)) return { day, brief: false, debrief: false };
  const minutes = minutesET(now);
  // Après 18 h la journée CME a basculé : l'horloge civile n'est plus celle de l'après-midi.
  const afternoon = etDateKey(now) === day;
  const seen = ctx.seen;
  const brief = afternoon && minutes >= BRIEF_START && minutes <= BRIEF_END && seen?.brief !== day;
  const byClock = afternoon && minutes >= DEBRIEF_START && ctx.tradesToday > 0;
  const debrief = seen?.debrief !== day && (byClock || ctx.dailyLossFull);
  return { day, brief, debrief };
}
