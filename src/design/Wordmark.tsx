import { useId, type CSSProperties } from 'react';
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

/** Points d'ancrage par glyphe (sommets et extrémités) — révélés pendant la construction. */
const WORDMARK_ANCHORS: readonly (readonly [number, number])[][] = [
  [
    [136, 40],
    [136, 120],
    [64, 80],
  ],
  [
    [176, 128],
    [224, 32],
    [272, 128],
  ],
  [
    [304, 128],
    [304, 32],
    [384, 128],
    [384, 32],
  ],
  [
    [416, 32],
    [512, 32],
    [464, 128],
  ],
  [
    [560, 32],
    [560, 128],
    [608, 80],
  ],
];

interface WordmarkProps {
  width?: number;
  animated?: boolean;
  /** Décalage de la construction animée (s), pour l'enchaîner après la LED du lanceur. */
  delay?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Wordmark({ width = 320, animated = false, delay = 0, color = 'var(--text-0)', strokeWidth, style, className }: WordmarkProps) {
  const height = (width * 160) / 640;
  const bloomId = `wm-bloom-${useId().replace(/:/g, '')}`;
  // Animé : trait d'1 px CSS exact quelle que soit la largeur (les tirets exigent un trait mis à l'échelle).
  const unit = 640 / width;
  const core = strokeWidth ?? (animated ? unit : 1.25);
  const hair = unit * 0.75;
  return (
    <svg
      viewBox="0 0 640 160"
      width={width}
      height={height}
      style={animated ? ({ ...style, '--wm-delay': `${delay}s` } as CSSProperties) : style}
      className={className}
      fill="none"
      aria-label="CΛNTO"
      overflow="visible"
    >
      {animated && (
        <defs>
          <filter id={bloomId} x="-10%" y="-60%" width="120%" height="220%">
            <feGaussianBlur stdDeviation={3 * unit} />
          </filter>
        </defs>
      )}
      {animated && (
        <g className={s.guides} stroke={color} strokeWidth={hair}>
          <line x1="-200" x2="840" y1="32" y2="32" />
          <line x1="-200" x2="840" y1="128" y2="128" />
          <line x1="-200" x2="840" y1="80" y2="80" className={s.guideMid} />
          {WORDMARK_GUIDES_X.map((x) => (
            <line key={x} x1={x} x2={x} y1="-48" y2="208" className={s.guideV} />
          ))}
        </g>
      )}
      {animated && (
        <g className={s.dimension} stroke={color} strokeWidth={hair}>
          <path d="M64 -24 H608 M64 -32 V-16 M608 -32 V-16 M336 -28 V-20" />
          <text x="336" y="-36" fill={color} stroke="none" textAnchor="middle" fontSize={11 * unit} className={s.dimLabel}>
            640 × 160 · 8 PX
          </text>
        </g>
      )}
      {animated && (
        <g className={s.bloom} stroke={color} strokeWidth={core * 3} strokeLinecap="square" strokeLinejoin="miter" filter={`url(#${bloomId})`}>
          {WORDMARK_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
      <g stroke={color} strokeWidth={core} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={2}>
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
        <g className={s.anchors} stroke={color} strokeWidth={hair}>
          {WORDMARK_ANCHORS.flatMap((glyph, i) =>
            glyph.map(([x, y]) => <rect key={`${i}-${x}-${y}`} x={x - 3 * unit} y={y - 3 * unit} width={6 * unit} height={6 * unit} style={{ '--i': i } as CSSProperties} />),
          )}
        </g>
      )}
      {animated && (
        <g stroke={color} strokeWidth={core * 2} strokeLinecap="square" strokeLinejoin="miter">
          {WORDMARK_PATHS.map((d, i) => (
            <path key={i} d={d} pathLength={1} className={s.glint} style={{ '--i': i } as CSSProperties} />
          ))}
        </g>
      )}
    </svg>
  );
}
