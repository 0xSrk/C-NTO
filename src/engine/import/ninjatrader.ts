import { detectDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { uid } from '@/lib/id';
import { detectDayFirst, parseFlexibleDateTime, tradingDayKey } from '@/lib/time';
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

export function detectInstrument(raw: string): Instrument | null {
  const s = raw.trim().toUpperCase();
  if (/^MNQ\b/.test(s)) return 'MNQ';
  if (/^NQ\b/.test(s)) return 'NQ';
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
export function importTradesCsv(text: string, opts: ImportOptions = {}): ImportResult {
  const table = parseCsv(text);
  const warnings: string[] = [];
  const format = detectFormat(table.headers);
  if (format === 'inconnu' || format === 'ninjatrader-executions') {
    return { sessions: [], trades: [], warnings: ['Colonnes non reconnues : export NinjaTrader « Trades » attendu (Instrument, Market pos., Qty, Entry price, Exit price, Entry time, Exit time…).'], format, skipped: table.rows.length };
  }
  const col = buildColumnIndex(table.headers);
  const decimalSep = detectDecimalSeparator(table.rows.slice(0, 80).flatMap((r) => [r[col.entryPrice] ?? '', r[col.exitPrice] ?? ''])) ?? (table.delimiter === ';' ? ',' : undefined);
  const dayFirst = detectDayFirst(table.rows.slice(0, 50).map((r) => r[col.entryTime] ?? ''));
  const boundary = opts.sessionBoundaryHour ?? 0;
  const source = opts.source ?? 'ninjatrader';

  const trades: Trade[] = [];
  let skipped = 0;
  let profitMismatch = 0;

  for (const row of table.rows) {
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

    const profitRaw = get('profit');
    if (profitRaw && /[$€£]/.test(profitRaw)) {
      const declared = parseLocaleNumber(profitRaw, decimalSep);
      if (Number.isFinite(declared)) {
        const diff = Math.abs(declared - pnl);
        const diffGross = Math.abs(declared - gross);
        if (diff > 0.51 && diffGross > 0.51) profitMismatch++;
        if (diffGross <= 0.51 && commission > 0) pnl = Math.round((declared - commission) * 100) / 100;
        else if (diff <= 0.51) pnl = declared;
      }
    } else if (profitRaw && format === 'canto-csv') {
      const declared = parseLocaleNumber(profitRaw, decimalSep);
      if (Number.isFinite(declared)) pnl = declared;
    }

    const maeRaw = get('mae');
    const mfeRaw = get('mfe');
    const toUsd = (raw: string): number | undefined => {
      if (!raw) return undefined;
      const v = Math.abs(parseLocaleNumber(raw, decimalSep));
      if (!Number.isFinite(v)) return undefined;
      // NinjaTrader exporte MAE/MFE dans l'unité d'affichage ; sans symbole monétaire on suppose des points
      return /[$€£]/.test(raw) ? v : v * spec.pointValue * qty;
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
  if (skipped > 0) warnings.push(`${skipped} ligne(s) ignorée(s) (instrument hors NQ/MNQ ou champs invalides).`);

  return { sessions: groupIntoSessions(trades, boundary, source), trades, warnings, format, skipped };
}

/** Regroupe des trades en séances (journée de trading × compte) et leur affecte un sessionId. */
export function groupIntoSessions(trades: Trade[], boundaryHour: number, source: SessionSource): Session[] {
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${tradingDayKey(t.exitTime, boundaryHour)}|${t.account ?? ''}`;
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
