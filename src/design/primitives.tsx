import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { montantAria, montantParts, type MontantParts } from '@/lib/format';
import s from './primitives.module.css';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

interface PanelProps {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tight?: boolean;
  raised?: boolean;
  flush?: boolean;
  accent?: boolean;
  corners?: boolean;
  style?: CSSProperties;
}

export function Panel({ title, sub, actions, children, className, bodyClassName, tight, raised, flush, accent, style }: PanelProps) {
  return (
    <section className={cx(s.panel, raised && s.raised, flush && s.flush, accent && s.accent, className)} style={style}>
      {(title || actions || sub) && (
        <header className={s.panelHead}>
          {title && <h3 className={s.panelTitle}>{title}</h3>}
          {sub && <span className={s.panelSub}>{sub}</span>}
          {actions && <div className={s.panelActions}>{actions}</div>}
        </header>
      )}
      <div className={cx(s.panelBody, tight && s.tight, bodyClassName)}>{children}</div>
    </section>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'gold' | 'solid' | 'danger' | 'chamfer';
  size?: 'md' | 'sm';
  active?: boolean;
}

export function Button({ variant = 'default', size = 'md', active, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(s.btn, variant !== 'default' && s[variant], size === 'sm' && s.sm, active && s.active, className)} {...rest}>
      {children}
    </button>
  );
}

export function Tag({ children, tone, dot, live, className }: { children: ReactNode; tone?: 'gold' | 'mint' | 'ember' | 'ice' | 'amber' | 'violet'; dot?: boolean; live?: boolean; className?: string }) {
  return (
    <span className={cx(s.tag, tone && s[tone], className)}>
      {dot && <i className={cx(s.tagDot, live && s.live)} />}
      {children}
    </span>
  );
}

/** Onglet inversé (fond blanc, texte noir) — un seul par écran. */
export function InvertedTab({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.invertedTab, className)}>{children}</span>;
}

