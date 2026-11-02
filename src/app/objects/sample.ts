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
