import { detectDecimalSeparator, inferDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { detectDayFirst, parseFlexibleDateTime } from '@/lib/time';
import { INSTRUMENTS, type Instrument, type SessionSource, type Trade } from '../types';
import { executionIdentityKey, executionTimeIso } from './identity';
import { detectInstrument, groupIntoSessions, type ImportOptions, type ImportResult } from './ninjatrader';

/**
 * Exécution brute telle qu'exportée par NinjaTrader 8 (onglet Executions › Export) ou écrite en
 * temps réel par l'AddOn CΛNTO Bridge (mêmes colonnes, culture invariante).
 */
export interface Execution {
  account: string;
  instrumentName: string;
  instrument: Instrument;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  time: number;
  executionId: string;
  orderId?: string;
  name?: string;
  commission: number;
  identityKey: string;
}

export interface OpenLot {
  account: string;
  instrumentName: string;
  instrument: Instrument;
  direction: 'long' | 'short';
  quantity: number;
  price: number;
  time: number;
}

export interface ExecutionsImportResult extends ImportResult {
  executions: number;
  openLots: OpenLot[];
  tradeExecutionKeys: string[][];
}

const COLS: Record<string, string[]> = {
  instrument: ['instrument', 'symbol'],
  action: ['action', 'side', 'sens'],
  quantity: ['quantity', 'qty', 'quantité', 'quantite', 'filled'],
  price: ['price', 'prix', 'fill price', 'avg. price'],
  time: ['time', 'heure', 'date', 'timestamp'],
  id: ['id', 'execution id', 'executionid', 'exec id'],
  orderId: ['order id', 'orderid'],
  name: ['name', 'nom'],
  commission: ['commission', 'commissions'],
  account: ['account', 'compte'],
};

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function indexColumns(headers: string[]): Record<string, number> {
  const norm = headers.map(normalize);
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLS)) {
    for (const a of aliases) {
      const i = norm.indexOf(a);
      if (i !== -1) {
        idx[key] = i;
        break;
      }
    }
  }
  return idx;
}

/** Vrai si l'en-tête ressemble à un export « Executions » (et non « Trades »). */
export function isExecutionsHeader(headers: string[]): boolean {
  const idx = indexColumns(headers);
  const norm = headers.map(normalize);
  const hasEntryExit = norm.includes('entry price') || norm.includes('exit price');
  return !hasEntryExit && idx.action !== undefined && idx.quantity !== undefined && idx.price !== undefined && idx.time !== undefined && idx.instrument !== undefined;
}

/** Empreinte stable (FNV-1a 32 bits) pour identifier un trade reconstitué de façon déterministe. */
function stableId(parts: (string | number)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `x_${h.toString(16).padStart(8, '0')}${s.length.toString(36)}`;
}

