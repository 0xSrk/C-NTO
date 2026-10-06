import { useMemo, useState } from 'react';
import { tableClass } from '@/design/primitives';
import { comparableSet, readAxis, tradingDaysBetween, weekdayKey, type AxisRow, type ReadingSample, type ReadingVerdict } from '@/engine/contextReading';
import { sessionDates } from '@/engine/metrics';
import { buildMetricsContext } from '@/engine/metricsContext';
import { findPlan } from '@/engine/propfirm';
import { horizonSigma, sigmaBand, sigmaDistance, tradeRisk } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { pointsPerContract } from '@/engine/tradeUnits';
import { tr, useI18n } from '@/i18n';
import { ET_ZONE, zonedWallClock } from '@/lib/time';
import { fmtPct, fmtRatio, signClass } from '@/lib/format';
import { useBars } from '@/store/bars';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

const AXES = ['regime', 'band', 'release', 'rank', 'afterLoss', 'risk', 'sigma', 'weekday', 'hour'] as const;
type Axis = (typeof AXES)[number];

function axisLabel(axis: Axis): string {
  const labels: Record<Axis, [string, string, string]> = {
    regime: ['Régime', 'Regime', 'Régimen'],
    band: ['Bande', 'Band', 'Banda'],
    release: ['Publication', 'Release', 'Publicación'],
    rank: ['Rang', 'Rank', 'Rango'],
    afterLoss: ['Après perte', 'After a loss', 'Tras pérdida'],
    risk: ['Risque', 'Risk', 'Riesgo'],
    sigma: ['Stop en σ', 'Stop in σ', 'Stop en σ'],
    weekday: ['Jour', 'Weekday', 'Día'],
    hour: ['Heure', 'Hour', 'Hora'],
  };
  const row = labels[axis];
  return tr(row[0], row[1], row[2]);
}

function verdictLabel(verdict: ReadingVerdict): string {
  if (verdict === 'confirme') return tr('confirmé', 'confirmed', 'confirmado');
  if (verdict === 'renverse') return tr('renversé', 'reversed', 'invertido');
  if (verdict === 'insuffisant') return tr('pas assez de données', 'not enough data', 'datos insuficientes');
  return tr('non concluant', 'inconclusive', 'no concluyente');
}

function rowName(axis: Axis, key: string): string {
  if (axis === 'hour') return `${key}h`;
  if (axis === 'afterLoss') return key === 'perte' ? tr('après une perte', 'after a loss', 'tras una pérdida') : tr('après un gain', 'after a win', 'tras una ganancia');
  if (axis === 'release') return key === 'pres' ? tr('proche', 'near', 'cerca') : tr('loin', 'far', 'lejos');
  if (axis === 'risk') return key === 'dans' ? tr('dans la recommandation', 'within the recommendation', 'dentro de la recomendación') : tr('au-dessus', 'above', 'por encima');
  if (axis === 'weekday') {
    const names: Record<string, [string, string, string]> = {
      lun: ['lundi', 'Monday', 'lunes'],
      mar: ['mardi', 'Tuesday', 'martes'],
      mer: ['mercredi', 'Wednesday', 'miércoles'],
      jeu: ['jeudi', 'Thursday', 'jueves'],
      ven: ['vendredi', 'Friday', 'viernes'],
    };
    const row = names[key];
    return row ? tr(row[0], row[1], row[2]) : key;
  }
  return key;
}

