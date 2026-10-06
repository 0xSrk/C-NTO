/**
 * Recapture les plaques du README (`docs/media`), en anglais, à 1600×1000.
 *
 * Le build navigateur doit écouter 127.0.0.1:5173 (`npx vite`). La phrase d'ouverture du desk est lue
 * dans CANTO_PHRASE : elle n'est écrite ni dans le dépôt, ni dans un journal. Playwright n'est pas une
 * dépendance du dépôt :
 *
 *   CANTO_PHRASE=… PLAYWRIGHT_MODULE=/chemin/playwright/index.mjs CHROME_PATH=/chemin/chrome \
 *     node scripts/capture-readme.mjs [--out <dossier>]
 *
 * Données : le jeu de démonstration (140 séances), plus deux poches, des positions et une topologie Sim
 * saisies dans le navigateur de capture, comme le ferait un trader. Rien n'est envoyé hors de la machine.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:5173/?lang=en';
const VIEW = { width: 1600, height: 1000 };

/** Clique à l'écart du rail : un survol allumerait un module. */
async function park(page) {
  await page.mouse.move(1595, 520);
  await page.waitForTimeout(200);
}

async function dismissToasts(page) {
  const toasts = page.locator('[role="status"] > div');
  for (let i = 0; i < 6; i++) {
    if ((await toasts.count()) === 0) break;
    await toasts.nth(0).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

async function shot(page, out, name, clip) {
  await dismissToasts(page);
  await park(page);
  await page.screenshot({ path: path.join(out, name), ...(clip ? { clip } : {}) });
}

/** Le desk fermé à l'arrivée. */
export async function arrival(page, out) {
  await page.locator('input').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.mouse.move(1595, 980);
  await page.screenshot({ path: path.join(out, 'arrival.png') });
}

/** Ouvre le desk avec la phrase ; « Desk Unlocked » est saisi pendant l'ouverture. */
export async function unlock(page, phrase, out) {
  const input = page.locator('input').first();
  await input.fill(phrase);
  await page.mouse.move(1595, 980);
  await page.getByRole('button', { name: /open/i }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'unlock.png') });
  await page.locator('aside').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(3000);
}

