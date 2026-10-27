import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakeNetRequest } from './helpers/netRequestFake';

/**
 * UPD1 — la mise à jour ne joint ni ne garde aucun cookie. Sans `credentials`, `net.fetch` garde dans la session par
 * défaut, persistante, les cookies d'une réponse (redirection comprise) et les renvoie aux appels suivants : vu sur
 * Electron 43.7.1, essai sur 127.0.0.1 (`docs/AUDIT.md`, UPD1). Le journal passe par `net.request` depuis UPD2.
 */
const electron = vi.hoisted(() => ({ fetch: vi.fn(), request: vi.fn(), temp: '' }));
vi.mock('electron', () => ({
  net: { fetch: electron.fetch, request: electron.request },
  app: { getPath: () => electron.temp, getVersion: () => '0.0.0' },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
}));
// Sans clé embarquée, la mise à jour va jusqu'au téléchargement : chaque appel réseau de la voie installeur est vu.
vi.mock('../electron/release-keys', () => ({ RELEASE_PUBLIC_KEYS: [] }));

import { fetchReleaseChangelog } from '../electron/changelog-fetch';
import { applyInstallerUpdate, fetchLatestReleaseInfo } from '../electron/native-update';

const REPO = '0xSrk/C-NTO';
const DL = `https://github.com/${REPO}/releases/download/v9.9.0`;
const INSTALLERS = ['win-x64-setup.exe', 'win-arm64-setup.exe', 'mac-universal.dmg', 'linux-x86_64.AppImage', 'linux-arm64.AppImage', 'linux-amd64.deb', 'linux-arm64.deb'].map((s) => `CANTO-9.9.0-${s}`);
const NAMES = [...INSTALLERS, 'SHA256SUMS.txt', 'SHA256SUMS.txt.sig', 'changelog.json'];

function route(url: string): Response {
  if (url === `https://api.github.com/repos/${REPO}/releases/latest`)
    return Response.json({ tag_name: 'v9.9.0', html_url: `https://github.com/${REPO}/releases/tag/v9.9.0`, assets: NAMES.map((name) => ({ name, browser_download_url: `${DL}/${name}`, size: 64 })) });
  if (url.endsWith('/SHA256SUMS.txt')) return new Response(INSTALLERS.map((n) => `${'a'.repeat(64)}  ./${n}`).join('\n'));
  if (url.endsWith('/SHA256SUMS.txt.sig')) return new Response(Buffer.alloc(64).toString('base64'));
  return new Response('installeur');
}

/** Les arguments de chaque appel `net.fetch(…)` ou `net.request(…)` d'un fichier source, parenthèses équilibrées. */
function fetchCalls(file: string): string[] {
  const source = readFileSync(path.join('electron', file), 'utf8');
  return [...source.matchAll(/net\.(?:fetch|request)\(/g)].map(({ index: at }) => {
    let depth = 0;
    let end = source.indexOf('(', at);
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')' && (depth -= 1) === 0) break;
    }
    return source.slice(at, end + 1);
  });
}

describe('mise à jour sans cookie (UPD1)', () => {
  it('dernière Release, journal, empreintes, signature et installeur : chaque appel part avec `credentials: omit`', async () => {
    electron.temp = mkdtempSync(path.join(tmpdir(), 'canto-upd1-'));
    electron.fetch.mockReset();
    electron.fetch.mockImplementation(async (url: string) => route(url));
    const journal = fakeNetRequest(() => ({ hops: [], status: 404, body: '' }));
    electron.request.mockReset();
    electron.request.mockImplementation(journal.request);

    expect(await fetchLatestReleaseInfo(REPO)).toMatchObject({ version: '9.9.0' });
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    // L'empreinte de l'installeur téléchargé n'est pas celle de SHA256SUMS.txt : refus, après le téléchargement.
    await expect(applyInstallerUpdate({ repo: REPO, current: '3.7.0' })).rejects.toThrow('checksum_mismatch');

    expect(journal.log.map((r) => ({ url: r.options.url, credentials: r.options.credentials }))).toEqual([{ url: `${DL}/changelog.json`, credentials: 'omit' }]);
    const urls = electron.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.endsWith('/SHA256SUMS.txt'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/SHA256SUMS.txt.sig'))).toBe(true);
    expect(urls.some((u) => INSTALLERS.some((n) => u.endsWith(`/${n}`)))).toBe(true);
    for (const [url, init] of electron.fetch.mock.calls) expect({ url, credentials: (init as RequestInit | undefined)?.credentials }).toEqual({ url, credentials: 'omit' });
  });

  it('chaque `net.fetch` et `net.request` de la mise à jour et du journal, même hors de ces chemins, pose `credentials: omit`', () => {
    for (const file of ['updater.ts', 'native-update.ts', 'changelog-fetch.ts']) {
      const calls = fetchCalls(file);
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, `${file} : ${call.split('\n')[0]}`).toMatch(/credentials: 'omit'/);
    }
  });
});
