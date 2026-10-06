import { useMemo, useState } from 'react';
import { Segmented, tableClass } from '@/design/primitives';
import type { AxisRow, ReadingVerdict } from '@/engine/contextReading';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtPct, fmtRatio, signClass } from '@/lib/format';
import { useBars } from '@/store/bars';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { AXES, axisReading, type Axis, type RegimeSource } from './axisReading';
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

const KEY_NAMES: Partial<Record<Axis, Record<string, [string, string, string]>>> = {
  regime: {
    expansion: ['expansion', 'expansion', 'expansión'],
    compression: ['compression', 'compression', 'compresión'],
    choc: ['choc', 'shock', 'choque'],
    decrue: ['décrue', 'receding', 'retroceso'],
  },
  band: {
    basse: ['basse', 'low', 'baja'],
    moyenne: ['moyenne', 'medium', 'media'],
    haute: ['haute', 'high', 'alta'],
  },
  sigma: {
    '<0.25': ['[0 ; 0,25) σ', '[0, 0.25) σ', '[0 ; 0,25) σ'],
    '0.25-0.5': ['[0,25 ; 0,5) σ', '[0.25, 0.5) σ', '[0,25 ; 0,5) σ'],
    '0.5-1': ['[0,5 ; 1) σ', '[0.5, 1) σ', '[0,5 ; 1) σ'],
    '>1': ['[1 ; ∞) σ', '[1, ∞) σ', '[1 ; ∞) σ'],
  },
};

function rowName(axis: Axis, key: string): string {
  const named = KEY_NAMES[axis]?.[key];
  if (named) return tr(named[0], named[1], named[2]);
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

/** Pourquoi le régime et la bande ne se lisent pas pour cette racine. Null : ils se lisent. */
function regimeNote(source: RegimeSource, root: string): string | null {
  if (source === 'demo')
    return tr(
      `Le régime et la bande ne se lisent pas sur une série de démonstration : importez des barres de ${root}.`,
      `Regime and band are not read from a demo series: import ${root} bars.`,
      `El régimen y la banda no se leen en una serie de demostración: importe barras de ${root}.`,
    );
  if (source === 'absent') return tr(`Aucune série de barres de ${root} : le régime et la bande ne se lisent pas.`, `No ${root} bar series: regime and band cannot be read.`, `Ninguna serie de barras de ${root}: el régimen y la banda no se leen.`);
  if (source === 'court') return tr('Historique de barres insuffisant', 'Bar history is too short', 'Historial de barras insuficiente');
  return null;
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
  const reading = useMemo(() => axisReading({ axis, sessions, trades, series, activeId, events, settings, metricAccount }), [axis, series, activeId, events, trades, sessions, settings, metricAccount]);
  const refused = (axis === 'regime' || axis === 'band') && reading.root ? regimeNote(reading.regime, reading.root) : null;
  return (
    <div className={s.trame}>
      <header className={s.trameHead}>
        <div>
          <h3>{tr('Lecture par contexte', 'Reading by context', 'Lectura por contexto')}</h3>
          <p>
            {tr(
              'Un axe à la fois. Le régime et la bande d’une journée sont ceux de sa fiche, arrêtée à la clôture de la veille.',
              'One axis at a time. A day’s regime and band come from its own sheet, set at the previous close.',
              'Un eje a la vez. El régimen y la banda de una jornada son los de su ficha, fijada al cierre del día anterior.',
            )}
          </p>
          {reading.root ? <p>{tr(`Racine lue : ${reading.root}, seuls ses trades entrent dans la lecture.`, `Root read: ${reading.root}, only its trades enter the reading.`, `Raíz leída: ${reading.root}, solo sus trades entran en la lectura.`)}</p> : null}
        </div>
      </header>
      <div style={{ marginBottom: 10 }}>
        <Segmented value={axis} onChange={setAxis} options={AXES.map((value) => ({ value, label: axisLabel(value) }))} />
      </div>
      {reading.thin ? <p className={s.note}>{tr('Pas assez de journées comparables', 'Not enough comparable days', 'No hay suficientes jornadas comparables')}</p> : null}
      {refused ? (
        <p className={s.note}>{refused}</p>
      ) : reading.rows.length === 0 ? (
        <p className={s.note}>{tr('Pas de données sur cet axe.', 'No data on this axis.', 'Sin datos en este eje.')}</p>
      ) : (
        <table className={tableClass}>
          <thead>
            <tr>
              <th>{axisLabel(axis)}</th>
              <th className="num">{tr('Jours tradés', 'Days traded', 'Días operados')}</th>
              <th className="num">{tr('Points', 'Points', 'Puntos')}</th>
              <th className="num">{tr('IC 90 %', '90% CI', 'IC 90 %')}</th>
              <th className="num">{tr('Trades', 'Trades', 'Trades')}</th>
              <th className="num">{tr('Écart', 'Gap', 'Brecha')}</th>
              <th>{tr('Verdict', 'Verdict', 'Veredicto')}</th>
            </tr>
          </thead>
          <tbody>
            {reading.rows.map((row) => (
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
