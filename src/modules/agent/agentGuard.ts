import { tr } from '@/i18n';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** Raccourci Electron (`CommandOrControl+Shift+K`) dit comme au clavier : `Ctrl+Shift+K` (`Cmd` sur macOS). */
export function shortcutLabel(accelerator: string): string {
  return accelerator
    .split('+')
    .map((key) => {
      switch (key.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return MAC ? 'Cmd' : 'Ctrl';
        case 'command':
        case 'cmd':
          return 'Cmd';
        case 'control':
          return 'Ctrl';
        case 'option':
          return 'Alt';
        default:
          return key.length === 1 ? key.toUpperCase() : key;
      }
    })
    .join('+');
}

/**
 * Le kill switch tel que la notice des ordres le nomme (Système 4.1, plus de plaque AGENT_GUARD) : avec le raccourci que
 * le process principal annonce, sans raccourci quand il ne l'a pas dit (navigateur, pont absent) — jamais un raccourci écrit
 * à la main.
 */
export function killSwitchText(killShortcut: string | null | undefined): string {
  const name = tr('kill switch', 'kill switch', 'kill switch');
  return killShortcut ? `${name} (${shortcutLabel(killShortcut)})` : name;
}
