import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { deskUrlAllowed, onPageLeft } from '../electron/page-left';

const INDEX = 'file:///opt/canto/dist/index.html';
const allowed = (url: string) => deskUrlAllowed(url, undefined, INDEX);

describe('départ de la page du desk', () => {
  it('rechargement ou navigation du cadre principal vers le desk, et processus de rendu perdu : release appelé', () => {
    const contents = new EventEmitter();
    const release = vi.fn();
    onPageLeft(contents, allowed, release);

    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: `${INDEX}?lang=fr#from-launcher` });
    expect(release).toHaveBeenCalledTimes(1);
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(release).toHaveBeenCalledTimes(2);
    contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('navigation que le desk refuse (lien https d’une note ou d’une réponse de l’agent, autre fichier) : la page reste, rien n’est fermé', () => {
    // Electron émet did-start-navigation avant will-navigate, qui l'annule ensuite : la page ne part pas.
    const contents = new EventEmitter();
    const release = vi.fn();
    onPageLeft(contents, allowed, release);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://example.com/source' });
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///opt/canto/dist/other.html' });
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: `${INDEX}.evil` });
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(release).not.toHaveBeenCalled();
  });

  it('ancre dans le même document, cadre secondaire ou événement illisible : la page reste, rien n’est fermé', () => {
    const contents = new EventEmitter();
    const release = vi.fn();
    onPageLeft(contents, allowed, release);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: `${INDEX}#x` });
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: INDEX });
    contents.emit('did-start-navigation', null);
    contents.emit('did-start-navigation');
    expect(release).not.toHaveBeenCalled();
  });

  it('un release qui lève n’empêche ni les suivants ni la navigation', () => {
    const contents = new EventEmitter();
    const after = vi.fn();
    onPageLeft(contents, allowed, () => {
      throw new Error('runtime absent');
    });
    contents.on('did-start-navigation', after);
    expect(() => contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: INDEX })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('règle du desk : index.html avec sa requête ou son ancre ; en développement, l’URL du serveur Vite', () => {
    expect(allowed(INDEX)).toBe(true);
    expect(allowed(`${INDEX}?lang=en`)).toBe(true);
    expect(allowed(`${INDEX}#from-launcher`)).toBe(true);
    expect(allowed(`${INDEX}x`)).toBe(false);
    expect(allowed('https://example.com/')).toBe(false);
    expect(deskUrlAllowed('http://localhost:5173/?lang=fr', 'http://localhost:5173/', INDEX)).toBe(true);
    expect(deskUrlAllowed('https://example.com/', 'http://localhost:5173/', INDEX)).toBe(false);
  });

  it('OROS4.55 en développement, la règle compare l’origine du serveur Vite, pas un préfixe : un autre hôte ou un autre port ne passent plus', () => {
    for (const dev of ['http://127.0.0.1:5173', 'http://127.0.0.1:5173/']) {
      expect(deskUrlAllowed('http://127.0.0.1:5173/', dev, INDEX), dev).toBe(true);
      expect(deskUrlAllowed('http://127.0.0.1:5173/?lang=en#x', dev, INDEX), dev).toBe(true);
      // ce qu'un préfixe de chaîne laissait passer
      expect(deskUrlAllowed('http://127.0.0.1:5173@ailleurs.example/', dev, INDEX), dev).toBe(false);
      expect(deskUrlAllowed('http://127.0.0.1:51730/', dev, INDEX), dev).toBe(false);
      expect(deskUrlAllowed('http://127.0.0.1:5173.ailleurs.example/', dev, INDEX), dev).toBe(false);
      expect(deskUrlAllowed('http://personne@127.0.0.1:5173/', dev, INDEX), dev).toBe(false);
      expect(deskUrlAllowed('https://127.0.0.1:5173/', dev, INDEX), dev).toBe(false);
      expect(deskUrlAllowed('pas une adresse', dev, INDEX), dev).toBe(false);
    }
  });

  it('electron/main.ts : will-navigate et le départ de la page lisent la même règle ; la fenêtre ferme les abonnements sans éteindre l’interrupteur', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const create = main.slice(main.indexOf('function createWindow('), main.indexOf('const chromiumLang'));
    expect(create).toMatch(/const deskUrl = \(url: string\): boolean => deskUrlAllowed\(url, DEV_URL, indexUrl\);/);
    expect(create).toMatch(/on\('will-navigate', \(event, url\) => \{\s*if \(!deskUrl\(url\)\) event\.preventDefault\(\);/);
    const wiring = create.slice(create.indexOf('onPageLeft(win.webContents, deskUrl, '));
    expect(wiring.length).toBeLessThan(create.length);
    expect(wiring.slice(0, 400)).toContain('cryptoRuntime?.releaseSubscriptions();');
    expect(wiring.slice(0, 400)).not.toContain('disable');
  });
});
