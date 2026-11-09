import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, createWriteStream, openSync, promises as fs, readSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { mainLog } from './main-log';
import { parseLatestRelease, pickInstallerAsset, type InstallKind, type ReleaseInfo } from './release-check';
import { RELEASE_PUBLIC_KEYS } from './release-keys';
import { SIGNATURE_ASSET, SIGNATURE_MAX_BYTES, trustedChecksum } from './release-signature';
import { compareSemver } from './semver';

/**
 * Mise à jour native de l'application installée (sans `.git`) : l'installeur de la dernière
 * Release GitHub adapté au poste est téléchargé, vérifié contre `SHA256SUMS.txt` (lui-même signé
 * par une clé du Lab, voir `release-signature.ts`), puis
 * installé. Windows : installeur NSIS silencieux qui relance CΛNTO ; Linux AppImage : fichier
 * remplacé puis relance ; macOS DMG et Linux deb : l'installeur est ouvert pour l'utilisateur.
 * L'installeur vérifié est celui qui s'exécute (SEC1.5) : il est écrit dans un dossier neuf et privé (`mkdtemp`, 0700),
 * jamais dans un dossier au nom fixe du dossier temporaire, qu'un autre compte du poste pouvait préparer ; son empreinte
 * est refaite sur ce qui part, la copie de l'AppImage et l'installeur Windows juste avant son lancement.
 * Réseau via `net.fetch` (pile Chromium) : le proxy système du poste est respecté. Chaque appel part sans cookie
 * (`credentials: 'omit'`) : sinon, `net.fetch` garde ceux d'une réponse dans la session par défaut et les renvoie (UPD1).
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

type PendingRestart = { kind: 'installer'; file: string; sha256: string } | { kind: 'appimage'; file: string };
let pending: PendingRestart | null = null;

/** Nom d'installeur admis : un seul segment, sans séparateur ni `..` ; ceux d'electron-builder (`package.json`) le sont. */
const INSTALLER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Dossiers de téléchargement de ce module : l'ancien, au nom fixe, et ceux de `mkdtemp` (six signes tirés au sort). */
const DOWNLOAD_DIR = /^canto-update(?:-[A-Za-z0-9]{6})?$/;

/** Dossiers créés depuis l'ouverture du desk : leur installeur peut être en cours d'installation (DMG, deb ouverts au trader). */
const sessionDownloads = new Set<string>();

/**
 * Retire les téléchargements des ouvertures précédentes du desk : un installeur pèse ≈ 100 Mo et rien d'autre ne les
 * enlève. Seulement de vrais dossiers (jamais un lien, que `lstat` ne suit pas) et, hors Windows, ceux de ce compte ;
 * jamais ceux de cette ouverture, dont l'installeur sert peut-être encore. Sans effet sur la mise à jour : un dossier
 * qui résiste reste où il est.
 */
async function sweepDownloads(temp: string): Promise<void> {
  const uid = process.getuid?.();
  let names: string[];
  try {
    names = await fs.readdir(temp);
  } catch {
    return;
  }
  for (const name of names) {
    if (!DOWNLOAD_DIR.test(name) || sessionDownloads.has(name)) continue;
    const dir = path.join(temp, name);
    try {
      const st = await fs.lstat(dir);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* dossier d'un autre compte, ou déjà parti */
    }
  }
}

/** Empreinte SHA-256 d'un fichier relu du disque, par blocs ; `null` s'il ne se lit plus. */
function fileSha256(file: string): string | null {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read <= 0) break;
      hash.update(chunk.subarray(0, read));
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export async function fetchLatestReleaseInfo(repo: string): Promise<ReleaseInfo | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: API_HEADERS, credentials: 'omit', signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return parseLatestRelease(await res.json());
  } catch {
    return null;
  }
}

