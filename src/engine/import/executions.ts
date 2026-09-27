import { tr } from '@/i18n';
import { detectDecimalSeparator, inferDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { detectDayFirst, parseFlexibleDateTime } from '@/lib/time';
import { getInstrument, resolveSymbol } from '../instruments';
import type { Instrument, SessionSource, Trade } from '../types';
import { executionIdentityKey, executionTimeIso } from './identity';
import { groupIntoSessions, MONEY_MAX, PRICE_MAX, QTY_MAX, unknownInstrumentWarnings, type ImportOptions, type ImportResult } from './ninjatrader';

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
  /** Mois tel que `resolveSymbol` l'écrit (`12-26`). Vide si la racine est nue. */
  contractMonth?: string;
  direction: 'long' | 'short';
  quantity: number;
  price: number;
  time: number;
  /** Commission de l'exécution d'entrée, par contrat. */
  commissionPerContract?: number;
  executionId?: string;
  orderId?: string;
  name?: string;
  identityKey?: string;
  openedAt?: number;
}

export interface ExecutionsImportResult extends ImportResult {
  executions: number;
  openLots: OpenLot[];
  tradeExecutionKeys: string[][];
  /** Empreintes connues après ce lot (précédentes + fraîches). */
  knownKeys: string[];
  /** Exécutions réellement appariées cette fois (les déjà connues sont absentes). */
  freshExecutions: Execution[];
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
  let outOfBounds = 0;
  const unknownCounts = new Map<string, number>();
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
    const resolved = resolveSymbol(instrumentName);
    const instrument = resolved?.symbol ?? null;
    const actionRaw = get('action').toLowerCase();
    const action = /^(buy|achat|b)/.test(actionRaw) ? 'buy' : /^(sell|vente|s)/.test(actionRaw) ? 'sell' : null;
    const quantity = Math.abs(parseLocaleNumber(get('quantity'), dec));
    const price = parseLocaleNumber(get('price'), dec);
    const time = parseFlexibleDateTime(get('time'), dayFirst);
    if (!instrument || !action || !quantity || Number.isNaN(quantity) || Number.isNaN(price) || !Number.isFinite(time)) {
      skipped++;
      if (!instrument) {
        const key = instrumentName.trim().toUpperCase();
        if (key) unknownCounts.set(key, (unknownCounts.get(key) ?? 0) + 1);
      }
      return;
    }
    // Bornes : quantité entière 1..10 000, prix 0..1 000 000 — sinon PnL/identités absurdes (Infinity, 1e300).
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || !Number.isInteger(quantity) || quantity > QTY_MAX || price < 0 || price > PRICE_MAX) {
      skipped++;
      outOfBounds++;
      return;
    }
    const commissionRaw = get('commission');
    const commission = commissionRaw ? Math.abs(parseLocaleNumber(commissionRaw, dec)) || 0 : 0;
    if (!Number.isFinite(commission) || commission > MONEY_MAX) {
      skipped++;
      outOfBounds++;
      return;
    }
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
  const warnings: string[] = [...table.warnings];
  const unknownRows = [...unknownCounts.values()].reduce((sum, n) => sum + n, 0);
  warnings.push(...unknownInstrumentWarnings(unknownCounts));
  if (skipped - unknownRows > 0) warnings.push(tr(`${skipped - unknownRows} exécution(s) ignorée(s) (champs invalides).`, `${skipped - unknownRows} execution(s) skipped (invalid fields).`, `${skipped - unknownRows} ejecución(es) ignorada(s) (campos inválidos).`));
  if (outOfBounds) warnings.push(tr(`${outOfBounds} exécution(s) rejetée(s) : quantité, prix ou commission hors bornes (qty entière 1–${QTY_MAX}, prix 0–${PRICE_MAX}).`, `${outOfBounds} execution(s) rejected: quantity, price or commission out of bounds (integer qty 1–${QTY_MAX}, price 0–${PRICE_MAX}).`, `${outOfBounds} ejecución(es) rechazada(s): cantidad, precio o comisión fuera de límites (qty entera 1–${QTY_MAX}, precio 0–${PRICE_MAX}).`));
  return { executions, skipped, warnings };
}

