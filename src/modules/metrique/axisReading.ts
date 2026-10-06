import type { BarSeries } from '@/engine/bars';
import { comparableSet, inReleaseWindow, readAxis, tradingDaysBetween, weekdayKey, type AxisRow, type ReadingSample } from '@/engine/contextReading';
import { sessionDates } from '@/engine/metrics';
import { buildMetricsContext, type ContextEvent } from '@/engine/metricsContext';
import { findPlan } from '@/engine/propfirm';
import { horizonSigma, sigmaBand, sigmaDistance, tradeRisk } from '@/engine/riskConsole';
import { pointsPerContract } from '@/engine/tradeUnits';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedWallClock } from '@/lib/time';
import type { Settings } from '@/store/settings';

export const AXES = ['regime', 'band', 'release', 'rank', 'afterLoss', 'risk', 'sigma', 'weekday', 'hour'] as const;
export type Axis = (typeof AXES)[number];

export type AxisSettings = Pick<
  Settings,
  | 'regimeConfirm'
  | 'regimeMinSessions'
  | 'releaseBefore'
  | 'releaseAfter'
  | 'markerMinTrades'
  | 'falseDiscoveryRate'
  | 'riskPerContract'
  | 'riskBasePoints'
  | 'impliedVol'
  | 'startingBalance'
  | 'planAccount'
  | 'planId'
>;

export interface AxisSample extends ReadingSample {
  tradeId: string;
}

export interface AxisReadingInput {
  axis: Axis;
  sessions: readonly Session[];
  trades: readonly Trade[];
  series: readonly BarSeries[];
  activeId: string | null;
  events: readonly ContextEvent[];
  settings: AxisSettings;
  metricAccount: string | null;
}

export interface AxisReading {
  rows: AxisRow[];
  /** Moins de 30 journées comparables à la dernière fiche, en hausse ou en baisse. */
  thin: boolean;
  /** Valeur d'axe de chaque trade lu, dans l'ordre du journal. */
  samples: AxisSample[];
}

/** Lecture de l'onglet C sur un axe : ce que `ContextAxis` affiche, sans le rendu. */
export function axisReading(input: AxisReadingInput): AxisReading {
  const { axis, sessions, trades, series, activeId, settings, metricAccount } = input;
  const chosen = series.find((row) => row.id === activeId) ?? series.slice().sort((a, b) => b.bars.length - a.bars.length)[0];
  const context = chosen
    ? buildMetricsContext({
        root: chosen.instrument,
        bars: chosen.bars,
        trades,
        sessions,
        events: input.events.map((event) => ({ date: event.date, timeET: event.timeET, title: event.title, impact: event.impact, estimated: event.estimated })),
        confirm: settings.regimeConfirm,
        minStay: settings.regimeMinSessions,
      })
    : null;
  const dates = sessionDates(sessions);
  const days = context?.days ?? [];
  // Fiche de la journée elle-même : ses volatilités s'arrêtent déjà à la clôture de la veille (`buildMetricsContext`).
  const cycleOf = new Map(days.map((day) => [day.date, day.volCycle]));
  const bandOf = new Map(days.map((day) => [day.date, day.volBand]));
  const infoOf = new Map((context?.trades ?? []).map((row) => [row.tradeId, row]));
  const plan = metricAccount && settings.planAccount === metricAccount ? findPlan(settings.planId) : null;
  const capital = plan?.maxDrawdown && plan.maxDrawdown > 0 ? plan.maxDrawdown : settings.startingBalance;
  const span = [...dates.values()].sort();
  const bounds = tradingDaysBetween(span[0] ?? '', span.at(-1) ?? '');
  const samples: AxisSample[] = [];
  for (const trade of trades) {
    const date = dates.get(trade.sessionId) ?? '';
    if (!date) continue;
    const info = infoOf.get(trade.id);
    let key: string | null = null;
    if (axis === 'weekday') key = weekdayKey(date);
    else if (axis === 'hour') key = String(zonedWallClock(trade.entryTime, ET_ZONE).hour);
    else if (axis === 'regime') key = cycleOf.get(date) ?? null;
    else if (axis === 'band') key = bandOf.get(date) ?? null;
    else if (axis === 'afterLoss' && info) key = info.afterLoss ? 'perte' : 'gain';
    else if (axis === 'rank' && info) key = String(info.rankInDay);
    // `minutesToRelease` = publication − entrée : l'entrée tombe à −minutesToRelease minutes de la publication.
    else if (axis === 'release' && info?.minutesToRelease != null) key = inReleaseWindow(-info.minutesToRelease, 0, settings.releaseBefore, settings.releaseAfter) ? 'pres' : 'loin';
    else if (axis === 'risk') {
      const risk = tradeRisk(trade, settings.riskPerContract, capital);
      if (risk.lossPct != null) key = risk.lossPct <= settings.riskBasePoints / 100 ? 'dans' : 'dessus';
    } else if (axis === 'sigma' && settings.impliedVol != null) {
      const risk = tradeRisk(trade, settings.riskPerContract, capital);
      const distance = sigmaDistance(risk.stopPoints, horizonSigma(trade.entryPrice, settings.impliedVol, 252));
      key = distance == null ? null : sigmaBand(distance);
    }
    if (!key) continue;
    samples.push({ tradeId: trade.id, date, exitTime: trade.exitTime, points: pointsPerContract(trade), key });
  }
  const hourKeys = [...new Set(samples.map((sample) => sample.key))];
  const calendar =
    axis === 'weekday'
      ? bounds.map((date) => ({ date, key: weekdayKey(date) }))
      : axis === 'hour'
        ? bounds.flatMap((date) => hourKeys.map((key) => ({ date, key })))
        : axis === 'regime'
          ? days.map((day) => ({ date: day.date, key: day.volCycle ?? null }))
          : axis === 'band'
            ? days.map((day) => ({ date: day.date, key: day.volBand ?? null }))
            : [];
  const rows = readAxis(samples, calendar, { minTrades: settings.markerMinTrades, fdr: settings.falseDiscoveryRate, draws: 800, seed: 1 });
  const last = [...days].reverse().find((day) => day.volCycle && day.volBand);
  const comparable = last?.volCycle && last.volBand ? comparableSet(days, last.volCycle, last.volBand) : null;
  const thin = comparable != null && ((comparable.hausse?.count ?? 0) < 30 || (comparable.baisse?.count ?? 0) < 30);
  return { rows, thin, samples };
}
