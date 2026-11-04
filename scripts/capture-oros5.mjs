/**
 * OROS5.47 — Éprouver la vague « Fiche et Frise » sous Electron, avant la fusion (Système 5, `docs/AUDIT.md`).
 *
 * Le desk du dépôt (`dist/` et `dist-electron/` : `npm run desk:build`) est lancé sous Electron, le sien
 * (`node_modules/electron`), et piloté par Playwright, que le dépôt n'embarque pas : PLAYWRIGHT_MODULE donne son module,
 * comme pour `scripts/capture-readme.mjs`. La phrase d'ouverture est lue dans CANTO_PHRASE ; elle n'est écrite ni dans le
 * dépôt, ni dans un journal, ni dans le rapport.
 *
 *   CANTO_PHRASE=… PLAYWRIGHT_MODULE=/chemin/playwright/index.mjs node scripts/capture-oros5.mjs --out <dossier> \
 *     [--langs fr,en,es] [--sizes 1600x1000,1180x720] [--instrument "MNQ 12-26"] [--wait 180] (--reel | --data <dossier> [--demo])
 *
 * Deux portes de débogage (OROS5.47h). Pour piloter Electron, Playwright ajoute toujours `--inspect=0
 * --remote-debugging-port=0` : pendant toute la recette, l'inspecteur Node du process principal et un port CDP du renderer
 * écoutent sur 127.0.0.1, sans authentification, et l'Electron de node_modules n'a pas le fusible du binaire empaqueté
 * (`enableNodeCliInspectArguments: false`, constat P2 de docs/AUDIT.md). Tout process local qui joint 127.0.0.1 peut y
 * exécuter du code dans le process principal, qui tient le coffre ouvert, les clés et le pont. Le script le dit dans la
 * console avant le premier lancement (DEBUG_PORTS_NOTICE) et ne pilote le coffre réel que sur --reel : un poste à un seul
 * compte, rien d'autre d'ouvert. La phrase reste au script, qui la saisit au verrou : l'environnement passé au desk ne la
 * porte pas (`launchEnv`).
 *
 * Conditions réelles (le poste de l'ADMIN, --reel) : le desk ouvre son coffre réel, le pont NinjaTrader réel et son
 * calendrier. Le script n'y écrit rien de lui-même : il navigue, lit et capture. Ce qui demande la main de l'opérateur, il
 * le dit dans la console et attend que le desk le montre (--wait secondes au plus) : ouvrir la passerelle MCP avec
 * l'écriture autorisée (Agent IA › Options), choisir « Autoriser » dans le dialogue du process principal, laisser expirer
 * le dialogue d'un ordre proposé (45 s, rien à cliquer), amener la perte du jour du compte suivi à 75 % de sa limite puis
 * au-delà, appuyer sur Ctrl+Maj+K. Une étape que le desk ne montre pas est notée « non éprouvée », jamais simulée.
 *
 * Les propositions suivent le flux réel : le script est un agent externe sur la passerelle MCP (127.0.0.1, jeton du
 * desk lu dans son dossier de données, jamais affiché) ; `propose_order` passe par le renderer, la garde du process
 * principal et son dialogue (Refuser par défaut, 45 s). La première part ordres de l'agent désactivés — l'état de chaque
 * ouverture du desk — et la garde la refuse ; la seconde, ordres autorisés, attend l'opérateur, puis expire. Le script ne
 * clique jamais « Envoyer l'ordre ». Le kill switch se fait au clavier, par le raccourci global du process principal :
 * c'est la dernière étape de chaque lancement, la soumission restant fermée jusqu'au redémarrage du desk.
 *
 * Banc (--data, Linux seulement) : un dossier de données neuf (XDG_CONFIG_HOME et HOME y sont pris), jamais un dossier
 * réel ; --demo y charge le jeu de démonstration et y règle la discipline (500 $ de perte du jour, MNQ et NQ) et la
 * passerelle MCP, comme le ferait un trader. Les gestes de l'opérateur restent ceux d'un opérateur : `run()` reçoit, en
 * argument, celui qui les fait (`operator`), la console par défaut.
 *
 * Vérifications, consignées dans `<out>/report.json` : aucune erreur console ni de page ; à chaque capture, dans la fiche,
 * la barre d'état, le tiroir de la frise, la bande du kill switch et la colonne Propositions, aucune police sous 10 px,
 * aucun texte coupé en ellipse (hors du fil d'Ariane de la fiche) et aucune page plus large que la fenêtre. Code de
 * sortie 1 si une vérification échoue.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '..');
export const LANGS = ['fr', 'en', 'es'];
/** Les deux tailles de la recette : l'écran d'usage, et la fenêtre minimale du desk (`minWidth`, `minHeight`). */
export const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1180, height: 720 },
];
const MIN_SIZE = { width: 1180, height: 720 };
/** Le dossier du desk sous XDG_CONFIG_HOME (`USER_DATA_DIR_NAME`, `electron/user-data.ts`). */
export const USER_DATA_DIR_NAME = 'CANTO';
/** Les zones que la recette mesure. */
export const ZONES = ['[data-drawer]', 'footer[data-chassis="status"]', '[data-frise]', '[role="alert"]', '[data-proposals]'];