function uniqIds(ids: (string | undefined)[]): string[] | undefined {
  const out: string[] = [];
  for (const id of ids) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out.length ? out : undefined;
}

/** Clé de carnet : compte, racine, mois. Deux écritures du même contrat (`NQ 12-26`, `NQZ6`) ne se rejoignent que si le mois résolu est le même. */
function bookKey(account: string, instrument: string, contractMonth: string): string {
  return `${account}|${instrument}|${contractMonth}`;
}

function contractMonthOf(instrumentName: string): string {
  return resolveSymbol(instrumentName)?.contractMonth ?? '';
}

/**
 * Clé Dexie d'un lot ouvert : `account|instrument|contractMonth|executionId`.
 * Sans identifiant d'exécution, l'empreinte remplace le dernier segment pour que deux lots vides ne s'écrasent pas.
 */
export function openLotKey(lot: OpenLot): string {
  const month = lot.contractMonth ?? contractMonthOf(lot.instrumentName);
  const id = lot.executionId?.trim() ? lot.executionId.trim() : (lot.identityKey ?? '');
  return `${lot.account}|${lot.instrument}|${month}|${id}`;
}

interface Lot {
  account: string;
  instrumentName: string;
  instrument: Instrument;
  contractMonth: string;
  direction: 'long' | 'short';
  quantity: number;
  price: number;
  time: number;
  executionId: string;
  orderId?: string;
  identityKey: string;
  name?: string;
  commissionPerContract: number;
}

function lotFromOpen(src: OpenLot): Lot {
  const contractMonth = src.contractMonth ?? contractMonthOf(src.instrumentName);
  return {
    account: src.account,
    instrumentName: src.instrumentName,
    instrument: src.instrument,
    contractMonth,
    direction: src.direction,
    quantity: src.quantity,
    price: src.price,
    time: src.time,
    executionId: src.executionId ?? '',
    orderId: src.orderId,
    identityKey: src.identityKey ?? '',
    name: src.name,
    commissionPerContract: src.commissionPerContract ?? 0,
  };
}

function lotFromExecution(e: Execution, quantity: number, side: 'long' | 'short', cpc: number): Lot {
  return {
    account: e.account,
    instrumentName: e.instrumentName,
    instrument: e.instrument,
    contractMonth: contractMonthOf(e.instrumentName),
    direction: side,
    quantity,
    price: e.price,
    time: e.time,
    executionId: e.executionId,
    orderId: e.orderId,
    identityKey: e.identityKey,
    name: e.name,
    commissionPerContract: cpc,
  };
}

function toOpenLot(lot: Lot): OpenLot {
  return {
    account: lot.account,
    instrumentName: lot.instrumentName,
    instrument: lot.instrument,
    contractMonth: lot.contractMonth,
    direction: lot.direction,
    quantity: lot.quantity,
    price: lot.price,
    time: lot.time,
    openedAt: lot.time,
    commissionPerContract: lot.commissionPerContract,
    executionId: lot.executionId,
    orderId: lot.orderId,
    name: lot.name,
    identityKey: lot.identityKey,
  };
}

/**
 * Apparie les exécutions en trades aller-retour par compte et par contrat, méthode FIFO
 * (première entrée, première sortie), avec fractionnement des remplissages partiels.
 * `carriedLots` (défaut vide) sont les lots déjà ouverts : ils sont en tête de file, consommés
 * avant les nouvelles exécutions. Clé de carnet : `account|instrument|contractMonth`.
 * Sans lots repris, le résultat est celui d'un appariement sur le seul tableau fourni.
 */
