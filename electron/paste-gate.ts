/**
 * Le garde du collage du verrou (`window:paste`), tenu par le process principal.
 *
 * « Coller » fait entrer le presse-papiers dans le champ qui a le focus, comme Ctrl+V ; le renderer ne lit pas le
 * presse-papiers lui-même (la permission `clipboard-read` reste refusée). Le garde ne colle que juste après un geste
 * réel de l'opérateur, vu par le process principal sur `input-event` : un appui de souris, de touche ou du doigt donne
 * un jeton, que son relâchement garde vif tant qu'il n'a pas servi. Un appui ne vaut qu'un collage. Il ne sait pas quel
 * élément le geste visait : du code de la page pourrait encore profiter d'un geste de l'opérateur. Le canal se ferme
 * donc une fois le verrou passé, son seul appelant (`close`), et ne se rouvre qu'avec un document neuf, donc un verrou
 * neuf (`reset`, par `reopenOnNewDocument`).
 */

/** « Coller » n'est honoré que dans ce délai après un geste réel (ms). */
export const PASTE_GESTURE_MS = 1500;

/** Les appuis, tels qu'Electron les nomme sur `input-event` : chacun donne un jeton de collage. */
export const PASTE_PRESSES: ReadonlySet<string> = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchStart']);
/**
 * Les relâchements : ils ne donnent pas de jeton, ils gardent vif celui d'un appui qui n'a pas encore servi. Le clic part
 * au relâchement : un appui long ou Espace tenu se mesurent donc depuis `mouseUp` ou `keyUp` ; un toucher finit par
 * `touchEnd` et `gestureTap`. Un clic vaut ainsi un collage, pas deux : du code de la page qui colle à l'appui laisse
 * « Coller » sans jeton au relâchement, et le détournement se voit.
 */
export const PASTE_RELEASES: ReadonlySet<string> = new Set(['mouseUp', 'keyUp', 'touchEnd', 'gestureTap']);

/** La répétition d'une touche tenue, lue dans les modificateurs de l'événement d'entrée (`isAutoRepeat`). */
export function isAutoRepeat(input: { modifiers?: readonly string[] }): boolean {
  return !!input.modifiers?.some((m) => m.toLowerCase() === 'isautorepeat');
}

export interface PasteGate {
  /** Un événement d'entrée de la page `id`, relevé par `input-event` ; `repeat` pour la répétition d'une touche tenue. */
  gesture(id: number, type: string, repeat?: boolean): void;
  /** Le collage est-il honoré pour la page `id`, maintenant ? Il consomme le geste. */
  allow(id: number): boolean;
  /** Le verrou est passé : plus de collage pour cette page. */
  close(id: number): void;
  /** Un document neuf est arrivé (rechargement abouti) : il a son verrou, et le canal rouvert. */
  reset(id: number): void;
}

/** Ce que `reopenOnNewDocument` lit d'un `webContents` : un événement. */
export interface DocumentEvents {
  on(event: 'did-navigate', listener: () => void): unknown;
}

/**
 * Rouvre « Coller » quand un document neuf arrive dans le cadre principal (`did-navigate`, émis quand la navigation est
 * validée, rechargement compris ; jamais pour une ancre ni une navigation interrompue), donc avec un verrou neuf. Pas au
 * départ d'une navigation : la page qui a passé le verrou pourrait en lancer une, l'interrompre, et rouvrir ainsi le
 * canal pour elle-même.
 */
export function reopenOnNewDocument(contents: DocumentEvents, gate: PasteGate, id: number): void {
  contents.on('did-navigate', () => gate.reset(id));
}

export function createPasteGate(now: () => number = Date.now): PasteGate {
  /** Le jeton de chaque page : l'instant de son dernier appui (ou relâchement), et s'il a servi. */
  const tokens = new Map<number, { at: number; spent: boolean }>();
  const closed = new Set<number>();
  return {
    gesture(id, type, repeat = false) {
      const token = tokens.get(id);
      if (PASTE_PRESSES.has(type) && !repeat) tokens.set(id, { at: now(), spent: false });
      else if ((PASTE_RELEASES.has(type) || (repeat && PASTE_PRESSES.has(type))) && token && !token.spent) token.at = now();
    },
    allow(id) {
      if (closed.has(id)) return false;
      const token = tokens.get(id);
      if (!token || token.spent || now() - token.at > PASTE_GESTURE_MS) return false;
      token.spent = true;
      return true;
    },
    close(id) {
      closed.add(id);
      tokens.delete(id);
    },
    reset(id) {
      closed.delete(id);
      tokens.delete(id);
    },
  };
}
