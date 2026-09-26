import { tr } from '@/i18n';
import { inferDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { uid } from '@/lib/id';
import { detectDayFirst, ET_ZONE, parseFlexibleDateTime, tradingDayKey } from '@/lib/time';
import { getInstrument, hasInstrument, resolveSymbol, tradingDayOf } from '../instruments';
import { summarizeTrades } from '../metrics';
import type { Direction, Instrument, Session, SessionSource, Trade } from '../types';

export interface ImportOptions {
  /** Heure locale à laquelle la journée de trading bascule (0 = date civile) */
  sessionBoundaryHour?: number;
  source?: SessionSource;
  /** Risque planifié par contrat (USD) pour calculer les multiples de R */
  riskPerContract?: number;
}

/** Bornes d'intégrité d'un trade importé (au-delà : ligne rejetée, jamais stockée). */
export const QTY_MAX = 10_000;
export const PRICE_MAX = 1_000_000;
export const PNL_MAX = 10_000_000;
export const MONEY_MAX = 10_000_000;

export interface ImportResult {
  sessions: Session[];
  trades: Trade[];
  warnings: string[];
  format: 'ninjatrader-trades' | 'ninjatrader-executions' | 'canto-csv' | 'inconnu';
  skipped: number;
  /** Clés d'idempotence par trade (format exécutions uniquement). */
  tradeExecutionKeys?: string[][];
}

/** Colonnes reconnues (export « Trade Performance › Trades » de NinjaTrader 8 et format CΛNTO). */
const COLUMN_ALIASES: Record<string, string[]> = {
  instrument: ['instrument', 'symbol', 'symbole'],
  account: ['account', 'compte'],
  strategy: ['strategy', 'stratégie', 'strategie'],
  direction: ['market pos.', 'market pos', 'market position', 'direction', 'side', 'sens'],
  qty: ['qty', 'quantity', 'quantité', 'quantite', 'contracts', 'contrats'],
  entryPrice: ['entry price', 'prix entrée', 'prix entree', 'entry'],
  exitPrice: ['exit price', 'prix sortie', 'exit'],
  entryTime: ['entry time', 'heure entrée', 'heure entree', 'entrytime'],
  exitTime: ['exit time', 'heure sortie', 'exittime'],
  entryName: ['entry name', 'nom entrée'],
  exitName: ['exit name', 'nom sortie'],
  profit: ['profit', 'pnl', 'p&l', 'net profit', 'résultat', 'resultat'],
  commission: ['commission', 'commissions', 'frais'],
  mae: ['mae'],
  mfe: ['mfe'],
  tags: ['tags', 'étiquettes'],
  risk: ['risk', 'risque'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnIndex(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  const norm = headers.map(normalizeHeader);
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const i = norm.indexOf(alias);
      if (i !== -1) {
        idx[key] = i;
        break;
      }
    }
  }
  return idx;
}

/** Reconnaît une racine du registre, avec mois de contrat optionnel (NinjaTrader, Rithmic, Tradovate). */
export function detectInstrument(raw: string): Instrument | null {
  return resolveSymbol(raw)?.symbol ?? null;
}

/** Libellés d'import : une ligne par racine absente du registre. */
export function unknownInstrumentWarnings(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sym, n]) =>
      tr(
        `instrument non reconnu : ${sym} (${n} lignes)`,
        `unrecognized instrument: ${sym} (${n} rows)`,
        `instrumento no reconocido: ${sym} (${n} líneas)`,
      ),
    );
}