export function pairExecutions(executions: Execution[], carriedLots: OpenLot[] = []): { trades: Trade[]; openLots: OpenLot[]; tradeExecutionKeys: string[][] } {
  const sorted = executions.map((e, i) => ({ e, i })).sort((a, b) => a.e.time - b.e.time || a.i - b.i);
  const books = new Map<string, Lot[]>();
  const trades: Trade[] = [];
  const tradeExecutionKeys: string[][] = [];
  const seenIds = new Set<string>();

  const carried = [...carriedLots].filter((lot) => lot.quantity > 0).sort((a, b) => a.time - b.time || a.account.localeCompare(b.account));
  for (const src of carried) {
    const lot = lotFromOpen(src);
    const key = bookKey(lot.account, lot.instrument, lot.contractMonth);
    const queue = books.get(key);
    if (queue) queue.push(lot);
    else books.set(key, [lot]);
  }

  for (const { e } of sorted) {
    const month = contractMonthOf(e.instrumentName);
    const key = bookKey(e.account, e.instrument, month);
    let lots = books.get(key);
    if (!lots) {
      lots = [];
      books.set(key, lots);
    }
    const side: 'long' | 'short' = e.action === 'buy' ? 'long' : 'short';
    const cpc = e.quantity > 0 ? e.commission / e.quantity : 0;
    let remaining = e.quantity;
    const spec = getInstrument(e.instrument);

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      if (!lot || lot.direction === side) break;
      const matched = Math.min(lot.quantity, remaining);
      const gross = (e.price - lot.price) * matched * spec.pointValue * (lot.direction === 'long' ? 1 : -1);
      const commission = Math.round(matched * (lot.commissionPerContract + cpc) * 100) / 100;
      const pnl = Math.round((gross - commission) * 100) / 100;
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) lots.shift();
      // Entrées bornées à l'analyse : un PnL non fini ici serait une corruption, jamais un trade.
      if (!Number.isFinite(pnl)) continue;
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
        pnl,
        commission,
        entryName: lot.name,
        exitName: e.name,
        executionIds: uniqIds([lot.executionId, e.executionId]),
        orderIds: uniqIds([lot.orderId, e.orderId]),
        contractMonth: month || undefined,
      });
      tradeExecutionKeys.push([lot.identityKey, e.identityKey]);
    }
    if (remaining > 0) lots.push(lotFromExecution(e, remaining, side, cpc));
  }

  const openLots: OpenLot[] = [];
  for (const lots of books.values()) {
    for (const lot of lots) {
      if (lot.quantity > 0) openLots.push(toOpenLot(lot));
    }
  }
  return { trades, openLots, tradeExecutionKeys };
}

/** Import complet d'un export Executions (ou du journal temps réel du pont) → séances + trades. */
export function importExecutionsCsv(text: string, opts: ImportOptions & { carriedLots?: OpenLot[]; knownKeys?: readonly string[] } = {}): ExecutionsImportResult {
  const { executions, skipped, warnings } = parseExecutionsCsv(text);
  const known = new Set(opts.knownKeys ?? []);
  const fresh = opts.knownKeys ? executions.filter((e) => !known.has(e.identityKey)) : executions;
  const carriedAll = opts.carriedLots ?? [];
  const accounts = new Set(fresh.map((e) => e.account));
  // Rejeu sans exécution nouvelle : on ne touche pas aux lots des autres comptes, ni à ceux déjà ouverts.
  const carried = accounts.size ? carriedAll.filter((lot) => accounts.has(lot.account)) : [];
  const untouched = accounts.size ? carriedAll.filter((lot) => !accounts.has(lot.account)) : carriedAll;
  const paired = pairExecutions(fresh, carried);
  for (const e of fresh) known.add(e.identityKey);
  const openLots = [...untouched, ...paired.openLots];
  if (opts.riskPerContract) for (const t of paired.trades) t.risk = opts.riskPerContract * t.qty;
  if (paired.openLots.length) warnings.push(tr(`${paired.openLots.length} position(s) encore ouverte(s) en fin de fichier — non importée(s) tant qu'elles ne sont pas clôturées.`, `${paired.openLots.length} position(s) still open at end of file — not imported until they are closed.`, `${paired.openLots.length} posición(es) aún abierta(s) al final del archivo — no importada(s) hasta que se cierren.`));
  const source: SessionSource = opts.source ?? 'ninjatrader';
  return {
    sessions: groupIntoSessions(paired.trades, opts.sessionBoundaryHour ?? 0, source),
    trades: paired.trades,
    warnings,
    format: 'ninjatrader-executions',
    skipped,
    executions: executions.length,
    openLots,
    tradeExecutionKeys: paired.tradeExecutionKeys,
    knownKeys: [...known],
    freshExecutions: fresh,
  };
}
