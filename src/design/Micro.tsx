import type { CSSProperties, ReactNode } from 'react';
import { CARTOUCHES, COMPONENTS, GLYPH_ID, PLATES } from './micro/assets';
import { cx } from './primitives';
import s from './micro.module.css';

/**
 * The Lab's micrographics in the desk (Ligne V2 Rév. A): components of the plate, HUD plates bound to real state,
 * decoded cartouches. Each one names a function or reads a state; none decorates. Ink is --k, paper is --p: each
 * zone sets them. The only code of the desk stays the strip's Code 128, bottom right.
 */
export type GlyphName = keyof typeof GLYPH_ID;
export type PlateId = keyof typeof PLATES;
export type CartoucheId = keyof typeof CARTOUCHES;
export type SlotValues = Readonly<Record<string, string | number | null | undefined>>;

const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Fills a plate's {{slots}}. A slot without a value reads « — »: a plate never shows an invented value. */
export function bindSlots(svg: string, values: SlotValues = {}): string {
  return svg.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined || v === '' ? '—' : esc(v);
  });
}

interface Common {
  className?: string;
  style?: CSSProperties;
  /** names the drawing for assistive tech; without it the drawing is silent */
  label?: string;
}
const a11y = (label?: string) => (label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const });

export function Glyph({ name, className, style, label }: Common & { name: GlyphName }) {
  return <span className={cx(s.glyph, className)} style={style} {...a11y(label)} dangerouslySetInnerHTML={{ __html: COMPONENTS[GLYPH_ID[name]] ?? '' }} />;
}

export function Plate({ id, values, className, style, label }: Common & { id: PlateId; values?: SlotValues }) {
  return <span className={cx(s.plate, className)} style={style} {...a11y(label)} dangerouslySetInnerHTML={{ __html: bindSlots(PLATES[id].svg, values) }} />;
}

export function Cartouche({ id, values, className, style, label }: Common & { id: CartoucheId; values?: SlotValues }) {
  return <span className={cx(s.cartouche, className)} style={style} {...a11y(label)} dangerouslySetInnerHTML={{ __html: bindSlots(CARTOUCHES[id], values) }} />;
}

const SIGNAL_GLYPH = { 1: 'signal1', 2: 'signal2', 3: 'signal3' } as const;

/** A desk signal: the glyph says the level — 1 orbit, 2 radiance, 3 circle-slash. Level 3 alone is red. */
export function Signal({ level, children, className }: { level: 1 | 2 | 3; children?: ReactNode; className?: string }) {
  return (
    <span className={cx(s.signal, level === 1 && s.l1, level === 2 && s.l2, level === 3 && 'sig-l3', className)} data-level={level}>
      <Glyph name={SIGNAL_GLYPH[level]} className={s.signalGlyph} />
      {children ? <span className={s.signalText}>{children}</span> : null}
    </span>
  );
}
