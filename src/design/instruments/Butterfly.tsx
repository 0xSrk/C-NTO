import type { CSSProperties } from 'react';
import type { Bucket } from '@/engine/metrics';
import { tr, useI18n } from '@/i18n';
import { cx } from '../primitives';
import s from './instruments.module.css';

/**
 * M.003, le papillon par heure d'entrée à New York (OROS5.35, Système 5 « Fiche et Frise » ; repris du prototype C · Frise,
 * d3). Une rangée par heure, de 08 à 16 h : les perdants à gauche de l'axe, les gagnants à droite, à angle droit et à
 * l'ivoire des deux côtés, à une même échelle ; « — » pour une heure sans trade ; gagnants / n à droite ; l'heure du
 * curseur de temps (ou de maintenant) à l'or (décision 1). Il lit `TradeStats.byHour`, la clé du moteur : l'heure
 * d'entrée à New York. Chaque heure est un bouton qui pose ou retire la puce Heure de la sélection partagée ; les autres
 * restent à leur place, atténuées. La géométrie est pure (`butterflyRows`, `butterflyGeometry`) ; le dessin est un
 * `role="img"` qui dit la valeur.
 */

/** La plage de M.003 : de 08 à 16 h, heure de New York. */
export const BUTTERFLY_FROM = 8;
export const BUTTERFLY_TO = 16;

export interface ButterflyRow {
  hour: number;
  winners: number;
  losers: number;
  /** Trades entrés à cette heure ; un trade nul n'est ni gagnant ni perdant : il compte dans n. */
  n: number;
}

/**
 * Les rangées de M.003, lues dans `byHour` : de 08 à 16 h, élargies aux heures où le journal a des entrées, pour que rien
 * ne soit caché. Gagnants : `wins` ; perdants : `losses` (pnl < 0). Un trade nul ne compte que dans n, sans barre.
 */
export function butterflyRows(byHour: readonly Pick<Bucket, 'key' | 'count' | 'wins' | 'losses'>[], from = BUTTERFLY_FROM, to = BUTTERFLY_TO): ButterflyRow[] {
  const used = byHour.filter((b) => b.count > 0).map((b) => Number(b.key)).filter((h) => Number.isInteger(h));
  const first = Math.min(from, ...used);
  const last = Math.max(to, ...used);
  const rows: ButterflyRow[] = [];
  for (let hour = first; hour <= last; hour++) {
    const b = byHour.find((row) => Number(row.key) === hour);
    const n = b?.count ?? 0;
    rows.push({ hour, winners: b?.wins ?? 0, losers: b?.losses ?? 0, n });
  }
  return rows;
}

/** Une barre de M.003, en pour cent de la largeur du dessin. */
export interface ButterflySpan {
  x: number;
  w: number;
}

export interface ButterflyBar {
  hour: number;
  /** Haut de la rangée, en px. */
  y: number;
  win: ButterflySpan | null;
  loss: ButterflySpan | null;
  /** Aucun trade à cette heure : ni barre ni zéro. */
  none: boolean;
  /** Gagnants / n, ou « — ». */
  count: string;
}

export interface ButterflyGeometry {
  /** L'axe, au milieu (en %). */
  axis: number;
  /** La demi-portée commune des deux côtés (en %) : la plus grande barre la remplit. */
  span: number;
  /** Hauteur d'une rangée, et de la barre qui s'y pose (px). */
  row: number;
  bar: number;
  height: number;
  bars: ButterflyBar[];
}

const ROW = 16;
const BAR = 6;
const AXIS = 50;
const SPAN = 47;

/** La géométrie de M.003 : une échelle commune aux deux côtés, une rangée par heure, de haut en bas. Pure. */
export function butterflyGeometry(rows: readonly ButterflyRow[]): ButterflyGeometry {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.winners, r.losers)));
  const bars = rows.map((r, i): ButterflyBar => {
    const lw = (r.losers / max) * SPAN;
    const ww = (r.winners / max) * SPAN;
    return {
      hour: r.hour,
      y: i * ROW,
      win: r.winners > 0 ? { x: AXIS, w: ww } : null,
      loss: r.losers > 0 ? { x: AXIS - lw, w: lw } : null,
      none: r.n === 0,
      count: r.n > 0 ? `${r.winners}/${r.n}` : '—',
    };
  });
  return { axis: AXIS, span: SPAN, row: ROW, bar: BAR, height: rows.length * ROW, bars };
}

