/**
 * Le garde du collage du verrou (`window:paste`), tenu par le process principal.
 *
 * « Coller » fait entrer le presse-papiers dans le champ qui a le focus, comme Ctrl+V ; le renderer ne lit jamais le
 * presse-papiers lui-même (la permission `clipboard-read` reste refusée). Le garde ne colle que juste après un geste réel
 * de l'opérateur, vu par le process principal sur `input-event` : appui ou relâchement de souris ou de touche, toucher.
 * Un geste ne vaut qu'un collage. Il ne sait pas quel élément le geste visait : du code de la page pourrait encore
 * profiter d'un geste de l'opérateur. Le canal se ferme donc une fois le verrou passé, son seul appelant (`close`), et ne
 * se rouvre qu'avec une page neuve, donc un verrou neuf (`reset`).
 */

/** « Coller » n'est honoré que dans ce délai après un geste réel (ms). */
export const PASTE_GESTURE_MS = 1500;

/**
 * Les gestes qui comptent, tels qu'Electron les nomme sur `input-event`. Le clic part au relâchement : un appui long ou
 * Espace tenu se mesurent donc depuis `mouseUp` ou `keyUp` ; un toucher n'émet que `touchEnd` et `gestureTap`.
 */
export const PASTE_GESTURES: ReadonlySet<string> = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'keyUp', 'touchEnd', 'gestureTap']);

export interface PasteGate {
  /** Un événement d'entrée de la page `id`, relevé par `input-event`. */
  gesture(id: number, type: string): void;
  /** Le collage est-il honoré pour la page `id`, maintenant ? Il consomme le geste. */
  allow(id: number): boolean;
  /** Le verrou est passé : plus de collage pour cette page. */
  close(id: number): void;
  /** La page s'en va (rechargement, rendu perdu) : la suivante a son verrou, et le canal rouvert. */
  reset(id: number): void;
}

export function createPasteGate(now: () => number = Date.now): PasteGate {
  const last = new Map<number, number>();
  const closed = new Set<number>();
  return {
    gesture(id, type) {
      if (PASTE_GESTURES.has(type)) last.set(id, now());
    },
    allow(id) {
      if (closed.has(id)) return false;
      const at = last.get(id);
      if (at === undefined || now() - at > PASTE_GESTURE_MS) return false;
      last.delete(id);
      return true;
    },
    close(id) {
      closed.add(id);
      last.delete(id);
    },
    reset(id) {
      closed.delete(id);
      last.delete(id);
    },
  };
}
