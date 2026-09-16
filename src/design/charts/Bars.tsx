import { useMemo, useState } from 'react';
import s from './charts.module.css';
import { niceTicks, useMeasure } from './useMeasure';

export interface BarDatum {
  key: string;
  value: number;
  label?: string;
  hint?: string;
  color?: string;
}

interface Props {
  data: BarDatum[];
  height?: number;
  formatY?: (v: number) => string;
  signed?: boolean;
  padding?: { top: number; right: number; bottom: number; left: number };
  labelEvery?: number;
}

/** Barres verticales (par heure, par jour, par instrument…) colorées selon le signe. */
const DEFAULT_PADDING = { top: 10, right: 8, bottom: 22, left: 48 };
const HISTO_PADDING = { top: 8, right: 8, bottom: 22, left: 34 };

export function Bars({ data, height = 180, formatY = (v) => v.toFixed(0), signed = true, padding = DEFAULT_PADDING, labelEvery = 1 }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    if (width === 0 || data.length === 0) return null;
    let yMin = 0;
    let yMax = 0;
    for (const d of data) {
      if (!Number.isFinite(d.value)) continue;
      if (d.value < yMin) yMin = d.value;
      if (d.value > yMax) yMax = d.value;
    }
    if (yMax - yMin < 1e-9) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= yMin < 0 ? pad : 0;
    yMax += pad;
    const w = width - padding.left - padding.right;
    const h = height - padding.top - padding.bottom;
    const slot = w / data.length;
    const bw = Math.max(2, Math.min(38, slot * 0.68));
    const sy = (y: number) => padding.top + h - ((y - yMin) / (yMax - yMin)) * h;
    return { yMin, yMax, w, h, slot, bw, sy, ticks: niceTicks(yMin, yMax, 4) };
  }, [data, width, height, padding]);

  return (
    <div className={s.wrap} ref={ref} style={{ height }}>
      {model && (
        <svg width={width} height={height} className={s.svg} onMouseLeave={() => setHover(null)}>
          {model.ticks.map((t) => (
            <g key={t}>
              <line x1={padding.left} x2={width - padding.right} y1={model.sy(t)} y2={model.sy(t)} className={Math.abs(t) < 1e-9 ? s.zero : s.grid} />
              <text x={padding.left - 6} y={model.sy(t) + 3} textAnchor="end" className={s.axis}>
                {formatY(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padding.left + i * model.slot + (model.slot - model.bw) / 2;
            const y0 = model.sy(0);
            const y1 = model.sy(d.value);
            const color = d.color ?? (signed ? (d.value >= 0 ? 'var(--mint)' : 'var(--ember)') : 'var(--ice)');
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)}>
                <rect x={padding.left + i * model.slot} y={padding.top} width={model.slot} height={model.h} fill="transparent" />
                <rect x={x} y={Math.min(y0, y1)} width={model.bw} height={Math.max(1, Math.abs(y1 - y0))} fill={color} opacity={hover === i ? 1 : 0.78} className={s.cell} />
                {i % labelEvery === 0 && (
                  <text x={x + model.bw / 2} y={height - 6} textAnchor="middle" className={s.axis}>
                    {d.label ?? d.key}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && model && data[hover] && (
        <div className={s.tooltip} style={{ left: Math.min(width - 160, padding.left + hover * model.slot + 8), top: 4 }}>
          <span className={s.t}>{data[hover].label ?? data[hover].key}</span>
          <b>{formatY(data[hover].value)}</b>
          {data[hover].hint && <span className={s.t}>{data[hover].hint}</span>}
        </div>
      )}
    </div>
  );
}

interface HistoProps {
  bins: { x0: number; x1: number; count: number }[];
  height?: number;
  formatX?: (v: number) => string;
}

export function Histogram({ bins, height = 160, formatX = (v) => v.toFixed(0) }: HistoProps) {
  const data: BarDatum[] = bins.map((b, i) => ({ key: String(i), value: b.count, label: i % Math.max(1, Math.floor(bins.length / 6)) === 0 ? formatX(b.x0) : '', hint: `${formatX(b.x0)} → ${formatX(b.x1)}`, color: b.x1 <= 0 ? 'var(--ember)' : b.x0 >= 0 ? 'var(--mint)' : 'var(--text-2)' }));
  return <Bars data={data} height={height} signed={false} formatY={(v) => String(Math.round(v))} padding={HISTO_PADDING} />;
}
