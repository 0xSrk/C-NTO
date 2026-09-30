import { useId, type CSSProperties, type ReactNode } from 'react';
import s from './wordmark.module.css';

/**
 * Logotype CΛNTO — grille 640 × 160 au pas de 8, capitale 96 (y 32 → 128), axe y 80, centré sur x 320.
 * Corrections optiques : le C et le O débordent de 1,5 u (rayon 49,5), la pointe du Λ de 2 u (y 30).
 * Tracés partagés par la barre de titre et le Boot. `electron/launcher.html` en garde une copie figée :
 * `tests/wordmark.test.ts` vérifie qu'elle ne dérive pas.
 */

/** Rayon optique des rondes : 48 + 1,5 de débord. */
export const WORDMARK_R = 49.5;

/** Point d'ancrage : position, fraction du tracé (0 → 1) où la pointe l'atteint, relevé éventuel. */
type Anchor = readonly [x: number, y: number, at: number, label?: string];

interface Glyph {
  readonly id: 'C' | 'Λ' | 'N' | 'T' | 'O';
  readonly d: string;
  readonly anchors: readonly Anchor[];
}

export const WORDMARK_GLYPHS: readonly Glyph[] = [
  /* C — centre (96, 80), ouvert à droite : extrémités à ±59° de l'axe. */
  {
    id: 'C',
    d: 'M121.49 37.57 A49.5 49.5 0 1 0 121.49 122.43',
    anchors: [
      [121.49, 37.57, 0],
      [46.5, 80, 0.5],
      [121.49, 122.43, 1],
    ],
  },
  /* Λ — pointe à y 30 : la LED s'y pose. */
  {
    id: 'Λ',
    d: 'M160 128 L208 30 L256 128',
    anchors: [
      [160, 128, 0],
      [208, 30, 0.5, 'Λ 208 · 30'],
      [256, 128, 1],
    ],
  },
  {
    id: 'N',
    d: 'M288 128 L288 32 L368 128 L368 32',
    anchors: [
      [288, 128, 0],
      [288, 32, 0.303],
      [368, 128, 0.697],
      [368, 32, 1],
    ],
  },
  {
    id: 'T',
    d: 'M400 32 L496 32 M448 32 L448 128',
    anchors: [
      [400, 32, 0],
      [496, 32, 0.5],
      [448, 128, 1, 'T 448 · 128'],
    ],
  },
  /* O — centre (544, 80). */
  {
    id: 'O',
    d: 'M544 30.5 A49.5 49.5 0 1 1 544 129.5 A49.5 49.5 0 1 1 544 30.5',
    anchors: [
      [544, 30.5, 0],
      [593.5, 80, 0.25, 'O 593,5 · 80'],
      [544, 129.5, 0.5],
    ],
  },
];

export const WORDMARK_PATHS: readonly string[] = WORDMARK_GLYPHS.map((glyph) => glyph.d);

/** Guides verticaux de la construction : axes et fûts des glyphes. */
export const WORDMARK_GUIDES_X = [96, 160, 208, 256, 288, 368, 400, 448, 496, 544] as const;

/** Bords optiques du dessin (flancs du C et du O), symétriques autour de x 320. */
export const WORDMARK_EDGE = { left: 46.5, right: 593.5 } as const;

/** Pointe du Λ : la LED de relais du lanceur s'y pose pendant la construction. */
export const WORDMARK_APEX = [208, 30] as const;

/** Centre du logotype : la LED du lanceur y arrive, la construction l'y reprend. */
const CENTER = [320, 80] as const;

/**
 * Chronologie de la construction (s), avant `delay`. Chaque lettre démarre `step` après la précédente ;
 * le tracé suit cubic-bezier(.65, 0, .35, 1) et chaque ancre s'allume quand la pointe passe dessus.
 */
export const CONSTRUCTION = { draw0: 0.34, step: 0.09, draw: 0.78, fadeOut: 1.58 } as const;

/** Durée totale de la construction (s) : la LED quitte la pointe du Λ. */
export const CONSTRUCTION_END = 2.1;

/** Ordonnée de cubic-bezier(p1x, p1y, p2x, p2y) à l'abscisse `x` (dichotomie). */
function bezier(p1x: number, p1y: number, p2x: number, p2y: number, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const t = (lo + hi) / 2;
    const bx = 3 * (1 - t) ** 2 * t * p1x + 3 * (1 - t) * t ** 2 * p2x + t ** 3;
    if (bx < x) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) ** 2 * t * p1y + 3 * (1 - t) * t ** 2 * p2y + t ** 3;
}