/** Une heure de New York, telle que M.003 et la puce Heure l'écrivent : « 09 h », « 09:00 ». */
export function hourLabel(hour: number): string {
  const hh = String(hour).padStart(2, '0');
  return tr(`${hh} h`, `${hh}:00`, `${hh} h`);
}

/** Ce que dit une rangée : « 3 gagnants sur 5 », « aucun ». */
function rowWords(r: ButterflyRow): string {
  if (r.n === 0) return tr('aucun', 'none', 'ninguno');
  return tr(
    `${r.winners} ${r.winners >= 2 ? 'gagnants' : 'gagnant'} sur ${r.n}`,
    `${r.winners} ${r.winners === 1 ? 'winner' : 'winners'} out of ${r.n}`,
    `${r.winners} ${r.winners === 1 ? 'ganador' : 'ganadores'} de ${r.n}`,
  );
}

/** La valeur de M.003, pour un lecteur d'écran : chaque heure et ce qu'elle porte. */
export function butterflyLabel(rows: readonly ButterflyRow[]): string {
  const sep = tr(' ; ', '; ', '; ');
  const list = rows.map((r) => `${hourLabel(r.hour)} ${rowWords(r)}`).join(sep);
  return tr(`Trades par heure d’entrée à New York : ${list}`, `Trades by New York entry hour: ${list}`, `Trades por hora de entrada en Nueva York: ${list}`);
}

export function Butterfly({ rows, cursorHour, hour, onHour, className }: { rows: readonly ButterflyRow[]; cursorHour: number | null; hour: number | null; onHour: (hour: number | null) => void; className?: string }) {
  useI18n((st) => st.locale);
  const g = butterflyGeometry(rows);
  const grid = { '--rows': rows.length, '--row': `${g.row}px` } as CSSProperties;
  return (
    <div className={cx(s.butterfly, className)} data-instrument-figure="M.003" style={grid}>
      <span className={s.side} aria-hidden>
        {tr('PERDANTS', 'LOSERS', 'PERDEDORES')}
      </span>
      <span className={cx(s.side, s.sideWin)} aria-hidden>
        {tr('GAGNANTS', 'WINNERS', 'GANADORES')}
      </span>
      {rows.map((r, i) => {
        const on = hour === r.hour;
        const out = hour != null && !on;
        return (
          <button
            key={`h${r.hour}`}
            type="button"
            className={cx(s.hour, out && s.out)}
            style={{ gridRow: i + 2 }}
            data-hour={r.hour}
            data-cursor={cursorHour === r.hour ? '' : undefined}
            data-out={out ? '' : undefined}
            aria-pressed={on}
            aria-label={tr(`Puce Heure : ${hourLabel(r.hour)} ET, ${rowWords(r)}`, `Hour chip: ${hourLabel(r.hour)} ET, ${rowWords(r)}`, `Chip Hora: ${hourLabel(r.hour)} ET, ${rowWords(r)}`)}
            onClick={() => onHour(on ? null : r.hour)}
          >
            {hourLabel(r.hour)}
          </button>
        );
      })}
      <svg className={s.bars} width="100%" height={g.height} role="img" aria-label={butterflyLabel(rows)}>
        <line className={s.axis} x1={`${g.axis}%`} x2={`${g.axis}%`} y1={0} y2={g.height} />
        {g.bars.map((bar) => (
          <g key={bar.hour} className={hour != null && hour !== bar.hour ? s.out : undefined}>
            {bar.loss ? <rect className={s.bar} x={`${bar.loss.x}%`} y={bar.y + (g.row - g.bar) / 2} width={`${bar.loss.w}%`} height={g.bar} /> : null}
            {bar.win ? <rect className={s.bar} x={`${bar.win.x}%`} y={bar.y + (g.row - g.bar) / 2} width={`${bar.win.w}%`} height={g.bar} /> : null}
          </g>
        ))}
      </svg>
      {g.bars.map((bar, i) => (
        <span key={`c${bar.hour}`} className={cx(s.count, hour != null && hour !== bar.hour && s.out)} style={{ gridRow: i + 2 }} data-hour-count={bar.hour} aria-hidden>
          {bar.count}
        </span>
      ))}
    </div>
  );
}
