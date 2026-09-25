import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '@/app/icons';
import { tr, useI18n } from '@/i18n';
import s from './modal.module.css';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  width = 560,
  footer,
  dismissable = true,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  /** false : Échap et le clic sur le voile ne ferment pas (import en cours, etc.). */
  dismissable?: boolean;
}) {
  useI18n((st) => st.locale);
  const panel = useRef<HTMLDivElement>(null);
  const restored = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Les rappels des appelants sont souvent des fonctions fléchées recréées à chaque rendu :
  // on les lit par ref pour que les effets ne se relancent pas (et ne volent pas le focus).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;

  // Focus initial + restauration : une seule fois par ouverture.
  useEffect(() => {
    restored.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (root) {
      const first = root.querySelector<HTMLElement>('[autofocus]') ?? focusable(root)[0];
      first?.focus();
    }
    return () => {
      restored.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = panel.current;
      if (e.key === 'Escape') {
        if (!dismissableRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = focusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (!head || !tail) return;
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div ref={panel} className={s.modal} style={{ width }} role="dialog" aria-modal aria-labelledby={titleId}>
        <i className={`${s.corner} ${s.tl}`} />
        <i className={`${s.corner} ${s.tr}`} />
        <i className={`${s.corner} ${s.bl}`} />
        <i className={`${s.corner} ${s.br}`} />
        <header className={s.head}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {sub && <span className={s.sub}>{sub}</span>}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={tr('Fermer', 'Close', 'Cerrar')}>
            <IconClose size={14} />
          </button>
        </header>
        <div className={s.body}>{children}</div>
        {footer && <footer className={s.foot}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
