import type { CursorMove } from '@/lib/frise';
import { tr } from '@/i18n';
import { KILL_SHORTCUT_FALLBACK } from './killState';

/**
 * Le registre des raccourcis du desk (OROS5.18, Système 5 « Fiche et Frise » ; correction du juge Palantir, AF7, et du
 * juge trader) : un seul, lu par chaque gestionnaire et par l'aide (« ? »). Un gestionnaire ne compare aucune touche
 * lui-même : il demande au registre ce qu'une touche veut dire dans sa portée (`matchShortcut`). Ce que le registre ne
 * connaît pas, aucun gestionnaire ne l'écoute ; ce qu'il recense, un gestionnaire l'écoute (tests/shortcut-help.test.ts).
 *
 * Ctrl+J, jamais Ctrl+K : Ctrl+Maj+K est le kill switch du process principal, que le registre ne fait que dire (lecture
 * seule) ; aucun gestionnaire du renderer ne le lit.
 */

/** Où la touche agit : le châssis, le zoom de la barre de titre, l'omnibar, la fiche, le curseur de temps, le registre, Note, le process principal. */
export type ShortcutScope = 'desk' | 'zoom' | 'omnibar' | 'fiche' | 'frise' | 'registre' | 'note' | 'main';

/**
 * Une combinaison de touches. `key` se compare à `KeyboardEvent.key` (une lettre sans casse) ; `code`, à
 * `KeyboardEvent.code`, quand la touche se lit par sa place (les chiffres du rail, quelle que soit la disposition).
 * Un modificateur absent est interdit ; `'any'` l'accepte, présent ou non.
 */
export interface Chord {
  key?: string;
  code?: string;
  /** Ctrl, ou Cmd sous macOS. */
  mod?: boolean;
  shift?: boolean | 'any';
  alt?: boolean | 'any';
}

export interface Shortcut {
  id: string;
  scope: ShortcutScope;
  chords: readonly Chord[];
  /** Les touches, telles que l'aide les écrit, dans la langue du desk. */
  keys: () => string;
  /** Ce que fait la touche, dans la langue du desk. */
  label: () => string;
  /** Écouté par le process principal, hors du renderer : le registre le dit, aucun gestionnaire ne le lit. */
  readOnly?: true;
  /** Répond aussi sous le verrou (le zoom, qui sert la fenêtre du verrou, et les modules du rail, comme avant). */
  underLock?: true;
}

const mac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
/** Ctrl, ou ⌘ sous macOS : `mod` accepte l'un ou l'autre. */
export const modKey = () => (mac() ? '⌘' : 'Ctrl');
const shiftKey = () => tr('Maj', 'Shift', 'Mayús');
const escKey = () => tr('Échap', 'Esc', 'Esc');
const enterKey = () => tr('Entrée', 'Enter', 'Intro');

const digits = Array.from({ length: 9 }, (_, i) => ({ code: `Digit${i + 1}`, mod: true }) satisfies Chord);

/** Ctrl+Maj+K, tel que le process principal l'enregistre (`KILL_SWITCH_SHORTCUT`, electron/nt-bridge/index.ts). */
export function chordOfAccelerator(accelerator: string): Chord {
  const parts = accelerator.split('+');
  const key = parts.at(-1)!.toLowerCase();
  return { key, mod: parts.some((p) => /^(CommandOrControl|CmdOrCtrl|Control|Ctrl|Command|Cmd)$/i.test(p)), shift: parts.some((p) => /^shift$/i.test(p)), alt: parts.some((p) => /^(alt|option)$/i.test(p)) };
}

