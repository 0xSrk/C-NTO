import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '@/app/icons';
import s from './modal.module.css';

export function Modal({ title, sub, onClose, children, width = 560, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} style={{ width }} role="dialog" aria-modal>
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
