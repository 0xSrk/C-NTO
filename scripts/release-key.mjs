#!/usr/bin/env node
/**
 * Clé de publication du Lab (Ed25519). À lancer par l'ADMIN, sur son poste, une fois.
 *
 *   node scripts/release-key.mjs [--out <fichier.pem>] [--write]
 *     Génère une paire. La clé privée (PKCS#8, PEM) va dans --out
 *     (défaut : ~/.canto/release-signing-key.pem), mode 0600, jamais écrasée.
 *     La clé publique est affichée ; --write l'ajoute à electron/release-keys.ts.
 *
 *   node scripts/release-key.mjs --public --key <fichier.pem> [--write]
 *     Affiche (et inscrit avec --write) la clé publique d'une clé privée existante.
 *
 * La clé privée ne doit jamais entrer dans ce dépôt ni dans un secret GitHub : c'est elle qui
 * prouve aux desks installés qu'une Release vient du Lab.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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

function fail(message) {
  console.error(`release-key : ${message}`);
  process.exit(1);
}

const keysFile = flag('--keys-file') ?? path.join(root, 'electron', 'release-keys.ts');
const MARKER = '  // clés\n';

/** Ajoute la clé publique à la liste embarquée, sans doublon. */
async function inscribe(x) {
  const src = await readFile(keysFile, 'utf8');
  if (!src.includes(MARKER)) fail(`repère « // clés » introuvable dans ${path.relative(root, keysFile)}`);
  if (src.includes(`'${x}'`)) {
    console.log(`Clé publique déjà inscrite dans ${path.relative(root, keysFile)}.`);
    return;
  }
  await writeFile(keysFile, src.replace(MARKER, `${MARKER}  '${x}',\n`), 'utf8');
  console.log(`Clé publique inscrite dans ${path.relative(root, keysFile)} : à committer.`);
}

const publicX = (key) => createPublicKey(key).export({ format: 'jwk' }).x;

if (args.includes('--public')) {
  const keyPath = flag('--key');
  if (!keyPath) fail('--key <fichier.pem> requis');
  const x = publicX(createPrivateKey(await readFile(keyPath, 'utf8')));
  console.log(x);
  if (args.includes('--write')) await inscribe(x);
  process.exit(0);
}

const out = path.resolve(flag('--out') ?? path.join(homedir(), '.canto', 'release-signing-key.pem'));
if (out.startsWith(`${root}${path.sep}`)) fail('la clé privée ne doit pas être écrite dans le dépôt');
if (existsSync(out)) fail(`${out} existe déjà : une clé n'est jamais écrasée`);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
await writeFile(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
await chmod(out, 0o600).catch(() => {});
const x = publicKey.export({ format: 'jwk' }).x;
console.log(`Clé privée : ${out} (0600). Sauvegardez-la hors ligne ; ne la mettez ni dans le dépôt ni dans un secret GitHub.`);
console.log(`Clé publique : ${x}`);
if (args.includes('--write')) await inscribe(x);
else console.log('Ajoutez-la avec --public --key <fichier> --write, ou à la main dans electron/release-keys.ts.');