export const SHORTCUTS: readonly Shortcut[] = [
  // Le châssis (src/app/Shell.tsx).
  { id: 'module', scope: 'desk', chords: digits, underLock: true, keys: () => `${modKey()}+1 … 9`, label: () => tr('Ouvrir un module du rail', 'Open a rail module', 'Abrir un módulo del riel') },
  { id: 'omnibar', scope: 'desk', chords: [{ key: 'j', mod: true }], keys: () => `${modKey()}+J`, label: () => tr('Aller à un objet ou à un module (omnibar)', 'Go to an object or a module (omnibar)', 'Ir a un objeto o a un módulo (omnibar)') },
  { id: 'help', scope: 'desk', chords: [{ key: '?', shift: 'any' }], keys: () => '?', label: () => tr('Cette aide, hors d’un champ', 'This help, outside a field', 'Esta ayuda, fuera de un campo') },
  {
    id: 'zones',
    scope: 'desk',
    chords: [{ key: 'F6' }, { key: 'F6', shift: true }],
    keys: () => `F6 · ${shiftKey()}+F6`,
    label: () => tr('Passer au rail, à la zone de travail, à la fiche, à la barre d’état', 'Move to the rail, the work area, the record, the status bar', 'Pasar al riel, a la zona de trabajo, a la ficha, a la barra de estado'),
  },
  { id: 'close', scope: 'desk', chords: [{ key: 'Escape', shift: 'any' }], keys: escKey, label: () => tr('Fermer la fiche et rendre le focus à la ligne d’origine', 'Close the record and return focus to its row', 'Cerrar la ficha y devolver el foco a su línea') },
  { id: 'back', scope: 'desk', chords: [{ key: 'Backspace' }], keys: () => tr('Retour arrière', 'Backspace', 'Retroceso'), label: () => tr('Défaire le dernier saut : le module, sa vue, la fiche et le fil reviennent', 'Undo the last jump: module, view, record and trail come back', 'Deshacer el último salto: vuelven el módulo, su vista, la ficha y el hilo') },
  // Le zoom de la barre de titre (src/app/ZoomControls.tsx).
  { id: 'zoomIn', scope: 'zoom', chords: [{ key: '=', mod: true, shift: 'any' }, { key: '+', mod: true, shift: 'any' }], underLock: true, keys: () => `${modKey()}++`, label: () => tr('Agrandir l’interface', 'Zoom the interface in', 'Ampliar la interfaz') },
  { id: 'zoomOut', scope: 'zoom', chords: [{ key: '-', mod: true, shift: 'any' }], underLock: true, keys: () => `${modKey()}+−`, label: () => tr('Réduire l’interface', 'Zoom the interface out', 'Reducir la interfaz') },
  { id: 'zoomReset', scope: 'zoom', chords: [{ key: '0', mod: true, shift: 'any' }], underLock: true, keys: () => `${modKey()}+0`, label: () => tr('Revenir au zoom automatique', 'Back to automatic zoom', 'Volver al zoom automático') },
  // La fiche, quand elle a le focus (src/app/objects/Fiche.tsx).
  { id: 'neighbor', scope: 'fiche', chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }], keys: () => '↑ ↓', label: () => tr('Passer à l’objet voisin de la liste, sans fermer', 'Move to the neighbouring object of the list, without closing', 'Pasar al objeto vecino de la lista, sin cerrar') },
  // L'omnibar (src/app/objects/Omnibar.tsx).
  { id: 'choose', scope: 'omnibar', chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }], keys: () => '↑ ↓', label: () => tr('Choisir un résultat', 'Choose a result', 'Elegir un resultado') },
  { id: 'open', scope: 'omnibar', chords: [{ key: 'Enter' }], keys: enterKey, label: () => tr('Ouvrir le module ou la fiche', 'Open the module or the record', 'Abrir el módulo o la ficha') },
  { id: 'dismiss', scope: 'omnibar', chords: [{ key: 'Escape', shift: 'any' }, { key: 'j', mod: true }], keys: () => `${escKey()} · ${modKey()}+J`, label: () => tr('Fermer et rendre le focus', 'Close and return focus', 'Cerrar y devolver el foco') },
  { id: 'stay', scope: 'omnibar', chords: [{ key: 'Tab', shift: 'any' }], keys: () => 'Tab', label: () => tr('Le focus reste au champ', 'Focus stays in the field', 'El foco se queda en el campo') },
  // Le curseur de temps, au tiroir de la frise (OROS5.24 ; le modèle : `moveCursor`, src/lib/frise.ts).
  { id: 'cursorStep', scope: 'frise', chords: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }], keys: () => '← →', label: () => tr('Déplacer le curseur de 5 min', 'Move the cursor by 5 min', 'Mover el cursor 5 min') },
  { id: 'cursorHour', scope: 'frise', chords: [{ key: 'ArrowLeft', shift: true }, { key: 'ArrowRight', shift: true }], keys: () => `${shiftKey()}+← →`, label: () => tr('Déplacer le curseur d’une heure', 'Move the cursor by one hour', 'Mover el cursor una hora') },
  { id: 'cursorDay', scope: 'frise', chords: [{ key: 'PageUp' }, { key: 'PageDown' }], keys: () => tr('Pg préc. · Pg suiv.', 'PgUp · PgDn', 'RePág · AvPág'), label: () => tr('Journée ouvrée précédente ou suivante', 'Previous or next trading day', 'Jornada hábil anterior o siguiente') },
  { id: 'cursorEdge', scope: 'frise', chords: [{ key: 'Home' }, { key: 'End' }], keys: () => tr('Début · Fin', 'Home · End', 'Inicio · Fin'), label: () => tr('Début ou fin de la journée', 'Start or end of the day', 'Inicio o fin de la jornada') },
  { id: 'cursorPresent', scope: 'frise', chords: [{ key: 'Escape' }], keys: escKey, label: () => tr('Rendre le présent', 'Back to the present', 'Volver al presente') },
  { id: 'cursorOpen', scope: 'frise', chords: [{ key: 'Enter' }], keys: enterKey, label: () => tr('Ouvrir la fiche de l’objet sous le curseur', 'Open the record of the object under the cursor', 'Abrir la ficha del objeto bajo el cursor') },
  // Le registre, en tiroir bas, quand sa liste a le focus (OROS5.38 ; src/app/RegistreDrawer.tsx).
  { id: 'registreChoose', scope: 'registre', chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }], keys: () => '↑ ↓', label: () => tr('Choisir une ligne du registre', 'Choose a log line', 'Elegir una línea del registro') },
  { id: 'registreOpen', scope: 'registre', chords: [{ key: 'Enter' }], keys: enterKey, label: () => tr('Ouvrir la fiche de l’objet de la ligne', 'Open the record of the line’s object', 'Abrir la ficha del objeto de la línea') },
  { id: 'registreClose', scope: 'registre', chords: [{ key: 'Escape', shift: 'any' }], keys: escKey, label: () => tr('Fermer le registre et rendre le focus', 'Close the log and return focus', 'Cerrar el registro y devolver el foco') },
  // Note (src/modules/note/Note.tsx).
  { id: 'newNote', scope: 'note', chords: [{ key: 'n', mod: true, alt: 'any' }], keys: () => `${modKey()}+N`, label: () => tr('Nouvelle note, dans Note', 'New note, in Note', 'Nueva nota, en Nota') },
  // Le process principal, en lecture seule.
  {
    id: 'killSwitch',
    scope: 'main',
    chords: [chordOfAccelerator(KILL_SHORTCUT_FALLBACK)],
    readOnly: true,
    keys: () => `${modKey()}+${shiftKey()}+K`,
    label: () => tr('Kill switch : aplatir et fermer la soumission jusqu’au redémarrage (process principal)', 'Kill switch: flatten and close submission until restart (main process)', 'Kill switch: aplanar y cerrar el envío hasta reiniciar (proceso principal)'),
  },
];

