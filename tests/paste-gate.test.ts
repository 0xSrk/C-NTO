import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPasteGate, PASTE_GESTURE_MS } from '../electron/paste-gate';

function gateAt(start = 10_000) {
  let clock = start;
  const gate = createPasteGate(() => clock);
  return { gate, advance: (ms: number) => (clock += ms) };
}

describe('OROS4.36 le garde du collage du verrou, dans le process principal', () => {
  it('sans geste réel, rien n’est collé ; un geste vaut un collage, dans le délai seulement', () => {
    const { gate, advance } = gateAt();
    expect(gate.allow(1)).toBe(false);
    gate.gesture(1, 'mouseDown');
    advance(PASTE_GESTURE_MS);
    expect(gate.allow(1)).toBe(true);
    // le geste est consommé
    expect(gate.allow(1)).toBe(false);
    gate.gesture(1, 'keyDown');
    advance(PASTE_GESTURE_MS + 1);
    expect(gate.allow(1)).toBe(false);
  });

  it('le clic part au relâchement : un appui long et Espace tenu passent, comme le toucher', () => {
    const { gate, advance } = gateAt();
    // appui long de 1,6 s : l'appui est trop ancien, le relâchement compte
    gate.gesture(1, 'mouseDown');
    advance(1600);
    gate.gesture(1, 'mouseUp');
    expect(gate.allow(1)).toBe(true);
    // Espace tenu 1,6 s, sans répétition
    gate.gesture(1, 'keyDown');
    advance(1600);
    gate.gesture(1, 'keyUp');
    expect(gate.allow(1)).toBe(true);
    // un toucher : touchStart, gestureTapDown, touchEnd, gestureShowPress, gestureTap
    for (const type of ['touchStart', 'gestureTapDown']) gate.gesture(1, type);
    expect(gate.allow(1)).toBe(false);
    for (const type of ['touchEnd', 'gestureShowPress', 'gestureTap']) gate.gesture(1, type);
    expect(gate.allow(1)).toBe(true);
  });

  it('un déplacement, une molette ou un survol ne sont pas des gestes ; chaque page a les siens', () => {
    const { gate } = gateAt();
    for (const type of ['mouseMove', 'mouseEnter', 'mouseWheel', 'gestureScrollUpdate', 'char', 'contextMenu']) gate.gesture(1, type);
    expect(gate.allow(1)).toBe(false);
    gate.gesture(2, 'mouseDown');
    expect(gate.allow(1)).toBe(false);
    expect(gate.allow(2)).toBe(true);
  });

  it('OROS4.37 le verrou passé, le canal se ferme ; une page neuve, donc un verrou neuf, le rouvre', () => {
    const { gate } = gateAt();
    gate.gesture(1, 'mouseDown');
    gate.close(1);
    expect(gate.allow(1)).toBe(false);
    // plus aucun geste ne le rouvre : c'est là qu'il protège, pendant toute la séance
    gate.gesture(1, 'mouseUp');
    gate.gesture(1, 'keyDown');
    expect(gate.allow(1)).toBe(false);
    // les autres pages ne sont pas touchées
    gate.gesture(2, 'mouseDown');
    expect(gate.allow(2)).toBe(true);
    // la page s'en va (rechargement, rendu perdu) : la suivante a son verrou, et son collage
    gate.reset(1);
    expect(gate.allow(1)).toBe(false);
    gate.gesture(1, 'mouseDown');
    expect(gate.allow(1)).toBe(true);
  });

  it('OROS4.37 la fermeture est nommée au preload, gardée par trusted(e), et la page qui part rouvre le canal pour la suivante', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(preload).toContain("pasteClose: () => ipcRenderer.send('window:paste-close'),");
    const close = main.slice(main.indexOf("ipcMain.on('window:paste-close'"), main.indexOf('});', main.indexOf("ipcMain.on('window:paste-close'")));
    expect(close).toMatch(/if \(!trusted\(e\)\) return;\s*pasteGate\.close\(e\.sender\.id\);/);
    expect(main).toMatch(/onPageLeft\(win\.webContents, deskUrl, \(\) => \{[^}]*pasteGate\.reset\(deskContents\.id\);/);
  });

  it('le process principal s’en sert : chaque événement d’entrée du desk lui est donné, le collage lui est demandé', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toContain("import { createPasteGate } from './paste-gate';");
    expect(main).toMatch(/deskContents\.on\('input-event', \(_event, input\) => \{\s*pasteGate\.gesture\(deskContents\.id, input\.type\);/);
    expect(main).not.toMatch(/lastGesture|PASTE_GESTURE_MS = /);
  });
});