/** Le contrat trimestriel du Micro Nasdaq en cours (mars, juin, septembre, décembre), roulé le 10 du mois d'échéance. */
export function frontContract(date = new Date()) {
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  if (month % 3 === 0 && date.getUTCDate() >= 10) month += 1;
  let quarter = Math.ceil(month / 3) * 3;
  if (quarter > 12) {
    quarter = 3;
    year += 1;
  }
  return `MNQ ${String(quarter).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
}

/** Les arguments de la ligne de commande. --demo n'entre jamais dans un coffre réel : il demande --data. */
export function parseArgs(argv) {
  const opts = { out: null, langs: [...LANGS], sizes: SIZES.map((s) => ({ ...s })), data: null, demo: false, reel: false, instrument: null, waitMs: 180_000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} : valeur manquante`);
      return next;
    };
    if (arg === '--out') opts.out = path.resolve(value());
    else if (arg === '--data') opts.data = path.resolve(value());
    else if (arg === '--demo') opts.demo = true;
    else if (arg === '--reel') opts.reel = true;
    else if (arg === '--instrument') opts.instrument = value();
    else if (arg === '--wait') {
      const seconds = Number(value());
      if (!Number.isFinite(seconds) || seconds < 50) throw new Error('--wait : 50 secondes au moins (le dialogue d’un ordre dure 45 s)');
      opts.waitMs = seconds * 1000;
    } else if (arg === '--langs') {
      const langs = value().split(',').map((l) => l.trim()).filter(Boolean);
      const unknown = langs.filter((l) => !LANGS.includes(l));
      if (!langs.length || unknown.length) throw new Error(`--langs : fr, en, es (${unknown.join(', ') || 'vide'})`);
      opts.langs = langs;
    } else if (arg === '--sizes') {
      opts.sizes = value()
        .split(',')
        .map((spec) => {
          const m = /^(\d{3,5})x(\d{3,5})$/.exec(spec.trim());
          if (!m) throw new Error(`--sizes : largeurxhauteur (${spec})`);
          const size = { width: Number(m[1]), height: Number(m[2]) };
          if (size.width < MIN_SIZE.width || size.height < MIN_SIZE.height) throw new Error(`--sizes : ${spec} est sous la fenêtre minimale du desk (1180x720)`);
          return size;
        });
    } else throw new Error(`argument inconnu : ${arg}`);
  }
  if (!opts.out) throw new Error('--out <dossier> requis');
  if (opts.demo && !opts.data) throw new Error('--demo demande --data : le jeu de démonstration n’entre jamais dans un coffre réel');
  if (opts.reel && opts.data) throw new Error('--reel ou --data : le coffre réel ou un dossier de banc, pas les deux');
  if (!opts.reel && !opts.data) throw new Error('sans --data, le desk ouvre son coffre réel : --reel requis, après avoir lu l’avis des deux portes de débogage');
  return opts;
}

/** OROS5.47h — ce que Playwright ouvre sur le poste, dit avant le premier lancement en conditions réelles. */
export const DEBUG_PORTS_NOTICE =
  'capture-oros5 : Playwright lance le desk avec --inspect=0 --remote-debugging-port=0. Pendant toute la recette, ' +
  'l’inspecteur Node du process principal et un port CDP du renderer écoutent sur 127.0.0.1, sans authentification : ' +
  'tout process local qui les joint exécute du code dans le desk, coffre ouvert, clés et pont compris. ' +
  'Ne lancez --reel que sur un poste à un seul compte, sans autre logiciel ouvert, et fermez le desk à la fin.';

