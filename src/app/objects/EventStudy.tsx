import { useMemo } from 'react';
import { cx } from '@/design/primitives';
import type { CalEvent } from '@/engine/calendar';
import { sampleOf } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { trEventTitle } from '@/lib/eventTitles';
import { fmtPct, fmtUsd } from '@/lib/format';
import { COMPARE_AFTER_MIN, COMPARE_BEFORE_MIN, compareEvent, type CompareStats, type Comparison } from '@/lib/frise';
import { shortDay } from './index';
import { samplePhrase } from './sample';
import s from './fiche.module.css';

/**
 * L'étude d'événement (OROS5.37, Système 5 « Fiche et Frise » ; reprise du prototype C · Frise, d3) : la seconde lecture
 * d'« Autour de… » dans la fiche d'un catalyseur, à côté du miroir M.036. Chaque publication passée de la famille tombée
 * un jour de séance du périmètre (les puces de la sélection partagée) s'aligne sur t0, de t0 − 30 à t0 + 90 min, rebasée à
 * zéro sur la publication (`compareEvent`, le modèle pur de la frise, OROS5.12) : les journées au trait fin (une par
 * publication, les comptes du jour ensemble ; OROS5.37a), la bande
 * min–max au glacier, la moyenne en escalier à l'ivoire, la journée du catalyseur ouvert à l'or (décision 1). La table
 * avec / sans lit la même fenêtre — le P&L des sorties de t0 − 30 à t0 + 90, les jours sans à la même heure de New York —,
 * avec son n, en séances (une par compte et par jour) ; sous `SAMPLE_FAIBLE`, une ligne se lit en veille et dit son
 * échantillon. Lecture seule.
 */

/** Le tracé, en unités de son `viewBox` : la fiche fait 400 px (mesure locale, décision 4). */
export const STUDY_W = 352;
export const STUDY_H = 128;
const PAD = { l: 34, r: 6, t: 10, b: 16 } as const;
/** Les graduations de la fenêtre, en minutes depuis t0. */
const TICKS = [-30, 0, 30, 60, 90] as const;

