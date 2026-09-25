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
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureElectron } from './ensure-electron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAUNCH = 42;
const PREFERRED_PORT = 5173;
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

/** Statut HTTP d'un GET local, ou null si rien ne répond. */
function probe(port, urlPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: urlPath, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Le port peut-il être pris en exclusivité sur 127.0.0.1 ? */
function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ host: HOST, port, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** Port libre attribué par le système. */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * 5173 est le port par défaut de Vite : une autre application peut déjà l'occuper
 * (le desk affichait alors sa réponse, p. ex. {"error":"not found"}). Si quoi que ce
 * soit y répond ou si le port ne se prend pas, on bascule sur un port libre.
 */
async function choosePort() {
  const foreign = await probe(PREFERRED_PORT, '/', 800);
  if (!foreign && (await canBind(PREFERRED_PORT))) return PREFERRED_PORT;
  const port = await ephemeralPort();
  console.log(`  Port ${PREFERRED_PORT} déjà utilisé par une autre application — Vite sur le port ${port}`);
  return port;
}

/**
 * Attendre que *notre* Vite réponde : `/@vite/client` n'existe que sur un serveur Vite,
 * une autre application sur le même port ne passe pas ce contrôle.
 */
function waitForVite(port, timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const res = await probe(port, '/@vite/client');
      if (res && res.status === 200 && res.type.includes('javascript')) return resolve();
      if (Date.now() - start > timeoutMs) reject(new Error(`Vite ne répond pas sur http://${HOST}:${port}`));
      else setTimeout(tick, 300);
    };
    void tick();
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
function startVite(port) {
  const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  mkdirSync(path.join(root, 'dist-electron'), { recursive: true });
  const logPath = path.join(root, 'dist-electron', 'vite-launcher.log');
  const log = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [viteJs, '--host', HOST, '--port', String(port), '--strictPort'], {
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

function runElectron(port) {
  return new Promise((resolve, reject) => {
    const bin = electronBinary();
    const child = spawn(bin, ['.', '--launcher'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CANTO_DEV_URL: `http://${HOST}:${port}`,
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
    const port = await choosePort();
    const vite = startVite(port);
    let viteExit = null;
    vite.on('close', (code) => {
      viteExit = code ?? 1;
    });

    try {
      await Promise.race([
        waitForVite(port),
        new Promise((_, reject) => {
          const iv = setInterval(() => {
            if (viteExit !== null) {
              clearInterval(iv);
              reject(
                new Error(
                  `Vite s'est arrêté (code ${viteExit}). Voir dist-electron/vite-launcher.log` +
                    (viteExit !== 0 ? ` — port ${port} peut-être déjà pris, ou dépendance manquante.` : ''),
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

    console.log(`  Vite prêt · http://${HOST}:${port}`);
    try {
      await electronReady;
    } catch (e) {
      stopChild(vite);
      throw e;
    }
    const code = await runElectron(port);
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
