import { parseCsv } from '@/lib/csv';
import { importExecutionsCsv } from './executions';
import { detectFormat, importTradesCsv, type ImportOptions, type ImportResult } from './ninjatrader';

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
