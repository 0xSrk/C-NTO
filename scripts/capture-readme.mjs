/**
 * Recapture README plates at 1538×967 (même cadre que docs/media historique).
 * Usage : le serveur Vite doit déjà écouter 127.0.0.1:5173.
 * Playwright n’est pas une dépendance du dépôt — lancer avec
 *   PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs node scripts/capture-readme.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/media');
const URL = 'http://127.0.0.1:5173/';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--lang=fr-FR'],
  });
  const page = await browser.newPage({
    viewport: { width: 1538, height: 967 },
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    timezoneId: 'America/New_York',
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => document.fonts?.status === 'loaded' || !document.fonts, { timeout: 15_000 }).catch(() => undefined);

  // L’écran de boot se saute au clavier une fois le coffre prêt.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (await page.locator('aside').getByRole('button', { name: /Métrique/i }).isVisible().catch(() => false)) break;
  }
  await page.locator('aside').getByRole('button', { name: /Métrique/i }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('h1').filter({ hasText: 'Métrique' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('Le journal est vide').or(page.getByText('PnL net')).first().waitFor({ timeout: 30_000 });

  const demo = page.getByRole('button', { name: 'Jeu de démonstration', exact: true });
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
  }
  await page.getByText('PnL net').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await dismissToasts(page);

  const shot = async (name) => {
    await page.mouse.move(24, 400);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, name), type: 'png' });
  };
  const nav = (label) => page.locator('aside').getByRole('button', { name: new RegExp(label, 'i') });
  const segment = (name) => page.getByRole('button', { name, exact: true });

  await shot('metrique.png');

  await segment('Analyse').click();
  await page.getByRole('heading', { name: 'Trame horaire' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await shot('analyse.png');

  await segment('Prop firm').click();
  await page.getByText(/Registre indicatif/i).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await shot('propfirm.png');

  await segment('Monte Carlo').click();
  await page.getByText(/bootstrap avec remise/i).waitFor({ timeout: 15_000 });
  await page.getByRole('heading', { name: 'Éventail des trajectoires' }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await shot('montecarlo.png');

  await nav('Visual').click();
  await page.locator('h1').filter({ hasText: 'Visual' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1800);
  await dismissToasts(page);
  await shot('visual.png');

  await nav('Calendrier').click();
  await page.locator('h1').filter({ hasText: 'Calendrier' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await dismissToasts(page);
  await shot('calendrier.png');

  await nav('Note').click();
  await page.locator('h1').filter({ hasText: 'Note' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await dismissToasts(page);
  await shot('note.png');

  await nav('Agent IA').click();
  await page.locator('h1').filter({ hasText: 'Agent IA' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await shot('agent.png');

  await nav('Bot').click();
  await page.locator('h1').filter({ hasText: 'Bot' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await shot('bot.png');

  await nav('Copieur').click();
  await page.locator('h1').filter({ hasText: 'Copieur' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await shot('copieur.png');

  await browser.close();
  console.log('captures écrites dans', OUT);
}

async function dismissToasts(page) {
  const toasts = page.locator('[role="status"] > div');
  for (let i = 0; i < 6; i++) {
    const n = await toasts.count();
    if (n === 0) break;
    await toasts.nth(0).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
