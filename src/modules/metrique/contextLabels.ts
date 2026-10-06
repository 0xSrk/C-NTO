import type { VolBand, VolCycle } from '@/engine/metricsContext';
import type { Axis } from './axisReading';
import { tr } from '@/i18n';

/** Régime de volatilité de la fiche, dans la langue du desk. Jamais la clé brute du moteur. */
export function volCycleLabel(cycle: VolCycle): string {
  if (cycle === 'choc') return tr('choc', 'shock', 'choque');
  if (cycle === 'expansion') return tr('expansion', 'expansion', 'expansión');
  if (cycle === 'decrue') return tr('décrue', 'receding', 'descenso');
  return tr('compression', 'compression', 'compresión');
}

/** Bande de volatilité (tiers de la volatilité moyen terme), dans la langue du desk. */
export function volBandLabel(band: VolBand): string {
  if (band === 'basse') return tr('basse', 'low', 'baja');
  if (band === 'moyenne') return tr('moyenne', 'medium', 'media');
  return tr('haute', 'high', 'alta');
}

const SIGMA_NAMES: Record<string, [string, string, string]> = {
  '<0.25': ['[0 ; 0,25) σ', '[0, 0.25) σ', '[0 ; 0,25) σ'],
  '0.25-0.5': ['[0,25 ; 0,5) σ', '[0.25, 0.5) σ', '[0,25 ; 0,5) σ'],
  '0.5-1': ['[0,5 ; 1) σ', '[0.5, 1) σ', '[0,5 ; 1) σ'],
  '>1': ['[1 ; ∞) σ', '[1, ∞) σ', '[1 ; ∞) σ'],
};

const CYCLES: readonly string[] = ['expansion', 'compression', 'choc', 'decrue'] satisfies VolCycle[];
const BANDS: readonly string[] = ['basse', 'moyenne', 'haute'] satisfies VolBand[];

/** Libellé d'une ligne de la vue par axe : le régime et la bande se nomment comme dans le contexte du jour. */
export function axisRowLabel(axis: Axis, key: string): string {
  if (axis === 'regime' && CYCLES.includes(key)) return volCycleLabel(key as VolCycle);
  if (axis === 'band' && BANDS.includes(key)) return volBandLabel(key as VolBand);
  const sigma = axis === 'sigma' ? SIGMA_NAMES[key] : undefined;
  if (sigma) return tr(sigma[0], sigma[1], sigma[2]);
  if (axis === 'hour') return `${key}h`;
  if (axis === 'afterLoss') return key === 'perte' ? tr('après une perte', 'after a loss', 'tras una pérdida') : tr('après un gain', 'after a win', 'tras una ganancia');
  if (axis === 'release') return key === 'pres' ? tr('proche', 'near', 'cerca') : tr('loin', 'far', 'lejos');
  if (axis === 'risk') return key === 'dans' ? tr('dans la recommandation', 'within the recommendation', 'dentro de la recomendación') : tr('au-dessus', 'above', 'por encima');
  if (axis === 'weekday') {
    const names: Record<string, [string, string, string]> = {
      lun: ['lundi', 'Monday', 'lunes'],
      mar: ['mardi', 'Tuesday', 'martes'],
      mer: ['mercredi', 'Wednesday', 'miércoles'],
      jeu: ['jeudi', 'Thursday', 'jueves'],
      ven: ['vendredi', 'Friday', 'viernes'],
    };
    const row = names[key];
    return row ? tr(row[0], row[1], row[2]) : key;
  }
  return key;
}
