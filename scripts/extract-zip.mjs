/**
 * Extraction zip sans binding natif.
 * Windows bloque parfois `@electron-internal/extract-zip` (Smart App Control) —
 * electron/electron#52481. On passe par tar / Expand-Archive, puis un inflate JS.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const SIG_EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const SIG_CD = 0x02014b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export async function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const os = process.platform;
  if (os === 'win32' || os === 'darwin') {
    try {
      await run('tar', ['-xf', zipPath, '-C', destDir]);
      return;
    } catch {
      /* JS / PowerShell */
    }
  }
  if (os === 'win32') {
    try {
      await expandArchive(zipPath, destDir);
      return;
    } catch {
      /* JS */
    }
  }
  await extractZipJs(zipPath, destDir);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, shell: false });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function expandArchive(zipPath, destDir) {
  const cmd = `Expand-Archive -LiteralPath ${psLiteral(zipPath)} -DestinationPath ${psLiteral(destDir)} -Force`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd]);
}

export async function extractZipJs(zipPath, destDir) {
  const dest = path.resolve(destDir);
  mkdirSync(dest, { recursive: true });
  const fh = await open(zipPath, 'r');
  try {
    const stat = await fh.stat();
    const eocd = await readEocd(fh, stat.size);
    if (eocd.cdSize === 0xffffffff || eocd.cdOffset === 0xffffffff) {
      throw new Error('zip64 non pris en charge');
    }
    const cd = Buffer.alloc(eocd.cdSize);
    const { bytesRead } = await fh.read(cd, 0, eocd.cdSize, eocd.cdOffset);
    if (bytesRead !== eocd.cdSize) throw new Error('répertoire central zip tronqué');
    let p = 0;
    for (let i = 0; i < eocd.entries; i++) {
      if (cd.readUInt32LE(p) !== SIG_CD) throw new Error('entrée centrale zip invalide');
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOff = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      await extractEntry(fh, zipPath, dest, { name, method, compSize, uncompSize, localOff });
    }
  } finally {
    await fh.close();
  }
}

async function readEocd(fh, fileSize) {
  const max = Math.min(fileSize, 22 + 65535);
  const buf = Buffer.alloc(max);
  await fh.read(buf, 0, max, fileSize - max);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === SIG_EOCD[0] && buf[i + 1] === SIG_EOCD[1] && buf[i + 2] === SIG_EOCD[2] && buf[i + 3] === SIG_EOCD[3]) {
      return {
        entries: buf.readUInt16LE(i + 10),
        cdSize: buf.readUInt32LE(i + 12),
        cdOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  throw new Error('fin de zip introuvable');
}

async function extractEntry(fh, zipPath, dest, entry) {
  const local = Buffer.alloc(30);
  await fh.read(local, 0, 30, entry.localOff);
  const nameLen = local.readUInt16LE(26);
  const extraLen = local.readUInt16LE(28);
  const dataOff = entry.localOff + 30 + nameLen + extraLen;
  const rel = entry.name.replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.includes('..')) throw new Error(`chemin zip refusé : ${entry.name}`);
  const out = path.resolve(dest, rel);
  const destRoot = dest.endsWith(path.sep) ? dest : dest + path.sep;
  if (out !== dest && !out.startsWith(destRoot)) throw new Error(`chemin zip hors cible : ${entry.name}`);
  if (rel.endsWith('/')) {
    await mkdir(out, { recursive: true });
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  if (entry.method === METHOD_STORE) {
    await copySlice(zipPath, dataOff, entry.compSize, out);
    return;
  }
  if (entry.method !== METHOD_DEFLATE) throw new Error(`méthode zip ${entry.method} non supportée`);
  if (entry.compSize === 0) {
    await writeFile(out, '');
    return;
  }
  const rs = createReadStream(zipPath, { start: dataOff, end: dataOff + entry.compSize - 1 });
  const ws = createWriteStream(out);
  await pipeline(rs, createInflateRaw(), ws);
}

async function copySlice(zipPath, start, size, out) {
  if (size === 0) {
    await writeFile(out, '');
    return;
  }
  const rs = createReadStream(zipPath, { start, end: start + size - 1 });
  const ws = createWriteStream(out);
  await pipeline(rs, ws);
}