/** Remplace la trame jour × heure : une ligne par valeur de l'axe choisi. */
export function ContextAxis({ sessions, trades }: { sessions: Session[]; trades: Trade[] }) {
  useI18n((st) => st.locale);
  const [axis, setAxis] = useState<Axis>('weekday');
  const series = useBars((st) => st.series);
  const activeId = useBars((st) => st.activeId);
  const events = useMacro((st) => st.events);
  const settings = useSettings((st) => st.settings);
  const metricAccount = useUi((st) => st.metricAccount);
  const rows = useMemo(() => {
    const chosen = series.find((row) => row.id === activeId) ?? series.slice().sort((a, b) => b.bars.length - a.bars.length)[0];
    const context = chosen
      ? buildMetricsContext({
          root: chosen.instrument,
          bars: chosen.bars,
          timeframe: chosen.timeframe,
          trades,
          sessions,
          events: events.map((event) => ({ date: event.date, timeET: event.timeET, title: event.title, impact: event.impact, estimated: event.estimated })),
          confirm: settings.regimeConfirm,
          minStay: settings.regimeMinSessions,
        })
      : null;
    const dates = sessionDates(sessions);
    const days = context?.days ?? [];
    const cycleOf = new Map(days.map((day, index) => [day.date, index > 0 ? days[index - 1]?.volCycle : undefined]));
    const bandOf = new Map(days.map((day, index) => [day.date, index > 0 ? days[index - 1]?.volBand : undefined]));
    const infoOf = new Map((context?.trades ?? []).map((row) => [row.tradeId, row]));
    const plan = metricAccount && settings.planAccount === metricAccount ? findPlan(settings.planId) : null;
    const capital = plan?.maxDrawdown && plan.maxDrawdown > 0 ? plan.maxDrawdown : settings.startingBalance;
    const span = [...dates.values()].sort();
    const bounds = tradingDaysBetween(span[0] ?? '', span.at(-1) ?? '');
    const samples: ReadingSample[] = [];
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
      else if (axis === 'release' && info?.minutesToRelease != null) key = info.minutesToRelease >= -settings.releaseBefore && info.minutesToRelease <= settings.releaseAfter ? 'pres' : 'loin';
      else if (axis === 'risk') {
        const risk = tradeRisk(trade, settings.riskPerContract, capital);
        if (risk.lossPct != null) key = risk.lossPct <= settings.riskBasePoints / 100 ? 'dans' : 'dessus';
      } else if (axis === 'sigma' && settings.impliedVol != null) {
        const risk = tradeRisk(trade, settings.riskPerContract, capital);
        const distance = sigmaDistance(risk.stopPoints, horizonSigma(trade.entryPrice, settings.impliedVol, 252));
        key = distance == null ? null : sigmaBand(distance);
      }
      if (!key) continue;
      samples.push({ date, exitTime: trade.exitTime, points: pointsPerContract(trade), key });
    }
    const hourKeys = [...new Set(samples.map((sample) => sample.key))];
    const calendar =
      axis === 'weekday'
        ? bounds.map((date) => ({ date, key: weekdayKey(date) }))
        : axis === 'hour'
          ? bounds.flatMap((date) => hourKeys.map((key) => ({ date, key })))
          : axis === 'regime'
            ? days.map((day, index) => ({ date: day.date, key: index > 0 ? (days[index - 1]?.volCycle ?? null) : null }))
            : axis === 'band'
              ? days.map((day, index) => ({ date: day.date, key: index > 0 ? (days[index - 1]?.volBand ?? null) : null }))
              : [];
    const rows = readAxis(samples, calendar, { minTrades: settings.markerMinTrades, fdr: settings.falseDiscoveryRate, draws: 800, seed: 1 });
    const last = [...days].reverse().find((day) => day.volCycle && day.volBand);
    const comparable = last?.volCycle && last.volBand ? comparableSet(days, last.volCycle, last.volBand) : null;
    const thin = comparable != null && ((comparable.hausse?.count ?? 0) < 30 || (comparable.baisse?.count ?? 0) < 30);
    return { rows, thin };
  }, [axis, series, activeId, events, trades, sessions, settings, metricAccount]);
  return (
    <div className={s.trame}>
      <header className={s.trameHead}>
        <div>
          <h3>{tr('Lecture par contexte', 'Reading by context', 'Lectura por contexto')}</h3>
          <p>{tr('Un axe à la fois. Le régime et la bande sont ceux de la veille.', 'One axis at a time. Regime and band are those of the previous day.', 'Un eje a la vez. El régimen y la banda son los del día anterior.')}</p>
        </div>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {AXES.map((value) => (
          <button key={value} type="button" onClick={() => setAxis(value)} className={axis === value ? s.insightK : s.note}>
            {axisLabel(value)}
          </button>
        ))}
      </div>
      {rows.thin ? <p className={s.note}>{tr('Pas assez de journées comparables', 'Not enough comparable days', 'No hay suficientes jornadas comparables')}</p> : null}
      {rows.rows.length === 0 ? (
        <p className={s.note}>{tr('Pas de données sur cet axe.', 'No data on this axis.', 'Sin datos en este eje.')}</p>
      ) : (
        <table className={tableClass}>
          <thead>
            <tr>
              <th>{axisLabel(axis)}</th>
              <th className="num">{tr('Jours tradés', 'Days traded', 'Días operados')}</th>
              <th className="num">{tr('Points', 'Points', 'Puntos')}</th>
              <th className="num">IC 90 %</th>
              <th className="num">{tr('Trades', 'Trades', 'Trades')}</th>
              <th className="num">{tr('Écart', 'Gap', 'Brecha')}</th>
              <th>{tr('Verdict', 'Verdict', 'Veredicto')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((row) => (
              <AxisLine key={row.key} axis={axis} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AxisLine({ axis, row }: { axis: Axis; row: AxisRow }) {
  return (
    <tr>
      <td>{rowName(axis, row.key)}</td>
      <td className="num">{row.tradedShare == null ? '—' : fmtPct(row.tradedShare, 0)}</td>
      <td className={`num ${row.points == null ? '' : signClass(row.points)}`}>{row.points == null ? '—' : fmtRatio(row.points, 2)}</td>
      <td className="num">{row.low == null || row.high == null ? '—' : `${fmtRatio(row.low, 1)} – ${fmtRatio(row.high, 1)}`}</td>
      <td className="num">{row.trades}</td>
      <td className="num">{row.mde == null ? '—' : fmtRatio(row.mde, 2)}</td>
      <td>{verdictLabel(row.verdict)}</td>
    </tr>
  );
}
