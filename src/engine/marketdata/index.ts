import { createCsvPort, type CsvPort } from './adapters/csv';
import { createDemoPort, type DemoPortOptions } from './adapters/demo';
import type { MarketDataPort } from './port';

export type { DemoPortOptions } from './adapters/demo';
export { demoSeedFromDate } from './adapters/demo';
export type { CsvPort } from './adapters/csv';
export type { FeedEvent, FeedKind, HistoryRequest, MarketDataPort, Quote, SubscribeRequest, Tick, Timeframe, Unsubscribe } from './port';
export { dedupeBars } from './port';

export interface PortBind {
  /** CSV déjà lu. Le port ne touche pas au disque. */
  csvText?: string;
  demo?: DemoPortOptions;
}

const FACTORIES = {
  demo: (bind?: PortBind) => createDemoPort(bind?.demo),
  csv: (bind?: PortBind) => createCsvPort(bind?.csvText ?? ''),
} as const;

/** `demo` et `csv` seulement. Toute autre source lève une Error. */
export function createPort(sourceId: string, bind?: PortBind): MarketDataPort {
  if (sourceId === 'demo') return FACTORIES.demo(bind);
  if (sourceId === 'csv') return FACTORIES.csv(bind);
  throw new Error(`Source de marché inconnue : ${sourceId}`);
}

export function portWarnings(port: MarketDataPort): string[] {
  const warnings = (port as Partial<CsvPort>).warnings;
  return Array.isArray(warnings) ? warnings : [];
}
