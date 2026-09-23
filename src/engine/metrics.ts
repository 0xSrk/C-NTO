import { ET_ZONE, zonedWallClock } from '@/lib/time';
import type { Instrument, Session, Trade } from './types';

export interface EquityPoint {
  t: number;
  equity: number;
  drawdown: number;
}

export interface Bucket {
  key: string;
  count: number;
  pnl: number;
  wins: number;
  winRate: number;
}

export interface DirectionStats {
  count: number;
  pnl: number;
  wins: number;
  winRate: number;
  avgPnl: number;
}

export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  commission: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number | null;
  payoffRatio: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  medianPnl: number;
  stdPnl: number;
  sqn: number;
  kelly: number;
  zScore: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  currentStreak: number;
  maxDrawdown: number;
  maxDrawdownDurationMs: number;
  recoveryFactor: number;
  avgDurationMs: number;
  avgWinDurationMs: number;
  avgLossDurationMs: number;
  totalVolume: number;
  avgMae: number | null;
  avgMfe: number | null;
  edgeRatio: number | null;
  /** Part de la MFE capturée sur les trades gagnants (pnl / mfe) */
  captureRatio: number | null;
  long: DirectionStats;
  short: DirectionStats;
  byHour: Bucket[];
  byWeekday: Bucket[];
  byInstrument: Bucket[];
  equity: EquityPoint[];
  /** Répartition des PnL par trade, en $ */
  pnls: number[];
  rMultiples: number[];
}

export interface DailyStats {
  days: number;
  winDays: number;
  lossDays: number;
  flatDays: number;
  winDayRate: number;
  netPnl: number;
  avgDay: number;
  avgWinDay: number;
  avgLossDay: number;
  bestDay: number;
  worstDay: number;
  stdDay: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDays: number;
  currentDrawdown: number;
  ulcerIndex: number;
  /** Part du meilleur jour dans le profit total (règle de consistance prop firm) */
  consistency: number;
  gainToPain: number;
  maxConsecWinDays: number;
  maxConsecLossDays: number;
  equity: EquityPoint[];
  rolling: RollingPoint[];
}

export interface RollingPoint {
  t: number;
  date: string;
  winRate: number;
  expectancy: number;
  sharpe: number;
  pnl: number;
}

const EPS = 1e-9;

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stddev(xs: number[], sample = true): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (sample ? n - 1 : n));
}

