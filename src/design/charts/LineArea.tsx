import { useMemo, useState } from 'react';
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

export function LineArea({ series, height = 220, formatY = (v) => v.toFixed(0), formatX = (v) => new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), baseline = 0, yDomain, legend, padding = { top: 12, right: 14, bottom: 22, left: 56 } }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

  const model = useMemo(() => {
    const all = series.flatMap((sr) => sr.points);
    if (all.length === 0 || width === 0) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    let yMin = yDomain ? yDomain[0] : Math.min(...ys, baseline ?? Infinity);
    let yMax = yDomain ? yDomain[1] : Math.max(...ys, baseline ?? -Infinity);
    if (yMax - yMin < 1e-9) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.06;
    yMin -= pad;
    yMax += pad;
    const w = width - padding.left - padding.right;
    const h = height - padding.top - padding.bottom;
    const sx = (x: number) => padding.left + (xMax === xMin ? w / 2 : ((x - xMin) / (xMax - xMin)) * w);
    const sy = (y: number) => padding.top + h - ((y - yMin) / (yMax - yMin)) * h;
    return { xMin, xMax, yMin, yMax, w, h, sx, sy, ticksY: niceTicks(yMin, yMax, 5), ticksX: niceTicks(xMin, xMax, Math.max(2, Math.floor(w / 110))) };
  }, [series, width, height, padding, baseline, yDomain]);

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
              <linearGradient key={sr.id} id={`g-${sr.id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={sr.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={sr.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
            <clipPath id="clip-pos">
              <rect x={0} y={0} width={width} height={model.sy(baseline ?? 0)} />
            </clipPath>
            <clipPath id="clip-neg">
              <rect x={0} y={model.sy(baseline ?? 0)} width={width} height={height} />
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
                {sr.area && !sr.signed && <path d={area} fill={`url(#g-${sr.id})`} />}
                {sr.area && sr.signed && (
                  <>
                    <path d={area} fill="var(--mint)" opacity={0.18} clipPath="url(#clip-pos)" />
                    <path d={area} fill="var(--ember)" opacity={0.22} clipPath="url(#clip-neg)" />
                  </>
                )}
                {sr.signed ? (
                  <>
                    <path d={d} fill="none" stroke="var(--mint)" strokeWidth={sr.width ?? 1.5} clipPath="url(#clip-pos)" />
                    <path d={d} fill="none" stroke="var(--ember)" strokeWidth={sr.width ?? 1.5} clipPath="url(#clip-neg)" />
                  </>
                ) : (
                  <path d={d} fill="none" stroke={sr.color} strokeWidth={sr.width ?? 1.5} strokeDasharray={sr.dashed ? '3 3' : undefined} strokeLinejoin="round" />
                )}
              </g>
            );
          })}
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
