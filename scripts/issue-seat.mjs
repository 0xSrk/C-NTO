#!/usr/bin/env node
/**
 * Siège nominatif (docs/SIEGE-NOMINATIF.md). À lancer par l'ADMIN, sur son poste, jamais en CI.
 *
 *   node scripts/issue-seat.mjs --new-key [--out <fichier.pem>] [--write]
 *     Génère la paire de siège. La clé privée (PKCS#8, PEM) va dans --out
 *     (défaut : ~/.canto/seat-signing-key.pem), mode 0600, jamais écrasée, jamais dans le dépôt.
 *     La clé publique est affichée ; --write l'inscrit dans electron/seat-keys.ts.
 *
 *   node scripts/issue-seat.mjs --key <fichier.pem> --client "<nom>" [--date YYYY-MM-DD]
 *     Imprime la ligne SIEGE1.<payload>.<signature> sur la sortie standard, et rien d'autre.
 *     Refuse une clé absente de electron/seat-keys.ts : un code que les desks refuseraient n'est pas imprimé.
 *
 * Ce n'est pas la clé de publication (scripts/release-key.mjs) : aucune ne remplace l'autre.
 * Le format et les règles sont ceux de electron/seat.ts, que le desk applique.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const ARTEFACT = '002';
const CLIENT_MAX = 24;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Fin de ligne LF ou CRLF : sous Windows, git extrait le fichier en CRLF.
const MARKER = /^( *\/\/ clés)(\r?\n)/m;

function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

function fail(message) {
  console.error(`issue-seat : ${message}`);
  process.exit(1);
}

const inRepo = (file) => path.resolve(file).startsWith(`${root}${path.sep}`);
const keysFile = flag('--keys-file') ?? path.join(root, 'electron', 'seat-keys.ts');
const releaseKeysFile = path.join(root, 'electron', 'release-keys.ts');
const listed = (src) => src.match(/'([A-Za-z0-9_-]{43})'/g)?.map((q) => q.slice(1, -1)) ?? [];
const publicX = (key) => createPublicKey(key).export({ format: 'jwk' }).x;

async function keysSource() {
  const src = await readFile(keysFile, 'utf8');
  if (!MARKER.test(src)) fail(`repère « // clés » introuvable dans ${path.relative(root, keysFile)}`);
  return src;
}

/** Ajoute la clé publique à la liste embarquée, sans doublon, avec la fin de ligne du fichier. */
async function inscribe(x) {
  const src = await keysSource();
  if (src.includes(`'${x}'`)) {
    console.log(`Clé publique déjà inscrite dans ${path.relative(root, keysFile)}.`);
    return;
  }
  await writeFile(keysFile, src.replace(MARKER, (_m, line, eol) => `${line}${eol}  '${x}',${eol}`), 'utf8');
  console.log(`Clé publique inscrite dans ${path.relative(root, keysFile)} : à committer.`);
}

/** Même règle que le desk : 1 à 24 caractères, sans espace en bord, sans contrôle ni caractère de format. */
function clientValid(client) {
  const length = [...client].length;
  return length >= 1 && length <= CLIENT_MAX && client === client.trim() && !FORBIDDEN.test(client);
}

function dateValid(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

if (args.includes('--new-key')) {
  const out = path.resolve(flag('--out') ?? path.join(homedir(), '.canto', 'seat-signing-key.pem'));
  if (inRepo(out)) fail('la clé privée ne doit pas être écrite dans le dépôt');
  if (existsSync(out)) fail(`${out} existe déjà : une clé n'est jamais écrasée`);
  // Avec --write, le fichier des clés est vérifié avant de générer : jamais de clé privée orpheline.
  if (args.includes('--write')) await keysSource();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
  await writeFile(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  await chmod(out, 0o600).catch(() => {});
  const x = publicKey.export({ format: 'jwk' }).x;
  console.log(`Clé privée de siège : ${out} (0600). Sauvegardez-la hors ligne ; ne la mettez ni dans le dépôt ni dans un secret GitHub.`);
  console.log(`Clé publique : ${x}`);
  if (args.includes('--write')) await inscribe(x);
  else console.log('Ajoutez-la dans electron/seat-keys.ts, sous « // clés ».');
  process.exit(0);
}

const keyPath = flag('--key');
if (!keyPath) fail('--key <fichier.pem> requis (pas de chemin par défaut)');
if (inRepo(keyPath)) fail('la clé privée ne doit pas être lue depuis le dépôt');
const client = flag('--client');
if (client === undefined) fail('--client "<nom>" requis');
if (!clientValid(client)) fail(`--client : 1 à ${CLIENT_MAX} caractères, sans espace en bord, sans caractère de contrôle ni de format`);
const date = flag('--date') ?? new Date().toISOString().slice(0, 10);
if (!dateValid(date)) fail('--date : YYYY-MM-DD, date réelle');

const privateKey = createPrivateKey(await readFile(keyPath, 'utf8'));
const x = publicX(privateKey);
if (existsSync(releaseKeysFile) && listed(await readFile(releaseKeysFile, 'utf8')).includes(x)) fail('cette clé est une clé de publication : un siège se signe avec la clé de siège');
if (!listed(await keysSource()).includes(x)) fail(`cette clé n'est pas dans ${path.relative(root, keysFile)} : les desks refuseraient ce siège`);

const payload = Buffer.from(JSON.stringify({ artefact: ARTEFACT, client, date }), 'utf8').toString('base64url');
const signature = sign(null, Buffer.from(`SIEGE1.${payload}`, 'ascii'), privateKey).toString('base64url');
console.log(`SIEGE1.${payload}.${signature}`);