/** L'environnement du desk : celui du script, sans la phrase, qui reste au script et n'est saisie qu'au verrou. */
export function launchEnv(base, extra) {
  const { CANTO_PHRASE: _phrase, ...rest } = { ...base, ...extra };
  return rest;
}

/** L'environnement d'un dossier de données de banc : Linux seulement, où le desk suit XDG_CONFIG_HOME. */
export function dataEnv(platform, dir) {
  if (platform !== 'linux') throw new Error('--data : sous Linux seulement (XDG_CONFIG_HOME) ; ailleurs, le desk ouvre son coffre réel');
  return { XDG_CONFIG_HOME: path.join(dir, 'config'), HOME: path.join(dir, 'home') };
}

/**
 * Les options de lancement d'Electron (OROS5.47i) : le desk du dépôt, et le bac à sable de Chromium, sauf pour root sous
 * Linux (un conteneur de banc). Sous Linux, `_electron.launch` ajoute lui-même `--no-sandbox` dès que `chromiumSandbox`
 * n'est pas vrai, quel que soit l'utilisateur : le bac à sable se demande ici, il ne se retire pas.
 */
export function launchOptions(platform, uid) {
  return { args: [REPO], chromiumSandbox: !(platform === 'linux' && uid === 0) };
}

/** Le nom d'une capture : langue, taille, scène. */
export function shotName(lang, size, scene) {
  return `${lang}-${size.width}x${size.height}-${scene}.png`;
}

/** Ce que l'opérateur fait de sa main, dans sa langue ; la console le lui dit. */
export const GESTURES = {
  gateway: 'Agent IA › Options : ouvrez la passerelle MCP, écriture autorisée.',
  allowAgentOrders: 'Dans le dialogue du desk, choisissez « Autoriser ».',
  letExpire: 'Un ordre proposé attend dans le dialogue du desk : ne cliquez rien, laissez-le expirer (45 s).',
  lossAttention: 'Amenez la perte du jour du compte suivi à 75 % de sa limite (réalisé et latent).',
  lossCrossed: 'Amenez la perte du jour du compte suivi au-delà de sa limite.',
  killSwitch: 'Appuyez sur Ctrl+Maj+K (⌘+Maj+K sous macOS), le kill switch du process principal.',
};

export const consoleOperator = {
  async perform(id) {
    console.log(`[geste de l’opérateur] ${GESTURES[id] ?? id}`);
  },
};

/** Ce qui se lit mal dans les zones, mesuré dans la page : police sous 10 px, texte coupé en ellipse, débordement. */
function measureInPage(zones) {
  const out = { overflow: document.documentElement.scrollWidth > innerWidth + 1 ? `${document.documentElement.scrollWidth}>${innerWidth}` : null, small: [], cut: [] };
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/)[0].replace(/^_?([A-Za-z0-9]+)_.*$/, '$1')}` : ''}`;
  for (const sel of zones) {
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > innerHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && !el.closest('svg') && parseFloat(cs.fontSize) < 10) out.small.push(`${sel} › ${label(el)} ${cs.fontSize} « ${el.textContent.trim().slice(0, 24)} »`);
        if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.closest('[data-crumb]')) out.cut.push(`${sel} › ${label(el)} « ${el.textContent.trim().slice(0, 40)} »`);
      }
    }
  }
  out.small = [...new Set(out.small)].slice(0, 20);
  out.cut = [...new Set(out.cut)].slice(0, 20);
  return out;
}

