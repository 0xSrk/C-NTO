import type { SlotValues } from '@/design/Micro';
import { CATALYST_HORIZON_DAYS } from '@/engine/agent/tools';
import type { CalEvent } from '@/engine/calendar';
import type { CalendarSourceStatus } from '@/engine/calendarEvents';
import { majorCatalysts } from '@/engine/discipline';
import { tr } from '@/i18n';
import { cmeSession } from '@/lib/cmeClosed';
import { addDays, etDateKey, ET_ZONE, globexState, zonedToUtc, type GlobexState } from '@/lib/time';

/**
 * Calendrier, Système 4.0 : le trait dit l'état d'une publication, la forme dit son impact — aucune couleur dépensée,
 * l'or et le rouge restent aux signaux du desk. Pur : l'instant `now` est passé, les dates sont celles de New York.
 */

/** Plein : publié ou passé (en service) · tireté : prévu dans la fenêtre · pointillé : au-delà de l'horizon. */
export type Stroke = 'publie' | 'prevu' | 'horizon';

export const STROKES: readonly Stroke[] = ['publie', 'prevu', 'horizon'];

/** Dernier jour de la fenêtre (date de New York) : aujourd'hui plus l'horizon des catalyseurs du desk. */
export function horizonEnd(now: number, days = CATALYST_HORIZON_DAYS): string {
  return addDays(etDateKey(now), days);
}

/** Instant de la publication ; une journée entière (sans heure) commence à minuit, heure de New York. */
function instant(e: Pick<CalEvent, 'date' | 'timeET'>): number {
  return zonedToUtc(e.date, e.timeET ?? '00:00', ET_ZONE);
}

/** Le trait d'une publication à l'instant `now`. Un résultat publié reste plein, quelle que soit sa date. */
export function strokeOf(e: Pick<CalEvent, 'date' | 'timeET' | 'actual'>, now: number, days = CATALYST_HORIZON_DAYS): Stroke {
  if (e.actual != null && e.actual !== '') return 'publie';
  if (instant(e) <= now) return 'publie';
  return e.date > horizonEnd(now, days) ? 'horizon' : 'prevu';
}

/** Barres de l'impact : trois, de hauteur croissante (px), allumées jusqu'au niveau. */
export function impactBars(level: number): { height: number; on: boolean }[] {
  return [1, 2, 3].map((k) => ({ height: 4 + k * 2.5, on: k <= level }));
}

/** Premier jour, parmi `days` (triés), au-delà de l'horizon : il porte le glyphe de l'horizon. */
export function horizonDay(days: readonly string[], now: number, n = CATALYST_HORIZON_DAYS): string | null {
  const end = horizonEnd(now, n);
  return days.find((d) => d > end) ?? null;
}

/** Rang de « maintenant » parmi les publications du jour triées par heure : après celles déjà passées. */
export function nowIndex(events: readonly Pick<CalEvent, 'date' | 'timeET'>[], now: number): number {
  let i = 0;
  while (i < events.length && instant(events[i]!) <= now) i++;
  return i;
}

/** Tracé de « maintenant » : la lentille du sceau, épaisse au centre, effilée aux bouts (boîte 400 × 8). */
export const LENS_PATH = 'M0 4 C120 1.6 280 1.6 400 4 C280 6.4 120 6.4 0 4 Z';

/** État de la synchro des sources officielles, tel que le tient le calendrier. */
export interface SyncInput {
  syncing: boolean;
  sources: readonly Pick<CalendarSourceStatus, 'sourceId' | 'state'>[];
  /** Publications officielles en cache. */
  cached: number;
}

/** La synchro dite telle qu'elle est (voix technique de la plaque). */
export function syncLabel({ syncing, sources, cached }: SyncInput): string {
  if (syncing) return 'SYNCING';
  if (!sources.length) return cached > 0 ? 'CACHED' : 'OFFLINE';
  if (sources.every((src) => src.state === 'ok')) return 'SYNCED';
  if (sources.some((src) => src.state === 'ok')) return 'PARTIAL';
  return sources.some((src) => src.state === 'stale') ? 'STALE' : 'ERROR';
}

function globexLabel(state: GlobexState): string {
  switch (state) {
    case 'FERMÉ':
      return tr('FERMÉ', 'CLOSED', 'CERRADO');
    case 'FERMÉ · FÉRIÉ':
      return tr('FERMÉ · FÉRIÉ', 'CLOSED · HOLIDAY', 'CERRADO · FESTIVO');
    default:
      return state;
  }
}

/** Libellé court d'une publication sur la plaque : sans parenthèse, en capitales, borné. */
export function plateTitle(title: string, max = 18): string {
  const bare = (title.replace(/\s*\([^)]*\)/g, '').split(/\s+[·—–]\s+/)[0] ?? '').trim().toUpperCase();
  return bare.length > max ? `${bare.slice(0, max - 1).trimEnd()}…` : bare;
}

/**
 * Ce que lit la plaque TIME ENGINE : la séance CME Globex de l'instant (jours fermés et demi-séances compris), les
 * prochains catalyseurs majeurs du jour (ceux que surveille la discipline du desk), l'état de la synchro.
 */
export function timeEngineValues(input: SyncInput & { now: number; events: readonly CalEvent[] }, label: (title: string) => string = (title) => title): SlotValues {
  const day = etDateKey(input.now);
  const cme = cmeSession(day);
  const next = majorCatalysts(input.events.filter((e) => e.date === day))
    .filter((c) => c.at >= input.now)
    .slice(0, 3);
  return {
    session: `CME GLOBEX · ${globexLabel(globexState(input.now, cme.closed, cme.earlyCloseMinute))}`,
    catalysts: next.length ? next.map((c) => `${plateTitle(label(c.title))} ${c.timeET}`).join(' • ') : tr('AUCUN CATALYSEUR', 'NO CATALYST', 'SIN CATALIZADOR'),
    sync: syncLabel(input),
  };
}

/** La même lecture, en phrase, pour les lecteurs d'écran. */
export function timeEngineLabel(values: SlotValues): string {
  const session = String(values.session ?? '—').replace('CME GLOBEX', 'CME Globex');
  return tr(
    `Moteur de temps : ${session} · prochains catalyseurs : ${values.catalysts ?? '—'} · synchro ${values.sync ?? '—'}`,
    `Time engine: ${session} · next catalysts: ${values.catalysts ?? '—'} · sync ${values.sync ?? '—'}`,
    `Motor de tiempo: ${session} · próximos catalizadores: ${values.catalysts ?? '—'} · sincronización ${values.sync ?? '—'}`,
  );
}