export interface StudyFrame {
  /** La fenêtre, en minutes depuis la publication : celle de la table. */
  domain: readonly [number, number];
  left: number;
  right: number;
  top: number;
  bottom: number;
  lo: number;
  hi: number;
  x: (m: number) => number;
  y: (v: number) => number;
  /** Une série en escalier : la valeur tient jusqu'à la marche suivante. */
  step: (points: readonly [number, number][]) => string;
  bandPath: string;
  meanPath: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** La géométrie de l'étude, pure : un axe de t0 − 30 à t0 + 90, une échelle qui contient zéro et la bande. */
export function studyFrame(cmp: Pick<Comparison, 'band' | 'mean'>, width = STUDY_W, height = STUDY_H): StudyFrame {
  const values = [0, ...cmp.band.flatMap(([, lo, hi]) => [lo, hi])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const left = PAD.l;
  const right = width - PAD.r;
  const top = PAD.t;
  const bottom = height - PAD.b;
  const x = (m: number) => r1(left + ((m + COMPARE_BEFORE_MIN) / (COMPARE_BEFORE_MIN + COMPARE_AFTER_MIN)) * (right - left));
  const y = (v: number) => r1(top + (1 - (v - lo) / span) * (bottom - top));
  const step = (points: readonly [number, number][]) => points.map(([m, v], i) => (i === 0 ? `M${x(m)} ${y(v)}` : `H${x(m)}V${y(v)}`)).join('');
  let bandPath = '';
  if (cmp.band.length >= 2) {
    const first = cmp.band[0]!;
    bandPath = `M${x(first[0])} ${y(first[2])}`;
    for (let i = 1; i < cmp.band.length; i++) bandPath += `H${x(cmp.band[i]![0])}V${y(cmp.band[i]![2])}`;
    const back = [...cmp.band].reverse();
    bandPath += `V${y(back[0]![1])}`;
    for (let i = 1; i < back.length; i++) bandPath += `H${x(back[i - 1]![0])}V${y(back[i]![1])}`;
    bandPath += `H${x(back[back.length - 1]![0])}Z`;
  }
  return { domain: [-COMPARE_BEFORE_MIN, COMPARE_AFTER_MIN], left, right, top, bottom, lo, hi, x, y, step, bandPath, meanPath: cmp.mean.length ? step(cmp.mean) : '' };
}

const signed = (v: number) => fmtUsd(v, { sign: true });
const tickText = (m: number) => (m === 0 ? 't0' : m > 0 ? `+${m}` : `−${-m}`);
const WINDOW = `t0 − ${COMPARE_BEFORE_MIN} → t0 + ${COMPARE_AFTER_MIN}`;

export function EventStudy({ events, family, sessions, trades, now, chosen }: { events: readonly CalEvent[]; family: string; sessions: readonly Session[]; trades: readonly Trade[]; now: number; chosen: string }) {
  useI18n((st) => st.locale);
  const cmp = useMemo(() => compareEvent(events, family, sessions, trades, now), [events, family, sessions, trades, now]);
  const frame = useMemo(() => studyFrame(cmp), [cmp]);
  const title = trEventTitle(cmp.title);
  const mine = cmp.series.find((row) => row.date === chosen);
  const meanEnd = cmp.mean.length ? cmp.mean[cmp.mean.length - 1]![1] : null;
  const weakMean = cmp.with.weak;
  const label = tr(
    `${title} : ${cmp.series.length} journées alignées sur la publication, de t0 − ${COMPARE_BEFORE_MIN} à t0 + ${COMPARE_AFTER_MIN} min ; moyenne ${meanEnd === null ? '—' : signed(meanEnd)} à t0 + ${COMPARE_AFTER_MIN} min`,
    `${title}: ${cmp.series.length} days aligned on the release, from t0 − ${COMPARE_BEFORE_MIN} to t0 + ${COMPARE_AFTER_MIN} min; mean ${meanEnd === null ? '—' : signed(meanEnd)} at t0 + ${COMPARE_AFTER_MIN} min`,
    `${title}: ${cmp.series.length} jornadas alineadas en la publicación, de t0 − ${COMPARE_BEFORE_MIN} a t0 + ${COMPARE_AFTER_MIN} min; media ${meanEnd === null ? '—' : signed(meanEnd)} a t0 + ${COMPARE_AFTER_MIN} min`,
  );
  const row = (key: 'with' | 'without', name: string, stats: CompareStats) => (
    <tr key={key} className={cx(stats.weak && s.studyWeak)} data-study-row={key} data-weak={stats.weak ? '' : undefined}>
      <th scope="row">
        {name}
        {stats.weak ? <span className={s.studySample}>{samplePhrase(sampleOf(stats.n))}</span> : null}
      </th>
      <td className={stats.mean === null ? undefined : stats.mean > 0 ? s.pos : stats.mean < 0 ? s.neg : undefined}>{stats.mean === null ? '—' : signed(stats.mean)}</td>
      <td>{stats.winRate === null ? '—' : fmtPct(stats.winRate, 0)}</td>
      <td data-n="">{stats.n}</td>
    </tr>
  );
  return (
    <div className={s.study} data-study="">
      <div className={s.studyHead}>
        <span className={s.predicatesHead}>{tr('Étude d’événement', 'Event study', 'Estudio de evento')}</span>
        <span className={s.studyN} data-study-n="" title={tr('Journées alignées sur la publication, les comptes du jour ensemble / publications passées de la famille', 'Days aligned on the release, the day’s accounts together / past releases of the family', 'Jornadas alineadas en la publicación, las cuentas del día juntas / publicaciones pasadas de la familia')}>
          n = {cmp.series.length} / {cmp.occurrences.length}
        </span>
      </div>
      <svg className={s.studyChart} viewBox={`0 0 ${STUDY_W} ${STUDY_H}`} width="100%" role="img" aria-label={label}>
        {/* La construction, au glacier : les demi-heures, la publication à t0, le zéro ; la bande min–max. */}
        {TICKS.map((m) => (
          <g key={m}>
            <line className={m === 0 ? s.studyT0 : s.studyGrid} x1={frame.x(m)} x2={frame.x(m)} y1={frame.top} y2={frame.bottom} />
            <text className={s.studyTick} data-tick="" x={frame.x(m)} y={STUDY_H - 4} textAnchor={m === TICKS[0] ? 'start' : m === TICKS[TICKS.length - 1] ? 'end' : 'middle'}>
              {tickText(m)}
            </text>
          </g>
        ))}
        {frame.bandPath ? <path className={s.studyBand} data-band="" d={frame.bandPath} /> : null}
        <line className={s.studyZero} x1={frame.left} x2={frame.right} y1={frame.y(0)} y2={frame.y(0)} />
        <text className={s.studyTick} x={frame.left - 4} y={frame.y(frame.hi) + 3} textAnchor="end">
          {frame.hi > 0 ? `+${Math.round(frame.hi)}` : Math.round(frame.hi)}
        </text>
        <text className={s.studyTick} x={frame.left - 4} y={frame.y(frame.lo) + 3} textAnchor="end">
          {Math.round(frame.lo)}
        </text>
        {cmp.series
          .filter((r) => r !== mine)
          .map((r) => (
            <path key={r.date} className={s.studySeries} data-series={r.date} d={frame.step(r.points)} />
          ))}
        {frame.meanPath ? <path className={cx(s.studyMean, weakMean && s.studyMeanWeak)} data-mean="" data-weak={weakMean ? '' : undefined} d={frame.meanPath} /> : null}
        {mine ? <path className={s.studyChosen} data-series={mine.date} data-chosen={mine.date} d={frame.step(mine.points)} /> : null}
      </svg>
      <div className={s.studyKey}>
        <span data-study-key="series">
          <i className={s.studyKeySeries} /> {tr('journées', 'days', 'jornadas')}
        </span>
        <span>
          <i className={s.studyKeyBand} /> {tr('min–max', 'min–max', 'mín–máx')}
        </span>
        <span>
          <i className={s.studyKeyMean} /> {tr('moyenne', 'mean', 'media')} {meanEnd === null ? '—' : signed(meanEnd)}
        </span>
        <span data-study-key="chosen">
          <i className={s.studyKeyChosen} /> {shortDay(chosen)} · {mine ? signed(mine.last) : '—'}
        </span>
      </div>
      <table className={s.studyTable}>
        <caption className={s.studyCaption}>{tr(`La même fenêtre que la courbe : P&L de ${WINDOW} ; sans, à la même heure de New York`, `The same window as the curve: P&L from ${WINDOW}; without, at the same New York hour`, `La misma ventana que la curva: P&L de ${WINDOW}; sin, a la misma hora de Nueva York`)}</caption>
        <thead>
          <tr>
            <th />
            <th scope="col">{tr('P&L moyen', 'Mean P&L', 'P&L medio')}</th>
            <th scope="col">{tr('Réussite', 'Win rate', 'Acierto')}</th>
            <th scope="col" data-study-unit="" title={tr('Séances : une par compte et par jour', 'Sessions: one per account and day', 'Sesiones: una por cuenta y día')}>
              n
            </th>
          </tr>
        </thead>
        <tbody>
          {row('with', tr('avec', 'with', 'con'), cmp.with)}
          {row('without', cmp.timeET ? tr(`sans · ${cmp.timeET} ET`, `without · ${cmp.timeET} ET`, `sin · ${cmp.timeET} ET`) : tr('sans', 'without', 'sin'), cmp.without)}
        </tbody>
      </table>
    </div>
  );
}
