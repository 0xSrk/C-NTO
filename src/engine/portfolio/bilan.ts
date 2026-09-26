import type { Session } from '@/engine/types';
import { ET_ZONE, tradingDayKey } from '@/lib/time';
import { consolidateEquity } from './equity';
import { convertAmount } from './fx';
import type { EquityPoint, FxRate, Pocket } from './types';

export type BilanPreset = '7j' | '30j' | 'trimestre' | 'annee' | 'personnalisee';

export interface BilanRow {
  pocketId: string;
  pnlBase: number;
  commission: number;
  share: number;
}

export interface Bilan {
  from: string;
  to: string;
  currency: string;
  byPocket: BilanRow[];
  totalPnl: number;
  commissions: number;
  winningDays: number;
  losingDays: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  netStart: number;
  netEnd: number;
  excluded: { pocketId: string; reason: string }[];
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7));
  const startMonth = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
  return `${date.slice(0, 4)}-${String(startMonth).padStart(2, '0')}-01`;
}

/** Bornes inclusives. `30j` = 30 journées civiles finissant le jour de trading de `asOfMs`. */
export function bilanBounds(preset: BilanPreset, asOfMs: number, custom?: { from: string; to: string }): { from: string; to: string } {
  const to = tradingDayKey(asOfMs, 18, ET_ZONE);
  if (preset === 'personnalisee' && custom?.from && custom.to) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  if (preset === '7j') return { from: addDays(to, -6), to };
  if (preset === '30j') return { from: addDays(to, -29), to };
  if (preset === 'trimestre') return { from: quarterStart(to), to };
  if (preset === 'annee') return { from: `${to.slice(0, 4)}-01-01`, to };
  return { from: to, to };
}

function inSpan(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function levels(points: readonly EquityPoint[], from: string, to: string): { start: number; end: number } {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let before: EquityPoint | undefined;
  let firstIn: EquityPoint | undefined;
  let lastTo: EquityPoint | undefined;
  for (const p of sorted) {
    if (p.date < from) before = p;
    if (inSpan(p.date, from, to) && !firstIn) firstIn = p;
    if (p.date <= to) lastTo = p;
  }
  const start = before ? before.equity : firstIn ? firstIn.equity - firstIn.pnl : 0;
  const end = lastTo ? lastTo.equity : start;
  return { start, end };
}

export interface BilanContext {
  pockets: readonly Pocket[];
  points: readonly EquityPoint[];
  sessions: readonly Session[];
  fx: readonly FxRate[];
  base: string;
}

/** PnL, commissions et variation de valeur nette sur la période. Les contributions somment au total. */
export function bilan(bounds: { from: string; to: string }, ctx: BilanContext): Bilan {
  const { from, to } = bounds;
  const rows: BilanRow[] = [];
  const excluded: Bilan['excluded'] = [];
  let netStart = 0;
  let netEnd = 0;

  for (const pocket of ctx.pockets) {
    if (pocket.archivedAt || pocket.kind === 'crypto') continue;
    const mine = ctx.points.filter((p) => p.pocketId === pocket.id);
    let pnlNative = 0;
    for (const p of mine) if (inSpan(p.date, from, to)) pnlNative += p.pnl;
    const pnl = convertAmount(pnlNative, pocket.currency, ctx.base, ctx.fx);
    if (!pnl.ok) {
      excluded.push({ pocketId: pocket.id, reason: pnl.reason });
      continue;
    }
    const lv = levels(mine, from, to);
    const start = convertAmount(lv.start, pocket.currency, ctx.base, ctx.fx);
    if (!start.ok) {
      excluded.push({ pocketId: pocket.id, reason: start.reason });
      continue;
    }
    const end = convertAmount(lv.end, pocket.currency, ctx.base, ctx.fx);
    if (!end.ok) {
      excluded.push({ pocketId: pocket.id, reason: end.reason });
      continue;
    }
    let commission = 0;
    if (pocket.kind === 'propfirm' || pocket.kind === 'futures') {
      const key = pocket.account ?? '';
      for (const s of ctx.sessions) {
        if ((s.account ?? '') !== key || !inSpan(s.date, from, to)) continue;
        if (Number.isFinite(s.commission)) commission += s.commission;
      }
    }
    const commissionBase = convertAmount(commission, pocket.currency, ctx.base, ctx.fx);
    if (!commissionBase.ok) {
      excluded.push({ pocketId: pocket.id, reason: commissionBase.reason });
      continue;
    }
    netStart += start.value;
    netEnd += end.value;
    rows.push({ pocketId: pocket.id, pnlBase: pnl.value, commission: commissionBase.value, share: 0 });
  }

  const totalPnl = rows.reduce((a, r) => a + r.pnlBase, 0);
  const commissions = rows.reduce((a, r) => a + r.commission, 0);
  for (const row of rows) row.share = totalPnl === 0 ? 0 : row.pnlBase / totalPnl;

  const curve = consolidateEquity(ctx.pockets, ctx.points, ctx.fx, ctx.base);
  const days = curve.series.filter((p) => inSpan(p.date, from, to));
  let winningDays = 0;
  let losingDays = 0;
  let best: Bilan['bestDay'] = null;
  let worst: Bilan['worstDay'] = null;
  for (const day of days) {
    if (day.pnl > 0) winningDays++;
    else if (day.pnl < 0) losingDays++;
    if (!best || day.pnl > best.pnl) best = { date: day.date, pnl: day.pnl };
    if (!worst || day.pnl < worst.pnl) worst = { date: day.date, pnl: day.pnl };
  }

  return {
    from,
    to,
    currency: ctx.base,
    byPocket: rows,
    totalPnl,
    commissions,
    winningDays,
    losingDays,
    bestDay: best,
    worstDay: worst,
    netStart,
    netEnd,
    excluded,
  };
}

function cell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV à en-tête, relisible par le parseur du desk. */
export function bilanToCsv(row: Bilan): string {
  const lines = ['poche,pnl,commission,devise'];
  for (const p of row.byPocket) lines.push([cell(p.pocketId), cell(p.pnlBase), cell(p.commission), cell(row.currency)].join(','));
  lines.push([cell('total'), cell(row.totalPnl), cell(row.commissions), cell(row.currency)].join(','));
  return `${lines.join('\n')}\n`;
}

export function bilanToJson(row: Bilan): string {
  return JSON.stringify(row);
}

/** Ruine = somme des drawdowns restants des poches prop (déjà en devise de base). Sinon le max historique. */
export function projectionRuin(propDrawdownsBase: readonly number[], historicalMax: number): { ruinDrawdown: number; source: 'prop' | 'historique' } {
  if (propDrawdownsBase.length === 0) return { ruinDrawdown: historicalMax, source: 'historique' };
  return { ruinDrawdown: propDrawdownsBase.reduce((a, n) => a + n, 0), source: 'prop' };
}
