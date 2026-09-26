import { importBarsCsv } from '../../bars';
import { dedupeBars, type HistoryRequest, type MarketDataPort } from '../port';

export interface CsvPort extends MarketDataPort {
  /** Avertissements du dernier `history` (lignes ignorées, colonnes manquantes). */
  readonly warnings: string[];
}

/**
 * Enveloppe `importBarsCsv`. Le texte est fourni par l'appelant : le port
 * n'ouvre pas de fichier. Les gros fichiers restent sur `bars.worker.ts`,
 * qui appelle le même parseur.
 */
export function createCsvPort(text: string): CsvPort {
  let disposed = false;
  const warnings: string[] = [];

  return {
    sourceId: 'csv',
    capabilities: { history: true, live: [], instruments: 'any' },
    warnings,
    async history(req: HistoryRequest) {
      if (disposed) throw new Error('Port CSV libéré');
      const parsed = importBarsCsv(text);
      warnings.splice(0, warnings.length, ...parsed.warnings);
      return dedupeBars(parsed.bars.filter((b) => b.time >= req.from && b.time <= req.to));
    },
    dispose() {
      disposed = true;
    },
  };
}
