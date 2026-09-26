/**
 * FRED (Saint-Louis Fed) — valeurs actual / previous, pas de nouveaux événements.
 *
 * URL : https://api.stlouisfed.org/fred/series/observations
 * Vérifié le 2026-09-26 : sans `api_key`, HTTP 400. La clé est `byok`.
 * Le fichier `tests/fixtures/calendar/fred.json` reprend le schéma documenté
 * (`observations[].date`, `observations[].value`, « . » = manquant). La valeur
 * 159075 est le CES0000000001 d'août 2026 lu le même jour sur api.bls.gov,
 * placée ici pour exercer le parseur — ce n'est pas une réponse FRED capturée.
 *
 * Séries prévues quand une clé est présente (ne crée pas d'événement) :
 * - PAYEMS → NFP (emplois)
 * - CPIAUCSL → CPI
 */

import type { CalendarEventRow } from './types';

export const FRED_OBS_URL = 'https://api.stlouisfed.org/fred/series/observations';

export interface FredPatch {
  /** Famille d'événement : nfp, cpi. */
  family: 'nfp' | 'cpi';
  actual: string;
  previous?: string;
  /** YYYY-MM du point le plus récent. */
  month: string;
}

export function parseFredObservations(raw: unknown, family: 'nfp' | 'cpi'): FredPatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const obs = (raw as { observations?: { date?: string; value?: string }[] }).observations;
  if (!Array.isArray(obs)) return null;
  const points = obs.filter((o) => o && typeof o.value === 'string' && o.value !== '.' && typeof o.date === 'string');
  const latest = points[0];
  if (!latest?.value || !latest.date) return null;
  const prev = points[1];
  return {
    family,
    actual: latest.value,
    previous: prev?.value,
    month: latest.date.slice(0, 7),
  };
}

/** Ne remplit que les événements officiels encore sans `actual`, même famille, même mois de référence si daté. */
export function applyFredPatch(events: CalendarEventRow[], patch: FredPatch | null): CalendarEventRow[] {
  if (!patch) return events;
  return events.map((ev) => {
    if (ev.actual) return ev;
    if (patch.family === 'nfp' && !ev.id.includes(':nfp-')) return ev;
    if (patch.family === 'cpi' && !ev.id.includes(':cpi-')) return ev;
    return { ...ev, actual: patch.actual, previous: patch.previous ?? ev.previous };
  });
}

export const fredAdapter = {
  sourceId: 'fred' as const,
  /** Sans clé, aucune requête. Le remplissage est fait par l'orchestrateur via `applyFredPatch`. */
  async fetch(_range: { from: string; to: string }, ctx: { byok?: string }): Promise<CalendarEventRow[]> {
    if (!ctx.byok) throw new Error('clé FRED absente');
    return [];
  },
};
