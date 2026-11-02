import type { KeyboardEvent, ReactNode } from 'react';
import { COMPONENTS, GLYPH_ID, type GlyphName } from '@/design/Micro';
import { TYPE_GLYPH } from '@/design/micro/meaning';
import e from '@/design/etat.module.css';
import { cx } from '@/design/primitives';
import { egoBox, egoFrame, egoLayout, rScale, type EgoNode, type EgoRay, type RDomain } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { fmtRatio } from '@/lib/format';
import type { LightProps } from './useHoverLight';
import s from './fiche.module.css';

/**
 * Les instruments de la fiche (OROS5.26, Système 5 « Fiche et Frise » ; repris du prototype d1, corrigés) : M.057 la
 * grille d'identité, M.016 le graphe d'ego, M.022 l'échelle en R. Chacun lit une donnée réelle et sa géométrie au moteur
 * (`src/engine/ontology/fiche.ts`) : rien n'est recalculé ici. Le trait d'un état vient de la table d'états
 * (`src/design/etat.module.css`) ; les glyphes, de la bibliothèque unique (`Micro.tsx`). Construction au glacier, valeurs à
 * l'ivoire, libellés au graphite ; l'or reste au glyphe de l'en-tête, l'objet ouvert (décision 1).
 */

/** Un composant de la planche posé dans une figure SVG : le master tel quel, dans une boîte de `size` px centrée sur (x, y). */
export function FigureGlyph({ name, x, y, size, className }: { name: GlyphName; x: number; y: number; size: number; className?: string }) {
  return <svg x={x - size / 2} y={y - size / 2} width={size} height={size} overflow="visible" className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: COMPONENTS[GLYPH_ID[name]] ?? '' }} />;
}

/** Un cercle en tracé : la table d'états ne vise que les tracés (`line`, `rect`, `path`), jamais un `circle`. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/* ─── M.057 · la grille en croix : au numéral la valeur qui décide ─────────────────────────────────────────── */

/** Le corps du numéral selon sa longueur : il tient dans sa colonne sans jamais passer à la ligne. */
function numeralClass(chars: number): string | undefined {
  if (chars <= 5) return s.identNumL;
  if (chars <= 8) return s.identNumM;
  return s.identNumS;
}

