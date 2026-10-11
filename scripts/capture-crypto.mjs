/**
 * Capture l'onglet 09 · CRY sur le banc local (CRY4.4), en anglais, à 1600×1000, par un navigateur Chromium sans interface.
 *
 * Le serveur de développement doit écouter 127.0.0.1:5173 (`npx vite`). Le banc (`scripts/harness`) monte le vrai onglet sur
 * un faux desk nourri des réponses réelles du 9 octobre 2026 : aucun réseau, aucune phrase d'ouverture, aucune dépendance.
 *
 *   node scripts/capture-crypto.mjs [--out <fichier.png>]                (défaut : docs/design/crypto/09-cry.png)
 *   node scripts/capture-crypto.mjs --scroll end [--out <fichier.png>]   (le bas de la colonne : Alertes, Source, Agent ;
 *                                                                          défaut : docs/design/crypto/09-cry-column.png)
 *
 * Le navigateur est lu dans EDGE_PATH, puis CHROME_PATH, puis aux emplacements standard d'Edge, puis à ceux de Chrome.
 * Il part avec un profil jetable : la capture ne touche ni au profil de l'utilisateur ni à un navigateur déjà ouvert, et
 * le coffre du banc est neuf à chaque fois. Les heures de la légende sont celles du fuseau du poste.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PAGE_URL = 'http://127.0.0.1:5173/scripts/harness/crypto.html?lang=en';
export const DEFAULT_OUT = path.resolve(__dirname, '../docs/design/crypto/09-cry.png');
export const DEFAULT_OUT_COLUMN = path.resolve(__dirname, '../docs/design/crypto/09-cry-column.png');
/** Le temps que le serveur de développement met à répondre, puis celui que le navigateur a pour photographier (le banc rend la main en moins de 5 s). */
const SERVER_TIMEOUT_MS = 60_000;
const BROWSER_TIMEOUT_MS = 90_000;

/** Les emplacements standard d'Edge et de Chrome (ou Chromium), dans l'ordre où ils sont essayés. */
export function standardBrowserPaths(platform, env) {
  if (platform === 'win32') {
    const roots = [env.ProgramFiles ?? 'C:\\Program Files', env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'];
    const chrome = roots.map((root) => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (env.LOCALAPPDATA) chrome.push(path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return { edge: roots.map((root) => path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')), chrome };
  }
  if (platform === 'darwin') {
    return {
      edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    };
  }
  return {
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
}

/**
 * Le navigateur à lancer : EDGE_PATH, puis CHROME_PATH, puis Edge, puis Chrome aux emplacements standard. Une variable qui
 * ne mène à aucun fichier est une erreur (un chemin donné n'est jamais ignoré en silence) ; sans rien, l'erreur dit quoi faire.
 */
export function resolveBrowser(env = process.env, exists = existsSync, platform = process.platform) {
  for (const name of ['EDGE_PATH', 'CHROME_PATH']) {
    const given = env[name];
    if (given) {
      if (!exists(given)) throw new Error(`capture-crypto : ${name} (${given}) ne mène à aucun fichier.`);
      return given;
    }
  }
  const { edge, chrome } = standardBrowserPaths(platform, env);
  const found = [...edge, ...chrome].find((candidate) => exists(candidate));
  if (!found) {
    throw new Error('capture-crypto : aucun navigateur Chromium trouvé (Edge, puis Chrome). Donner son chemin dans EDGE_PATH ou CHROME_PATH.');
  }
  return found;
}

/** L'adresse du banc : `scroll=end` fait défiler la colonne de droite jusqu'en bas avant la capture. */
export function pageUrl(scroll) {
  return scroll === 'end' ? `${PAGE_URL}&scroll=end` : PAGE_URL;
}

/** Les drapeaux du navigateur : ceux du plan, plus un profil jetable. La page retient son événement load jusqu'à être composée. */
export function browserArgs(out, profile, url = PAGE_URL) {
  return ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,1000', `--user-data-dir=${profile}`, `--screenshot=${out}`, url];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attend que le serveur de développement serve la page du banc. */
export async function waitForServer(url, timeoutMs = SERVER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Pas encore à l'écoute.
    }
    if (Date.now() > deadline) throw new Error(`capture-crypto : rien ne répond sur ${new URL(url).host}. Lancer « npx vite » d'abord.`);
    await sleep(500);
  }
}

/** Lance le navigateur et attend sa sortie ; au-delà du délai, il est tué avec ses sous-processus. */
function runBrowser(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      kill();
      reject(new Error(`capture-crypto : le navigateur n'a pas fini en ${BROWSER_TIMEOUT_MS / 1000} s.`));
    }, BROWSER_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(undefined);
      else reject(new Error(`capture-crypto : le navigateur a rendu le code ${code}.\n${stderr}`));
    });
  });
}

/** La valeur qui suit un drapeau de la ligne de commande, ou `undefined`. */
function flagValue(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const scroll = flagValue('--scroll');
  if (scroll !== undefined && scroll !== 'end') throw new Error('capture-crypto : --scroll n\'accepte que « end ».');
  const given = flagValue('--out');
  const out = given ? path.resolve(given) : scroll ? DEFAULT_OUT_COLUMN : DEFAULT_OUT;
  const browser = resolveBrowser();
  await waitForServer(PAGE_URL);
  mkdirSync(path.dirname(out), { recursive: true });
  // Une capture d'avant ne doit pas passer pour celle-ci.
  rmSync(out, { force: true });
  const profile = mkdtempSync(path.join(tmpdir(), 'canto-crypto-'));
  try {
    await runBrowser(browser, browserArgs(out, profile, pageUrl(scroll)));
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
  if (!existsSync(out) || statSync(out).size === 0) throw new Error(`capture-crypto : ${out} n'a pas été écrit.`);
  console.log('capture écrite dans', out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