export function minOf(xs: number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

export function maxOf(xs: number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? (a[mid] ?? 0) : ((a[mid - 1] ?? 0) + (a[mid] ?? 0)) / 2;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (idx - lo);
}

export interface DrawdownResult {
  equity: EquityPoint[];
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDurationMs: number;
  maxDrawdownPeriods: number;
  currentDrawdown: number;
  ulcerIndex: number;
}

/** Courbe d'équité + drawdown à partir d'une suite de PnL horodatés. */
export function drawdownSeries(points: { t: number; pnl: number }[], startingBalance = 0): DrawdownResult {
  const equity: EquityPoint[] = [];
  let eq = startingBalance;
  let peak = startingBalance;
  let peakT = points[0]?.t ?? 0;
  let maxDd = 0;
  let maxDdPct = 0;
  let maxDur = 0;
  let maxPeriods = 0;
  let periods = 0;
  let sumSqDdPct = 0;
  for (const p of points) {
    eq += p.pnl;
    if (eq >= peak) {
      // Retour au plus haut : la durée du drawdown court jusqu'à la récupération incluse.
      if (periods > 0 && p.t - peakT > maxDur) maxDur = p.t - peakT;
      if (eq > peak) {
        peak = eq;
        peakT = p.t;
      }
      periods = 0;
    } else {
      periods++;
      const dur = p.t - peakT;
      if (dur > maxDur) maxDur = dur;
      if (periods > maxPeriods) maxPeriods = periods;
    }
    const dd = peak - eq;
    const ddPct = peak > EPS ? dd / peak : 0;
    if (dd > maxDd) maxDd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
    sumSqDdPct += ddPct * ddPct;
    equity.push({ t: p.t, equity: eq, drawdown: -dd });
  }
  const last = equity[equity.length - 1];
  return {
    equity,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    maxDrawdownDurationMs: maxDur,
    maxDrawdownPeriods: maxPeriods,
    currentDrawdown: last ? -last.drawdown : 0,
    ulcerIndex: equity.length ? Math.sqrt(sumSqDdPct / equity.length) : 0,
  };
}

function streaks(signs: number[]): { maxWins: number; maxLosses: number; current: number; runs: number } {
  let maxWins = 0;
  let maxLosses = 0;
  let cur = 0;
  let runs = 0;
  let prev = 0;
  for (const s of signs) {
    if (s === 0) continue;
    if (s !== prev) {
      runs++;
      prev = s;
      cur = s;
    } else {
      cur += s;
    }
    if (cur > maxWins) maxWins = cur;
    if (-cur > maxLosses) maxLosses = -cur;
  }
  return { maxWins, maxLosses, current: cur, runs };
}

/**
 * Z-score des séries (Van Tharp) : mesure si les gains/pertes s'enchaînent de façon
 * non aléatoire. |Z| > 1,96 ⇒ dépendance significative à 95 %.
 */
export function streakZScore(signs: number[]): number {
  const nonZero = signs.filter((s) => s !== 0);
  const n = nonZero.length;
  if (n < 3) return 0;
  const w = nonZero.filter((s) => s > 0).length;
  const l = n - w;
  const r = streaks(nonZero).runs;
  const x = 2 * w * l;
  const denom = (x * (x - n)) / (n - 1);
  if (denom <= 0) return 0;
  return (n * (r - 0.5) - x) / Math.sqrt(denom);
}

function bucketize(trades: Trade[], keyOf: (t: Trade) => string, keys: string[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const k of keys) map.set(k, { key: k, count: 0, pnl: 0, wins: 0, winRate: 0 });
  for (const t of trades) {
    const k = keyOf(t);
    let b = map.get(k);
    if (!b) {
      b = { key: k, count: 0, pnl: 0, wins: 0, winRate: 0 };
      map.set(k, b);
    }
    b.count++;
    b.pnl += t.pnl;
    if (t.pnl > 0) b.wins++;
  }
  for (const b of map.values()) b.winRate = b.count ? b.wins / b.count : 0;
  return [...map.values()];
}

function directionStats(trades: Trade[]): DirectionStats {
  const count = trades.length;
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  return { count, pnl, wins, winRate: count ? wins / count : 0, avgPnl: count ? pnl / count : 0 };
}

export const WEEKDAY_KEYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

export function computeTradeStats(input: Trade[]): TradeStats {
  const trades = input.filter((t) => Number.isFinite(t.pnl)).sort((a, b) => a.exitTime - b.exitTime);
  const pnls = trades.map((t) => t.pnl);
  const count = trades.length;
  const winsArr = pnls.filter((p) => p > 0);
  const lossArr = pnls.filter((p) => p < 0);
  const wins = winsArr.length;
  const losses = lossArr.length;
  const breakeven = count - wins - losses;
  const grossProfit = winsArr.reduce((s, p) => s + p, 0);
  const grossLoss = lossArr.reduce((s, p) => s + p, 0);
  const netPnl = grossProfit + grossLoss;
  const commission = trades.reduce((s, t) => s + (t.commission || 0), 0);
  const winRate = count ? wins / count : 0;
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;
  const payoffRatio = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : wins ? Infinity : 0;
  const profitFactor = grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0;
  const expectancy = count ? netPnl / count : 0;
  const std = stddev(pnls);
  // Van Tharp : SQN sur les R-multiples dès que chaque trade a un risque ; sinon sur le PnL $.
  const rMultiples = trades.filter((t) => t.risk && t.risk > 0).map((t) => t.pnl / (t.risk as number));
  const sqnOnR = rMultiples.length === count && count > 0;
  const sqnSample = sqnOnR ? rMultiples : pnls;
  const sqnStd = stddev(sqnSample);
  const sqn = sqnSample.length > 1 && sqnStd > EPS ? (Math.sqrt(sqnSample.length) * mean(sqnSample)) / sqnStd : 0;
  const lossRate = count ? losses / count : 0;
  const kelly = Number.isFinite(payoffRatio) && payoffRatio > 0 ? winRate - lossRate / payoffRatio : winRate;

  const signs = pnls.map((p) => (p > 0 ? 1 : p < 0 ? -1 : 0));
  const st = streaks(signs);

  const dd = drawdownSeries(trades.map((t) => ({ t: t.exitTime, pnl: t.pnl })));

  const durations = trades.map((t) => Math.max(0, t.exitTime - t.entryTime));
  const winDur = trades.filter((t) => t.pnl > 0).map((t) => Math.max(0, t.exitTime - t.entryTime));
  const lossDur = trades.filter((t) => t.pnl < 0).map((t) => Math.max(0, t.exitTime - t.entryTime));

  const withMae = trades.filter((t) => typeof t.mae === 'number');
  const withMfe = trades.filter((t) => typeof t.mfe === 'number');
  const avgMae = withMae.length ? mean(withMae.map((t) => t.mae as number)) : null;
  const avgMfe = withMfe.length ? mean(withMfe.map((t) => t.mfe as number)) : null;
  const edgeRatio = avgMae !== null && avgMfe !== null && avgMae > EPS ? avgMfe / avgMae : null;
  const winWithMfe = trades.filter((t) => t.pnl > 0 && typeof t.mfe === 'number' && (t.mfe as number) > EPS);
  const captureRatio = winWithMfe.length ? mean(winWithMfe.map((t) => t.pnl / (t.mfe as number))) : null;

  const expectancyR = rMultiples.length ? mean(rMultiples) : null;

  const instruments = [...new Set(trades.map((t) => t.instrument))] as Instrument[];

  return {
    count,
    wins,
    losses,
    breakeven,
    winRate,
    netPnl,
    grossProfit,
    grossLoss,
    commission,
    profitFactor,
    expectancy,
    expectancyR,
    payoffRatio,
    avgWin,
    avgLoss,
    largestWin: winsArr.length ? maxOf(winsArr) : 0,
    largestLoss: lossArr.length ? minOf(lossArr) : 0,
    medianPnl: median(pnls),
    stdPnl: std,
    sqn,
    kelly,
    zScore: streakZScore(signs),
    maxConsecWins: st.maxWins,
    maxConsecLosses: st.maxLosses,
    currentStreak: st.current,
    maxDrawdown: dd.maxDrawdown,
    maxDrawdownDurationMs: dd.maxDrawdownDurationMs,
    recoveryFactor: dd.maxDrawdown > EPS ? netPnl / dd.maxDrawdown : netPnl > 0 ? Infinity : 0,
    avgDurationMs: mean(durations),
    avgWinDurationMs: mean(winDur),
    avgLossDurationMs: mean(lossDur),
    totalVolume: trades.reduce((s, t) => s + t.qty, 0),
    avgMae,
    avgMfe,
    edgeRatio,
    captureRatio,
    long: directionStats(trades.filter((t) => t.direction === 'long')),
    short: directionStats(trades.filter((t) => t.direction === 'short')),
    byHour: bucketize(
      trades,
      (t) => String(zonedWallClock(t.entryTime, ET_ZONE).hour),
      Array.from({ length: 24 }, (_, i) => String(i)),
    ),
    byWeekday: bucketize(trades, (t) => WEEKDAY_KEYS[new Date(t.entryTime).getDay()] ?? 'dim', WEEKDAY_KEYS),
    byInstrument: bucketize(trades, (t) => t.instrument, instruments),
    equity: dd.equity,
    pnls,
    rMultiples,
  };
}

const ANNUALIZATION = Math.sqrt(252);

/** Agrège les séances par journée civile (plusieurs comptes le même jour = une journée). */
export function aggregateByDate(sessionsInput: Session[]): { date: string; pnl: number; tradeCount: number }[] {
  const byDate = new Map<string, { date: string; pnl: number; tradeCount: number }>();
  for (const s of sessionsInput) {
    if (!Number.isFinite(s.pnl)) continue;
    const cur = byDate.get(s.date);
    if (cur) {
      cur.pnl += s.pnl;
      cur.tradeCount += s.tradeCount;
    } else byDate.set(s.date, { date: s.date, pnl: s.pnl, tradeCount: s.tradeCount });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function computeDailyStats(sessionsInput: Session[], startingBalance = 50_000, rollingWindow = 20): DailyStats {
  const sessions = aggregateByDate(sessionsInput);
  const pnls = sessions.map((s) => s.pnl);
  const days = sessions.length;
  const winDaysArr = pnls.filter((p) => p > 0);
  const lossDaysArr = pnls.filter((p) => p < 0);
  const netPnl = pnls.reduce((s, p) => s + p, 0);
  const avgDay = days ? netPnl / days : 0;
  const stdDay = stddev(pnls);

  const returns = pnls.map((p) => p / startingBalance);
  const meanR = mean(returns);
  const stdR = stddev(returns);
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(0, r) ** 2)));
  const sharpe = stdR > EPS ? (meanR / stdR) * ANNUALIZATION : 0;
  const sortino = downside > EPS ? (meanR / downside) * ANNUALIZATION : 0;

  const dd = drawdownSeries(
    sessions.map((s) => ({ t: new Date(`${s.date}T12:00:00`).getTime(), pnl: s.pnl })),
    startingBalance,
  );
  // Calmar ici = rendement linéaire annualisé (net / capital × 252 / jours) / drawdown %, pas un CAGR.
  const annualizedReturn = days ? (netPnl / startingBalance) * (252 / days) : 0;
  const calmar = dd.maxDrawdownPct > EPS ? annualizedReturn / dd.maxDrawdownPct : 0;

  const totalProfitDays = winDaysArr.reduce((s, p) => s + p, 0);
  const bestDay = winDaysArr.length ? maxOf(winDaysArr) : 0;
  // Règle de consistance des firmes : part du meilleur jour dans le profit net.
  const consistency = netPnl > EPS ? bestDay / netPnl : 0;
  const sumLoss = Math.abs(lossDaysArr.reduce((s, p) => s + p, 0));
  const gainToPain = sumLoss > EPS ? netPnl / sumLoss : netPnl > 0 ? Infinity : 0;

  const st = streaks(pnls.map((p) => (p > 0 ? 1 : p < 0 ? -1 : 0)));

  const rolling: RollingPoint[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const from = Math.max(0, i - rollingWindow + 1);
    const win = pnls.slice(from, i + 1);
    const wr = win.filter((p) => p > 0).length / win.length;
    const m = mean(win);
    const sd = stddev(win);
    const day = sessions[i];
    if (!day) continue;
    rolling.push({
      t: new Date(`${day.date}T12:00:00`).getTime(),
      date: day.date,
      winRate: wr,
      expectancy: m,
      sharpe: sd > EPS ? (m / sd) * ANNUALIZATION : 0,
      pnl: win.reduce((s, p) => s + p, 0),
    });
  }

  return {
    days,
    winDays: winDaysArr.length,
    lossDays: lossDaysArr.length,
    flatDays: days - winDaysArr.length - lossDaysArr.length,
    winDayRate: days ? winDaysArr.length / days : 0,
    netPnl,
    avgDay,
    avgWinDay: winDaysArr.length ? totalProfitDays / winDaysArr.length : 0,
    avgLossDay: lossDaysArr.length ? -sumLoss / lossDaysArr.length : 0,
    bestDay,
    worstDay: lossDaysArr.length ? minOf(lossDaysArr) : 0,
    stdDay,
    sharpe,
    sortino,
    calmar,
    maxDrawdown: dd.maxDrawdown,
    maxDrawdownPct: dd.maxDrawdownPct,
    maxDrawdownDays: dd.maxDrawdownPeriods,
    currentDrawdown: dd.currentDrawdown,
    ulcerIndex: dd.ulcerIndex,
    consistency,
    gainToPain,
    maxConsecWinDays: st.maxWins,
    maxConsecLossDays: st.maxLosses,
    equity: dd.equity,
    rolling,
  };
}

