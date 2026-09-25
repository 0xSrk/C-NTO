import { app, shell } from 'electron';
import { readLocaleFile, uiText } from './locale';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseLatestRelease } from './release-check';
import { compareSemver } from './semver';

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

async function gitDirty(root: string): Promise<boolean> {
  const r = await run('git', ['status', '--porcelain'], root);
  return r.code === 0 && r.out.trim().length > 0;
}

function openReleasesPage(url: string = RELEASES_URL): void {
  if (url.startsWith('https://github.com/')) void shell.openExternal(url);
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
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
function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      env: process.env,
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

function runNpm(args: string[], cwd: string) {
  return run(process.execPath, [npmCliPath(), ...args], cwd);
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
    const res = await fetch(url, {
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
    const res = await fetch(url, {
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

export async function applyUpdate(opts: { channel?: string; confirmStash?: boolean } = {}): Promise<UpdateStatus> {
  const root = repoRoot();
  const current = await readLocalVersion(root);
  const git = await isGitCheckout(root);

  if (!git) {
    const release = await fetchLatestRelease();
    openReleasesPage(release?.url || RELEASES_URL);
    return {
      current,
      latest: release?.version ?? null,
      available: true,
      busy: false,
      applied: false,
      error: ui('Dépôt git introuvable — page des versions ouverte.', 'Git repository not found — releases page opened.', 'Repositorio git no encontrado — página de versiones abierta.'),
      source: 'none',
    };
  }

  const latest = (await gitRemotePackageVersion(root)) ?? (await fetchGithubPackageVersion());
  const dirty = await gitDirty(root);
  const gitOk = canApplyGitUpdate({ isGitCheckout: git, dirty });
  if (!gitOk.ok) {
    if (gitOk.reason === 'dirty' && canStash({ confirmStash: opts.confirmStash === true })) {
      const stash = await run('git', ['stash', 'push', '-u', '-m', 'canto-auto-update'], root);
      if (stash.code !== 0) {
        return { current, latest: latest ?? null, available: true, busy: false, error: stash.err || ui('git stash a échoué', 'git stash failed', 'git stash falló'), source: 'git' };
      }
    } else if (gitOk.reason === 'dirty') {
      return { current, latest: latest ?? null, available: true, busy: false, error: 'dirty_needs_stash', source: 'git' };
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
  if (process.env.CANTO_LAUNCHER_PARENT === '1') {
    app.exit(RELAUNCH_EXIT_CODE);
    return;
  }
  const root = repoRoot();
  const child = spawn(process.execPath, [npmCliPath(), 'run', 'launch'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, CANTO_LAUNCHER_PARENT: undefined },
    windowsHide: true,
  });
  child.unref();
  setTimeout(() => app.quit(), 400);
}
