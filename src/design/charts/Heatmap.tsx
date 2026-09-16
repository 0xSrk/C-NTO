import { useState } from 'react';
import s from './charts.module.css';
import { useMeasure } from './useMeasure';

export interface HeatCell {
  row: number;
  col: number;
  value: number | null;
  label?: string;
  hint?: string;
}

interface Props {
  rows: string[];
  cols: string[];
  cells: HeatCell[];
  height?: number;
  formatValue?: (v: number) => string;
  /** échelle signée (rouge ↔ vert) ou séquentielle (transparent → or) */
  signed?: boolean;
  colLabelEvery?: number;
}

export function colorFor(v: number, max: number, signed: boolean): string {
  if (max <= 0) return 'rgba(255,255,255,0.04)';
  const t = Math.min(1, Math.abs(v) / max);
  if (signed) return v >= 0 ? `rgba(127, 207, 154, ${0.12 + t * 0.78})` : `rgba(224, 119, 108, ${0.12 + t * 0.78})`;
  return `rgba(211, 171, 83, ${0.08 + t * 0.85})`;
}

export function Heatmap({ rows, cols, cells, height, formatValue = (v) => v.toFixed(0), signed = true, colLabelEvery = 1 }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<HeatCell | null>(null);
  const left = 34;
  const top = 16;
  const gap = 2;
  const cw = width > 0 ? (width - left) / cols.length : 0;
  const ch = height ? (height - top) / rows.length : Math.max(14, Math.min(26, cw));
  const h = height ?? top + ch * rows.length;
  const max = Math.max(1e-9, ...cells.map((c) => Math.abs(c.value ?? 0)));

  return (
    <div className={s.wrap} ref={ref} style={{ height: h }}>
      {width > 0 && (
        <svg width={width} height={h} className={s.svg} onMouseLeave={() => setHover(null)}>
          {cols.map((c, i) => (i % colLabelEvery === 0 ? <text key={c + i} x={left + i * cw + cw / 2} y={10} textAnchor="middle" className={s.axis}>{c}</text> : null))}
          {rows.map((r, i) => (
            <text key={r + i} x={left - 6} y={top + i * ch + ch / 2 + 3} textAnchor="end" className={s.axis}>
              {r}
            </text>
          ))}
          {cells.map((c) => (
            <rect
              key={`${c.row}-${c.col}`}
              x={left + c.col * cw + gap / 2}
              y={top + c.row * ch + gap / 2}
              width={Math.max(1, cw - gap)}
              height={Math.max(1, ch - gap)}
              rx={1}
              fill={c.value === null ? 'rgba(255,255,255,0.03)' : colorFor(c.value, max, signed)}
              className={s.cell}
              onMouseEnter={() => setHover(c)}
            />
          ))}
        </svg>
      )}
      {hover && (
        <div className={s.tooltip} style={{ left: Math.min(width - 170, left + hover.col * cw + cw), top: top + hover.row * ch - 4 }}>
          <span className={s.t}>{hover.label ?? `${rows[hover.row]} · ${cols[hover.col]}`}</span>
          <b>{hover.value === null ? '—' : formatValue(hover.value)}</b>
          {hover.hint && <span className={s.t}>{hover.hint}</span>}
        </div>
      )}
    </div>
  );
}
