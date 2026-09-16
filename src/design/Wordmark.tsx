import type { CSSProperties } from 'react';
import s from './wordmark.module.css';

/**
 * Tracés du logotype CΛNTO — viewBox 640×160, grille 8 px, traits 1 px.
 * Capitals optique : C · Λ · N · T · O, baselines y=32 / y=128, axe y=80.
 */
export const WORDMARK_PATHS = [
  /* C — arc ouvert à droite, centre (112, 80), r=48 */
  'M136 40 A48 48 0 1 0 136 120',
  /* Λ */
  'M176 128 L224 32 L272 128',
  /* N */
  'M304 128 L304 32 L384 128 L384 32',
  /* T */
  'M416 32 L512 32 M464 32 L464 128',
  /* O — cercle centre (560, 80), r=48 */
  'M560 32 A48 48 0 1 1 560 128 A48 48 0 1 1 560 32',
];

/** Guides de construction (boot animé) — baselines + axes des glyphes */
export const WORDMARK_GUIDES_X = [112, 176, 224, 272, 304, 384, 416, 464, 512, 560] as const;

interface WordmarkProps {
  width?: number;
  animated?: boolean;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Wordmark({ width = 320, animated = false, color = 'var(--text-0)', strokeWidth = 1.25, style, className }: WordmarkProps) {
  const height = (width * 160) / 640;
  return (
    <svg viewBox="0 0 640 160" width={width} height={height} style={style} className={className} fill="none" aria-label="CΛNTO">
      {animated && (
        <defs>
          <filter id="wm-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {animated && (
        <g className={s.guides} stroke={color} strokeWidth={0.5}>
          <line x1="-200" x2="840" y1="32" y2="32" />
          <line x1="-200" x2="840" y1="128" y2="128" />
          <line x1="-200" x2="840" y1="80" y2="80" className={s.guideMid} />
          {WORDMARK_GUIDES_X.map((x) => (
            <line key={x} x1={x} x2={x} y1="-48" y2="208" className={s.guideV} />
          ))}
        </g>
      )}
      <g
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeMiterlimit={2}
        filter={animated ? 'url(#wm-glow)' : undefined}
      >
        {WORDMARK_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            className={animated ? s.stroke : undefined}
            style={animated ? ({ '--i': i } as CSSProperties) : undefined}
            vectorEffect={animated ? undefined : 'non-scaling-stroke'}
          />
        ))}
      </g>
      {animated && (
        <g stroke={color} strokeWidth={strokeWidth + 0.8} strokeLinecap="square" strokeLinejoin="miter" opacity={0.85}>
          {WORDMARK_PATHS.map((d, i) => (
            <path key={i} d={d} pathLength={1} className={s.glint} style={{ '--i': i } as CSSProperties} />
          ))}
        </g>
      )}
    </svg>
  );
}
