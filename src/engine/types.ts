export type Instrument = 'NQ' | 'MNQ';

export interface InstrumentSpec {
  symbol: Instrument;
  name: string;
  exchange: 'CME';
  currency: 'USD';
  pointValue: number;
  tickSize: number;
  tickValue: number;
}

export const INSTRUMENTS: Record<Instrument, InstrumentSpec> = {
  NQ: {
    symbol: 'NQ',
    name: 'E-mini Nasdaq-100',
    exchange: 'CME',
    currency: 'USD',
    pointValue: 20,
    tickSize: 0.25,
    tickValue: 5,
  },
  MNQ: {
    symbol: 'MNQ',
    name: 'Micro E-mini Nasdaq-100',
    exchange: 'CME',
    currency: 'USD',
    pointValue: 2,
    tickSize: 0.25,
    tickValue: 0.5,
  },
};

export type Direction = 'long' | 'short';

export type SessionSource = 'ninjatrader' | 'csv' | 'manuel' | 'demo';

export interface Trade {
  id: string;
  sessionId: string;
  instrument: Instrument;
  account?: string;
  direction: Direction;
  qty: number;
  /** epoch ms */
  entryTime: number;
  /** epoch ms */
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** PnL net (USD), commissions déduites */
  pnl: number;
  commission: number;
  /** Maximum adverse excursion (USD, valeur positive) */
  mae?: number;
  /** Maximum favorable excursion (USD, valeur positive) */
  mfe?: number;
  strategy?: string;
  entryName?: string;
  exitName?: string;
  tags?: string[];
  /** Risque planifié en USD, pour les multiples de R */
  risk?: number;
  /** Identifiants d'exécutions NT ayant formé ce trade */
  executionIds?: string[];
  /** Identifiants d'ordres NT (FIFO entrée puis sortie) */
  orderIds?: string[];
  /** Mois de contrat (ex. 12-26, SEP26) */
  contractMonth?: string;
  schemaVersion?: number;
}

export interface Session {
  id: string;
  /** Journée de trading, 'YYYY-MM-DD' */
  date: string;
  account?: string;
  instruments: Instrument[];
  source: SessionSource;
  tradeCount: number;
  pnl: number;
  grossProfit: number;
  grossLoss: number;
  commission: number;
  tags: string[];
  note?: string;
  /** Auto-évaluation 1..5 */
  rating?: number;
  createdAt: number;
  updatedAt: number;
  executionIds?: string[];
  contractMonth?: string;
  schemaVersion?: number;
}

/** Soft limit UI : warning + proposition d'export, pas de drop silencieux à l'import. */
export const SESSION_CAPACITY = 1000;
