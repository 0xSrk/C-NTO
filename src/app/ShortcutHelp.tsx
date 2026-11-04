import { create } from 'zustand';
import { Modal } from '@/design/Modal';
import { tr, useI18n } from '@/i18n';
import { HELP_SECTIONS, SHORTCUTS, statusBarHint } from './shortcuts';
import s from './shortcutHelp.module.css';

/** L'aide des raccourcis est ouverte : « ? » l'ouvre (le châssis), Échap la ferme (la fenêtre). En mémoire seulement. */
export const useShortcutHelp = create<{ open: boolean }>(() => ({ open: false }));

/**
 * L'aide des raccourcis (OROS5.18) : tirée du registre unique (`src/app/shortcuts.ts`), section par portée, dans la langue
 * du desk ; elle dit aussi comment atteindre la barre d'état. Elle ne fait que lire.
 */
export function ShortcutHelp() {
  useI18n((st) => st.locale);
  const open = useShortcutHelp((h) => h.open);
  if (!open) return null;
  return (
    <Modal title={tr('Raccourcis du desk', 'Desk shortcuts', 'Atajos del desk')} sub={tr('« ? » ouvre cette aide', '“?” opens this help', '«?» abre esta ayuda')} onClose={() => useShortcutHelp.setState({ open: false })} width={640}>
      <div className={s.help} data-help>
        {HELP_SECTIONS.map((section) => (
          <section key={section.scope} className={s.section} data-help-scope={section.scope}>
            <h3>{section.title()}</h3>
            <dl>
              {SHORTCUTS.filter((shortcut) => shortcut.scope === section.scope).map((shortcut) => (
                <div key={shortcut.id} className={s.row} data-shortcut={shortcut.id}>
                  <dt>
                    <kbd>{shortcut.keys()}</kbd>
                  </dt>
                  <dd>{shortcut.label()}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className={s.hint} data-help-status>
          {statusBarHint()}
        </p>
      </div>
    </Modal>
  );
}
