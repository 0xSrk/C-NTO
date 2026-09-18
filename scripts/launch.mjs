#!/usr/bin/env node
/**
 * Lanceur CΛNTO — compile le shell, démarre Vite (127.0.0.1), ouvre la fenêtre lanceur.
 * Exit code 42 (depuis Electron après une màj) → reboucle.
 *
 * Aucun `spawn(..., { shell: true, args })` : évite DEP0190 (Node 22+).
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureElectron } from './ensure-electron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAUNCH = 42;
const PORT = 5173;
const HOST = '127.0.0.1';
const isWin = process.platform === 'win32';

/** Chemin absolu vers `npm-cli.js` (même Node que le lanceur). */
function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error('npm-cli.js introuvable — vérifiez l’installation Node.js / npm.');
}

/** Binaire Electron déjà extrait — ne pas `require('electron')` (install.js + binding natif Windows). */
function electronBinary() {
  const dir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(dir, 'path.txt');
  if (existsSync(pathFile)) {
    const rel = readFileSync(pathFile, 'utf8').trim();
    const abs = path.isAbsolute(rel) ? rel : path.join(dir, 'dist', rel);
    if (existsSync(abs)) return abs;
  }
  const nested = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : isWin ? 'electron.exe' : 'electron';
  const dist = path.join(dir, 'dist', nested);
  if (existsSync(dist)) return dist;
  throw new Error('Binaire Electron introuvable après extraction.');
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Attendre que Vite réponde en HTTP (évite le piège IPv6 ::1 vs 127.0.0.1). */
function waitForVite(timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: HOST, port: PORT, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Vite ne répond pas sur http://${HOST}:${PORT}`));
        else setTimeout(tick, 300);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Vite ne répond pas sur http://${HOST}:${PORT}`));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function compileElectron() {
  const code = await runNodeScript(npmCliPath(), ['run', 'electron:compile']);
  if (code !== 0) throw new Error('electron:compile a échoué');
}

/**
 * Démarre Vite via le binaire Node local (plus fiable que npx sous Windows).
 * Force --host 127.0.0.1 pour coller à CANTO_DEV_URL.
 */
function startVite() {
  const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  mkdirSync(path.join(root, 'dist-electron'), { recursive: true });
  const logPath = path.join(root, 'dist-electron', 'vite-launcher.log');
  const log = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [viteJs, '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true,
    shell: false,
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.on('error', (err) => {
    console.error('Impossible de démarrer Vite :', err.message);
  });
  return child;
}

function runElectron() {
  return new Promise((resolve, reject) => {
    const bin = electronBinary();
    const child = spawn(bin, ['.', '--launcher'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CANTO_DEV_URL: `http://${HOST}:${PORT}`,
        CANTO_LAUNCHER_PARENT: '1',
      },
      windowsHide: false,
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}

function stopChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* déjà mort */
  }
}

async function main() {
  console.log('\n  CΛNTO · lanceur Lab\n');
  const electronReady = ensureElectron(root);
  await compileElectron();

  for (;;) {
    const vite = startVite();
    let viteExit = null;
    vite.on('close', (code) => {
      viteExit = code ?? 1;
    });

    try {
      await Promise.race([
        waitForVite(),
        new Promise((_, reject) => {
          const iv = setInterval(() => {
            if (viteExit !== null) {
              clearInterval(iv);
              reject(
                new Error(
                  `Vite s'est arrêté (code ${viteExit}). Voir dist-electron/vite-launcher.log` +
                    (viteExit !== 0 ? ' — port 5173 peut-être déjà pris, ou dépendance manquante.' : ''),
                ),
              );
            }
          }, 200);
        }),
      ]);
    } catch (e) {
      stopChild(vite);
      throw e;
    }

    console.log(`  Vite prêt · http://${HOST}:${PORT}`);
    try {
      await electronReady;
    } catch (e) {
      stopChild(vite);
      throw e;
    }
    const code = await runElectron();
    stopChild(vite);
    await new Promise((r) => setTimeout(r, 500));
    if (code === RELAUNCH) {
      console.log('\n  Mise à jour appliquée — redémarrage…\n');
      await compileElectron();
      continue;
    }
    process.exit(code);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