export function parseExecutionsCsv(text: string): { executions: Execution[]; skipped: number; warnings: string[] } {
  const table = parseCsv(text);
  const idx = indexColumns(table.headers);
  const iPrice = idx.price;
  const iCommission = idx.commission;
  const iTime = idx.time;
  const sample = table.rows.slice(0, 80);
  const dec =
    inferDecimalSeparator(
      sample.map((r) => (iPrice !== undefined ? (r[iPrice] ?? '') : '')),
      sample.map((r) => (iCommission !== undefined ? (r[iCommission] ?? '') : '')),
      table.delimiter,
    ) ?? detectDecimalSeparator(sample.map((r) => (iPrice !== undefined ? (r[iPrice] ?? '') : '')));
  const dayFirst = detectDayFirst(table.rows.slice(0, 50).map((r) => (iTime !== undefined ? (r[iTime] ?? '') : ''))) ?? table.delimiter === ';';
  const executions: Execution[] = [];
  let skipped = 0;
  const expectedCols = table.headers.length;
  table.rows.forEach((row) => {
    if (expectedCols > 0 && row.length !== expectedCols) {
      skipped++;
      return;
    }
    const get = (k: string) => {
      const i = idx[k];
      return i !== undefined ? (row[i] ?? '').trim() : '';
    };
    const instrumentName = get('instrument');
    const instrument = detectInstrument(instrumentName);
    const actionRaw = get('action').toLowerCase();
    const action = /^(buy|achat|b)/.test(actionRaw) ? 'buy' : /^(sell|vente|s)/.test(actionRaw) ? 'sell' : null;
    const quantity = Math.abs(parseLocaleNumber(get('quantity'), dec));
    const price = parseLocaleNumber(get('price'), dec);
    const time = parseFlexibleDateTime(get('time'), dayFirst);
    if (!instrument || !action || !quantity || !Number.isFinite(price) || !Number.isFinite(time)) {
      skipped++;
      return;
    }
    const commissionRaw = get('commission');
    const commission = commissionRaw ? Math.abs(parseLocaleNumber(commissionRaw, dec)) || 0 : 0;
    const account = get('account') || 'Compte';
    const executionId = get('id');
    executions.push({
      account,
      instrumentName,
      instrument,
      action,
      quantity,
      price,
      time,
      executionId,
      orderId: get('orderId') || undefined,
      name: get('name') || undefined,
      commission,
      identityKey: executionIdentityKey({
        account,
        executionId,
        instrument: instrumentName,
        timeIso: executionTimeIso(time),
        price,
        qty: quantity,
        action,
      }),
    });
  });
  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} exécution(s) ignorée(s) (instrument hors NQ/MNQ ou champs invalides).`);
  return { executions, skipped, warnings };
}

/**
 * Apparie les exécutions en trades aller-retour par compte et par contrat, méthode FIFO
 * (première entrée, première sortie), avec fractionnement des remplissages partiels.
 */
export function pairExecutions(executions: Execution[]): { trades: Trade[]; openLots: OpenLot[]; tradeExecutionKeys: string[][] } {
  const sorted = executions.map((e, i) => ({ e, i })).sort((a, b) => a.e.time - b.e.time || a.i - b.i);
  interface Lot {
    direction: 'long' | 'short';
    quantity: number;
    price: number;
    time: number;
    executionId: string;
    identityKey: string;
    name?: string;
    commissionPerContract: number;
  }
  const books = new Map<string, Lot[]>();
  const trades: Trade[] = [];
  const tradeExecutionKeys: string[][] = [];
  const seenIds = new Set<string>();

  for (const { e } of sorted) {
    const key = `${e.account}|${e.instrumentName.toUpperCase()}`;
    let lots = books.get(key);
    if (!lots) {
      lots = [];
      books.set(key, lots);
    }
    const side: 'long' | 'short' = e.action === 'buy' ? 'long' : 'short';
    const cpc = e.quantity > 0 ? e.commission / e.quantity : 0;
    let remaining = e.quantity;
    const spec = INSTRUMENTS[e.instrument];

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      if (!lot || lot.direction === side) break;
      const matched = Math.min(lot.quantity, remaining);
      const gross = (e.price - lot.price) * matched * spec.pointValue * (lot.direction === 'long' ? 1 : -1);
      const commission = Math.round(matched * (lot.commissionPerContract + cpc) * 100) / 100;
      let id = stableId([e.account, e.instrumentName, lot.executionId, e.executionId, matched]);
      while (seenIds.has(id)) id = `${id}_`;
      seenIds.add(id);
      trades.push({
        id,
        sessionId: '',
        instrument: e.instrument,
        account: e.account,
        direction: lot.direction,
        qty: matched,
        entryTime: lot.time,
        exitTime: e.time,
        entryPrice: lot.price,
        exitPrice: e.price,
        pnl: Math.round((gross - commission) * 100) / 100,
        commission,
        entryName: lot.name,
        exitName: e.name,
      });
      tradeExecutionKeys.push([lot.identityKey, e.identityKey]);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) lots.shift();
    }
    if (remaining > 0) {
      lots.push({ direction: side, quantity: remaining, price: e.price, time: e.time, executionId: e.executionId, identityKey: e.identityKey, name: e.name, commissionPerContract: cpc });
    }
  }

  const openLots: OpenLot[] = [];
  for (const [key, lots] of books) {
    const [account, instrumentName] = key.split('|');
    if (!account || !instrumentName) continue;
    for (const lot of lots) {
      const instrument = detectInstrument(instrumentName);
      if (instrument) openLots.push({ account, instrumentName, instrument, direction: lot.direction, quantity: lot.quantity, price: lot.price, time: lot.time });
    }
  }
  return { trades, openLots, tradeExecutionKeys };
}

/** Import complet d'un export Executions (ou du journal temps réel du pont) → séances + trades. */
export function importExecutionsCsv(text: string, opts: ImportOptions = {}): ExecutionsImportResult {
  const { executions, skipped, warnings } = parseExecutionsCsv(text);
  const { trades, openLots, tradeExecutionKeys } = pairExecutions(executions);
  if (opts.riskPerContract) for (const t of trades) t.risk = opts.riskPerContract * t.qty;
  if (openLots.length) warnings.push(`${openLots.length} position(s) encore ouverte(s) en fin de fichier — non importée(s) tant qu'elles ne sont pas clôturées.`);
  const source: SessionSource = opts.source ?? 'ninjatrader';
  return {
    sessions: groupIntoSessions(trades, opts.sessionBoundaryHour ?? 0, source),
    trades,
    warnings,
    format: 'ninjatrader-executions',
    skipped,
    executions: executions.length,
    openLots,
    tradeExecutionKeys,
  };
}