/** Une recette : un lancement par langue, les scènes à chaque taille, les gestes de l'opérateur, le rapport. */
export async function run(opts, { playwright, operator = consoleOperator, onLaunch, phrase }) {
  for (const need of ['dist/index.html', 'dist-electron/main.js']) {
    if (!existsSync(path.join(REPO, need))) throw new Error(`${need} absent : lancez npm run desk:build`);
  }
  mkdirSync(opts.out, { recursive: true });
  const env = opts.data ? dataEnv(process.platform, opts.data) : {};
  if (opts.data) for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true });
  const electronPath = createRequire(import.meta.url)('electron');
  if (!opts.data) console.warn(DEBUG_PORTS_NOTICE);
  const report = { started: new Date().toISOString(), mode: opts.data ? (opts.demo ? 'banc, démonstration' : 'banc') : 'conditions réelles', langs: opts.langs, sizes: opts.sizes, shots: [], errors: [], skipped: [], steps: [] };
  const instrument = opts.instrument ?? frontContract();
  let staged = false;
  /** La langue du desk avant la recette, rendue à la fin : choisir une langue au rail l'écrit dans `locale.json`. */
  let locale = null;

  for (const lang of opts.langs) {
    const app = await playwright._electron.launch({ executablePath: electronPath, ...launchOptions(process.platform, process.getuid?.()), cwd: REPO, env: launchEnv(process.env, env) });
    const page = await app.firstWindow();
    page.on('console', (msg) => {
      if (msg.type() === 'error') report.errors.push({ lang, kind: 'console', text: msg.text().slice(0, 400) });
    });
    page.on('pageerror', (err) => report.errors.push({ lang, kind: 'page', text: String(err.message ?? err).slice(0, 400) }));
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    if (locale === null) {
      const file = path.join(userData, 'locale.json');
      locale = { file, before: existsSync(file) ? readFileSync(file, 'utf8') : null };
    }
    if (onLaunch) await onLaunch({ app, page, lang });
    const ctx = { app, page, lang, userData, opts, report, operator, instrument };
    try {
      await unlock(page, phrase);
      await setLanguage(page, lang);
      await setSize(ctx, opts.sizes[0]);
      if (opts.demo && !staged) {
        await stageDemo(ctx);
        staged = true;
      }
      await fiches(ctx);
      await frise(ctx);
      await proposals(ctx);
      await loss(ctx);
      await killSwitch(ctx);
    } catch (err) {
      report.errors.push({ lang, kind: 'script', text: String(err?.message ?? err).slice(0, 600) });
      await page.screenshot({ path: path.join(opts.out, `${lang}-erreur.png`) }).catch(() => undefined);
    } finally {
      await app.close().catch(() => undefined);
    }
  }
  // La langue du desk est rendue telle qu'elle était avant la recette.
  if (locale) {
    if (locale.before === null) rmSync(locale.file, { force: true });
    else writeFileSync(locale.file, locale.before, 'utf8');
  }
  report.finished = new Date().toISOString();
  const failed = report.errors.length > 0 || report.shots.some((s) => s.overflow || s.small.length || s.cut.length);
  report.ok = !failed;
  writeFileSync(path.join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function unlock(page, phrase) {
  const input = page.locator('[aria-labelledby="gate-title"] input');
  await input.waitFor({ state: 'visible', timeout: 90_000 });
  await input.fill(phrase);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  // Une touche neuve abrège l'ouverture (4.1).
  await page.keyboard.press('Escape');
  await page.locator('[aria-labelledby="gate-title"]').waitFor({ state: 'detached', timeout: 30_000 });
  await page.locator('aside nav').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/** La langue, choisie au pied du rail comme le ferait l'opérateur. */
async function setLanguage(page, lang) {
  const radio = page.locator('aside [role="radiogroup"] [role="radio"]').nth(LANGS.indexOf(lang));
  if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click();
  await page.waitForFunction((i) => document.querySelectorAll('aside [role="radiogroup"] [role="radio"]')[i]?.getAttribute('aria-checked') === 'true', LANGS.indexOf(lang));
  await page.waitForTimeout(600);
}

async function setSize({ app, page }, size) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    win?.setContentSize(s.width, s.height);
  }, size);
  await page.waitForTimeout(900);
  await page.mouse.move(size.width - 4, Math.round(size.height / 2));
}

const nav = (page, id) => page.locator(`aside button[data-tab="${id}"]`);

async function shot(ctx, size, scene, note) {
  const { page, opts, report, lang } = ctx;
  await page.mouse.move(size.width - 4, Math.round(size.height / 2));
  await page.waitForTimeout(250);
  const file = shotName(lang, size, scene);
  await page.screenshot({ path: path.join(opts.out, file) });
  const measured = await page.evaluate(measureInPage, ZONES);
  report.shots.push({ file, lang, size: `${size.width}x${size.height}`, scene, note: note ?? null, ...measured });
}

/** À chaque taille, la même scène. */
async function atSizes(ctx, scene, ready, note) {
  for (const size of ctx.opts.sizes) {
    await setSize(ctx, size);
    if (ready) await ready();
    await shot(ctx, size, scene, note);
  }
}

function skip(ctx, step, why) {
  ctx.report.skipped.push({ lang: ctx.lang, step, why });
  console.log(`[non éprouvé] ${ctx.lang} · ${step} : ${why}`);
}