/** Téléchargement en flux vers `dest`, empreinte SHA-256 calculée au passage. */
async function download(url: string, dest: string, onProgress?: (p: DownloadProgress) => void): Promise<string> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'CANTO-Desk' }, redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(15 * 60_000) });
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
  // `wx` : le fichier est créé ici, dans un dossier neuf ; un fichier ou un lien déjà là fait échouer l'écriture.
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), meter, createWriteStream(dest, { flags: 'wx' }));
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
  // Le nom vient de la Release : un seul segment, sinon il désignerait un fichier hors du dossier de téléchargement.
  if (!INSTALLER_NAME.test(pick.asset.name) || path.basename(pick.asset.name) !== pick.asset.name) throw new Error('no_installer');
  const sumsAsset = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
  if (!sumsAsset) throw new Error('no_checksums');
  const sumsRes = await net.fetch(sumsAsset.url, { headers: { 'User-Agent': 'CANTO-Desk' }, redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  if (!sumsRes.ok) throw new Error('no_checksums');
  const sums = await sumsRes.text();
  // Signature du Lab sur SHA256SUMS.txt : sans elle, des empreintes publiées avec les installeurs ne prouvent rien.
  const sigAsset = release.assets.find((a) => a.name === SIGNATURE_ASSET);
  let signature: string | null = null;
  if (sigAsset && sigAsset.size <= SIGNATURE_MAX_BYTES) {
    const sigRes = await net.fetch(sigAsset.url, { headers: { 'User-Agent': 'CANTO-Desk' }, redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(30_000) });
    if (sigRes.ok) signature = (await sigRes.text()).slice(0, SIGNATURE_MAX_BYTES);
  }
  const trust = trustedChecksum({ version: release.version, installer: pick.asset.name, sums, signature, keys: RELEASE_PUBLIC_KEYS });
  if (!trust.ok) {
    mainLog('error', `mise à jour v${release.version} refusée : ${trust.error}`);
    throw new Error(trust.error);
  }
  if (trust.signed) mainLog('info', `SHA256SUMS.txt de v${release.version} signé par une clé du Lab`);
  else mainLog('warn', `aucune clé de publication embarquée : SHA256SUMS.txt de v${release.version} non vérifié par signature`);
  const expected = trust.sha256;

  // Un dossier neuf par téléchargement, créé en 0700 sous un nom que personne ne devine : ni dossier ni lien posé d'avance.
  const temp = app.getPath('temp');
  await sweepDownloads(temp);
  const dir = await fs.mkdtemp(path.join(temp, 'canto-update-'));
  sessionDownloads.add(path.basename(dir));
  const dest = path.join(dir, pick.asset.name);
  const discard = () => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  mainLog('info', `mise à jour v${opts.current} → v${release.version} : téléchargement de ${pick.asset.name}`);
  let actual: string;
  try {
    actual = await download(pick.asset.url, dest, opts.onProgress);
  } catch (err) {
    await discard();
    throw err;
  }
  if (actual !== expected) {
    await discard();
    mainLog('error', `empreinte SHA-256 invalide pour ${pick.asset.name} (attendu ${expected}, obtenu ${actual})`);
    throw new Error('checksum_mismatch');
  }
  mainLog('info', `${pick.asset.name} vérifié (SHA-256)`);

  switch (pick.kind) {
    case 'nsis':
      // L'empreinte vérifiée suit l'installeur jusqu'à son lancement, qui la refait (`performPendingRestart`).
      pending = { kind: 'installer', file: dest, sha256: expected };
      return { version: release.version, kind: pick.kind, restart: true, file: dest };
    case 'appimage': {
      const target = process.env.APPIMAGE;
      if (!target) {
        await discard();
        throw new Error('no_installer');
      }
      const staged = `${target}.update`;
      await fs.copyFile(dest, staged);
      await discard();
      // L'empreinte est refaite sur la copie : c'est elle qui prend la place de l'AppImage et qui sera lancée.
      if (fileSha256(staged) !== expected) {
        await fs.rm(staged, { force: true });
        mainLog('error', `${pick.asset.name} modifié entre sa vérification et sa mise en place : non installé`);
        throw new Error('checksum_mismatch');
      }
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

/**
 * Termine une mise à jour native : true si une relance est prise en charge ici. L'installeur Windows n'est lancé que si
 * son empreinte, refaite à l'instant, est celle qui a été vérifiée ; sinon il est retiré, rien n'est lancé, le desk reste
 * ouvert et l'erreur `installer_changed` remonte à l'appelant.
 */
export function performPendingRestart(): boolean {
  if (!pending) return false;
  const next = pending;
  pending = null;
  if (next.kind === 'installer' && fileSha256(next.file) !== next.sha256) {
    mainLog('error', `installeur ${path.basename(next.file)} modifié depuis sa vérification : non lancé`);
    try {
      rmSync(path.dirname(next.file), { recursive: true, force: true });
    } catch {
      /* déjà retiré */
    }
    throw new Error('installer_changed');
  }
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
