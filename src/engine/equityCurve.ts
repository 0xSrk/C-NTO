import { aggregateByDate } from './metrics';
import type { Session, Trade } from './types';

/**
 * Courbe d'équité du tableau de bord (Métrique › A.02) : un pas par séance ou par trade.
 * Pur : le graphique ne fait que dessiner ces pas.
 */

export type EquityGrain = 'session' | 'trade';

export interface EquityStep {
  /** Secondes UTC, strictement croissantes : l'axe du graphique. */
  time: number;
  /** Séance (`YYYY-MM-DD`) du pas. */
  date: string;
  /** Instant du pas en ms : sortie du trade, ou midi UTC de la séance. `null` au départ. */
  at: number | null;
  /** P&L net du pas (0 au départ). */
  pnl: number;
  /** P&L cumulé depuis le début de la période. */
  equity: number;
  /** Plus haut du P&L cumulé jusqu'ici ; le départ (0) compte. */
  peak: number;
  /** Écart au plus haut, toujours ≤ 0. */
  drawdown: number;
  /** Trades du pas. */
  trades: number;
  /** Instrument du trade (grain trade). */
  instrument?: string;
  /** Point de départ, avant le premier pas. */
  origin?: true;
}

export interface EquityCurveData {
  grain: EquityGrain;
  steps: EquityStep[];
  net: number;
  /** Plus grand drawdown : profondeur (> 0), indices du plus haut et du creux dans `steps`. */
  maxDrawdown: { depth: number; peak: number; trough: number } | null;
}

const DAY_S = 86_400;
const EPS = 1e-9;

/** Midi UTC du jour : la date reste la même dans tous les fuseaux du desk. */
function noonUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

function dayBefore(date: string): string {
  return new Date(noonUtc(date) - DAY_S * 1000).toISOString().slice(0, 10);
}

interface RawStep {
  at: number;
  date: string;
  pnl: number;
  trades: number;
  instrument?: string;
  order: number;
}

function sessionSteps(sessions: readonly Session[]): RawStep[] {
  return aggregateByDate([...sessions]).map((row, order) => ({ at: noonUtc(row.date), date: row.date, pnl: row.pnl, trades: row.tradeCount, order }));
}

/**
 * Un pas par trade, à sa sortie. Une séance sans trade (saisie manuelle) reste un pas, à midi de
 * sa date : le cumul final est le même dans les deux grains.
 */
function tradeSteps(sessions: readonly Session[], trades: readonly Trade[]): RawStep[] {
  const dateOf = new Map(sessions.map((row) => [row.id, row.date]));
  const withTrades = new Set<string>();
  const out: RawStep[] = [];
  trades.forEach((row, order) => {
    if (!Number.isFinite(row.pnl) || !Number.isFinite(row.exitTime)) return;
    withTrades.add(row.sessionId);
    const date = dateOf.get(row.sessionId) ?? new Date(row.exitTime).toISOString().slice(0, 10);
    out.push({ at: row.exitTime, date, pnl: row.pnl, trades: 1, instrument: row.instrument, order });
  });
  sessions.forEach((row, order) => {
    if (withTrades.has(row.id) || !Number.isFinite(row.pnl)) return;
    out.push({ at: noonUtc(row.date), date: row.date, pnl: row.pnl, trades: row.tradeCount, order: trades.length + order });
  });
  return out.sort((a, b) => a.at - b.at || a.order - b.order);
}

export function equityCurve(sessions: readonly Session[], trades: readonly Trade[], grain: EquityGrain): EquityCurveData {
  const raw = grain === 'trade' ? tradeSteps(sessions, trades) : sessionSteps(sessions);
  const first = raw[0];
  if (!first) return { grain, steps: [], net: 0, maxDrawdown: null };

  // Départ : un jour avant la première séance, ou une minute avant le premier trade.
  const firstTime = Math.floor(first.at / 1000);
  const originTime = grain === 'trade' ? firstTime - 60 : firstTime - DAY_S;
  const steps: EquityStep[] = [{ time: originTime, date: grain === 'trade' ? first.date : dayBefore(first.date), at: null, pnl: 0, equity: 0, peak: 0, drawdown: 0, trades: 0, origin: true }];
  let equity = 0;
  let peak = 0;
  let time = originTime;
  let trough = -1;
  for (const row of raw) {
    equity += row.pnl;
    if (equity > peak) peak = equity;
    // Deux sorties dans la même seconde : l'axe exige des temps distincts.
    time = Math.max(Math.floor(row.at / 1000), time + 1);
    const drawdown = Math.min(0, equity - peak);
    steps.push({ time, date: row.date, at: row.at, pnl: row.pnl, equity, peak, drawdown, trades: row.trades, ...(row.instrument ? { instrument: row.instrument } : {}) });
    if (drawdown < -EPS && (trough < 0 || drawdown < (steps[trough]?.drawdown ?? 0))) trough = steps.length - 1;
  }

  let maxDrawdown: EquityCurveData['maxDrawdown'] = null;
  if (trough > 0) {
    let top = trough;
    while (top > 0 && (steps[top]?.drawdown ?? 0) < -EPS) top--;
    maxDrawdown = { depth: -(steps[trough]?.drawdown ?? 0), peak: top, trough };
  }
  return { grain, steps, net: equity, maxDrawdown };
}