function noteUnknown(counts: Map<string, number>, raw: string): void {
  const key = raw.trim().toUpperCase();
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function parseDirection(raw: string): Direction | null {
  const s = raw.trim().toLowerCase();
  if (['long', 'buy', 'achat', 'l'].includes(s)) return 'long';
  if (['short', 'sell', 'vente', 's'].includes(s)) return 'short';
  return null;
}

/** Détecte si le fichier ressemble à un export NinjaTrader (colonnes clés présentes). */
export function detectFormat(headers: string[]): ImportResult['format'] {
  const idx = buildColumnIndex(headers);
  const norm = headers.map(normalizeHeader);
  if (norm.includes('market pos.') && idx.entryPrice !== undefined && idx.exitPrice !== undefined) return 'ninjatrader-trades';
  if (idx.instrument !== undefined && idx.direction !== undefined && idx.entryTime !== undefined && idx.exitTime !== undefined) return 'canto-csv';
  if (idx.instrument !== undefined && norm.includes('action') && (norm.includes('quantity') || norm.includes('qty')) && norm.includes('price') && norm.includes('time')) return 'ninjatrader-executions';
  return 'inconnu';
}

export const FORMAT_LABEL: Record<ImportResult['format'], string> = {
  'ninjatrader-trades': 'NinjaTrader · Trades',
  'ninjatrader-executions': 'NinjaTrader · Exécutions',
  'canto-csv': 'CΛNTO CSV',
  inconnu: 'inconnu',
};

/**
 * Importe un CSV de trades (NinjaTrader 8 « Trades » ou format CΛNTO) et regroupe en séances.
 * Le PnL est recalculé à partir des prix et de la valeur du point (source de vérité), puis
 * comparé à la colonne Profit lorsqu'elle est en devise.
 * Fichiers > 5000 lignes : Worker via `src/store/journal.ts` (`csv.worker.ts`).
 */
export function importTradesCsv(text: string, opts: ImportOptions = {}): ImportResult {
  const table = parseCsv(text);
  const warnings: string[] = [...table.warnings];
  const format = detectFormat(table.headers);
  if (format === 'inconnu' || format === 'ninjatrader-executions') {
    return { sessions: [], trades: [], warnings: [tr('Colonnes non reconnues : export NinjaTrader « Trades » attendu (Instrument, Market pos., Qty, Entry price, Exit price, Entry time, Exit time…).', 'Unrecognized columns: a NinjaTrader “Trades” export is expected (Instrument, Market pos., Qty, Entry price, Exit price, Entry time, Exit time…).', 'Columnas no reconocidas: se espera un export NinjaTrader « Trades » (Instrument, Market pos., Qty, Entry price, Exit price, Entry time, Exit time…).')], format, skipped: table.rows.length };
  }
  const col = buildColumnIndex(table.headers);
  const sample = table.rows.slice(0, 80);
  const iEntry = col.entryPrice;
  const iExit = col.exitPrice;
  const iProfit = col.profit;
  const iMae = col.mae;
  const iMfe = col.mfe;
  const iCommission = col.commission;
  const iEntryTime = col.entryTime;
  const decimalSep = inferDecimalSeparator(
    sample.flatMap((r) => [iEntry !== undefined ? (r[iEntry] ?? '') : '', iExit !== undefined ? (r[iExit] ?? '') : '']),
    sample.flatMap((r) => [
      iProfit !== undefined ? (r[iProfit] ?? '') : '',
      iMae !== undefined ? (r[iMae] ?? '') : '',
      iMfe !== undefined ? (r[iMfe] ?? '') : '',
      iCommission !== undefined ? (r[iCommission] ?? '') : '',
    ]),
    table.delimiter,
  );
  // Culture fichier : AM/PM ou jour>12 tranche ; sinon le délimiteur `;` implique fr-FR (J/M), `,` implique en-US (M/J).
  const dayFirst = detectDayFirst(table.rows.slice(0, 50).map((r) => (iEntryTime !== undefined ? (r[iEntryTime] ?? '') : ''))) ?? table.delimiter === ';';
  const boundary = opts.sessionBoundaryHour ?? 0;
  const source = opts.source ?? 'ninjatrader';
  const expectedCols = table.headers.length;

  if (table.delimiter === ',' && decimalSep === ',') {
    warnings.push(tr('Délimiteur « , » et décimale « , » : les champs décimaux doivent être quotés ; les lignes au mauvais nombre de colonnes seront rejetées.', 'Delimiter “,” and decimal “,”: decimal fields must be quoted; rows with the wrong column count will be rejected.', 'Delimitador « , » y decimal « , »: los campos decimales deben ir entre comillas; las filas con un número de columnas incorrecto se rechazan.'));
  }

  const trades: Trade[] = [];
  let skipped = 0;
  let profitMismatch = 0;
  let widthMismatch = 0;
  let outOfBounds = 0;
  const unknownCounts = new Map<string, number>();

  for (const row of table.rows) {
    if (expectedCols > 0 && row.length !== expectedCols) {
      skipped++;
      widthMismatch++;
      continue;
    }
    const get = (k: string) => {
      const i = col[k];
      return i !== undefined ? (row[i] ?? '').trim() : '';
    };
    const rawInstrument = get('instrument');
    const resolved = resolveSymbol(rawInstrument);
    if (!resolved) {
      skipped++;
      noteUnknown(unknownCounts, rawInstrument);
      continue;
    }
    const instrument = resolved.symbol;
    const direction = parseDirection(get('direction'));
    const qty = Math.abs(parseLocaleNumber(get('qty'), decimalSep));
    const entryPrice = parseLocaleNumber(get('entryPrice'), decimalSep);
    const exitPrice = parseLocaleNumber(get('exitPrice'), decimalSep);
    const entryTime = parseFlexibleDateTime(get('entryTime'), dayFirst);
    const exitTime = parseFlexibleDateTime(get('exitTime'), dayFirst);
    if (!direction || !qty || Number.isNaN(qty) || Number.isNaN(entryPrice) || Number.isNaN(exitPrice) || !Number.isFinite(entryTime) || !Number.isFinite(exitTime)) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(qty) || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) {
      // Valeur ±Infinity (ex. 400 chiffres) : lisible mais absurde → hors bornes.
      skipped++;
      outOfBounds++;
      continue;
    }
    // Bornes : quantité entière 1..10 000, prix 0..1 000 000 (sinon PnL absurde, Infinity ou perte de précision).
    if (!Number.isInteger(qty) || qty > QTY_MAX || entryPrice < 0 || entryPrice > PRICE_MAX || exitPrice < 0 || exitPrice > PRICE_MAX) {
      skipped++;
      outOfBounds++;
      continue;
    }
    const spec = getInstrument(instrument);
    const commissionRaw = get('commission');
    const commission = commissionRaw ? Math.abs(parseLocaleNumber(commissionRaw, decimalSep)) || 0 : 0;
    if (!Number.isFinite(commission) || commission > MONEY_MAX) {
      skipped++;
      outOfBounds++;
      continue;
    }
    const gross = (exitPrice - entryPrice) * qty * spec.pointValue * (direction === 'long' ? 1 : -1);
    let pnl = Math.round((gross - commission) * 100) / 100;

    // NinjaTrader exporte Profit / MAE / MFE dans l'unité d'affichage choisie : devise, points, ticks ou %.
    // L'unité est déduite de la colonne Profit (comparée au brut recalculé) et réutilisée pour MAE/MFE.
    const profitRaw = get('profit');
    const grossPoints = gross / (spec.pointValue * qty);
    let excursionFactor = spec.pointValue * qty;
    if (profitRaw && /[$€£]/.test(profitRaw)) {
      const declared = parseLocaleNumber(profitRaw, decimalSep);
      if (Number.isFinite(declared)) {
        const diff = Math.abs(declared - pnl);
        const diffGross = Math.abs(declared - gross);
        if (diff <= 0.51 && diff <= diffGross) pnl = declared;
        else if (diffGross <= 0.51 && commission > 0) pnl = Math.round((declared - commission) * 100) / 100;
        else profitMismatch++;
      }
    } else if (profitRaw) {
      const declared = parseLocaleNumber(profitRaw, decimalSep);
      if (/%/.test(profitRaw)) excursionFactor = NaN;
      else if (Number.isFinite(declared)) {
        if (Math.abs(declared - grossPoints / spec.tickSize) < 0.51 && Math.abs(grossPoints) > 0) excursionFactor = spec.tickValue * qty;
        else if (Math.abs(declared - grossPoints) < 0.51) excursionFactor = spec.pointValue * qty;
        else if (format === 'canto-csv') pnl = declared;
      }
    }

    if (!Number.isFinite(pnl) || Math.abs(pnl) > PNL_MAX) {
      skipped++;
      outOfBounds++;
      continue;
    }

    const maeRaw = get('mae');
    const mfeRaw = get('mfe');
    const bounded = (v: number): number | undefined => (Number.isFinite(v) && v <= MONEY_MAX ? v : undefined);
    const toUsd = (raw: string): number | undefined => {
      if (!raw) return undefined;
      const v = Math.abs(parseLocaleNumber(raw, decimalSep));
      if (!Number.isFinite(v)) return undefined;
      if (/[$€£]/.test(raw)) return bounded(v);
      return Number.isFinite(excursionFactor) ? bounded(Math.round(v * excursionFactor * 100) / 100) : undefined;
    };
    const riskRaw = get('risk');
    const risk = riskRaw ? bounded(Math.abs(parseLocaleNumber(riskRaw, decimalSep))) || undefined : opts.riskPerContract ? opts.riskPerContract * qty : undefined;
    const tagsRaw = get('tags');

    trades.push({
      id: uid('t'),
      sessionId: '',
      instrument,
      account: get('account') || undefined,
      direction,
      qty,
      entryTime,
      exitTime,
      entryPrice,
      exitPrice,
      pnl,
      commission,
      mae: toUsd(maeRaw),
      mfe: toUsd(mfeRaw),
      strategy: get('strategy') || undefined,
      entryName: get('entryName') || undefined,
      exitName: get('exitName') || undefined,
      tags: tagsRaw ? tagsRaw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : undefined,
      risk,
      contractMonth: resolved.contractMonth,
    });
  }

  const unknownRows = [...unknownCounts.values()].reduce((sum, n) => sum + n, 0);
  if (profitMismatch > 0) warnings.push(tr(`${profitMismatch} trade(s) : la colonne Profit diffère du PnL recalculé (prix × valeur du point). Le PnL recalculé est conservé.`, `${profitMismatch} trade(s): the Profit column differs from the recomputed PnL (price × point value). The recomputed PnL is kept.`, `${profitMismatch} trade(s): la columna Profit difiere del PnL recalculado (precio × valor del punto). Se conserva el PnL recalculado.`));
  if (outOfBounds > 0) warnings.push(tr(`${outOfBounds} ligne(s) rejetée(s) : quantité, prix, commission ou PnL hors bornes (qty entière 1–${QTY_MAX}, prix 0–${PRICE_MAX}, PnL fini).`, `${outOfBounds} row(s) rejected: quantity, price, commission or PnL out of bounds (integer qty 1–${QTY_MAX}, price 0–${PRICE_MAX}, finite PnL).`, `${outOfBounds} fila(s) rechazada(s): cantidad, precio, comisión o PnL fuera de límites (qty entera 1–${QTY_MAX}, precio 0–${PRICE_MAX}, PnL finito).`));
  warnings.push(...unknownInstrumentWarnings(unknownCounts));
  if (widthMismatch > 0) warnings.push(tr(`${widthMismatch} ligne(s) rejetée(s) : nombre de colonnes incohérent ou décimale/délimiteur conflictuels (intégrité du journal).`, `${widthMismatch} row(s) rejected: inconsistent column count or conflicting decimal/delimiter (journal integrity).`, `${widthMismatch} fila(s) rechazada(s): número de columnas incoherente o decimal/delimitador en conflicto (integridad del diario).`));
  else if (skipped - unknownRows > 0) warnings.push(tr(`${skipped - unknownRows} ligne(s) ignorée(s) (champs invalides).`, `${skipped - unknownRows} row(s) skipped (invalid fields).`, `${skipped - unknownRows} fila(s) ignorada(s) (campos inválidos).`));

  return { sessions: groupIntoSessions(trades, boundary, source), trades, warnings, format, skipped };
}

