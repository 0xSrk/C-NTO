import { useId, useMemo, useState } from 'react';
import s from './charts.module.css';
import { niceTicks, useMeasure } from './useMeasure';

export interface LinePoint {
  x: number;
  y: number;
  label?: string;
}

export interface LineSeries {
  id: string;
  points: LinePoint[];
  color: string;
  area?: boolean;
  width?: number;
  dashed?: boolean;
  /** Colorie l'aire en fonction du signe (vert au-dessus de 0, rouge en dessous) */
  signed?: boolean;
  label?: string;
}

interface Props {
  series: LineSeries[];
  height?: number;
  formatY?: (v: number) => string;
  formatX?: (v: number) => string;
  baseline?: number | null;
  yDomain?: [number, number];
  legend?: boolean;
  padding?: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_PADDING = { top: 12, right: 14, bottom: 22, left: 56 };
const fmtDefaultX = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

export function LineArea({ series, height = 220, formatY = (v) => v.toFixed(0), formatX = (v) => fmtDefaultX.format(v), baseline = 0, yDomain, legend, padding = DEFAULT_PADDING, endValue }: Props & { endValue?: boolean }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const model = useMemo(() => {
    if (width === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let count = 0;
    for (const sr of series) {
      for (const p of sr.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        count++;
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    if (count === 0) return null;
    if (baseline !== null) {
      if (baseline < yMin) yMin = baseline;
      if (baseline > yMax) yMax = baseline;
    }
    if (yDomain) {
      yMin = yDomain[0];
      yMax = yDomain[1];
    }
    if (yMax - yMin < 1e-9) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.06;
    yMin -= pad;
    yMax += pad;
    const w = width - padding.left - (endValue ? padding.right + 56 : padding.right);
    const h = height - padding.top - padding.bottom;
    const sx = (x: number) => padding.left + (xMax === xMin ? w / 2 : ((x - xMin) / (xMax - xMin)) * w);
    const sy = (y: number) => padding.top + h - ((y - yMin) / (yMax - yMin)) * h;
    return { xMin, xMax, yMin, yMax, w, h, sx, sy, ticksY: niceTicks(yMin, yMax, 5), ticksX: niceTicks(xMin, xMax, Math.max(2, Math.floor(w / 110))) };
  }, [series, width, height, padding, baseline, yDomain, endValue]);

  const primary = series[0];

  const onMove = (e: React.MouseEvent) => {
    if (!model || !primary) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const xv = model.xMin + ((mx - padding.left) / model.w) * (model.xMax - model.xMin);
    let best = 0;
    let bestD = Infinity;
    primary.points.forEach((p, i) => {
      const d = Math.abs(p.x - xv);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover({ x: mx, idx: best });
  };

  return (
    <div className={s.wrap} ref={ref} style={{ height: legend ? height + 22 : height }}>
      {legend && (
        <div className={s.legend}>
          {series.map((sr) => (
            <span key={sr.id}>
              <i style={{ background: sr.color }} />
              {sr.label ?? sr.id}
            </span>
          ))}
        </div>
      )}
      {model && (
        <svg width={width} height={height} className={s.svg} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((sr) => (
              <linearGradient key={sr.id} id={`g-${uid}-${sr.id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={sr.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={sr.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
            <clipPath id={`clip-pos-${uid}`}>
              <rect x={0} y={0} width={width} height={Math.max(0, model.sy(baseline ?? 0))} />
            </clipPath>
            <clipPath id={`clip-neg-${uid}`}>
              <rect x={0} y={model.sy(baseline ?? 0)} width={width} height={Math.max(0, height - model.sy(baseline ?? 0))} />
            </clipPath>
          </defs>
          {model.ticksY.map((t) => (
            <g key={t}>
              <line x1={padding.left} x2={width - padding.right} y1={model.sy(t)} y2={model.sy(t)} className={baseline !== null && Math.abs(t - baseline) < 1e-9 ? s.zero : s.grid} />
              <text x={padding.left - 8} y={model.sy(t) + 3} textAnchor="end" className={s.axis}>
                {formatY(t)}
              </text>
            </g>
          ))}
          {baseline !== null && !model.ticksY.some((t) => Math.abs(t - baseline) < 1e-9) && baseline >= model.yMin && baseline <= model.yMax && (
            <line x1={padding.left} x2={width - padding.right} y1={model.sy(baseline)} y2={model.sy(baseline)} className={s.zero} />
          )}
          {model.ticksX.map((t) => (
            <text key={t} x={model.sx(t)} y={height - 6} textAnchor="middle" className={s.axis}>
              {formatX(t)}
            </text>
          ))}
          {series.map((sr) => {
            if (sr.points.length === 0) return null;
            const d = sr.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${model.sx(p.x).toFixed(1)} ${model.sy(p.y).toFixed(1)}`).join(' ');
            const baseY = model.sy(baseline ?? model.yMin);
            const area = `${d} L${model.sx(sr.points[sr.points.length - 1].x).toFixed(1)} ${baseY} L${model.sx(sr.points[0].x).toFixed(1)} ${baseY} Z`;
            return (
              <g key={sr.id}>
                {sr.area && !sr.signed && <path d={area} fill={`url(#g-${uid}-${sr.id})`} />}
                {sr.area && sr.signed && (
                  <>
                    <path d={area} fill="var(--mint)" opacity={0.18} clipPath={`url(#clip-pos-${uid})`} />
                    <path d={area} fill="var(--ember)" opacity={0.22} clipPath={`url(#clip-neg-${uid})`} />
                  </>
                )}
                {sr.signed ? (
                  <>
                    <path d={d} fill="none" stroke="var(--mint)" strokeWidth={sr.width ?? 1} clipPath={`url(#clip-pos-${uid})`} />
                    <path d={d} fill="none" stroke="var(--ember)" strokeWidth={sr.width ?? 1} clipPath={`url(#clip-neg-${uid})`} />
                  </>
                ) : (
                  <path d={d} fill="none" stroke={sr.color} strokeWidth={sr.width ?? 1} strokeDasharray={sr.dashed ? '3 3' : undefined} strokeLinejoin="miter" />
                )}
              </g>
            );
          })}
          {endValue && primary && primary.points.length > 0 && (() => {
            const last = primary.points[primary.points.length - 1];
            const color = primary.signed ? (last.y >= (baseline ?? 0) ? 'var(--mint)' : 'var(--ember)') : primary.color;
            return (
              <g>
                <circle cx={model.sx(last.x)} cy={model.sy(last.y)} r={2.5} fill={color} />
                <text x={model.sx(last.x) + 7} y={model.sy(last.y) + 3.5} className={s.axis} fill={color} style={{ fill: color }}>
                  {formatY(last.y)}
                </text>
              </g>
            );
          })()}
          {hover && primary && primary.points[hover.idx] && (
            <g>
              <line x1={model.sx(primary.points[hover.idx].x)} x2={model.sx(primary.points[hover.idx].x)} y1={padding.top} y2={height - padding.bottom} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 2" />
              {series.map((sr) => {
                const p = sr.points[hover.idx] ?? sr.points.find((q) => q.x === primary.points[hover.idx].x);
                return p ? <circle key={sr.id} cx={model.sx(p.x)} cy={model.sy(p.y)} r={3} fill={sr.signed ? (p.y >= (baseline ?? 0) ? 'var(--mint)' : 'var(--ember)') : sr.color} stroke="#000" strokeWidth={1} /> : null;
              })}
            </g>
          )}
        </svg>
      )}
      {hover && model && primary && primary.points[hover.idx] && (
        <div className={s.tooltip} style={{ left: Math.min(width - 150, hover.x + 12), top: padding.top + (legend ? 22 : 0) }}>
          <span className={s.t}>{primary.points[hover.idx].label ?? formatX(primary.points[hover.idx].x)}</span>
          {series.map((sr) => {
            const p = sr.points[hover.idx] ?? sr.points.find((q) => q.x === primary.points[hover.idx].x);
            return p ? (
              <span key={sr.id}>
                {sr.label ?? sr.id} <b>{formatY(p.y)}</b>
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
