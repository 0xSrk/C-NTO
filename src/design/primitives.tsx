import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
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

export function Panel({ title, sub, actions, children, className, bodyClassName, tight, raised, flush, accent, corners = raised || accent, style }: PanelProps) {
  return (
    <section className={cx(s.panel, raised && s.raised, flush && s.flush, accent && s.accent, className)} style={style}>
      {corners && (
        <>
          <i className={cx(s.corner, s.tl)} />
          <i className={cx(s.corner, s.tr)} />
          <i className={cx(s.corner, s.bl)} />
          <i className={cx(s.corner, s.br)} />
        </>
      )}
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
  variant?: 'default' | 'ghost' | 'gold' | 'solid' | 'danger';
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
