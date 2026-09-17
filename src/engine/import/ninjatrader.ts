import { inferDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { uid } from '@/lib/id';
import { detectDayFirst, ET_ZONE, parseFlexibleDateTime, tradingDayKey } from '@/lib/time';
import { summarizeTrades } from '../metrics';
import { INSTRUMENTS, type Direction, type Instrument, type Session, type SessionSource, type Trade } from '../types';

export interface ImportOptions {
  /** Heure locale à laquelle la journée de trading bascule (0 = date civile) */
  sessionBoundaryHour?: number;
  source?: SessionSource;
  /** Risque planifié par contrat (USD) pour calculer les multiples de R */
  riskPerContract?: number;
}

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

/** Reconnaît « NQ 12-26 », « MNQ SEP26 », « NQZ6 », « MNQZ26 » (symbologies NinjaTrader, Rithmic, Tradovate). */
export function detectInstrument(raw: string): Instrument | null {
  const s = raw.trim().toUpperCase();
  const m = /^(M?NQ)(?=$|[\s\-_/]|[FGHJKMNQUVXZ]\d{1,2}$)/.exec(s);
  if (m) return m[1] === 'MNQ' ? 'MNQ' : 'NQ';
  if (/\bMNQ\b/.test(s)) return 'MNQ';
  if (/\bNQ\b/.test(s)) return 'NQ';
  return null;
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
 */
// TODO(P1.5) worker
export function importTradesCsv(text: string, opts: ImportOptions = {}): ImportResult {
  const table = parseCsv(text);
  const warnings: string[] = [];
  const format = detectFormat(table.headers);
  if (format === 'inconnu' || format === 'ninjatrader-executions') {
    return { sessions: [], trades: [], warnings: ['Colonnes non reconnues : export NinjaTrader « Trades » attendu (Instrument, Market pos., Qty, Entry price, Exit price, Entry time, Exit time…).'], format, skipped: table.rows.length };
  }
  const col = buildColumnIndex(table.headers);
  const sample = table.rows.slice(0, 80);
  const decimalSep = inferDecimalSeparator(
    sample.flatMap((r) => [r[col.entryPrice] ?? '', r[col.exitPrice] ?? '']),
    sample.flatMap((r) => [r[col.profit] ?? '', r[col.mae] ?? '', r[col.mfe] ?? '', r[col.commission] ?? '']),
    table.delimiter,
  );
  // Culture fichier : AM/PM ou jour>12 tranche ; sinon le délimiteur `;` implique fr-FR (J/M), `,` implique en-US (M/J).
  const dayFirst = detectDayFirst(table.rows.slice(0, 50).map((r) => r[col.entryTime] ?? '')) ?? table.delimiter === ';';
  const boundary = opts.sessionBoundaryHour ?? 0;
  const source = opts.source ?? 'ninjatrader';
  const expectedCols = table.headers.length;

  if (table.delimiter === ',' && decimalSep === ',') {
    warnings.push('Délimiteur « , » et décimale « , » : les champs décimaux doivent être quotés ; les lignes au mauvais nombre de colonnes seront rejetées.');
  }

  const trades: Trade[] = [];
  let skipped = 0;
  let profitMismatch = 0;
  let widthMismatch = 0;

  for (const row of table.rows) {
    if (expectedCols > 0 && row.length !== expectedCols) {
      skipped++;
      widthMismatch++;
      continue;
    }
    const get = (k: string) => (col[k] !== undefined ? (row[col[k]] ?? '').trim() : '');
    const instrument = detectInstrument(get('instrument'));
    if (!instrument) {
      skipped++;
      continue;
    }
    const direction = parseDirection(get('direction'));
    const qty = Math.abs(parseLocaleNumber(get('qty'), decimalSep));
    const entryPrice = parseLocaleNumber(get('entryPrice'), decimalSep);
    const exitPrice = parseLocaleNumber(get('exitPrice'), decimalSep);
    const entryTime = parseFlexibleDateTime(get('entryTime'), dayFirst);
    const exitTime = parseFlexibleDateTime(get('exitTime'), dayFirst);
    if (!direction || !qty || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(entryTime) || !Number.isFinite(exitTime)) {
      skipped++;
      continue;
    }
    const spec = INSTRUMENTS[instrument];
    const commissionRaw = get('commission');
    const commission = commissionRaw ? Math.abs(parseLocaleNumber(commissionRaw, decimalSep)) || 0 : 0;
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

    const maeRaw = get('mae');
    const mfeRaw = get('mfe');
    const toUsd = (raw: string): number | undefined => {
      if (!raw) return undefined;
      const v = Math.abs(parseLocaleNumber(raw, decimalSep));
      if (!Number.isFinite(v)) return undefined;
      if (/[$€£]/.test(raw)) return v;
      return Number.isFinite(excursionFactor) ? Math.round(v * excursionFactor * 100) / 100 : undefined;
    };
    const riskRaw = get('risk');
    const risk = riskRaw ? Math.abs(parseLocaleNumber(riskRaw, decimalSep)) || undefined : opts.riskPerContract ? opts.riskPerContract * qty : undefined;
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
    });
  }

  if (profitMismatch > 0) warnings.push(`${profitMismatch} trade(s) : la colonne Profit diffère du PnL recalculé (prix × valeur du point). Le PnL recalculé est conservé.`);
  if (widthMismatch > 0) warnings.push(`${widthMismatch} ligne(s) rejetée(s) : nombre de colonnes incohérent ou décimale/délimiteur conflictuels (intégrité du journal).`);
  else if (skipped > 0) warnings.push(`${skipped} ligne(s) ignorée(s) (instrument hors NQ/MNQ ou champs invalides).`);

  return { sessions: groupIntoSessions(trades, boundary, source), trades, warnings, format, skipped };
}

/** Regroupe des trades en séances (journée de trading × compte) et leur affecte un sessionId. */
export function groupIntoSessions(trades: Trade[], boundaryHour: number, source: SessionSource): Session[] {
  // La convention Globex (bascule à 18:00) s'exprime en heure de New York quel que soit le poste.
  const zone = boundaryHour === 18 ? ET_ZONE : undefined;
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${tradingDayKey(t.exitTime, boundaryHour, zone)}|${t.account ?? ''}`;
    const arr = byDay.get(key);
    if (arr) arr.push(t);
    else byDay.set(key, [t]);
  }
  const now = Date.now();
  const sessions: Session[] = [];
  for (const [key, dayTrades] of byDay) {
    const [date, account] = key.split('|');
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
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
