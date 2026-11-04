import { acceleratorKeys } from '@/app/shortcuts';
import { tr } from '@/i18n';

/** Raccourci Electron (`CommandOrControl+Shift+K`) dit comme l'aide le dit, dans la langue du desk (OROS5.47a). */
export function shortcutLabel(accelerator: string): string {
  return acceleratorKeys(accelerator);
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
