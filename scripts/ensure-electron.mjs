/**
 * Garantit node_modules/electron/dist sans charger le binding natif extract-zip.
 * Usage : importé par launch.mjs, ou `node scripts/ensure-electron.mjs`.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractZip } from './extract-zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');

function platformPath(platform) {
  if (platform === 'darwin' || platform === 'mas') return 'Electron.app/Contents/MacOS/Electron';
  if (platform === 'win32') return 'electron.exe';
  return 'electron';
}

function installedExe(electronDir, rel, version) {
  const exe = path.join(electronDir, 'dist', rel);
  if (!existsSync(exe)) return null;
  try {
    const got = readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').replace(/^v/, '').trim();
    if (got !== version) return null;
  } catch {
    return null;
  }
  return exe;
}

export async function ensureElectron(root = defaultRoot) {
  const electronDir = path.join(root, 'node_modules', 'electron');
  if (!existsSync(path.join(electronDir, 'package.json'))) {
    throw new Error('Le paquet electron est absent — lancez npm install.');
  }
  const require = createRequire(path.join(electronDir, 'package.json'));
  const { version } = require('./package.json');
  const rel = platformPath(process.platform);
  const already = installedExe(electronDir, rel, version);
  if (already) return already;

  console.log('  Téléchargement du binaire Electron (extraction sans module natif)…');
  const { downloadArtifact } = require('@electron/get');
  let checksums;
  try {
    checksums = require('./checksums.json');
  } catch {
    checksums = undefined;
  }
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    checksums,
    platform: process.platform,
    arch: process.arch,
  });

  const dist = path.join(electronDir, 'dist');
  mkdirSync(dist, { recursive: true });
  await extractZip(zipPath, dist);

  const dtsSrc = path.join(dist, 'electron.d.ts');
  const dtsDst = path.join(electronDir, 'electron.d.ts');
  if (existsSync(dtsSrc)) renameSync(dtsSrc, dtsDst);
  writeFileSync(path.join(electronDir, 'path.txt'), rel);

  const exe = installedExe(electronDir, rel, version) ?? path.join(dist, rel);
  if (!existsSync(exe)) {
    throw new Error(`Extraction Electron incomplète (${rel} manquant).`);
  }
  return exe;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  ensureElectron().then((exe) => {
    console.log('  Electron :', exe);
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