/** Toutes les plaques, desk ouvert. */
export async function capture(page, out) {
  const nav = (label) => page.locator('aside').getByRole('button', { name: new RegExp(`^\\d\\d ${label}`, 'i') }).first();
  const tab = (label) => page.getByRole('tab', { name: new RegExp(label, 'i') });

  await page.getByRole('button', { name: 'LOAD A DEMO DATASET' }).click();
  await page.getByText(/net p&l/i).first().waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'ALL', exact: true }).first().click();
  await page.waitForTimeout(1800);
  await shot(page, out, 'metrique.png');

  await tab('Analysis').click();
  await page.waitForTimeout(2500);
  await shot(page, out, 'analyse.png');

  await tab('Prop firm').click();
  await page.waitForTimeout(2000);
  await shot(page, out, 'propfirm.png');

  await page.locator('select[aria-label="Account"]').selectOption({ label: 'Apex-PA-50K' });
  await tab('Monte.Carlo').click();
  await page.waitForTimeout(9000);
  await shot(page, out, 'montecarlo.png');

  // Réglages › Discipline : la plaque est le cadre de la section, au même rapport 16:10 que les autres.
  await tab('Dashboard').click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/A rule set to 0/).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  for (const [label, value] of [['Max daily loss ($)', 500], ['Trades per day', 6], ['Catalyst window (min)', 10], ['Allowed instruments', 'NQ, MNQ']]) {
    const input = dialog.getByLabel(label).first();
    await input.fill(String(value));
    await input.blur();
  }
  await page.waitForTimeout(600);
  await shot(page, out, 'discipline.png', { x: 480, y: 63, width: 640, height: 400 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await nav('Visual').click();
  await page.waitForTimeout(3000);
  await shot(page, out, 'visual.png');

  await nav('Calendar').click();
  await page.waitForTimeout(2500);
  await shot(page, out, 'calendrier.png');

  await nav('Note').click();
  await page.waitForTimeout(2000);
  await shot(page, out, 'note.png');

  await nav('Portfolio').click();
  await page.waitForTimeout(1500);
  for (const pocket of [
    { name: 'Apex 50K', kind: 'propfirm', account: 'Apex-PA-50K', plan: 'apex-50' },
    { name: 'Long-term', kind: 'actions', venue: 'Broker' },
    { name: 'Reserve', kind: 'liquidites' },
  ]) {
    await page.getByLabel('Pocket name', { exact: true }).fill(pocket.name);
    await page.getByLabel('Pocket type', { exact: true }).selectOption(pocket.kind);
    if (pocket.account) await page.getByLabel('Account', { exact: true }).fill(pocket.account);
    if (pocket.plan) await page.getByLabel('Prop plan', { exact: true }).selectOption(pocket.plan);
    if (pocket.venue) await page.getByLabel('Venue', { exact: true }).fill(pocket.venue);
    await page.getByRole('button', { name: 'Create pocket', exact: true }).click();
    await page.waitForTimeout(700);
  }
  for (const [symbol, qty, avg, last] of [['QQQ', 30, 455, 512], ['GLD', 25, 205, 238]]) {
    await page.getByLabel('Position pocket', { exact: true }).selectOption({ label: 'Long-term · USD' });
    await page.getByLabel('Symbol', { exact: true }).first().fill(symbol);
    await page.getByLabel('Quantity', { exact: true }).first().fill(String(qty));
    await page.getByLabel('Average price', { exact: true }).first().fill(String(avg));
    await page.getByLabel('Last price', { exact: true }).first().fill(String(last));
    await page.getByRole('button', { name: 'Add position', exact: true }).click();
    await page.waitForTimeout(500);
  }
  await page.getByLabel('Cash pocket', { exact: true }).selectOption({ label: 'Reserve' });
  await page.getByLabel('Amount', { exact: true }).fill('12000');
  await page.getByLabel('Cash date', { exact: true }).fill('2026-09-01');
  await page.getByRole('button', { name: 'Add cash', exact: true }).click();
  await page.waitForTimeout(800);
  // Le haut de la synthèse : on remonte le conteneur qui défile.
  await page.getByText(/consolidated net value/i).first().evaluate((el) => {
    let node = el.parentElement;
    while (node && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement;
    if (node) node.scrollTop = 0;
  });
  await page.waitForTimeout(1500);
  await shot(page, out, 'portefeuille.png');

  await nav('AI Agent').click();
  await page.waitForTimeout(2000);
  await shot(page, out, 'agent.png');

  await nav('Bot').click();
  await page.waitForTimeout(2000);
  await shot(page, out, 'bot.png');

  await nav('Copier').click();
  await page.waitForTimeout(1500);
  for (const [name, account, role] of [['Master Sim', 'Sim101', 'maitre'], ['Eval A', 'Sim102', 'suiveur'], ['Eval B', 'Sim103', 'suiveur']]) {
    await page.getByPlaceholder('Name (Apex 50K #2…)').fill(name);
    await page.getByPlaceholder('NinjaTrader account (APEX-1234-02)').fill(account);
    await page.locator('select').filter({ has: page.locator('option[value="suiveur"]') }).first().selectOption(role);
    await page.getByRole('button', { name: /^add$/i }).click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1000);
  await shot(page, out, 'copieur.png');
}

async function main() {
  const phrase = process.env.CANTO_PHRASE;
  if (!phrase) {
    console.error('capture-readme : CANTO_PHRASE requis (la phrase d’ouverture du desk).');
    process.exit(1);
  }
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag > 0 && process.argv[outFlag + 1] ? path.resolve(process.argv[outFlag + 1]) : path.resolve(__dirname, '../docs/media');
  mkdirSync(out, { recursive: true });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--lang=en-US'],
  });
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/New_York' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await arrival(page, out);
  await unlock(page, phrase, out);
  await capture(page, out);
  await browser.close();
  console.log('plaques écrites dans', out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
