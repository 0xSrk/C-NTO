import { app, net, shell } from 'electron';
import { readLocaleFile, uiText } from './locale';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { classifyDirty, GENERATED_FILES } from './git-dirty';
import { applyInstallerUpdate, performPendingRestart, type DownloadProgress } from './native-update';
import { parseLatestRelease } from './release-check';
import { compareSemver } from './semver';
import { mainLog } from './main-log';

export { compareSemver } from './semver';

export const GITHUB_REPO = '0xSrk/C-NTO';
export const GITHUB_BRANCH = 'main';
/** Code de sortie : le script `launch.mjs` relance la boucle. */
export const RELAUNCH_EXIT_CODE = 42;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

/** Miroir de src/engine/updatePolicy.ts — le process main ne compile pas `src/`. */
function canApplyGitUpdate(input: { isGitCheckout: boolean; dirty: boolean }): { ok: true } | { ok: false; reason: string } {
  if (!input.isGitCheckout) return { ok: false, reason: 'not_git' };
  if (input.dirty) return { ok: false, reason: 'dirty' };
  return { ok: true };
}

function canStash(input: { confirmStash: boolean }): boolean {
  return input.confirmStash === true;
}

function ui(fr: string, en: string, es: string): string {
  return uiText(readLocaleFile(app.getPath('userData')), fr, en, es);
}

/**
 * Fichiers suivis réellement modifiés (ceux qui peuvent bloquer un pull). Les fichiers
 * régénérés par npm (package-lock.json) sont restaurés au passage ; les fichiers non
 * suivis ne comptent pas : git refusera lui-même s'ils entrent en collision.
 */
async function gitDirtyFiles(root: string): Promise<string[]> {
  // quotepath=false : chemins accentués en clair, utilisables tels quels par checkout / stash.
  const r = await run('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'], root);
  if (r.code !== 0) return [];
  const { generated, user } = classifyDirty(r.out);
  if (generated.length) await run('git', ['checkout', '--', ...generated], root);
  return user;
}

function openReleasesPage(url: string = RELEASES_URL): void {
  if (url.startsWith('https://github.com/')) void shell.openExternal(url);
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
  /** Fichiers suivis modifiés localement, quand error === 'dirty_needs_stash'. */
  dirtyFiles?: string[];
  /** Application installée : installeur ouvert pour l'utilisateur (DMG, deb) au lieu d'une relance. */
  opened?: string;
  busy: boolean;
  error?: string;
  /** Source de la détection */
  source: 'git' | 'github' | 'none';
  /** true seulement après un pull dev réussi */
  applied?: boolean;
}

export function repoRoot(): string {
  // dist-electron/ → racine du dépôt (ou ressources de l'app packagée)
  return path.resolve(__dirname, '..');
}

