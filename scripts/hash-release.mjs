#!/usr/bin/env node
/**
 * SHA-256 des artefacts dans `release/` (pas de signature de binaire).
 * Écrit `release/SHA256SUMS.txt`. Sortie 0 si le dossier est vide ou absent.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release');

async function walk(from, acc) {
  const names = await readdir(from);
  for (const name of names) {
    if (name === 'SHA256SUMS.txt') continue;
    const full = path.join(from, name);
    const st = await stat(full);
    if (st.isDirectory()) await walk(full, acc);
    else if (st.isFile()) acc.push(full);
  }
  return acc;
}

if (!existsSync(dir)) {
  console.log('release/ absent — rien à hacher.');
  process.exit(0);
}

const files = (await walk(dir, [])).sort();
if (files.length === 0) {
  console.log('release/ vide — rien à hacher.');
  process.exit(0);
}

const lines = [];
for (const file of files) {
  const buf = await readFile(file);
  const hex = createHash('sha256').update(buf).digest('hex');
  const rel = path.relative(dir, file).replaceAll('\\', '/');
  lines.push(`${hex}  ${rel}`);
}
const out = path.join(dir, 'SHA256SUMS.txt');
await writeFile(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`SHA-256 → ${path.relative(root, out)} (${files.length} fichier(s))`);
