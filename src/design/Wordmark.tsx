import type { CSSProperties } from 'react';
import s from './wordmark.module.css';

/** Tracés du logotype CΛNTO, en traits fins (viewBox 0 0 640 170). */
export const WORDMARK_PATHS = [
  'M116.5 39.9 A55 55 0 1 0 116.5 130.1',
  'M150 140 L200 30 L250 140',
  'M285 140 L285 30 L365 140 L365 30',
  'M395 30 L485 30 M440 30 L440 140',
  'M555 30 A55 55 0 1 1 555 140 A55 55 0 1 1 555 30',
];

interface WordmarkProps {
  width?: number;
  animated?: boolean;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Wordmark({ width = 320, animated = false, color = '#ffffff', strokeWidth = 1.5, style, className }: WordmarkProps) {
  const height = (width * 170) / 640;
  return (
    <svg viewBox="0 0 640 170" width={width} height={height} style={style} className={className} fill="none" aria-label="CΛNTO">
      {animated && (
        <defs>
          <filter id="wm-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {animated && (
        <g className={s.guides} stroke={color} strokeWidth={0.5}>
          <line x1="-200" x2="840" y1="30" y2="30" />
          <line x1="-200" x2="840" y1="140" y2="140" />
          <line x1="-200" x2="840" y1="85" y2="85" className={s.guideMid} />
          {[116.5, 150, 200, 250, 285, 365, 395, 440, 485, 555].map((x) => (
            <line key={x} x1={x} x2={x} y1="-60" y2="230" className={s.guideV} />
          ))}
        </g>
      )}
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" filter={animated ? 'url(#wm-glow)' : undefined}>
        {WORDMARK_PATHS.map((d, i) => (
          <path key={i} d={d} pathLength={1} className={animated ? s.stroke : undefined} style={animated ? ({ '--i': i } as CSSProperties) : undefined} vectorEffect={animated ? undefined : 'non-scaling-stroke'} />
        ))}
      </g>
      {animated && (
        <g stroke={color} strokeWidth={strokeWidth + 1.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
          {WORDMARK_PATHS.map((d, i) => (
            <path key={i} d={d} pathLength={1} className={s.glint} style={{ '--i': i } as CSSProperties} />
          ))}
        </g>
      )}
    </svg>
  );
}
