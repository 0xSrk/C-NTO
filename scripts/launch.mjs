#!/usr/bin/env node
/**
 * Lanceur CΛNTO — compile le shell, démarre Vite, ouvre la fenêtre lanceur.
 * Exit code 42 (depuis Electron après une màj) → reboucle.
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAUNCH = 42;
const PORT = 5173;
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const npx = isWin ? 'npx.cmd' : 'npx';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWin,
      env: process.env,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function waitForVite(port = PORT, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const c = connect({ port, host: '127.0.0.1' }, () => {
        c.end();
        resolve();
      });
      c.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Vite ne répond pas sur :${port}`));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

async function compileElectron() {
  const code = await run(npm, ['run', 'electron:compile']);
  if (code !== 0) throw new Error('electron:compile a échoué');
}

function startVite() {
  return spawn(npx, ['vite', '--strictPort', '--port', String(PORT)], {
    cwd: root,
    stdio: 'ignore',
    shell: isWin,
    windowsHide: true,
    env: process.env,
  });
}

function runElectron() {
  return new Promise((resolve) => {
    const electronBin = path.join(root, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
    const child = spawn(electronBin, ['.', '--launcher'], {
      cwd: root,
      stdio: 'inherit',
      shell: isWin,
      env: {
        ...process.env,
        CANTO_DEV_URL: `http://127.0.0.1:${PORT}`,
        CANTO_LAUNCHER_PARENT: '1',
      },
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function main() {
  console.log('\n  CΛNTO · lanceur Lab\n');
  await compileElectron();

  for (;;) {
    const vite = startVite();
    try {
      await waitForVite();
    } catch (e) {
      vite.kill();
      throw e;
    }
    const code = await runElectron();
    vite.kill();
    await new Promise((r) => setTimeout(r, 400));
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
