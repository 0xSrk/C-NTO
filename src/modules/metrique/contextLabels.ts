import type { VolBand, VolCycle } from '@/engine/metricsContext';
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
