import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '@/app/icons';
import s from './modal.module.css';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export function Modal({ title, sub, onClose, children, width = 560, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const restored = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restored.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    const first = root ? focusable(root)[0] : undefined;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
    return () => {
      window.removeEventListener('keydown', onKey);
      restored.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={s.modal} style={{ width }} role="dialog" aria-modal>
        <i className={`${s.corner} ${s.tl}`} />
        <i className={`${s.corner} ${s.tr}`} />
        <i className={`${s.corner} ${s.bl}`} />
        <i className={`${s.corner} ${s.br}`} />
        <header className={s.head}>
          <div>
            <h2>{title}</h2>
            {sub && <span className={s.sub}>{sub}</span>}
          </div>
          <button className={s.close} onClick={onClose} aria-label="Fermer">
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
