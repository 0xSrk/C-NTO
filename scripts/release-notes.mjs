#!/usr/bin/env node
/**
 * Prépare la Release à partir de `src/engine/changelog/changelog.json`.
 *
 * - `publish/changelog.json` : le journal complet (asset de la Release) ;
 * - `release-notes.md` : l'entrée de la version, français puis anglais.
 *
 * `--check` ne écrit rien : le job `prepare` échoue si l'entrée de `package.json`
 * manque ou n'a pas les trois langues. Le validateur complet vit dans
 * `src/engine/changelog/index.ts` ; ici, le filet du tag, sans compiler le TypeScript.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

const checkOnly = args.includes('--check');
const changelogPath = flag('--changelog') ?? path.join(root, 'src', 'engine', 'changelog', 'changelog.json');
const outDir = flag('--out') ?? path.join(root, 'publish');
const notesPath = flag('--notes') ?? path.join(root, 'release-notes.md');

function fail(message) {
  process.stderr.write(`changelog: ${message}\n`);
  process.exit(1);
}

function languagesOk(entry) {
  const highlights = entry?.highlights;
  if (!highlights) return false;
  const { fr, en, es } = highlights;
  if (!Array.isArray(fr) || !Array.isArray(en) || !Array.isArray(es)) return false;
  if (fr.length === 0 || fr.length !== en.length || fr.length !== es.length) return false;
  return [...fr, ...en, ...es].every((point) => typeof point === 'string' && point.trim().length > 0);
}

const raw = await readFile(changelogPath, 'utf8');
let doc;
try {
  doc = JSON.parse(raw);
} catch {
  fail(`JSON illisible (${path.relative(root, changelogPath)})`);
}

let version = flag('--version');
if (!version) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  version = pkg.version;
}
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) fail(`version illisible (${version})`);

const entries = Array.isArray(doc?.entries) ? doc.entries : [];
const entry = entries.find((item) => item && item.version === version);
if (!entry) fail(`aucune entrée pour ${version}`);
if (!languagesOk(entry)) fail(`l'entrée ${version} n'a pas les trois langues`);

if (checkOnly) {
  process.stdout.write(`changelog: ${version} (${entry.highlights.fr.length} points, fr/en/es)\n`);
  process.exit(0);
}

const notes = [
  `## CΛNTO ${version}`,
  '',
  '### Français',
  '',
  ...entry.highlights.fr.map((point) => `- ${point}`),
  '',
  '### English',
  '',
  ...entry.highlights.en.map((point) => `- ${point}`),
  '',
].join('\n');

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'changelog.json'), raw);
await writeFile(notesPath, notes);
process.stdout.write(`changelog: ${path.join(outDir, 'changelog.json')} + ${notesPath}\n`);
