import { parseCsv } from '@/lib/csv';
import { importExecutionsCsv } from './executions';
import { detectFormat, importTradesCsv, type ImportOptions } from './ninjatrader';

self.onmessage = (e: MessageEvent<{ text: string; opts: ImportOptions }>) => {
  try {
    self.postMessage({ type: 'progress', done: 0, total: 1 });
    const { text, opts } = e.data;
    const headers = parseCsv(text.slice(0, 4000)).headers;
    const format = detectFormat(headers);
    const result = format === 'ninjatrader-executions' ? importExecutionsCsv(text, opts) : importTradesCsv(text, opts);
    self.postMessage({ type: 'progress', done: 1, total: 1 });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
