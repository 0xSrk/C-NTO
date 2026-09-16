import { useMemo } from 'react';
import type { MonteCarloResult } from '@/engine/montecarlo';
import s from './charts.module.css';
import { niceTicks, useMeasure } from './useMeasure';

interface Props {
  result: MonteCarloResult;
  height?: number;
  formatY?: (v: number) => string;
  ruin?: number;
  target?: number;
}

const PADDING = { top: 12, right: 14, bottom: 22, left: 56 };

/** Éventail Monte Carlo : trajectoires échantillon + enveloppe p5 / p50 / p95. */
export function Fan({ result, height = 240, formatY = (v) => v.toFixed(0), ruin, target }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const padding = PADDING;

  const model = useMemo(() => {
    if (width === 0) return null;
    let yMin = Math.min(0, ruin !== undefined ? -ruin : 0);
    let yMax = Math.max(0, target ?? 0);
    const scan = (arr: number[]) => {
      for (const v of arr) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    };
    scan(result.envelope.p5);
    scan(result.envelope.p95);
    for (const p of result.samples) scan(p);
    const pad = (yMax - yMin) * 0.06 || 1;
    yMin -= pad;
    yMax += pad;
    const w = width - padding.left - padding.right;
    const h = height - padding.top - padding.bottom;
    const n = result.horizon;
    const sx = (i: number) => padding.left + (n <= 1 ? w : (i / (n - 1)) * w);
    const sy = (y: number) => padding.top + h - ((y - yMin) / (yMax - yMin)) * h;
    const steps = result.envelope.steps;
    const line = (arr: number[]) => arr.map((v, k) => `${k === 0 ? 'M' : 'L'}${sx(steps[k]).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
    const back = [...result.envelope.p5].reverse().map((v, j) => `L${sx(steps[steps.length - 1 - j]).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
    const band = `${line(result.envelope.p95)} ${back} Z`;
    return { yMin, yMax, sx, sy, line, band, ticks: niceTicks(yMin, yMax, 5), ticksX: niceTicks(0, n - 1, Math.max(2, Math.floor(w / 90))) };
  }, [result, width, height, ruin, target, padding]);

  return (
    <div className={s.wrap} ref={ref} style={{ height }}>
      {model && (
        <svg width={width} height={height} className={s.svg}>
          {model.ticks.map((t) => (
            <g key={t}>
              <line x1={padding.left} x2={width - padding.right} y1={model.sy(t)} y2={model.sy(t)} className={Math.abs(t) < 1e-9 ? s.zero : s.grid} />
              <text x={padding.left - 8} y={model.sy(t) + 3} textAnchor="end" className={s.axis}>
                {formatY(t)}
              </text>
            </g>
          ))}
          {model.ticksX.map((t) => (
            <text key={t} x={model.sx(t)} y={height - 6} textAnchor="middle" className={s.axis}>
              {Math.round(t) + 1}
            </text>
          ))}
          <path d={model.band} fill="var(--ice-soft)" />
          {result.samples.map((p, i) => (
            <path key={i} d={model.line(p)} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
          ))}
          <path d={model.line(result.envelope.p5)} fill="none" stroke="var(--ember)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={model.line(result.envelope.p95)} fill="none" stroke="var(--mint)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={model.line(result.envelope.p50)} fill="none" stroke="var(--ice)" strokeWidth={2} />
          {ruin !== undefined && (
            <>
              <line x1={padding.left} x2={width - padding.right} y1={model.sy(-ruin)} y2={model.sy(-ruin)} stroke="var(--ember)" strokeWidth={1} />
              <text x={width - padding.right} y={model.sy(-ruin) - 4} textAnchor="end" className={s.axis} fill="var(--ember)">
                ruine
              </text>
            </>
          )}
          {target !== undefined && (
            <>
              <line x1={padding.left} x2={width - padding.right} y1={model.sy(target)} y2={model.sy(target)} stroke="var(--gold)" strokeWidth={1} />
              <text x={width - padding.right} y={model.sy(target) - 4} textAnchor="end" className={s.axis} fill="var(--gold)">
                objectif
              </text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}