/** Attend que le desk montre un état ; l'opérateur a `waitMs` pour le faire paraître. */
async function until(ctx, predicate, arg, timeout = ctx.opts.waitMs) {
  try {
    await ctx.page.waitForFunction(predicate, arg, { timeout, polling: 250 });
    return true;
  } catch {
    return false;
  }
}

/** Le banc : le jeu de démonstration, la discipline et la passerelle MCP, réglés à l'écran comme un trader. */
async function stageDemo(ctx) {
  const { page } = ctx;
  await nav(page, 'metrique').click();
  const demo = page.locator('main button:not([role="menuitem"])', { hasText: /démonstration|demo dataset|demostración/i }).first();
  if (await demo.count()) {
    await demo.click();
    await page.waitForTimeout(4000);
  }
  await page.locator('[data-options] > button').first().click();
  await page.getByRole('menuitem', { name: /Réglages du desk|Desk settings|Ajustes del desk/ }).click();
  const settings = page.getByRole('dialog');
  for (const [label, value] of [
    [/Perte maximale du jour|Max daily loss|Pérdida máxima del día/, '500'],
    [/Trades par journée|Trades per day|Trades por jornada/, '6'],
    [/Fenêtre catalyseur|Catalyst window|Ventana de catalizador/, '10'],
    [/Instruments autorisés|Allowed instruments|Instrumentos autorizados/, 'NQ, MNQ'],
  ]) {
    const input = settings.getByLabel(label).first();
    await input.fill(value);
    await input.blur();
  }
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await openGatewayOnScreen(ctx);
  ctx.report.steps.push({ lang: ctx.lang, step: 'banc', text: 'jeu de démonstration, discipline (500 $, 6 trades, ± 10 min, NQ et MNQ), passerelle MCP en écriture autorisée' });
}

async function openGatewayOnScreen({ page }) {
  await nav(page, 'agent').click();
  await page.locator('#agent-tab-options').click();
  await page.waitForTimeout(600);
  const readOnly = page.getByRole('switch', { name: /lecture seule · MCP|read only · MCP|solo lectura · MCP/ });
  if (await readOnly.count()) await readOnly.first().click();
  const open = page.locator('#agent-panel-options button', { hasText: /Ouvrir la passerelle|Open gateway|Abrir la pasarela/i }).first();
  if (await open.count()) await open.click();
  await page.waitForFunction(async () => (await window.canto.mcp.status()).running, undefined, { timeout: 15_000 });
}

/** La fiche ouverte sur Métrique, Visual, le Calendrier et le Copieur (AF3) : une séance, un catalyseur, un compte. */
async function fiches(ctx) {
  const { page } = ctx;
  await nav(page, 'metrique').click();
  await page.waitForTimeout(800);
  const tabs = page.locator('main [role="tab"]');
  await tabs.nth(1).click();
  await page.waitForTimeout(800);
  const opener = page.locator('[data-open-fiche]').first();
  if (!(await opener.count())) return skip(ctx, 'fiches', 'aucune séance au journal');
  await opener.click();
  await page.locator('[data-drawer]').waitFor({ state: 'visible', timeout: 10_000 });
  await tabs.nth(0).click();
  await atSizes(ctx, 'metrique-fiche', () => page.waitForTimeout(1200), 'fiche Séance sur Métrique › Tableau de bord');
  await nav(page, 'visual').click();
  await atSizes(ctx, 'visual-fiche', () => page.waitForTimeout(1800), 'fiche Séance sur Visual');
  await nav(page, 'calendrier').click();
  await page.waitForTimeout(1500);
  // Un catalyseur s'ouvre par l'omnibar (Ctrl+J), comme le ferait l'opérateur : « EIA » se lit dans les trois langues.
  await page.keyboard.press('Control+J');
  const omni = page.locator('[data-omnibar] input').first();
  let catalyst = false;
  if (await omni.count()) {
    await omni.fill('EIA');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    catalyst = await page
      .locator('[data-drawer="evenement"]')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!catalyst && (await omni.count())) await page.keyboard.press('Escape');
  }
  await atSizes(ctx, 'calendrier-fiche', () => page.waitForTimeout(1000), catalyst ? 'fiche Catalyseur sur le Calendrier, ouverte par Ctrl+J' : 'fiche Séance sur le Calendrier (aucun catalyseur à l’omnibar)');
  const account = page.locator('[data-account-open]').first();
  if (await account.count()) await account.click();
  await nav(page, 'copieur').click();
  await atSizes(ctx, 'copieur-fiche', () => page.waitForTimeout(1200), (await account.count()) ? 'fiche Compte (ΟΡΟΣ · Bornes) sur le Copieur' : 'fiche ouverte sur le Copieur');
}

