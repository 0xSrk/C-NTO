import { describe, expect, it } from 'vitest';
import { parseChecksums, parseLatestRelease, pickInstallerAsset, type ReleaseAsset } from '../electron/release-check';

describe('contrôle de version par Release GitHub', () => {
  it('lit le tag de la dernière release publiée', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.0', html_url: 'https://github.com/0xSrk/C-NTO/releases/tag/v2.0.0' })).toEqual({
      version: '2.0.0',
      url: 'https://github.com/0xSrk/C-NTO/releases/tag/v2.0.0',
      assets: [],
    });
    expect(parseLatestRelease({ tag_name: '2.1.0' })?.version).toBe('2.1.0');
  });

  it('ignore brouillons, préversions et tags mal formés', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.1', draft: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v2.0.1', prerelease: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v2.0.1-rc1' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease('v2.0.0')).toBeNull();
  });

  it('ne garde une URL que sur github.com', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.0', html_url: 'http://evil.example/x' })?.url).toBe('');
  });

  it('lit les fichiers de la release, en https github.com uniquement', () => {
    const r = parseLatestRelease({
      tag_name: 'v2.0.1',
      assets: [
        { name: 'CANTO-2.0.1-win-x64-setup.exe', browser_download_url: 'https://github.com/0xSrk/C-NTO/releases/download/v2.0.1/CANTO-2.0.1-win-x64-setup.exe', size: 10 },
        { name: 'piege.exe', browser_download_url: 'https://evil.example/piege.exe', size: 1 },
        { name: 42 },
      ],
    });
    expect(r?.assets.map((a) => a.name)).toEqual(['CANTO-2.0.1-win-x64-setup.exe']);
  });
});

const ASSETS: ReleaseAsset[] = [
  'CANTO-2.0.1-linux-amd64.deb',
  'CANTO-2.0.1-linux-arm64.AppImage',
  'CANTO-2.0.1-linux-arm64.deb',
  'CANTO-2.0.1-linux-x86_64.AppImage',
  'CANTO-2.0.1-mac-universal.dmg',
  'CANTO-2.0.1-mac-universal.zip',
  'CANTO-2.0.1-win-arm64-portable.exe',
  'CANTO-2.0.1-win-arm64-setup.exe',
  'CANTO-2.0.1-win-portable.exe',
  'CANTO-2.0.1-win-setup.exe',
  'CANTO-2.0.1-win-x64-portable.exe',
  'CANTO-2.0.1-win-x64-setup.exe',
  'SHA256SUMS.txt',
].map((name) => ({ name, url: `https://github.com/0xSrk/C-NTO/releases/download/v2.0.1/${name}`, size: 1 }));

describe('installeur de mise à jour adapté au poste', () => {
  const pick = (platform: string, arch: string, appImage = false) => pickInstallerAsset(ASSETS, { platform, arch, appImage });

  it('Windows : setup de l’architecture, jamais le portable', () => {
    expect(pick('win32', 'x64')).toEqual({ asset: expect.objectContaining({ name: 'CANTO-2.0.1-win-x64-setup.exe' }), kind: 'nsis' });
    expect(pick('win32', 'arm64')?.asset.name).toBe('CANTO-2.0.1-win-arm64-setup.exe');
    const universal = pickInstallerAsset(ASSETS.filter((a) => !a.name.includes('-x64-')), { platform: 'win32', arch: 'x64' });
    expect(universal?.asset.name).toBe('CANTO-2.0.1-win-setup.exe');
  });

  it('macOS : DMG universel', () => {
    expect(pick('darwin', 'arm64')).toEqual({ asset: expect.objectContaining({ name: 'CANTO-2.0.1-mac-universal.dmg' }), kind: 'dmg' });
  });

  it('Linux : AppImage si l’app tourne en AppImage, sinon deb', () => {
    expect(pick('linux', 'x64', true)?.asset.name).toBe('CANTO-2.0.1-linux-x86_64.AppImage');
    expect(pick('linux', 'arm64', true)?.kind).toBe('appimage');
    expect(pick('linux', 'x64')?.asset.name).toBe('CANTO-2.0.1-linux-amd64.deb');
    expect(pick('linux', 'arm64')?.kind).toBe('deb');
  });

  it('aucun installeur connu : null', () => {
    expect(pickInstallerAsset([], { platform: 'win32', arch: 'x64' })).toBeNull();
    expect(pick('freebsd', 'x64')).toBeNull();
  });
});

describe('empreintes SHA-256 de la release', () => {
  it('lit la sortie de sha256sum, avec ou sans ./', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const sums = parseChecksums(`${a}  ./CANTO-2.0.1-win-x64-setup.exe\r\n${b} *CANTO-2.0.1-mac-universal.dmg\nbruit\n`);
    expect(sums.get('CANTO-2.0.1-win-x64-setup.exe')).toBe(a);
    expect(sums.get('CANTO-2.0.1-mac-universal.dmg')).toBe('b'.repeat(64));
    expect(sums.size).toBe(2);
  });
});