export function IdentityGrid({
  label,
  lead,
  when,
  numeral,
  chars,
  sub,
  aside,
  foot,
}: {
  label: string;
  /** Haut gauche : ce qui situe l'objet (un lien quand c'est un objet), en Geist Mono. */
  lead: ReactNode;
  /** Haut droite : sa date ou sa période. */
  when: ReactNode;
  /** La valeur qui décide. */
  numeral: ReactNode;
  /** Nombre de signes du numéral, pour son corps. */
  chars: number;
  /** Ce que dit le numéral (unité, base horaire), dessous. */
  sub?: ReactNode;
  aside: ReactNode;
  foot: readonly ReactNode[];
}) {
  return (
    <section className={s.ident} aria-label={label} data-section="identity">
      <div className={s.identLead}>{lead}</div>
      <div className={s.identWhen}>{when}</div>
      <div className={cx(s.identNum, numeralClass(chars))} data-ident="numeral">
        <b>{numeral}</b>
        {sub ? <span>{sub}</span> : null}
      </div>
      <div className={s.identAside}>{aside}</div>
      {foot.length ? (
        <p className={s.identFoot}>
          {foot.map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/* ─── M.016 · le graphe d'ego : un arc par moitié, le trait dit le genre, la longueur dit le score ──────────────── */

export interface EgoLabel {
  text: string;
  /** Une valeur qui suit le texte (« −1,5 R ») ; seule elle porte le signe, en menthe ou en braise. */
  value?: string;
  tone?: 'pos' | 'neg';
  meta?: string;
}

/** Largeur moyenne d'un signe de l'étiquette (Instrument Sans, 12 px), arrondie au-dessus : une étiquette tient dans sa place. */
const LABEL_CHAR_PX = 5.4;
/** Une étiquette peut mordre sur la marge de la fiche (16 px), jamais au-delà : 12 px de plus que la figure. */
const LABEL_BLEED_PX = 12;
/** Une étiquette de nœud tient sur trois lignes au plus. */
const LABEL_LINES = 3;

/**
 * Les lignes d'une étiquette dans `max` signes : la coupe se fait entre les mots, jamais dans la figure hors de la fiche.
 * Un mot plus long que la ligne se coupe à la ligne ; au-delà de `lines` lignes, la dernière dit la suite par « … » (le
 * nom entier reste dans la liste dessous et dans le nom accessible du nœud).
 */
export function wrapLabel(text: string, max: number, lines = LABEL_LINES): string[] {
  const width = Math.max(4, Math.floor(max));
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    const next = line ? `${line} ${rest}` : rest;
    if (next.length > width && line) {
      out.push(line);
      line = rest;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1]!.slice(0, Math.max(1, width - 1))}…`;
  return kept;
}

/** La place d'une étiquette dans la figure, en signes : du point d'ancrage au bord, de chaque côté pour une étiquette centrée. */
export function labelRoom(ray: Pick<EgoRay, 'anchor' | 'lx'>, width: number): number {
  const px = ray.anchor === 'end' ? ray.lx + LABEL_BLEED_PX : ray.anchor === 'start' ? width - ray.lx + LABEL_BLEED_PX : 2 * (Math.min(ray.lx, width - ray.lx) + LABEL_BLEED_PX);
  return Math.max(4, Math.floor(px / LABEL_CHAR_PX));
}

/** Les lignes d'une étiquette et sa valeur : la valeur suit la dernière ligne si elle y tient, sinon elle prend la sienne. */
export function labelLines(text: string, value: string | undefined, room: number): { text: string; value?: string }[] {
  const lines = wrapLabel(text, room).map((line) => ({ text: line })) as { text: string; value?: string }[];
  if (!value) return lines;
  const last = lines[lines.length - 1]!;
  if (`${last.text} · ${value}`.length <= room) last.value = value;
  else lines.push({ text: '', value });
  return lines;
}

/** La clé d'un rayon pour la lumière liée : l'objet visé (`type:id`), ou le groupe replié. */
export const rayKey = (ray: Pick<EgoRay, 'ref' | 'id'>): string => (ray.ref ? `${ray.ref.type}:${ray.ref.id}` : ray.id);

export function EgoGraph({
  center,
  nodes,
  labelOf,
  onOpen,
  label,
  light,
  lit,
}: {
  center: EgoNode['type'];
  nodes: readonly EgoNode[];
  labelOf: (ray: EgoRay) => EgoLabel;
  /** Un nœud qui vise un seul objet l'ouvre (un saut) ; un groupe replié ne s'ouvre pas. */
  onOpen: (ray: EgoRay) => void;
  /** Ce que la figure montre, pour les lecteurs d'écran : la liste dessous le dit aux autres. */
  label: string;
  /** La lumière liée (`useHoverLight`) : le même crochet allume le nœud et sa ligne. */
  light: (key: string) => LightProps;
  lit: string | null;
}) {
  useI18n((st) => st.locale);
  const box = egoBox(nodes.length);
  const layout = egoLayout(nodes, box);
  const { cx: x0, cy: y0, rays } = layout;
  // Chaque étiquette dans sa place : coupée entre les mots, sur trois lignes au plus ; le cadre garde les lignes en plus.
  const texts = rays.map((ray) => {
    const text = labelOf(ray);
    return { text, lines: labelLines(text.text, text.value, labelRoom(ray, box.width)) };
  });
  const extra = Math.max(0, ...texts.map((row) => row.lines.length - 1));
  const frame = egoFrame(layout, box, 6 + 12 * extra);
  const onKey = (event: KeyboardEvent, ray: EgoRay) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(ray);
  };
  return (
    <figure className={s.ego} data-figure="M.016">
      <svg className={s.egoSvg} viewBox={`0 ${frame.y} ${box.width} ${frame.height}`} style={{ aspectRatio: `${box.width} / ${frame.height}` }} role="img" aria-label={label}>
        {rays.map((ray) => {
          const rad = (ray.angle * Math.PI) / 180;
          // Le genre du lien est son trait, tiré de la table d'états : plein, ou tireté pour une hypothèse.
          return (
            <line
              key={`ray-${ray.id}`}
              className={cx(s.ray, ray.kind === 'hypothese' ? e.tirete : e.plein)}
              data-ray={ray.kind}
              data-lit={lit === rayKey(ray) ? '' : undefined}
              x1={ray.x1}
              y1={ray.y1}
              x2={ray.x - Math.cos(rad) * 12}
              y2={ray.y - Math.sin(rad) * 12}
            />
          );
        })}
        <circle cx={x0} cy={y0} r={box.core} className={s.egoCore} />
        <FigureGlyph name={TYPE_GLYPH[center]} x={x0} y={y0} size={18} className={s.egoCoreGlyph} />
        {rays.map((ray, index) => {
          const { text, lines } = texts[index]!;
          const key = rayKey(ray);
          const opens = ray.ref != null && ray.count === 1;
          const name = `${text.text}${text.value ? ` · ${text.value}` : ''}${text.meta ? ` · ${text.meta}` : ''}`;
          return (
            <g
              key={`node-${ray.id}`}
              className={cx(s.egoNode, opens && s.egoOpen)}
              data-node={key}
              {...light(key)}
              {...(opens ? { role: 'button', tabIndex: 0, 'aria-label': name, onClick: () => onOpen(ray), onKeyDown: (event: KeyboardEvent) => onKey(event, ray) } : {})}
            >
              <circle cx={ray.x} cy={ray.y} r="11" className={s.egoHalo} />
              <path d={circlePath(ray.x, ray.y, 11)} className={cx(s.egoRing, e.plein)} />
              {/* L'hypothèse : le second contour, tireté à 3 px, de la table d'états (décision 3). */}
              {ray.kind === 'hypothese' ? <path d={circlePath(ray.x, ray.y, 14)} className={cx(s.egoHypo, e.tirete)} data-halo="tirete" /> : null}
              <FigureGlyph name={TYPE_GLYPH[ray.type]} x={ray.x} y={ray.y} size={14} />
              {ray.count > 1 ? (
                <text x={ray.x + 9} y={ray.y - 7} className={s.egoCount}>
                  {ray.count}
                </text>
              ) : null}
              <text x={ray.lx} y={ray.ly} textAnchor={ray.anchor} className={s.egoLabel}>
                {lines.map((line, i) => (
                  <tspan key={i} x={ray.lx} dy={i === 0 ? 0 : 12}>
                    {line.text}
                    {line.value ? (
                      <>
                        {line.text ? <tspan className={s.egoSep}>{' · '}</tspan> : null}
                        <tspan className={text.tone ? s[text.tone] : undefined}>{line.value}</tspan>
                      </>
                    ) : null}
                  </tspan>
                ))}
              </text>
              {text.meta ? (
                <text x={ray.lx} y={ray.ly + 12 * lines.length} textAnchor={ray.anchor} className={s.egoMeta}>
                  {text.meta}
                </text>
              ) : null}
              {ray.kind === 'hypothese' && ray.score != null ? (
                <text x={(ray.x1 + ray.x) / 2} y={(ray.y1 + ray.y) / 2 - 4} textAnchor="middle" className={s.egoScore}>
                  {fmtRatio(ray.score, 2)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ─── M.022 · l'échelle en R d'un trade, sur l'axe de la fiche : stop, entrée, objectif (C.085), réalisé ────────── */

const RW = 112;
const RH = 28;
const AXIS = 13.5;

/** Un nombre de R signé au signe vrai (U+2212) : « +1,7 », « −0,9 ». */
export function fmtR(r: number, digits = 1): string {
  return `${r >= 0 ? '+' : '−'}${fmtRatio(Math.abs(r), digits)}`;
}

/**
 * L'échelle d'un trade sur l'axe commun de la fiche (`rDomain`) : −1 et 0 tombent au même endroit sur chaque ligne. Le
 * stop est un simple trait à −1, toujours libellé (C.126 reste au plancher du desk, décision 5) ; l'objectif, C.085 ;
 * le réalisé, une barre de 3 px sous l'axe, qui ne couvre aucun repère. Sans risque connu, « R — », jamais une échelle.
 */
export function RScaleBar({ risk, realizedR, plannedRr, domain }: { risk: number | null; realizedR: number | null; plannedRr: number | null; domain: RDomain | null }) {
  useI18n((st) => st.locale);
  const scale = rScale({ risk, realizedR, plannedRr }, domain);
  if (!scale) {
    return (
      <span className={s.rAbsent} role="img" aria-label={tr('Échelle en R : risque inconnu', 'R scale: unknown risk', 'Escala en R: riesgo desconocido')} data-rscale="absent">
        R —
      </span>
    );
  }
  const x = (r: number) => 4 + scale.at(r) * (RW - 8);
  const real = realizedR != null && Number.isFinite(realizedR) ? Math.min(scale.hi, Math.max(scale.lo, realizedR)) : null;
  const target = plannedRr != null && plannedRr > 0 ? `${fmtRatio(plannedRr, 1)} R` : '—';
  const done = realizedR != null ? `${fmtR(realizedR, 2)} R` : '—';
  const label = tr(`Stop −1 R · objectif ${target} · réalisé ${done}`, `Stop −1 R · target ${target} · realized ${done}`, `Stop −1 R · objetivo ${target} · realizado ${done}`);
  const zero = x(0);
  const end = real != null ? x(real) : zero;
  return (
    <svg className={s.rScale} viewBox={`0 0 ${RW} ${RH}`} role="img" aria-label={label} data-rscale="">
      <line x1="2" x2={RW - 2} y1={AXIS} y2={AXIS} className={s.rAxis} />
      <line x1={x(-1)} x2={x(-1)} y1={AXIS - 3.5} y2={AXIS + 3.5} className={s.rStop} data-r="stop" />
      <line x1={zero} x2={zero} y1={AXIS - 5} y2={AXIS + 5} className={s.rEntry} data-r="entry" />
      {plannedRr != null && plannedRr > 0 ? <FigureGlyph name="target" x={x(plannedRr)} y={AXIS} size={8} className={s.rTarget} /> : null}
      {real != null ? <rect x={Math.min(zero, end)} y={AXIS + 1.5} width={Math.max(1, Math.abs(end - zero))} height="3" className={cx(s.rReal, (realizedR ?? 0) >= 0 ? s.pos : s.neg)} data-r="real" /> : null}
      {real != null ? (
        <text x={Math.min(RW - 12, Math.max(12, end))} y="7.5" textAnchor="middle" className={cx(s.rTick, s.rTickReal)}>
          {`${fmtR(realizedR!)}${scale.clipped ? '›' : ''}`}
        </text>
      ) : null}
      <text x={x(-1)} y={RH - 1} textAnchor="middle" className={s.rTick}>
        −1
      </text>
      <text x={zero} y={RH - 1} textAnchor="middle" className={s.rTick}>
        0
      </text>
    </svg>
  );
}
