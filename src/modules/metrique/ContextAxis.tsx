import { useMemo, useState } from 'react';
import { tableClass } from '@/design/primitives';
import type { AxisRow, ReadingVerdict } from '@/engine/contextReading';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtPct, fmtRatio, signClass } from '@/lib/format';
import { useBars } from '@/store/bars';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { AXES, axisReading, type Axis } from './axisReading';
import s from './metrique.module.css';

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
  const rows = useMemo(() => axisReading({ axis, sessions, trades, series, activeId, events, settings, metricAccount }), [axis, series, activeId, events, trades, sessions, settings, metricAccount]);
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