/** Histogramme de valeurs en `bins` classes de largeur égale. */
export function histogram(input: number[], bins = 24): { x0: number; x1: number; count: number }[] {
  const values = input.filter(Number.isFinite);
  if (values.length === 0) return [];
  let min = minOf(values);
  let max = maxOf(values);
  if (max - min < EPS) {
    min -= 1;
    max += 1;
  }
  const width = (max - min) / bins;
  if (!Number.isFinite(width) || width <= 0) return [];
  const out = Array.from({ length: bins }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    const bucket = out[idx];
    if (bucket) bucket.count++;
  }
  return out;
}

/** Résumé d'une session à partir de ses trades (utilisé lors des imports et éditions). */
export function summarizeTrades(trades: Trade[]): Pick<Session, 'tradeCount' | 'pnl' | 'grossProfit' | 'grossLoss' | 'commission' | 'instruments'> {
  let pnl = 0;
  let gp = 0;
  let gl = 0;
  let com = 0;
  const instr = new Set<Instrument>();
  for (const t of trades) {
    pnl += t.pnl;
    // Le pnl stocké est déjà net : le brut remet les commissions (coût positif).
    const gross = t.pnl + (t.commission || 0);
    if (gross > 0) gp += gross;
    else gl += gross;
    com += t.commission || 0;
    instr.add(t.instrument);
  }
  return { tradeCount: trades.length, pnl, grossProfit: gp, grossLoss: gl, commission: com, instruments: [...instr] };
}
