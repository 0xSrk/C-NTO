import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeNetRequest, type FakeWorld } from './helpers/netRequestFake';

/**
 * UPD2 — le journal de la Release ne suit une redirection que vers GitHub, en https. `net.fetch` rendait une `url`
 * vide (Electron 43.7.1), et la garde d'hôte final de `fetchReleaseChangelog` ne jouait jamais.
 */
const net = vi.hoisted(() => ({ world: null as unknown as FakeWorld, fetch: vi.fn(), request: vi.fn() }));
vi.mock('electron', () => ({
  net: { fetch: net.fetch, request: net.request },
  app: { getPath: () => '', getVersion: () => '0.0.0' },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
}));

import { CHANGELOG_MAX_BYTES } from '../src/engine/changelog';
import { fetchReleaseChangelog } from '../electron/changelog-fetch';

const REPO = '0xSrk/C-NTO';
const ASSET = `https://github.com/${REPO}/releases/download/v9.9.0/changelog.json`;
const CDN = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/changelog.json';
const JOURNAL = readFileSync('src/engine/changelog/changelog.json', 'utf8');
const fake = fakeNetRequest(() => net.world);

beforeEach(() => {
  fake.log.length = 0;
  net.world = { hops: [CDN], status: 200, body: JOURNAL };
  net.request.mockReset();
  net.request.mockImplementation(fake.request);
  net.fetch.mockReset();
  net.fetch.mockImplementation(async (url: string) => {
    if (url === `https://api.github.com/repos/${REPO}/releases/latest`)
      return Response.json({ tag_name: 'v9.9.0', assets: [{ name: 'changelog.json', browser_download_url: ASSET, size: 2048 }] });
    // `net.fetch` suit chaque redirection et rend une `url` vide, comme sous Electron 43.7.1.
    const w = net.world;
    return new Response(w.body, { status: w.status });
  });
});

describe('journal de la Release : redirections (UPD2)', () => {
  it('une redirection vers le CDN de GitHub est suivie, sans cookie : le journal est lu', async () => {
    const doc = await fetchReleaseChangelog(REPO);
    expect(doc?.entries.length).toBeGreaterThan(0);
    expect(fake.log).toHaveLength(1);
    expect(fake.log[0]).toMatchObject({ options: { url: ASSET, method: 'GET', redirect: 'manual', credentials: 'omit' }, followed: [CDN], aborted: false });
  });

  it('une redirection hors de GitHub n’est pas suivie : pas de journal', async () => {
    net.world.hops = ['https://evil.example/changelog.json'];
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    expect(fake.log[0]).toMatchObject({ followed: [], aborted: true });
  });

  it('une redirection en http, ou porteuse d’identifiants, n’est pas suivie', async () => {
    for (const hop of ['http://release-assets.githubusercontent.com/changelog.json', 'https://user:pass@release-assets.githubusercontent.com/changelog.json']) {
      fake.log.length = 0;
      net.world.hops = [hop];
      expect(await fetchReleaseChangelog(REPO), hop).toBeNull();
      expect(fake.log[0], hop).toMatchObject({ followed: [], aborted: true });
    }
  });

  it('un saut de GitHub vers un autre hôte, après un premier saut permis, n’est pas suivi', async () => {
    net.world.hops = [CDN, 'https://evil.example/changelog.json'];
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    expect(fake.log[0]).toMatchObject({ followed: [CDN], aborted: true });
  });

  it('plus de trois redirections : abandon', async () => {
    net.world.hops = [CDN, CDN, CDN, CDN];
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    expect(fake.log[0]).toMatchObject({ followed: [CDN, CDN, CDN], aborted: true });
  });

  it('réponse en erreur, ou au-delà de 64 Kio annoncés ou reçus : pas de journal', async () => {
    net.world.status = 404;
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    net.world = { hops: [CDN], status: 200, body: JOURNAL, contentLength: String(CHANGELOG_MAX_BYTES + 1) };
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
    net.world = { hops: [CDN], status: 200, body: JOURNAL.padEnd(CHANGELOG_MAX_BYTES + 1, ' '), contentLength: '' };
    expect(await fetchReleaseChangelog(REPO)).toBeNull();
  });
});
