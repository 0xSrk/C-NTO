import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SEC1.5 — l'installeur vérifié est celui qui s'exécute. La mise à jour téléchargeait dans un dossier au nom fixe du
 * dossier temporaire (`canto-update`, partagé entre comptes sous Linux), sous le nom donné par la Release, et lançait
 * plus tard le fichier relu du disque : un dossier ou un lien posé d'avance, ou un fichier remplacé après la vérification,
 * passaient. Le téléchargement va dans un dossier neuf et privé (`mkdtemp`), sous un nom de fichier simple, et l'empreinte
 * est refaite sur ce qui part : la copie de l'AppImage, l'installeur Windows juste avant son lancement.
 */
const electron = vi.hoisted(() => ({ fetch: vi.fn(), temp: '', openPath: vi.fn(async () => ''), quit: vi.fn(), exit: vi.fn(), release: vi.fn() }));
const child = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: () => undefined })) }));
vi.mock('electron', () => ({
  net: { fetch: electron.fetch, request: vi.fn() },
  app: { getPath: () => electron.temp, getVersion: () => '0.0.0', quit: electron.quit, exit: electron.exit, releaseSingleInstanceLock: electron.release },
  shell: { openPath: electron.openPath, openExternal: vi.fn() },
}));
vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), spawn: child.spawn }));
// Sans clé embarquée, l'empreinte de SHA256SUMS.txt fait foi : le test porte sur le fichier, pas sur la signature.
vi.mock('../electron/release-keys', () => ({ RELEASE_PUBLIC_KEYS: [] }));

import { applyInstallerUpdate, performPendingRestart } from '../electron/native-update';
import { relaunchDesk } from '../electron/updater';

const REPO = '0xSrk/C-NTO';
const DL = `https://github.com/${REPO}/releases/download/v9.9.0`;
const BODY = 'installeur vérifié';
const SHA = createHash('sha256').update(BODY).digest('hex');
const posix = process.platform !== 'win32';

/** Une Release dont chaque installeur a le même corps, donc la même empreinte. */
function release(names: string[]): (url: string) => Response {
  return (url) => {
    if (url === `https://api.github.com/repos/${REPO}/releases/latest`)
      return Response.json({ tag_name: 'v9.9.0', html_url: `https://github.com/${REPO}/releases/tag/v9.9.0`, assets: [...names, 'SHA256SUMS.txt'].map((name) => ({ name, browser_download_url: `${DL}/${encodeURIComponent(name)}`, size: 64 })) });
    if (url.endsWith('/SHA256SUMS.txt')) return new Response(names.map((name) => `${SHA}  ./${name}`).join('\n'));
    return new Response(BODY);
  };
}

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const setPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...platform, value });