function npmCliPath(): string {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(repoRoot(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('npm-cli.js introuvable');
}

/** Spawn sans shell — évite DEP0190 (args + shell:true). */
function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      env,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', (e) => resolve({ code: 1, out, err: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

/** Dans le desk, `process.execPath` est Electron : ELECTRON_RUN_AS_NODE le fait tourner comme Node pour npm. */
function runNpm(args: string[], cwd: string) {
  return run(process.execPath, [npmCliPath(), ...args], cwd, { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
}

async function isGitCheckout(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function readLocalVersion(root: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: string }).version;
    if (v) return v;
  } catch {
    /* fallback */
  }
  return app.getVersion();
}

async function fetchGithubPackageVersion(): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/package.json`;
  try {
    const res = await net.fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CANTO-Desk' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Voie installeur : dernière Release GitHub publiée (et non `package.json` sur `main`,
 * dont le numéro peut avancer avant qu'un binaire existe).
 */
async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  try {
    const res = await net.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CANTO-Desk', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return parseLatestRelease(await res.json());
  } catch {
    return null;
  }
}

/** Détecte une avance de `origin/main` même si le numéro de version n'a pas bougé. */
async function gitBehind(root: string): Promise<boolean> {
  const fetch = await run('git', ['fetch', 'origin', GITHUB_BRANCH, '--quiet'], root);
  if (fetch.code !== 0) return false;
  const rev = await run('git', ['rev-list', '--count', `HEAD..origin/${GITHUB_BRANCH}`], root);
  if (rev.code !== 0) return false;
  return parseInt(rev.out.trim(), 10) > 0;
}

async function gitRemotePackageVersion(root: string): Promise<string | null> {
  const r = await run('git', ['show', `origin/${GITHUB_BRANCH}:package.json`], root);
  if (r.code !== 0) return null;
  try {
    const v = (JSON.parse(r.out) as { version?: string }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const root = repoRoot();
  const current = await readLocalVersion(root);
  const base: UpdateStatus = { current, latest: null, available: false, busy: false, source: 'none' };

  if (await isGitCheckout(root)) {
    try {
      const behind = await gitBehind(root);
      const latest = (await gitRemotePackageVersion(root)) ?? (await fetchGithubPackageVersion());
      const newer = latest ? compareSemver(latest, current) > 0 : false;
      return {
        current,
        latest: latest ?? current,
        available: behind || newer,
        busy: false,
        source: 'git',
      };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : ui('Contrôle git impossible', 'Git check failed', 'Comprobación git imposible'), source: 'git' };
    }
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { ...base, error: ui('Impossible de joindre GitHub', 'Could not reach GitHub', 'No se pudo contactar GitHub'), source: 'github' };
  }
  return {
    current,
    latest: release.version,
    available: compareSemver(release.version, current) > 0,
    busy: false,
    source: 'github',
  };
}

export async function applyUpdate(
  opts: { channel?: string; confirmStash?: boolean; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<UpdateStatus> {
  const root = repoRoot();
  const current = await readLocalVersion(root);
  const git = await isGitCheckout(root);

  if (!git) {
    // Application installée : téléchargement vérifié de l'installeur de la dernière Release.
    try {
      const r = await applyInstallerUpdate({ repo: GITHUB_REPO, current, onProgress: opts.onProgress });
      return {
        current,
        latest: r.version,
        available: !r.restart,
        busy: false,
        applied: r.restart,
        opened: r.restart ? undefined : r.file,
        source: 'github',
      };
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      mainLog('error', `mise à jour native impossible : ${code}`);
      if (code === 'no_installer') openReleasesPage();
      const messages: Record<string, string> = {
        release_unreachable: ui('Impossible de joindre GitHub', 'Could not reach GitHub', 'No se pudo contactar GitHub'),
        already_latest: ui('Déjà à jour', 'Already up to date', 'Ya actualizado'),
        no_installer: ui('Pas d’installeur pour ce système — page des versions ouverte', 'No installer for this system — releases page opened', 'Sin instalador para este sistema — página de versiones abierta'),
        no_checksums: ui('Empreintes SHA-256 absentes de la release : installation refusée', 'Release has no SHA-256 checksums: install refused', 'La versión no tiene sumas SHA-256: instalación rechazada'),
        checksum_mismatch: ui('Fichier corrompu (SHA-256 différent) : installation refusée', 'Corrupted download (SHA-256 mismatch): install refused', 'Descarga dañada (SHA-256 distinto): instalación rechazada'),
      };
      return {
        current,
        latest: null,
        available: code !== 'already_latest',
        busy: false,
        applied: false,
        error: messages[code] ?? `${ui('Téléchargement impossible', 'Download failed', 'Descarga imposible')} : ${code}`,
        source: 'github',
      };
    }
  }

  const latest = (await gitRemotePackageVersion(root)) ?? (await fetchGithubPackageVersion());
  const dirtyFiles = await gitDirtyFiles(root);
  const gitOk = canApplyGitUpdate({ isGitCheckout: git, dirty: dirtyFiles.length > 0 });
  if (!gitOk.ok) {
    if (gitOk.reason === 'dirty' && canStash({ confirmStash: opts.confirmStash === true })) {
      const stash = await run('git', ['stash', 'push', '-m', 'canto-auto-update', '--', ...dirtyFiles], root);
      if (stash.code !== 0) {
        return { current, latest: latest ?? null, available: true, busy: false, error: stash.err || ui('git stash a échoué', 'git stash failed', 'git stash falló'), source: 'git' };
      }
    } else if (gitOk.reason === 'dirty') {
      return { current, latest: latest ?? null, available: true, busy: false, error: 'dirty_needs_stash', dirtyFiles, source: 'git' };
    } else {
      openReleasesPage();
      return { current, latest: latest ?? null, available: true, busy: false, error: gitOk.reason, source: 'git' };
    }
  }

  const fetch = await run('git', ['fetch', 'origin', GITHUB_BRANCH], root);
  if (fetch.code !== 0) {
    return { current, latest: latest ?? null, available: true, busy: false, error: fetch.err || ui('git fetch a échoué', 'git fetch failed', 'git fetch falló'), source: 'git' };
  }

  const pull = await run('git', ['pull', '--ff-only', 'origin', GITHUB_BRANCH], root);
  if (pull.code !== 0) {
    return { current, latest: latest ?? null, available: true, busy: false, error: pull.err || pull.out || ui('git pull a échoué', 'git pull failed', 'git pull falló'), source: 'git' };
  }

  const install = await runNpm(['install', '--legacy-peer-deps'], root);
  // npm vient de réécrire le lockfile : l'arbre reste propre pour la prochaine mise à jour.
  await run('git', ['checkout', '--', ...GENERATED_FILES], root);
  if (install.code !== 0) {
    return {
      current,
      latest: latest ?? null,
      available: false,
      busy: false,
      error: install.err || ui('npm install a échoué', 'npm install failed', 'npm install falló'),
      source: 'git',
    };
  }

  const next = await readLocalVersion(root);
  return { current: next, latest: next, available: false, busy: false, applied: true, source: 'git' };
}

/** Relance : si le parent est `launch.mjs`, exit 42 ; sinon spawn détaché de `npm run launch`. */
export function relaunchDesk(): void {
  // Application installée : l'installeur (Windows) ou la relance (AppImage) prend la main.
  if (performPendingRestart()) return;
  if (process.env.CANTO_LAUNCHER_PARENT === '1') {
    app.releaseSingleInstanceLock();
    app.exit(RELAUNCH_EXIT_CODE);
    return;
  }
  const root = repoRoot();
  // La nouvelle instance ne doit pas buter sur le verrou de celle qui se ferme.
  app.releaseSingleInstanceLock();
  const child = spawn(process.execPath, [npmCliPath(), 'run', 'launch'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, CANTO_LAUNCHER_PARENT: undefined, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });
  child.unref();
  setTimeout(() => app.quit(), 400);
}