/** Le tiroir de la frise, déplié par la réponse du temps. */
async function frise(ctx) {
  const { page } = ctx;
  await nav(page, 'metrique').click();
  await page.waitForTimeout(600);
  const answer = page.locator('[data-status="answer"]');
  if (!(await answer.count())) return skip(ctx, 'frise', 'la réponse du temps est absente de la barre d’état');
  if ((await answer.getAttribute('aria-expanded')) !== 'true') await answer.click();
  await page.locator('[data-frise]').waitFor({ state: 'visible', timeout: 5000 });
  await atSizes(ctx, 'frise', () => page.waitForTimeout(600), 'tiroir de la frise déplié');
  await answer.click();
}

async function mcpToken(ctx) {
  return JSON.parse(readFileSync(path.join(ctx.userData, 'mcp-token.json'), 'utf8')).token;
}

/** Un appel à la passerelle MCP, comme un agent externe : jeton porteur, sans en-tête Origin. */
async function mcp(port, token, method, params) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params }),
  });
  return { status: res.status, body: await res.text() };
}

/** Une proposition refusée par la garde, puis une en attente de l'opérateur, qui expire : le flux réel. */
async function proposals(ctx) {
  const { page, lang } = ctx;
  let gateway = await page.evaluate(() => window.canto.mcp.status());
  if (!gateway.running) {
    await ctx.operator.perform('gateway', ctx);
    if (!(await until(ctx, async () => (await window.canto.mcp.status()).running))) return skip(ctx, 'propositions', 'passerelle MCP fermée');
    gateway = await page.evaluate(() => window.canto.mcp.status());
  }
  const bridge = await page.evaluate(() => window.canto.ntbridge?.status?.());
  const account = (bridge?.accounts ?? []).map((a) => (typeof a === 'string' ? a : a?.name)).find((name) => typeof name === 'string' && /^Sim/i.test(name));
  if (!account) return skip(ctx, 'propositions', 'aucun compte Sim* au pont');
  const token = await mcpToken(ctx);
  await mcp(gateway.port, token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'capture-oros5', version: '1' } });
  const args = (reason) => ({ name: 'propose_order', arguments: { account, instrument: ctx.instrument, side: 'buy', qty: 1, reason } });
  const before = await page.locator('[data-proposal]').count();
  const status = await page.evaluate(() => window.canto.agentOrders.status());
  if (status.enabled) skip(ctx, 'proposition refusée', 'les ordres de l’agent sont déjà autorisés : la première proposition ne part pas désactivée');
  const say = (fr, en, es) => ({ fr, en, es })[lang] ?? fr;
  const first = await mcp(gateway.port, token, 'tools/call', args(say('Recette OROS5.47 : une proposition que la garde refuse, ordres de l’agent désactivés.', 'OROS5.47 run: a proposal the guard refuses, agent orders disabled.', 'Prueba OROS5.47: una propuesta que la guarda rechaza, órdenes del agente desactivadas.')));
  ctx.report.steps.push({ lang, step: 'proposition 1', http: first.status, outcome: /"status\\?":\\?"(\w+)/.exec(first.body)?.[1] ?? null });
  await nav(page, 'agent').click();
  await page.locator('#agent-tab-conversation').click();
  if (!(await until(ctx, (n) => document.querySelectorAll('[data-proposal]').length > n, before, 15_000))) return skip(ctx, 'propositions', 'la proposition n’a pas paru dans la colonne');
  await atSizes(ctx, 'proposition-refusee', () => page.waitForTimeout(600), 'proposition refusée par la garde, ordres de l’agent désactivés');

  // Autoriser… ouvre le dialogue du process principal ; l'opérateur seul y répond.
  await page.locator('#agent-tab-options').click();
  const allow = page.locator('#agent-panel-options button', { hasText: /Autoriser…|Allow…|Autorizar…/ }).first();
  if (!(await allow.count())) return skip(ctx, 'proposition en attente', 'bouton Autoriser… absent');
  await allow.scrollIntoViewIfNeeded();
  await allow.click();
  await ctx.operator.perform('allowAgentOrders', ctx);
  if (!(await until(ctx, async () => (await window.canto.agentOrders.status()).enabled))) return skip(ctx, 'proposition en attente', 'ordres de l’agent non autorisés');
  const second = mcp(gateway.port, token, 'tools/call', args(say('Recette OROS5.47 : une proposition qui attend l’opérateur, puis expire.', 'OROS5.47 run: a proposal that waits for the operator, then expires.', 'Prueba OROS5.47: una propuesta que espera al operador y luego expira.')));
  await page.locator('#agent-tab-conversation').click();
  if (!(await until(ctx, () => document.querySelector('[data-proposal][data-stage="dialog"]') !== null, undefined, 20_000))) {
    skip(ctx, 'proposition en attente', 'le dialogue ne s’est pas ouvert (la garde a pu refuser)');
  } else {
    await ctx.operator.perform('letExpire', ctx);
    await atSizes(ctx, 'proposition-en-attente', () => page.waitForTimeout(400), 'proposition en attente de l’opérateur, dialogue ouvert, barre de 45 s');
  }
  const answered = await second;
  ctx.report.steps.push({ lang, step: 'proposition 2', http: answered.status, outcome: /"status\\?":\\?"(\w+)/.exec(answered.body)?.[1] ?? null, timeout: /"timeout\\?":\\?true/.test(answered.body) });
  if (await until(ctx, () => document.querySelector('[data-proposal][data-outcome="declined"]') !== null, undefined, 15_000)) {
    await atSizes(ctx, 'proposition-expiree', () => page.waitForTimeout(400), 'proposition expirée à 45 s, issue declined typée');
  } else skip(ctx, 'proposition expirée', 'aucune issue declined');
}

/** La barre d'état à 75 % de la perte du jour, puis la perte franchie. */
async function loss(ctx) {
  const { page } = ctx;
  await nav(page, 'metrique').click();
  await page.waitForTimeout(500);
  const level = (min) => {
    const cell = document.querySelector('footer [data-borne="loss"]');
    return cell !== null && Number(cell.getAttribute('data-level')) >= min;
  };
  if (!(await page.locator('footer [data-borne="loss"]').count())) return skip(ctx, 'perte du jour', 'aucune perte du jour réglée');
  await ctx.operator.perform('lossAttention', ctx);
  if (await until(ctx, level, 2)) await atSizes(ctx, 'barre-75', () => page.waitForTimeout(500), 'barre d’état : perte du jour à 75 % de sa limite');
  else skip(ctx, 'barre à 75 %', 'la perte du jour n’a pas atteint 75 %');
  await ctx.operator.perform('lossCrossed', ctx);
  if (await until(ctx, level, 3)) {
    await atSizes(ctx, 'perte-franchie', () => page.waitForTimeout(500), 'barre d’état : perte du jour franchie');
    const answer = page.locator('[data-status="answer"]');
    await answer.click();
    await atSizes(ctx, 'perte-franchie-frise', () => page.waitForTimeout(500), 'frise dépliée, perte du jour atteinte');
    await answer.click();
  } else skip(ctx, 'perte franchie', 'la perte du jour n’a pas franchi sa limite');
}

/** Le kill switch au clavier : le raccourci global du process principal, puis le rapport de coupure. */
async function killSwitch(ctx) {
  const { page } = ctx;
  await nav(page, 'metrique').click();
  await ctx.operator.perform('killSwitch', ctx);
  if (!(await until(ctx, () => document.querySelector('[role="alert"]') !== null))) return skip(ctx, 'kill switch', 'la bande ne s’est pas posée');
  const reported = await until(ctx, () => document.querySelector('[data-kill="cut"]') !== null, undefined, 10_000);
  await atSizes(ctx, 'kill-switch', () => page.waitForTimeout(500), reported ? 'bande du kill switch et rapport de coupure' : 'bande du kill switch, sans rapport du pont');
}

async function main() {
  const phrase = process.env.CANTO_PHRASE;
  if (!phrase) {
    console.error('capture-oros5 : CANTO_PHRASE requis (la phrase d’ouverture du desk).');
    process.exit(1);
  }
  const opts = parseArgs(process.argv.slice(2));
  const modulePath = process.env.PLAYWRIGHT_MODULE;
  const playwright = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
  const report = await run(opts, { playwright: playwright.default ?? playwright, phrase });
  console.log(`${report.shots.length} captures dans ${opts.out} · ${report.errors.length} erreur(s) · ${report.skipped.length} étape(s) non éprouvée(s)`);
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
