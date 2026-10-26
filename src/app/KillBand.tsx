import { Cartouche, Plate } from '@/design/Micro';
import { tr, useI18n } from '@/i18n';
import s from './shell.module.css';

/** « CommandOrControl+Shift+K » (raccourci du process principal) tel que le clavier le porte. */
export function shortcutLabel(accelerator: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, mac ? '⌘' : 'Ctrl');
}

/**
 * Bande de niveau 3 sous la barre de titre (Système 4.0) : le kill switch est engagé. La cartouche SK-SIG-3 est le seul
 * rouge ; le texte reste ivoire ; la plaque critique dit ce qui est fermé. Jamais animée.
 */
export function KillBand({ shortcut = 'CommandOrControl+Shift+K' }: { shortcut?: string }) {
  useI18n((st) => st.locale);
  return (
    <div className={s.band} role="alert">
      <Cartouche id="signal3" className={s.bandSignal} />
      <div className={s.bandText}>
        <b>{tr('Kill switch engagé', 'Kill switch engaged', 'Kill switch activado')}</b>
        <span>
          {tr('Soumission fermée jusqu’au redémarrage du desk', 'Submission closed until the desk restarts', 'Envío cerrado hasta reiniciar el desk')} · {shortcutLabel(shortcut)}
        </span>
      </div>
      <Plate id="critical" className={s.bandPlate} />
    </div>
  );
}
