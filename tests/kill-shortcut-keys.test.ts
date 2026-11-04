/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { shortcutLabel as bandKeys } from '@/app/KillBand';
import { KILL_SHORTCUT_FALLBACK } from '@/app/killState';
import { acceleratorKeys, SHORTCUTS } from '@/app/shortcuts';
import { killSwitchText, shortcutLabel as noticeKeys } from '@/modules/agent/agentGuard';
import { useI18n } from '@/i18n';

/**
 * OROS5.47a — sous Electron, la bande du kill switch disait « Ctrl+Shift+K » en français et en espagnol, quand l'aide
 * (« ? ») dit « Ctrl+Maj+K » et « Ctrl+Mayús+K » : deux écritures des mêmes touches. Le raccourci du process principal
 * s'écrit désormais une fois, dans la langue du desk, par le registre des raccourcis ; la bande, la notice des ordres de
 * l'agent et le verrou le lisent.
 */
afterEach(() => useI18n.setState({ locale: 'fr' }));

const said = (fn: () => string) =>
  (['fr', 'en', 'es'] as const).map((locale) => {
    useI18n.setState({ locale });
    return fn();
  });

describe('OROS5.47a · les touches du process principal, écrites une fois', () => {
  it('Ctrl+Maj+K, Ctrl+Shift+K, Ctrl+Mayús+K : la bande, la notice et l’aide disent les mêmes touches', () => {
    expect(said(() => acceleratorKeys('CommandOrControl+Shift+K'))).toEqual(['Ctrl+Maj+K', 'Ctrl+Shift+K', 'Ctrl+Mayús+K']);
    expect(said(() => bandKeys('CommandOrControl+Shift+K'))).toEqual(['Ctrl+Maj+K', 'Ctrl+Shift+K', 'Ctrl+Mayús+K']);
    expect(said(() => noticeKeys('CommandOrControl+Shift+K'))).toEqual(['Ctrl+Maj+K', 'Ctrl+Shift+K', 'Ctrl+Mayús+K']);
    expect(said(() => killSwitchText('CommandOrControl+Shift+K'))).toEqual(['kill switch (Ctrl+Maj+K)', 'kill switch (Ctrl+Shift+K)', 'kill switch (Ctrl+Mayús+K)']);
    const help = SHORTCUTS.find((x) => x.id === 'killSwitch')!;
    expect(said(() => help.keys())).toEqual(said(() => bandKeys(KILL_SHORTCUT_FALLBACK)));
    // Sans raccourci annoncé, la notice n'en invente aucun.
    expect(killSwitchText(null)).toBe('kill switch');
  });

  it('les autres touches restent ce qu’elles sont : Ctrl+V au verrou, Alt, une lettre en capitale', () => {
    expect(said(() => acceleratorKeys('CommandOrControl+V'))).toEqual(['Ctrl+V', 'Ctrl+V', 'Ctrl+V']);
    expect(acceleratorKeys('Control+Alt+k')).toBe('Ctrl+Alt+K');
    expect(acceleratorKeys('CmdOrCtrl+Option+F6')).toBe('Ctrl+Alt+F6');
  });
});