/** Interpole une valeur numérique vers sa nouvelle cible (380 ms), chiffres tabulaires. */
function useCountUp(target: number | undefined, duration = 380): number | undefined {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === undefined || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const start = from.current !== undefined && Number.isFinite(from.current) ? from.current : target;
    if (start === target || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'pos' | 'neg' | 'flat' | 'gold' | 'ice';
  small?: boolean;
  className?: string;
  /** Valeur numérique interpolée à l'arrivée des données ; `format` la met en forme */
  num?: number;
  format?: (v: number) => string;
}

export function Stat({ label, value, hint, tone, small, className, num, format }: StatProps) {
  const animated = useCountUp(num);
  const shown = num !== undefined && format && animated !== undefined ? format(animated) : value;
  return (
    <div className={cx(s.stat, tone && tone !== 'flat' && s[tone], className)}>
      <span className={s.statLabel} title={typeof label === 'string' ? label : undefined}>{label}</span>
      <span className={cx(s.statValue, small && s.sm)}>{shown}</span>
      {hint !== undefined && <span className={s.statHint} title={typeof hint === 'string' ? hint : undefined}>{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, children, className, style }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <label className={cx(s.field, className)} style={style}>
      <span className={s.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </label>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={cx(s.toggle, on && s.on)} onClick={() => onChange(!on)} role="switch" aria-checked={on} disabled={disabled}>
      <span className={s.toggleTrack} />
      {label && <span>{label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className={s.segmented}>
      {options.map((o) => (
        <button key={o.value} className={cx(o.value === value && s.on)} onClick={() => onChange(o.value)} type="button" aria-pressed={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, text, action }: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyTitle}>{title}</div>
      {text && <div className={s.emptyText}>{text}</div>}
      {action}
    </div>
  );
}

export function Progress({ value, tone, className }: { value: number; tone?: 'gold' | 'mint' | 'ember' | 'ice'; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={cx(s.progress, tone && s[tone], className)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Marque SIΞRRΛSKΛ—LAB — discrète, mono espacée ; `engraved` pour la version gravée du chargement. */
export function Sigil({ size = 11, className, style, engraved, lab = true }: { size?: number; className?: string; style?: CSSProperties; engraved?: boolean; lab?: boolean }) {
  return (
    <span className={cx(s.sigil, engraved && s.engraved, className)} style={{ fontSize: size, ...style }}>
      {lab ? 'SIΞRRΛSKΛ—LAB' : 'SIΞRRΛSKΛ'}
    </span>
  );
}

export const tableClass = s.table;

export function Montant({ value, decimals = 2, discrete, className }: { value: number; decimals?: number; discrete?: boolean; className?: string }) {
  const parts = montantParts(value, decimals);
  const label = montantAria(parts);
  if (discrete) return <span className={cx(s.montant, s.masked, className)} aria-label={label}>•••••</span>;
  return (
    <span className={cx(s.montant, className)} aria-label={label}>
      {parts.sign ? <span>{parts.sign}</span> : null}
      {parts.groups.map((group, index) => (
        <span key={`${group}-${index}`} className={index > 0 ? s.groupGap : undefined}>
          {group}
        </span>
      ))}
      <span className={s.decimals}>,{parts.decimals}</span>
    </span>
  );
}

/** Lecteur Doto — un seul par écran, posé sur une plaque vissée. */
export function Lecteur({ value, decimals = 2, discrete }: { value: number; decimals?: number; discrete?: boolean }) {
  const parts = montantParts(value, decimals);
  const label = montantAria(parts);
  if (discrete) {
    return (
      <span className={s.lecteur} aria-label={label}>
        •••••
      </span>
    );
  }
  const ghost: MontantParts = {
    sign: parts.sign,
    groups: parts.groups.map((group) => '8'.repeat(group.length)),
    decimals: '8'.repeat(parts.decimals.length),
  };
  return (
    <span className={s.lecteur} aria-label={label}>
      <span className={s.lecteurGhost} aria-hidden>
        <MontantInner parts={ghost} />
      </span>
      <span className={s.lecteurInk}>
        <MontantInner parts={parts} />
      </span>
    </span>
  );
}

function MontantInner({ parts }: { parts: MontantParts }) {
  return (
    <>
      {parts.sign ? <span>{parts.sign}</span> : null}
      {parts.groups.map((group, index) => (
        <span key={`${group}-${index}`} className={index > 0 ? s.groupGap : undefined}>
          {group}
        </span>
      ))}
      <span className={s.decimals}>,{parts.decimals}</span>
    </>
  );
}

/** Plaque du lecteur : quatre vis, trame, languette du Lab. */
export function PlaqueVissee({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx(s.plaque, className)}>
      <span className={s.trame} aria-hidden />
      <i className={cx(s.vis, s.visTl)} aria-hidden />
      <i className={cx(s.vis, s.visTr)} aria-hidden />
      <i className={cx(s.vis, s.visBl)} aria-hidden />
      <i className={cx(s.vis, s.visBr)} aria-hidden />
      <i className={s.languette} aria-hidden />
      <div className={s.plaqueBody}>{children}</div>
    </section>
  );
}

/** Point 5 px + halo. Vivant, jamais décoratif, jamais animé. */
export function Led({ children, on = true }: { children?: ReactNode; on?: boolean }) {
  if (!on) return children ? <span className={s.ledOff}>{children}</span> : null;
  return (
    <span className={s.led}>
      <i aria-hidden />
      {children}
    </span>
  );
}

export function Jauge({
  min,
  max,
  value,
  marker,
  markerColor = 'var(--neg)',
  hatchFrom,
  ticks,
}: {
  min: number;
  max: number;
  value: number;
  marker?: number | null;
  markerColor?: string;
  hatchFrom?: number | null;
  ticks: { value: number; label: string; color?: string }[];
}) {
  const span = max - min || 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, ((n - min) / span) * 100))}%`;
  return (
    <div className={s.jauge}>
      <div className={s.jaugeTrack}>
        {hatchFrom != null && <span className={s.jaugeHatch} style={{ left: pct(hatchFrom) }} />}
        <span className={s.jaugeFill} style={{ width: pct(value) }} />
        {marker != null && Number.isFinite(marker) && <span className={s.jaugeMark} style={{ left: pct(marker), background: markerColor }} />}
        <span className={s.jaugeCursor} style={{ left: pct(value) }} aria-hidden />
      </div>
      <div className={s.jaugeScale}>
        {ticks.map((tick) => (
          <span key={`${tick.value}-${tick.label}`} style={{ left: pct(tick.value), color: tick.color }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** `[ LIBELLÉ ]` mono, une ligne, tronqué au-delà de 14 caractères. */
export function Etiquette({ children }: { children: string }) {
  const raw = children.trim();
  const long = raw.length > 14;
  const shown = long ? `${raw.slice(0, 13)}…` : raw;
  return (
    <span className={s.etiquette} title={long ? raw : undefined}>
      [ {shown} ]
    </span>
  );
}

export function Regle({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={s.regle}>
      <span>{label}</span>
      <i aria-hidden />
      <span>{value}</span>
    </div>
  );
}

export function Barcode({ className }: { className?: string }) {
  return <span className={cx(s.barcode, className)} aria-hidden />;
}
