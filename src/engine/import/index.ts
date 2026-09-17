import { parseCsv } from '@/lib/csv';
import { importExecutionsCsv } from './executions';
import { detectFormat, importTradesCsv, type ImportOptions, type ImportResult } from './ninjatrader';

/** Au-delà, l'import journal passe par `csv.worker.ts`. */
export const CSV_WORKER_MIN_LINES = 5000;

export function csvLineCount(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Point d'entrée unique : détecte le format (Trades, Exécutions, CΛNTO) et importe. */
export function importCsvAuto(text: string, opts: ImportOptions = {}): ImportResult {
  const headers = parseCsv(text.slice(0, 4000)).headers;
  const format = detectFormat(headers);
  if (format === 'ninjatrader-executions') return importExecutionsCsv(text, opts);
  return importTradesCsv(text, opts);
}

export { detectFormat, FORMAT_LABEL, exportTradesCsv, importTradesCsv } from './ninjatrader';
export type { ImportOptions, ImportResult } from './ninjatrader';
export { executionIdentityKey, takeNewExecutionTrades } from './identity';
export { importExecutionsCsv, pairExecutions, parseExecutionsCsv } from './executions';
export type { Execution, ExecutionsImportResult, OpenLot } from './executions';
