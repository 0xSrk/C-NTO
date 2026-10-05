#!/usr/bin/env node
/**
 * Signe la Release avec la clé du Lab, sur le poste de l'ADMIN (jamais en CI).
 *
 *   node scripts/sign-release.mjs --tag v3.4.0 --key <fichier.pem> [--publish] [--repo 0xSrk/C-NTO]
 *     Télécharge SHA256SUMS.txt de la Release (brouillon) avec `gh`, l'affiche, demande de taper la
 *     version pour confirmer, signe, vérifie la signature contre les clés de electron/release-keys.ts,
 *     téléverse SHA256SUMS.txt.sig ; --publish sort la Release du brouillon.
 *
 *   node scripts/sign-release.mjs --sums SHA256SUMS.txt --version 3.4.0 --key <fichier.pem> [--out <sig>]
 *     Hors ligne : écrit seulement la signature, à téléverser à la main.
 *
 * Message signé : `canto-release\n<version>\n<contenu exact de SHA256SUMS.txt>` (electron/release-signature.ts).
 * --yes saute la confirmation (tests, ou après comparaison faite autrement).
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
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

function fail(message) {
  console.error(`sign-release : ${message}`);
  process.exit(1);
}

const keyPath = flag('--key');
if (!keyPath) fail('--key <fichier.pem> requis');
const tag = flag('--tag');
const repo = flag('--repo') ?? '0xSrk/C-NTO';
const keysFile = flag('--keys-file') ?? path.join(root, 'electron', 'release-keys.ts');

let version = flag('--version');
let sumsPath = flag('--sums');
let work = null;
if (tag) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) fail(`tag illisible : ${tag}`);
  version = m[1];
  work = mkdtempSync(path.join(tmpdir(), 'canto-sign-'));
  execFileSync('gh', ['release', 'download', tag, '--repo', repo, '--pattern', 'SHA256SUMS.txt', '--dir', work, '--clobber'], { stdio: 'inherit' });
  sumsPath = path.join(work, 'SHA256SUMS.txt');
}
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('--tag vX.Y.Z, ou --sums <fichier> --version X.Y.Z');
if (!sumsPath) fail('--sums <fichier> requis hors ligne');

const sums = await readFile(sumsPath, 'utf8');
if (!/^[0-9a-f]{64}\s+\S/m.test(sums)) fail(`${sumsPath} ne ressemble pas à une sortie de sha256sum`);

const privateKey = createPrivateKey(await readFile(keyPath, 'utf8'));
const x = createPublicKey(privateKey).export({ format: 'jwk' }).x;
const embedded = (await readFile(keysFile, 'utf8')).match(/'([A-Za-z0-9_-]{43})'/g)?.map((q) => q.slice(1, -1)) ?? [];
if (!embedded.includes(x)) fail(`cette clé n'est pas dans ${path.relative(root, keysFile)} : les desks refuseraient la signature`);

console.log(`\nEmpreintes de v${version} :\n${sums.trimEnd()}\n`);
console.log('Comparez-les au journal du job « publish » (étape SHA-256) de la Release.');
if (!args.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Tapez ${version} pour signer : `)).trim();
  rl.close();
  if (answer !== version) fail('signature annulée');
}

const signature = sign(null, Buffer.from(`canto-release\n${version}\n${sums}`, 'utf8'), privateKey).toString('base64');
const out = flag('--out') ?? path.join(work ?? path.dirname(sumsPath), 'SHA256SUMS.txt.sig');
await writeFile(out, `${signature}\n`, 'utf8');
console.log(`Signature : ${out}`);

if (tag) {
  execFileSync('gh', ['release', 'upload', tag, out, '--repo', repo, '--clobber'], { stdio: 'inherit' });
  console.log(`SHA256SUMS.txt.sig téléversé sur ${tag}.`);
  if (args.includes('--publish')) {
    execFileSync('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false'], { stdio: 'inherit' });
    console.log(`${tag} publiée.`);
  } else {
    console.log(`${tag} reste en brouillon : relancez avec --publish, ou publiez-la depuis GitHub.`);
  }
}
