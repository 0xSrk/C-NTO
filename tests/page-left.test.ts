import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { onPageLeft } from '../electron/page-left';

describe('départ de la page du desk', () => {
  it('rechargement ou navigation du cadre principal vers un autre document, et processus de rendu perdu : release appelé', () => {
    const contents = new EventEmitter();
    const release = vi.fn();
    onPageLeft(contents, release);

    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///dist/index.html' });
    expect(release).toHaveBeenCalledTimes(1);
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(release).toHaveBeenCalledTimes(2);
    contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('ancre dans le même document, cadre secondaire ou événement illisible : la page reste, rien n’est fermé', () => {
    const contents = new EventEmitter();
    const release = vi.fn();
    onPageLeft(contents, release);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    contents.emit('did-start-navigation', null);
    contents.emit('did-start-navigation');
    expect(release).not.toHaveBeenCalled();
  });

  it('un release qui lève n’empêche ni les suivants ni la navigation', () => {
    const contents = new EventEmitter();
    const after = vi.fn();
    onPageLeft(contents, () => {
      throw new Error('runtime absent');
    });
    contents.on('did-start-navigation', after);
    expect(() => contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('electron/main.ts : la fenêtre du desk ferme les abonnements crypto de la page qui s’en va, sans éteindre l’interrupteur', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const create = main.slice(main.indexOf('function createWindow('), main.indexOf('const chromiumLang'));
    const wiring = create.slice(create.indexOf('onPageLeft(win.webContents, '));
    expect(wiring.slice(0, 400)).toContain('cryptoRuntime?.releaseSubscriptions();');
    expect(wiring.slice(0, 400)).not.toContain('disable');
  });
});
