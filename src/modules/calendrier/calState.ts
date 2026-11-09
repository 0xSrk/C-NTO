import { CATALYST_HORIZON_DAYS } from '@/engine/agent/tools';
import type { CalEvent } from '@/engine/calendar';
import type { CoverageGap } from '@/engine/calendarCoverage';
import { tr } from '@/i18n';
import { horizonEnd, publicationInstant } from '@/lib/calendarMarks';

/**
 * Calendrier, Système 4.0 : le trait dit l'état d'une publication, la forme dit son impact — aucune couleur dépensée,
 * l'or et le rouge restent aux signaux du desk. Pur : l'instant `now` est passé, les dates sont celles de New York.
 * Système 4.1 : plus de plaque TIME ENGINE ; la séance, la synchro et les catalyseurs sont dits chacun une fois ailleurs.
 * Système 5 (OROS5.4) : les tables du trait et de l'impact vivent dans `src/lib/calendarMarks.ts`, que le châssis et le
 * design lisent sans importer un module ; elles se relisent ici pour leurs lecteurs d'avant. Restent au Calendrier
 * l'horizon de sa grille, « maintenant » dans le flux et la lentille.
 */
export { horizonEnd, impactBars, strokeOf, STROKES, type Stroke } from '@/lib/calendarMarks';

/** Premier jour, parmi `days` (triés), au-delà de l'horizon : il porte le glyphe de l'horizon. */
export function horizonDay(days: readonly string[], now: number, n = CATALYST_HORIZON_DAYS): string | null {
  const end = horizonEnd(now, n);
  return days.find((d) => d > end) ?? null;
}

/** Rang de « maintenant » parmi les publications du jour triées par heure : après celles déjà passées. */
export function nowIndex(events: readonly Pick<CalEvent, 'date' | 'timeET'>[], now: number): number {
  let i = 0;
  while (i < events.length && publicationInstant(events[i]!) <= now) i++;
  return i;
}

/** Tracé de « maintenant » : la lentille du sceau, épaisse au centre, effilée aux bouts (boîte 400 × 8). */
export const LENS_PATH = 'M0 4 C120 1.6 280 1.6 400 4 C280 6.4 120 6.4 0 4 Z';

/** « 04.12.2026 » : la dernière date connue d'une famille, telle que la note l'écrit. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/**
 * Ce que le calendrier officiel ne couvre plus, en mots (SEC2.2) ; `null` quand il couvre. Le NFP et le CPI sont alors
 * estimés par règle et marqués « ≈ » ; le FOMC n'a pas de règle, sa date manque. `text` tient dans la barre du
 * Calendrier, `detail` dit la dernière date connue et ce que lisent les gardes.
 */
export function coverageNotice(gaps: readonly CoverageGap[]): { text: string; detail: string } | null {
  if (gaps.length === 0) return null;
  const estimated = gaps.filter((gap) => gap.family !== 'fomc').map((gap) => (gap.family === 'nfp' ? 'NFP' : 'CPI'));
  const fomc = gaps.some((gap) => gap.family === 'fomc');
  const parts: string[] = [];
  if (estimated.length === 2) parts.push(tr('NFP et CPI estimés par règle', 'NFP and CPI estimated by rule', 'NFP y CPI estimados por regla'));
  else if (estimated.length === 1) parts.push(tr(`${estimated[0]} estimé par règle`, `${estimated[0]} estimated by rule`, `${estimated[0]} estimado por regla`));
  if (fomc) parts.push(tr('FOMC sans date', 'FOMC not dated', 'FOMC sin fecha'));
  const known = gaps
    .map((gap) => {
      const name = gap.family === 'nfp' ? 'NFP' : gap.family === 'cpi' ? 'CPI' : 'FOMC';
      return gap.last ? `${name} ${shortDate(gap.last)}` : tr(`${name} aucune`, `${name} none`, `${name} ninguna`);
    })
    .join(' · ');
  return {
    text: `${tr('Couverture', 'Coverage', 'Cobertura')} · ${parts.join(' · ')}`,
    detail: tr(
      `Le calendrier officiel ne donne plus ces publications. Dernière date connue : ${known}. Les dates marquées « ≈ » sont estimées par règle ; le blackout du Copieur et la garde « catalyseur » de l’agent les lisent. Une mise à jour du desk rend les dates officielles.`,
      `The official calendar no longer gives these releases. Last known date: ${known}. Dates marked “≈” are estimated by rule; the Copier blackout and the agent’s “catalyst” guard read them. A desk update restores the official dates.`,
      `El calendario oficial ya no da estas publicaciones. Última fecha conocida: ${known}. Las fechas marcadas « ≈ » se estiman por regla; el blackout del Copiador y la guarda « catalizador » del agente las leen. Una actualización del desk devuelve las fechas oficiales.`,
    ),
  };
}