/** Regroupe des trades en séances (journée de trading × compte) et leur affecte un sessionId. */
export function groupIntoSessions(trades: Trade[], boundaryHour: number, source: SessionSource): Session[] {
  // Instrument connu : journée du registre (Globex 18:00 ET). La bascule opérateur ne s'applique
  // qu'à une racine absente du registre.
  const zone = boundaryHour === 18 ? ET_ZONE : undefined;
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const day = hasInstrument(t.instrument) ? tradingDayOf(t.exitTime, getInstrument(t.instrument)) : tradingDayKey(t.exitTime, boundaryHour, zone);
    const key = `${day}|${t.account ?? ''}`;
    const arr = byDay.get(key);
    if (arr) arr.push(t);
    else byDay.set(key, [t]);
  }
  const now = Date.now();
  const sessions: Session[] = [];
  for (const [key, dayTrades] of byDay) {
    const [date, account] = key.split('|');
    if (!date) continue;
    const id = uid('s');
    for (const t of dayTrades) t.sessionId = id;
    const summary = summarizeTrades(dayTrades);
    sessions.push({
      id,
      date,
      account: account || undefined,
      source,
      tags: [],
      createdAt: now,
      updatedAt: now,
      ...summary,
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return sessions;
}

/** Export CSV au format CΛNTO (réimportable). */
export function exportTradesCsv(trades: Trade[]): string {
  const header = ['Instrument', 'Account', 'Strategy', 'Market pos.', 'Qty', 'Entry price', 'Exit price', 'Entry time', 'Exit time', 'Entry name', 'Exit name', 'Profit', 'Commission', 'MAE', 'MFE', 'Risk', 'Tags'];
  const iso = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const esc = (v: string | number | undefined) => {
    let s = v === undefined ? '' : String(v);
    // Injection de formule tableur : =, +, -, @ mais aussi tabulation et retour chariot en tête.
    if (s.length > 0 && '=+-@\t\r'.includes(s[0]!)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const t of trades) {
    lines.push(
      [
        t.instrument,
        t.account,
        t.strategy,
        t.direction === 'long' ? 'Long' : 'Short',
        t.qty,
        t.entryPrice,
        t.exitPrice,
        iso(t.entryTime),
        iso(t.exitTime),
        t.entryName,
        t.exitName,
        `$${t.pnl.toFixed(2)}`,
        t.commission.toFixed(2),
        t.mae !== undefined ? `$${t.mae.toFixed(2)}` : '',
        t.mfe !== undefined ? `$${t.mfe.toFixed(2)}` : '',
        t.risk ?? '',
        t.tags?.join('|') ?? '',
      ]
        .map(esc)
        .join(','),
    );
  }
  return lines.join('\n');
}
