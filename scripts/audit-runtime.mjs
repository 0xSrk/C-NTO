/**
 * Avis de sécurité du runtime livré (SEC1.8).
 *
 * L'étape « dépendances embarquées » de la CI lance `npm audit --omit=dev` : elle ne voit pas Electron, qu'electron-builder
 * exige parmi les `devDependencies`, alors que c'est lui — Chromium et Node — qui part dans chaque installeur. Ce script
 * relit l'audit complet et échoue si un paquet du runtime porte un avis haut ou critique. Les outils de build et de test
 * (Vite, Vitest, electron-builder) n'y entrent pas : leurs avis se lisent dans `npm audit`, ils ne bloquent pas ici.
 *
 * Usage : node scripts/audit-runtime.mjs               lance `npm audit --json`
 *         node scripts/audit-runtime.mjs rapport.json  relit un rapport déjà écrit
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paquets rangés parmi les outils de développement qui s'exécutent pourtant chez le trader. */
export const RUNTIME_PACKAGES = ['electron'];
const BLOCKING = new Set(['high', 'critical']);
const ATTEMPTS = 3;

/**
 * Avis bloquants d'un rapport `npm audit --json` pour les paquets du runtime. Un rapport sans table des vulnérabilités
 * (registre injoignable, erreur de npm) lève : il ne passe jamais pour « aucun avis ».
 */
export function runtimeAdvisories(report, packages = RUNTIME_PACKAGES) {
  const table = report !== null && typeof report === 'object' && !Array.isArray(report) ? report.vulnerabilities : null;
  if (table === null || typeof table !== 'object' || Array.isArray(table)) throw new Error('rapport npm audit illisible');
  const found = [];
  for (const name of packages) {
    const entry = table[name];
    if (!entry || typeof entry !== 'object' || !BLOCKING.has(entry.severity)) continue;
    const advisories = (Array.isArray(entry.via) ? entry.via : [])
      .filter((via) => via !== null && typeof via === 'object')
      .map((via) => `${via.title ?? 'avis sans titre'} · ${via.url ?? 'sans lien'} · ${via.range ?? '?'}`);
    found.push({ name, severity: entry.severity, range: typeof entry.range === 'string' ? entry.range : '?', advisories });
  }
  return found;
}

/** `npm audit --json`, sans shell hors Windows (où `npm` est un `.cmd`). Le code de sortie de npm n'est pas lu : le rapport l'est. */
function auditReport() {
  const win = process.platform === 'win32';
  const run = spawnSync(win ? 'npm.cmd' : 'npm', ['audit', '--json'], { encoding: 'utf8', shell: win, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  return JSON.parse(run.stdout);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const file = process.argv[2];
  let found = null;
  let failure = null;
  for (let attempt = 1; attempt <= (file ? 1 : ATTEMPTS); attempt += 1) {
    try {
      found = runtimeAdvisories(file ? JSON.parse(readFileSync(file, 'utf8')) : auditReport());
      break;
    } catch (err) {
      // Le point d'audit de npm répond parfois par une erreur alors que le verrou est valide : on réessaie, puis on échoue.
      failure = err instanceof Error ? err.message : String(err);
      console.error(`Audit du runtime illisible (tentative ${attempt}/${file ? 1 : ATTEMPTS}) : ${failure}`);
      if (!file && attempt < ATTEMPTS) sleep(attempt * 10_000);
    }
  }
  if (found === null) {
    console.error('::error::Avis de sécurité du runtime non contrôlés : npm audit n’a rendu aucun rapport lisible.');
    process.exit(1);
  }
  if (found.length === 0) {
    console.log(`Runtime livré (${RUNTIME_PACKAGES.join(', ')}) : aucun avis haut ou critique.`);
    return;
  }
  for (const hit of found) {
    console.error(`::error::${hit.name} (${hit.severity}) · versions touchées : ${hit.range}`);
    for (const line of hit.advisories) console.error(`  - ${line}`);
  }
  console.error('Monter la version dans package.json et package-lock.json, puis relever le plancher de tests/deps-floor.test.ts.');
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