/** Une touche répond-elle à une combinaison ? */
export function chordMatches(chord: Chord, event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (chord.code !== undefined && event.code !== chord.code) return false;
  if (chord.key !== undefined && (event.key ?? '').toLowerCase() !== chord.key.toLowerCase()) return false;
  if (chord.key === undefined && chord.code === undefined) return false;
  const mod = event.ctrlKey || event.metaKey;
  if (mod !== (chord.mod ?? false)) return false;
  if ((chord.shift ?? false) !== 'any' && event.shiftKey !== (chord.shift ?? false)) return false;
  if ((chord.alt ?? false) !== 'any' && event.altKey !== (chord.alt ?? false)) return false;
  return true;
}

/** Ce qu'une touche veut dire dans une portée : le raccourci et la combinaison (son rang), ou rien. Jamais un raccourci en lecture seule. */
export function matchShortcut(scope: ShortcutScope, event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): { id: string; index: number; shortcut: Shortcut } | null {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.scope !== scope || shortcut.readOnly) continue;
    const index = shortcut.chords.findIndex((chord) => chordMatches(chord, event));
    if (index >= 0) return { id: shortcut.id, index, shortcut };
  }
  return null;
}

/** Le pas du curseur de temps qu'une touche demande (`moveCursor`, src/lib/frise.ts), ou rien : le tiroir de la frise le lit. */
export function cursorMoveOf(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): CursorMove | null {
  const hit = matchShortcut('frise', event);
  if (!hit) return null;
  const moves: Readonly<Record<string, readonly CursorMove[]>> = {
    cursorStep: ['left', 'right'],
    cursorHour: ['hourLeft', 'hourRight'],
    cursorDay: ['dayBack', 'dayForward'],
    cursorEdge: ['home', 'end'],
  };
  return moves[hit.id]?.[hit.index] ?? null;
}

/** Les sections de l'aide, dans l'ordre où elle les dit. */
export const HELP_SECTIONS: readonly { scope: ShortcutScope; title: () => string }[] = [
  { scope: 'desk', title: () => tr('Partout', 'Everywhere', 'En todas partes') },
  { scope: 'zoom', title: () => tr('Zoom', 'Zoom', 'Zoom') },
  { scope: 'fiche', title: () => tr('La fiche', 'The record', 'La ficha') },
  { scope: 'omnibar', title: () => tr('L’omnibar', 'The omnibar', 'El omnibar') },
  { scope: 'frise', title: () => tr('Le curseur de temps, au tiroir de la frise', 'The time cursor, in the timeline drawer', 'El cursor de tiempo, en el cajón de la frisa') },
  { scope: 'registre', title: () => tr('Le registre, en tiroir bas', 'The log, in the bottom drawer', 'El registro, en el cajón inferior') },
  { scope: 'note', title: () => tr('Note', 'Note', 'Nota') },
  { scope: 'main', title: () => tr('Le process principal, en lecture seule', 'The main process, read-only', 'El proceso principal, solo lectura') },
];

/** Comment atteindre la barre d'état au clavier : l'aide le dit (juge trader). */
export const statusBarHint = () =>
  tr(
    'La barre d’état : F6 y mène depuis le rail, la zone de travail ou la fiche ; Tab parcourt ensuite ses cellules.',
    'The status bar: F6 leads there from the rail, the work area or the record; Tab then walks its cells.',
    'La barra de estado: F6 lleva a ella desde el riel, la zona de trabajo o la ficha; Tab recorre luego sus celdas.',
  );
