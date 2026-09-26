import { ET_ZONE, tradingDayKey } from '@/lib/time';
import { convertAmount } from './fx';
import { positionMultiplier } from './price';
import type { CashBalance, ConsolidatedPoint, EquityPoint, FxRate, Pocket, Position } from './types';
import { isTraditionalKind } from './types';
import type { Session } from '@/engine/types';
import { findPlan } from '@/engine/propfirm';

const BOUNDARY = 18;

/** Journée de trading Globex : bascule à 18:00 America/New_York. */
export function portfolioDay(ms: number): string {
  return tradingDayKey(ms, BOUNDARY, ET_ZONE);
}

export interface EquityContext {
  sessions: readonly Session[];
  positions: readonly Position[];
  cash: readonly CashBalance[];
  fx: readonly FxRate[];
}

function sessionsOf(pocket: Pocket, sessions: readonly Session[]): Session[] {
  const key = pocket.account ?? '';
  return sessions.filter((s) => (s.account ?? '') === key && Number.isFinite(s.pnl)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function dayPnl(rows: readonly Session[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of rows) map.set(s.date, (map.get(s.date) ?? 0) + s.pnl);
  return map;
}

function cashAt(pocket: Pocket, cash: readonly CashBalance[], fx: readonly FxRate[], date: string): number | null {
  let total = 0;
  for (const row of cash) {
    if (row.pocketId !== pocket.id || portfolioDay(row.at) > date) continue;
    const c = convertAmount(row.amount, row.currency, pocket.currency, fx);
    if (!c.ok) return null;
    total += c.value;
  }
  return total;
}

function accountSeries(pocket: Pocket, sessions: readonly Session[], cash: readonly CashBalance[], fx: readonly FxRate[], baseline: number): EquityPoint[] | null {
  const byDay = dayPnl(sessionsOf(pocket, sessions));
  const dates = new Set<string>(byDay.keys());
  for (const row of cash) if (row.pocketId === pocket.id) dates.add(portfolioDay(row.at));
  const ordered = [...dates].sort();
  let cum = 0;
  const out: EquityPoint[] = [];
  for (const date of ordered) {
    const pnl = byDay.get(date) ?? 0;
    cum += pnl;
    const cashNow = cashAt(pocket, cash, fx, date);
    if (cashNow == null) return null;
    out.push({ date, pocketId: pocket.id, equity: baseline + cashNow + cum, pnl, currency: pocket.currency });
  }
  return out;
}

function openOn(position: Position, date: string): boolean {
  if (portfolioDay(position.openedAt) > date) return false;
  if (position.closedAt != null && portfolioDay(position.closedAt) <= date) return false;
  return true;
}

function priceOn(position: Position, date: string): number {
  if (position.lastPrice != null && position.lastPriceAt != null && portfolioDay(position.lastPriceAt) <= date) return position.lastPrice;
  return position.avgPrice;
}

/** Équité et coût (prix de revient + cash). Le PnL du jour est la variation de l'écart mark-to-market, pas l'apport. */
function traditionalAt(pocket: Pocket, ctx: EquityContext, date: string): { equity: number; mtm: number } | null {
  let equity = 0;
  let cost = 0;
  for (const line of ctx.positions) {
    if (line.pocketId !== pocket.id) continue;
    const mult = positionMultiplier(line);
    if (line.closedAt != null && portfolioDay(line.closedAt) <= date && portfolioDay(line.openedAt) <= date) {
      const c = convertAmount(line.realizedPnl ?? 0, line.currency, pocket.currency, ctx.fx);
      if (!c.ok) return null;
      equity += c.value;
      continue;
    }
    if (!openOn(line, date)) continue;
    const mark = convertAmount(line.quantity * priceOn(line, date) * mult, line.currency, pocket.currency, ctx.fx);
    const book = convertAmount(line.quantity * line.avgPrice * mult, line.currency, pocket.currency, ctx.fx);
    if (!mark.ok) return null;
    if (!book.ok) return null;
    equity += mark.value;
    cost += book.value;
  }
  const cash = cashAt(pocket, ctx.cash, ctx.fx, date);
  if (cash == null) return null;
  equity += cash;
  cost += cash;
  return { equity, mtm: equity - cost };
}

function traditionalSeries(pocket: Pocket, ctx: EquityContext): EquityPoint[] | null {
  const dates = new Set<string>();
  for (const line of ctx.positions) {
    if (line.pocketId !== pocket.id) continue;
    dates.add(portfolioDay(line.openedAt));
    if (line.closedAt != null) dates.add(portfolioDay(line.closedAt));
    if (line.lastPrice != null && line.lastPriceAt != null) dates.add(portfolioDay(line.lastPriceAt));
  }
  for (const row of ctx.cash) if (row.pocketId === pocket.id) dates.add(portfolioDay(row.at));
  const ordered = [...dates].sort();
  const out: EquityPoint[] = [];
  let prev = 0;
  for (const date of ordered) {
    const book = traditionalAt(pocket, ctx, date);
    if (!book) return null;
    out.push({ date, pocketId: pocket.id, equity: book.equity, pnl: book.mtm - prev, currency: pocket.currency });
    prev = book.mtm;
  }
  return out;
}

/**
 * Un point par poche et par journée de trading qui porte une séance (prop / futures)
 * ou un mouvement (ouverture, clôture, dernier prix, cash). Idempotent : même entrée, même sortie.
 * Les poches archivées sont ignorées. Un taux manquant pour le cash d'une poche omet ses points.
 */
export function buildEquityPoints(pockets: readonly Pocket[], ctx: EquityContext): EquityPoint[] {
  const out: EquityPoint[] = [];
  const ordered = [...pockets].filter((p) => !p.archivedAt && p.kind !== 'crypto').sort((a, b) => a.id.localeCompare(b.id));
  for (const pocket of ordered) {
    let series: EquityPoint[] | null = null;
    if (pocket.kind === 'propfirm') {
      const plan = pocket.planId ? findPlan(pocket.planId) : undefined;
      if (!plan) continue;
      series = accountSeries(pocket, ctx.sessions, [], ctx.fx, plan.accountSize);
    } else if (pocket.kind === 'futures') {
      series = accountSeries(pocket, ctx.sessions, ctx.cash, ctx.fx, 0);
    } else if (pocket.kind === 'liquidites') {
      series = accountSeries(pocket, [], ctx.cash, ctx.fx, 0);
    } else if (isTraditionalKind(pocket.kind)) {
      series = traditionalSeries(pocket, ctx);
    }
    if (series) out.push(...series);
  }
  out.sort((a, b) => a.pocketId.localeCompare(b.pocketId) || a.date.localeCompare(b.date));
  return out;
}

export interface ConsolidatedCurve {
  series: ConsolidatedPoint[];
  excluded: { pocketId: string; reason: string }[];
}

/**
 * Somme par date en devise de base. Une poche sans point ce jour-là reporte sa dernière équité.
 * Un taux manquant exclut toute la poche : rien n'est converti à 1.
 */
export function consolidateEquity(pockets: readonly Pocket[], points: readonly EquityPoint[], fx: readonly FxRate[], base: string): ConsolidatedCurve {
  const active = new Set(pockets.filter((p) => !p.archivedAt).map((p) => p.id));
  const byPocket = new Map<string, EquityPoint[]>();
  for (const point of points) {
    if (!active.has(point.pocketId)) continue;
    const list = byPocket.get(point.pocketId);
    if (list) list.push(point);
    else byPocket.set(point.pocketId, [point]);
  }
  for (const list of byPocket.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const excluded: ConsolidatedCurve['excluded'] = [];
  const kept: { id: string; points: EquityPoint[] }[] = [];
  for (const [id, list] of [...byPocket.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sample = list[0];
    if (!sample) continue;
    const probe = convertAmount(1, sample.currency, base, fx);
    if (!probe.ok) {
      excluded.push({ pocketId: id, reason: probe.reason });
      continue;
    }
    kept.push({ id, points: list });
  }

  const dates = new Set<string>();
  for (const row of kept) for (const p of row.points) dates.add(p.date);
  const series: ConsolidatedPoint[] = [];
  for (const date of [...dates].sort()) {
    let equity = 0;
    let pnl = 0;
    for (const row of kept) {
      let last: EquityPoint | undefined;
      let today: EquityPoint | undefined;
      for (const p of row.points) {
        if (p.date < date) last = p;
        else if (p.date === date) today = p;
      }
      const level = today ?? last;
      if (!level) continue;
      const eq = convertAmount(level.equity, level.currency, base, fx);
      const day = convertAmount(today?.pnl ?? 0, level.currency, base, fx);
      if (!eq.ok || !day.ok) continue;
      equity += eq.value;
      pnl += day.value;
    }
    series.push({ date, equity, pnl });
  }
  return { series, excluded };
}

/** Derniers `n` PnL quotidiens consolidés (défaut 120). */
export function projectionSeries(series: readonly ConsolidatedPoint[], n = 120): number[] {
  const span = Math.max(1, Math.floor(n));
  return series.slice(Math.max(0, series.length - span)).map((p) => p.pnl);
}
