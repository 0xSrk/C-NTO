import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { tr, useI18n } from '@/i18n';
import { Glyph, type GlyphName } from './Micro';
import { cx } from './primitives';
import p from './primitives.module.css';
import s from './optionsMenu.module.css';

/** Le code couleur d'une option : l'état qu'elle porte (vivant, en service, à surveiller, technique). */
export type OptionTone = 'gold' | 'mint' | 'ember' | 'ice';

export interface OptionItem {
  id: string;
  label: string;
  /** Le composant de la planche qui nomme l'option. */
  glyph?: GlyphName;
  tone?: OptionTone;
  /** Ce que l'option lit, à droite (« actif », « hors ligne »…). Une option qui lit un état le montre aussi sur le bouton. */
  state?: string;
  /** Interrupteur : l'option se coche et le menu reste ouvert. */
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  /** Ouvre un nouveau groupe : un filet la sépare de la précédente. */
  group?: boolean;
  onSelect: () => void;
}

/**
 * Bouton « Options » d'un module (4.1), en haut à droite : ses états se lisent sur le bouton par leur code couleur, et le
 * menu se déroule sous lui, fluide — chaque option glisse à son tour. Clavier : Entrée, Espace ou ↓ ouvrent sur la
 * première option, ↑ sur la dernière ; ↑ ↓ Début Fin parcourent ; Échap referme et rend la main au bouton ; Tab referme.
 */
export function OptionsMenu({ items, label, className }: { items: OptionItem[]; label?: string; className?: string }) {
  useI18n((st) => st.locale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  /** L'option qui prend le focus à l'ouverture : la première, ou la dernière quand ↑ ouvre le menu. */
  const openAt = useRef(0);
  const name = label ?? tr('Options', 'Options', 'Opciones');
  const marks = items.filter((item) => item.state !== undefined);

  const entries = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
  const focusAt = (index: number) => {
    const list = entries();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]?.focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  // Ouvert : un appui hors du menu le referme.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // À l'ouverture, la première option prend le focus (la dernière si ↑ a ouvert), après le rendu du menu.
  useEffect(() => {
    if (!open) return;
    focusAt(openAt.current);
    openAt.current = 0;
  }, [open]);

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAt.current = event.key === 'ArrowDown' ? 0 : -1;
      if (!open) setOpen(true);
      else focusAt(openAt.current);
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = entries();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(at - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const choose = (item: OptionItem) => {
    if (item.disabled) return;
    item.onSelect();
    if (item.checked === undefined) close(true);
  };

  return (
    <div ref={rootRef} className={cx(s.root, className)} data-options="">
      <button
        ref={buttonRef}
        type="button"
        className={cx(p.btn, s.trigger)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onButtonKey}
      >
        {name}
        {marks.length > 0 ? (
          <>
            <span className={s.marks} aria-hidden>
              {marks.map((item) => (
                <i key={item.id} className={cx(s.mark, item.tone && s[item.tone])} data-tone={item.tone ?? 'neutral'} />
              ))}
            </span>
            {/* Ce que les points montrent se dit aussi : le nom du bouton porte chaque état, sans ouvrir le menu. */}
            <span className={s.srOnly}>{marks.map((item) => ` · ${item.label} · ${item.state}`).join('')}</span>
          </>
        ) : null}
        <svg className={s.chevron} width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M1 2.75l3 3 3-3" />
        </svg>
      </button>
      <div ref={menuRef} id={menuId} className={s.menu} role="menu" aria-label={name} data-open={open} inert={!open} onKeyDown={onMenuKey}>
        {items.map((item, index) => (
          <div key={item.id} className={s.row} style={{ '--i': index } as CSSProperties}>
            {item.group && index > 0 ? <span className={s.sep} role="separator" /> : null}
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              className={cx(s.item, item.tone && s[item.tone])}
              disabled={item.disabled}
              title={item.title}
              tabIndex={-1}
              onClick={() => choose(item)}
            >
              {/* En tête : la coche, ou le composant ; sans composant, une option qui a une couleur la porte en point. */}
              <span className={s.lead} aria-hidden data-glyph={item.checked === undefined ? item.glyph : undefined}>
                {item.checked !== undefined ? (
                  <i className={cx(s.check, item.checked && s.checked)} />
                ) : item.glyph ? (
                  <Glyph name={item.glyph} className={s.glyph} />
                ) : item.tone ? (
                  <i className={cx(s.mark, s[item.tone])} data-tone={item.tone} />
                ) : null}
              </span>
              <span className={s.label}>{item.label}</span>
              {item.state !== undefined ? <span className={s.state}>{item.state}</span> : null}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
