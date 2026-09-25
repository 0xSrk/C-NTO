import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, promises as fs, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { mainLog } from './main-log';
import { parseChecksums, parseLatestRelease, pickInstallerAsset, type InstallKind, type ReleaseInfo } from './release-check';
import { compareSemver } from './semver';

/**
 * Mise à jour native de l'application installée (sans `.git`) : l'installeur de la dernière
 * Release GitHub adapté au poste est téléchargé, vérifié contre `SHA256SUMS.txt`, puis
 * installé. Windows : installeur NSIS silencieux qui relance CΛNTO ; Linux AppImage : fichier
 * remplacé puis relance ; macOS DMG et Linux deb : l'installeur est ouvert pour l'utilisateur.
 * Réseau via `net.fetch` (pile Chromium) : le proxy système du poste est respecté.
 */

const API_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'CANTO-Desk', 'X-GitHub-Api-Version': '2022-11-28' };

export interface NativeUpdateResult {
  version: string;
  kind: InstallKind;
  /** true : relancer via `performPendingRestart` ; false : un installeur a été ouvert. */
  restart: boolean;
  file: string;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

type PendingRestart = { kind: 'installer'; file: string } | { kind: 'appimage'; file: string };
let pending: PendingRestart | null = null;

export async function fetchLatestReleaseInfo(repo: string): Promise<ReleaseInfo | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: API_HEADERS, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return parseLatestRelease(await res.json());
  } catch {
    return null;
  }
}

/** Téléchargement en flux vers `dest`, empreinte SHA-256 calculée au passage. */
async function download(url: string, dest: string, onProgress?: (p: DownloadProgress) => void): Promise<string> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'CANTO-Desk' }, redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  let lastTick = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      received += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastTick > 150) {
        lastTick = now;
        onProgress({ received, total });
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), meter, createWriteStream(dest));
  onProgress?.({ received, total: total || received });
  return hash.digest('hex');
}

export async function applyInstallerUpdate(opts: {
  repo: string;
  current: string;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<NativeUpdateResult> {
  const release = await fetchLatestReleaseInfo(opts.repo);
  if (!release) throw new Error('release_unreachable');
  if (compareSemver(release.version, opts.current) <= 0) throw new Error('already_latest');
  const pick = pickInstallerAsset(release.assets, { platform: process.platform, arch: process.arch, appImage: !!process.env.APPIMAGE });
  if (!pick) throw new Error('no_installer');
  const sumsAsset = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
  if (!sumsAsset) throw new Error('no_checksums');
  const sumsRes = await net.fetch(sumsAsset.url, { headers: { 'User-Agent': 'CANTO-Desk' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!sumsRes.ok) throw new Error('no_checksums');
  const expected = parseChecksums(await sumsRes.text()).get(pick.asset.name);
  if (!expected) throw new Error('no_checksums');

  const dir = path.join(app.getPath('temp'), 'canto-update');
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, pick.asset.name);
  mainLog('info', `mise à jour v${opts.current} → v${release.version} : téléchargement de ${pick.asset.name}`);
  const actual = await download(pick.asset.url, dest, opts.onProgress);
  if (actual !== expected) {
    await fs.rm(dest, { force: true });
    mainLog('error', `empreinte SHA-256 invalide pour ${pick.asset.name} (attendu ${expected}, obtenu ${actual})`);
    throw new Error('checksum_mismatch');
  }
  mainLog('info', `${pick.asset.name} vérifié (SHA-256)`);

  switch (pick.kind) {
    case 'nsis':
      pending = { kind: 'installer', file: dest };
      return { version: release.version, kind: pick.kind, restart: true, file: dest };
    case 'appimage': {
      const target = process.env.APPIMAGE;
      if (!target) throw new Error('no_installer');
      const staged = `${target}.update`;
      await fs.copyFile(dest, staged);
      chmodSync(staged, 0o755);
      renameSync(staged, target);
      pending = { kind: 'appimage', file: target };
      return { version: release.version, kind: pick.kind, restart: true, file: target };
    }
    default: {
      const err = await shell.openPath(dest);
      if (err) throw new Error(err);
      return { version: release.version, kind: pick.kind, restart: false, file: dest };
    }
  }
}

/** Termine une mise à jour native : true si une relance est prise en charge ici. */
export function performPendingRestart(): boolean {
  if (!pending) return false;
  const next = pending;
  pending = null;
  app.releaseSingleInstanceLock();
  if (next.kind === 'installer') {
    // Installeur NSIS d'electron-builder : /S silencieux (même dossier), --updated, puis
    // --force-run relance CΛNTO une fois les fichiers remplacés. On quitte pour les libérer.
    mainLog('info', `lancement de l'installeur ${path.basename(next.file)}`);
    const child = spawn(next.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    setTimeout(() => app.quit(), 300);
    return true;
  }
  // AppImage : le binaire courant vit dans un montage temporaire qui disparaît à la sortie ;
  // c'est le nouveau fichier AppImage qu'on lance, sans les variables de l'ancien montage.
  mainLog('info', `relance sur ${next.file}`);
  const env = { ...process.env };
  for (const key of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0']) delete env[key];
  spawn(next.file, [], { detached: true, stdio: 'ignore', env }).unref();
  setTimeout(() => app.quit(), 300);
  return true;
}