/** Instant (0 → 1 de la durée du tracé) où la pointe atteint la fraction `p` du tracé. */
export function whenAt(p: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (bezier(0.65, 0, 0.35, 1, m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Début du tracé de la lettre `i` (s). */
const drawStart = (i: number) => CONSTRUCTION.draw0 + i * CONSTRUCTION.step;

/** Survol : quatre ancres seulement — pointe du Λ, barre du T, flanc du O. */
const SURVOL_ANCRES = [WORDMARK_APEX, [400, 32], [496, 32], [WORDMARK_EDGE.right, 80]] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const sec = (n: number) => `${r2(n)}s`;
const vars = (entries: Record<string, string>) => entries as CSSProperties;
const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined;

interface WordmarkProps {
  /** Largeur en px CSS ; la hauteur suit (4:1). */
  width?: number;
  /** Construction animée (Boot) : guides, cote, tracés, ancres, LED de relais, halo. */
  animated?: boolean;
  /** Décalage de la construction (s). La LED de relais attend au centre pendant ce temps. */
  delay?: number;
  color?: string;
  /** Épaisseur du trait en px CSS, quelle que soit la largeur. */
  strokeWidth?: number;
  /** Au repos : amorces des lignes de capitale et de pied, hors du dessin. */
  ticks?: boolean;
  /** Au survol : les trois guides et quatre ancres affleurent. */
  survol?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function Wordmark({
  width = 320,
  animated = false,
  delay = 0,
  color = 'var(--text-0)',
  strokeWidth = 1.25,
  ticks = false,
  survol = false,
  style,
  className,
}: WordmarkProps) {
  const uid = `wm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const u = 640 / width;
  const core = strokeWidth * u;
  return (
    <svg
      viewBox="0 0 640 160"
      width={width}
      height={width / 4}
      style={animated ? { ...style, ...vars({ '--wm-delay': sec(delay) }) } : style}
      className={join(animated && s.construction, !animated && survol && s.interactif, className)}
      fill="none"
      role="img"
      aria-label="CΛNTO"
      overflow="visible"
    >
      {animated ? <Construction uid={uid} u={u} core={core} color={color} /> : <Repos uid={uid} u={u} core={core} color={color} ticks={ticks} survol={survol} />}
    </svg>
  );
}

interface LayerProps {
  uid: string;
  /** Unités SVG par px CSS. */
  u: number;
  core: number;
  color: string;
}

function glyphPaths(extra?: (index: number) => { className?: string; style?: CSSProperties; pathLength?: number; filter?: string }): ReactNode[] {
  return WORDMARK_GLYPHS.map((glyph, i) => <path key={glyph.id} d={glyph.d} {...extra?.(i)} />);
}

/** Logotype au repos : trait en px exacts, halo à 16 %, amorces et survol optionnels. */
function Repos({ uid, u, core, color, ticks, survol }: LayerProps & { ticks: boolean; survol: boolean }) {
  const { left, right } = WORDMARK_EDGE;
  const fine = r2(0.6 * u);
  const reach = 4 * u;
  const gap = 3 * u;
  const sa = 2.5 * u;
  return (
    <>
      <defs>
        <filter id={`${uid}-halo`} x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation={r2(2.6 * u)} />
        </filter>
      </defs>
      {survol && (
        <g className={s.survol} data-part="survol" stroke={color} strokeWidth={fine}>
          {[32, 80, 128].map((y) => (
            <line key={y} className={s.sg} x1={r2(left - 10 * u)} x2={r2(right + 10 * u)} y1={y} y2={y} />
          ))}
        </g>
      )}
      <g stroke={color} strokeWidth={r2(core * 2.6)} strokeLinecap="square" filter={`url(#${uid}-halo)`} opacity={0.16}>
        {glyphPaths()}
      </g>
      <g stroke={color} strokeWidth={r2(core)} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={4}>
        {glyphPaths()}
      </g>
      {survol && (
        <g className={s.survol} data-part="survol" stroke={color} strokeWidth={fine} fill="var(--bg-0)">
          {SURVOL_ANCRES.map(([x, y]) => (
            <rect key={`${x}-${y}`} className={s.sa} x={r2(x - sa / 2)} y={r2(y - sa / 2)} width={r2(sa)} height={r2(sa)} />
          ))}
        </g>
      )}
      {ticks && (
        <g data-part="amorces" stroke={color} strokeWidth={fine} opacity={0.32}>
          {[32, 128].map((y) => (
            <path key={y} d={`M${r2(left - gap - reach)} ${y} H${r2(left - gap)} M${r2(right + gap)} ${y} H${r2(right + gap + reach)}`} />
          ))}
        </g>
      )}
    </>
  );
}

/** Construction (Boot) : même dessin, révélé par la grille, avec la LED du lanceur en relais. */
function Construction({ uid, u, core, color }: LayerProps) {
  const hair = r2(0.75 * u);
  const sq = 6 * u;
  const led = 5 * u;
  const { left, right } = WORDMARK_EDGE;
  const mid = (left + right) / 2;
  const [ax, ay] = WORDMARK_APEX;
  const flare = drawStart(1) + whenAt(0.5) * CONSTRUCTION.draw;
  return (
    <>
      <defs>
        <filter id={`${uid}-halo`} x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation={r2(3.2 * u)} />
        </filter>
        <filter id={`${uid}-pointe`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={r2(1.4 * u)} />
        </filter>
        <radialGradient id={`${uid}-led`}>
          <stop offset="0" stopColor="var(--gold)" stopOpacity={0.8} />
          <stop offset="0.35" stopColor="var(--gold)" stopOpacity={0.3} />
          <stop offset="1" stopColor="var(--gold)" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}-scan`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0} />
          <stop offset="0.5" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Guides : l'axe, puis capitale et pied, puis les fûts colonne par colonne. */}
      <g stroke={color} strokeWidth={hair}>
        <line className={join(s.gh, s.ghMid)} x1="-120" x2="760" y1="80" y2="80" style={vars({ '--t': '0s' })} />
        <line className={s.gh} x1="-120" x2="760" y1="32" y2="32" style={vars({ '--t': '0.05s' })} />
        <line className={s.gh} x1="-120" x2="760" y1="128" y2="128" style={vars({ '--t': '0.05s' })} />
        {WORDMARK_GUIDES_X.map((x, i) => (
          <line key={x} className={s.gv} x1={x} x2={x} y1="-44" y2="204" style={vars({ '--t': sec(0.14 + i * 0.025) })} />
        ))}
      </g>

      {/* Cote de construction au-dessus du dessin. */}
      <g className={s.cote} stroke={color} strokeWidth={hair}>
        <line className={s.cl} x1={left} x2={right} y1="-22" y2="-22" />
        <line className={s.ct} x1={left} x2={left} y1="-28" y2="-16" />
        <line className={s.ct} x1={right} x2={right} y1="-28" y2="-16" />
        <line className={s.ct} x1={mid} x2={mid} y1="-25" y2="-19" />
        <text className={s.clab} x={mid} y={r2(-22 - 9 * u)} textAnchor="middle" fontSize={r2(9.5 * u)} fill={color} stroke="none">
          640 × 160 · 8 PX
        </text>
      </g>

      {/* Halo : la lumière passe à travers le dessin une fois les tracés posés. */}
      <g className={s.halo} stroke={color} strokeWidth={r2(core * 3.2)} strokeLinecap="square" filter={`url(#${uid}-halo)`}>
        {glyphPaths()}
      </g>

      <g stroke={color} strokeWidth={r2(core)} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={4}>
        {glyphPaths((i) => ({ className: s.trait, pathLength: 1, style: vars({ '--t': sec(drawStart(i)) }) }))}
      </g>

      {/* Pointe lumineuse qui court sur le trait (blanc pur : plus clair que l'encre). */}
      <g stroke="#FFFFFF" strokeWidth={r2(core * 2.2)} strokeLinecap="round">
        {glyphPaths((i) => ({ className: s.pointe, pathLength: 1, filter: `url(#${uid}-pointe)`, style: vars({ '--t': sec(drawStart(i)) }) }))}
      </g>

      {/* Ancres et relevés : ils s'allument au passage de la pointe, puis s'effacent ensemble. */}
      <g stroke={color} strokeWidth={hair} fill="var(--bg-0)">
        {WORDMARK_GLYPHS.flatMap((glyph, i) =>
          glyph.anchors.flatMap(([x, y, at, label]) => {
            const t = drawStart(i) + whenAt(at) * CONSTRUCTION.draw;
            const out = CONSTRUCTION.fadeOut + i * 0.02;
            const apex = x === ax && y === ay;
            const nodes: ReactNode[] = [];
            // À la pointe du Λ, la LED tient lieu d'ancre : seul le relevé s'affiche.
            if (!apex) {
              nodes.push(
                <rect key={`a-${glyph.id}-${x}-${y}`} className={s.ancre} x={r2(x - sq / 2)} y={r2(y - sq / 2)} width={r2(sq)} height={r2(sq)} style={vars({ '--t': sec(t), '--o': sec(out) })} />,
              );
            }
            if (label) {
              const dy = apex || y <= 100 ? -9 : 16;
              nodes.push(
                <text
                  key={`r-${glyph.id}-${x}-${y}`}
                  className={s.releve}
                  x={r2(x + 7 * u)}
                  y={r2(y + dy * u)}
                  fontSize={r2(8.5 * u)}
                  fill="var(--text-2)"
                  stroke="none"
                  style={vars({ '--t': sec(t + 0.06), '--o': sec(out - 0.08) })}
                >
                  {label}
                </text>,
              );
            }
            return nodes;
          }),
        )}
      </g>

      {/* LED de relais : apparaît au centre, se pose sur la pointe du Λ, s'embrase au passage du tracé. */}
      <g className={s.led} data-part="led" style={vars({ '--dx': `${CENTER[0] - ax}px`, '--dy': `${CENTER[1] - ay}px`, '--f': sec(flare) })}>
        <circle className={s.ledHalo} cx={ax} cy={ay} r={r2(led * 2.8)} fill={`url(#${uid}-led)`} />
        <rect x={r2(ax - led / 2)} y={r2(ay - led / 2)} width={r2(led)} height={r2(led)} fill="var(--gold)" />
      </g>

      {/* Balayage de lecture avant l'allumage. */}
      <line className={s.scan} x1="0" x2="0" y1="18" y2="142" stroke={`url(#${uid}-scan)`} strokeWidth={r2(u)} style={vars({ '--x0': `${left - 10}px`, '--x1': `${right + 10}px` })} />
    </>
  );
}