describe('SEC1.5 mise à jour : l’installeur vérifié est celui qui s’exécute', () => {
  let scratch = '';
  const appImageEnv = process.env.APPIMAGE;
  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'canto-sec15-'));
    electron.temp = scratch;
    electron.fetch.mockReset();
    electron.openPath.mockClear();
    electron.quit.mockClear();
    electron.exit.mockClear();
    electron.release.mockClear();
    child.spawn.mockClear();
    delete process.env.APPIMAGE;
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    if (appImageEnv === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = appImageEnv;
    vi.useRealTimers();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('télécharge dans un dossier neuf et privé, jamais dans le dossier au nom fixe', async () => {
    setPlatform('linux');
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-linux-amd64.deb', 'CANTO-9.9.0-linux-arm64.deb'])(url));
    const check = (result: Awaited<ReturnType<typeof applyInstallerUpdate>>) => {
      expect(result).toMatchObject({ version: '9.9.0', kind: 'deb', restart: false });
      expect(readFileSync(result.file, 'utf8')).toBe(BODY);
      const dir = path.dirname(result.file);
      expect(path.dirname(dir)).toBe(scratch);
      expect(path.basename(dir)).toMatch(/^canto-update-[A-Za-z0-9]{6}$/);
      if (posix) expect(statSync(dir).mode & 0o777).toBe(0o700);
    };
    const first = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    check(first);
    const second = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    check(second);
    expect(path.dirname(first.file)).not.toBe(path.dirname(second.file));
    expect(existsSync(path.join(scratch, 'canto-update'))).toBe(false);
    expect(electron.openPath).toHaveBeenCalledTimes(2);
  });

  it('retire les téléchargements précédents, sans suivre un lien ni toucher un autre dossier', async () => {
    setPlatform('linux');
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-linux-amd64.deb', 'CANTO-9.9.0-linux-arm64.deb'])(url));
    const first = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    // L'ancien dossier au nom fixe, un dossier voisin au nom proche, et un lien qui porte un nom de téléchargement.
    mkdirSync(path.join(scratch, 'canto-update'));
    writeFileSync(path.join(scratch, 'canto-update', 'CANTO-3.9.0-linux-amd64.deb'), 'ancien');
    mkdirSync(path.join(scratch, 'canto-update-du-trader'));
    writeFileSync(path.join(scratch, 'canto-update-du-trader', 'notes.txt'), 'à garder');
    const elsewhere = path.join(scratch, 'ailleurs');
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, 'garde.txt'), 'à garder');
    if (posix) symlinkSync(elsewhere, path.join(scratch, 'canto-update-AbCd12'));
    const second = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    expect(existsSync(path.dirname(first.file))).toBe(false);
    expect(existsSync(path.join(scratch, 'canto-update'))).toBe(false);
    expect(readFileSync(second.file, 'utf8')).toBe(BODY);
    expect(readFileSync(path.join(scratch, 'canto-update-du-trader', 'notes.txt'), 'utf8')).toBe('à garder');
    expect(readFileSync(path.join(elsewhere, 'garde.txt'), 'utf8')).toBe('à garder');
  });

  it.runIf(posix)('un lien posé d’avance dans l’ancien dossier fixe n’est plus suivi', async () => {
    setPlatform('linux');
    // Ce qu'un autre compte du poste préparait dans /tmp : le dossier attendu, et l'installeur attendu comme lien.
    const victim = path.join(scratch, 'fichier-du-trader.txt');
    writeFileSync(victim, 'intact');
    mkdirSync(path.join(scratch, 'canto-update'));
    symlinkSync(victim, path.join(scratch, 'canto-update', `CANTO-9.9.0-linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}.deb`));
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-linux-amd64.deb', 'CANTO-9.9.0-linux-arm64.deb'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    expect(readFileSync(victim, 'utf8')).toBe('intact');
    expect(path.dirname(result.file)).not.toBe(path.join(scratch, 'canto-update'));
  });

  it('refuse un installeur dont le nom sort du dossier', async () => {
    setPlatform('win32');
    const evil = '../CANTO-9.9.0-win-x64-setup.exe';
    electron.fetch.mockImplementation(async (url: string) => release([evil, '..\\CANTO-9.9.0-win-arm64-setup.exe'])(url));
    await expect(applyInstallerUpdate({ repo: REPO, current: '3.10.0' })).rejects.toThrow('no_installer');
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('Windows : l’installeur vérifié est lancé tel quel', async () => {
    setPlatform('win32');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-win-x64-setup.exe', 'CANTO-9.9.0-win-arm64-setup.exe'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    expect(result).toMatchObject({ kind: 'nsis', restart: true });
    expect(performPendingRestart()).toBe(true);
    expect(child.spawn).toHaveBeenCalledTimes(1);
    expect(child.spawn.mock.calls[0]!.slice(0, 2)).toEqual([result.file, ['/S', '--updated', '--force-run']]);
  });

  it('Windows : un installeur remplacé après sa vérification n’est pas lancé', async () => {
    setPlatform('win32');
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-win-x64-setup.exe', 'CANTO-9.9.0-win-arm64-setup.exe'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    writeFileSync(result.file, 'autre programme');
    expect(() => performPendingRestart()).toThrow('installer_changed');
    expect(child.spawn).not.toHaveBeenCalled();
    expect(electron.quit).not.toHaveBeenCalled();
    // Le fichier remplacé part, et rien ne reste en attente : un second appel ne le lance pas davantage.
    expect(existsSync(result.file)).toBe(false);
    expect(performPendingRestart()).toBe(false);
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it('Windows : la relance du desk le dit au trader et ne lance rien, ni l’installeur ni une autre relance', async () => {
    setPlatform('win32');
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-win-x64-setup.exe', 'CANTO-9.9.0-win-arm64-setup.exe'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    writeFileSync(result.file, 'autre programme');
    expect(() => relaunchDesk()).toThrow('Installeur modifié depuis sa vérification');
    expect(child.spawn).not.toHaveBeenCalled();
    expect(electron.quit).not.toHaveBeenCalled();
    expect(electron.exit).not.toHaveBeenCalled();
    expect(electron.release).not.toHaveBeenCalled();
  });

  it('Windows : un installeur disparu avant la relance n’est pas « lancé » non plus', async () => {
    setPlatform('win32');
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-win-x64-setup.exe', 'CANTO-9.9.0-win-arm64-setup.exe'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    rmSync(result.file);
    expect(() => performPendingRestart()).toThrow('installer_changed');
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it.runIf(posix)('AppImage : la copie mise en place est celle dont l’empreinte a été refaite', async () => {
    setPlatform('linux');
    const target = path.join(scratch, 'CANTO.AppImage');
    writeFileSync(target, 'ancienne version');
    process.env.APPIMAGE = target;
    electron.fetch.mockImplementation(async (url: string) => release(['CANTO-9.9.0-linux-x86_64.AppImage', 'CANTO-9.9.0-linux-arm64.AppImage'])(url));
    const result = await applyInstallerUpdate({ repo: REPO, current: '3.10.0' });
    expect(result).toMatchObject({ kind: 'appimage', restart: true, file: target });
    expect(readFileSync(target, 'utf8')).toBe(BODY);
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(existsSync(`${target}.update`)).toBe(false);
    // Le téléchargement, une fois copié, ne reste pas dans le dossier temporaire.
    expect(readdirSync(scratch).filter((name) => name.startsWith('canto-update-'))).toEqual([]);
  });

  it('le fichier est créé, jamais rouvert : écriture exclusive', () => {
    const source = readFileSync('electron/native-update.ts', 'utf8');
    expect(source).toMatch(/createWriteStream\(dest, \{ flags: 'wx' \}\)/);
    expect(source).not.toMatch(/'canto-update'\)/);
  });
});
