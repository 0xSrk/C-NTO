import type { ClaimConfidence } from '@/engine/ontology';
import { tr } from '@/i18n';

/** L'échantillon d'un chiffre, aux seuils du moteur (`SAMPLE_FAIBLE`, `SAMPLE_MOYEN`, `SAMPLE_SOLIDE`), en mots. */
export function sampleWord(sample: ClaimConfidence['sample']): string {
  switch (sample) {
    case 'insuffisant':
      return tr('insuffisant', 'insufficient', 'insuficiente');
    case 'faible':
      return tr('faible', 'weak', 'débil');
    case 'moyen':
      return tr('moyen', 'medium', 'medio');
    case 'solide':
      return tr('solide', 'solid', 'sólido');
  }
}

/** « échantillon moyen » : le nom et son mot, accordés dans chaque langue (« muestra media »). */
export function samplePhrase(sample: ClaimConfidence['sample']): string {
  switch (sample) {
    case 'insuffisant':
      return tr('échantillon insuffisant', 'insufficient sample', 'muestra insuficiente');
    case 'faible':
      return tr('échantillon faible', 'weak sample', 'muestra débil');
    case 'moyen':
      return tr('échantillon moyen', 'medium sample', 'muestra media');
    case 'solide':
      return tr('échantillon solide', 'solid sample', 'muestra sólida');
  }
}
