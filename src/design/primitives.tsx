import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
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

export function Panel({ title, sub, actions, children, className, bodyClassName, tight, raised, flush, accent, corners = true, style }: PanelProps) {
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

export function Button({ variant = 'default', size = 'md', active, className, children, ...rest }: ButtonProps) {
  return (
    <button className={cx(s.btn, variant !== 'default' && s[variant], size === 'sm' && s.sm, active && s.active, className)} {...rest}>
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

export function Stat({ label, value, hint, tone, small, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'pos' | 'neg' | 'flat' | 'gold' | 'ice'; small?: boolean; className?: string }) {
  return (
    <div className={cx(s.stat, tone && tone !== 'flat' && s[tone], className)}>
      <span className={s.statLabel}>{label}</span>
      <span className={cx(s.statValue, small && s.sm)}>{value}</span>
      {hint !== undefined && <span className={s.statHint}>{hint}</span>}
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

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <span className={cx(s.toggle, on && s.on)} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className={s.toggleTrack} />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className={s.segmented}>
      {options.map((o) => (
        <button key={o.value} className={cx(o.value === value && s.on)} onClick={() => onChange(o.value)} type="button">
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

export function Divider() {
  return <div className={s.divider} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

export function Progress({ value, tone, className }: { value: number; tone?: 'gold' | 'mint' | 'ember' | 'ice'; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={cx(s.progress, tone && s[tone], className)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Marque SIΞRRΛSKΛ gravée — toujours discrète. */
export function Sigil({ size = 10, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx(s.sigil, className)} style={{ fontSize: size, ...style }}>
      SIΞRRΛSKΛ
    </span>
  );
}

export const tableClass = s.table;
