import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataEnv, electronArgs, frontContract, GESTURES, LANGS, parseArgs, REPO, shotName, SIZES, ZONES } from '../scripts/capture-oros5.mjs';

/**
 * OROS5.47 — la recette de la vague sous Electron (`scripts/capture-oros5.mjs`). Le script se lance sur le poste de l'ADMIN
 * sans modification : il lit, navigue et capture, n'écrit rien de lui-même dans un coffre réel, ne contourne ni le verrou
 * ni un dialogue du process principal, et laisse à l'opérateur chaque geste qui décide. Ces tests tiennent ses règles et
 * ses sélecteurs, que le desk doit continuer de poser.
 */

const SOURCE = readFileSync('scripts/capture-oros5.mjs', 'utf8').replace(/\r\n/g, '\n');
const posix = (p: string) => p.split(/[/\\]/).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(?:tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}
const DESK = walk('src')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('OROS5.47 · la recette sous Electron', () => {
  it('lit ses arguments : trois langues, deux tailles, et le jeu de démonstration jamais dans un coffre réel', () => {
    const opts = parseArgs(['--out', 'captures']);
    expect(posix(opts.out).endsWith('/captures')).toBe(true);
    expect(opts.langs).toEqual(['fr', 'en', 'es']);
    expect(LANGS).toEqual(['fr', 'en', 'es']);
    expect(opts.sizes).toEqual([
      { width: 1600, height: 1000 },
      { width: 1180, height: 720 },
    ]);
    expect(SIZES).toEqual(opts.sizes);
    expect(opts).toMatchObject({ data: null, demo: false, instrument: null, waitMs: 180_000 });
    expect(() => parseArgs([])).toThrow(/--out/);
    expect(() => parseArgs(['--out', 'x', '--demo'])).toThrow(/coffre réel/);
    expect(parseArgs(['--out', 'x', '--data', 'banc', '--demo'])).toMatchObject({ demo: true });
    expect(() => parseArgs(['--out', 'x', '--sizes', '1024x700'])).toThrow(/fenêtre minimale/);
    expect(parseArgs(['--out', 'x', '--sizes', '1180x720']).sizes).toEqual([{ width: 1180, height: 720 }]);
    expect(() => parseArgs(['--out', 'x', '--langs', 'fr,de'])).toThrow(/de/);
    expect(parseArgs(['--out', 'x', '--langs', 'es']).langs).toEqual(['es']);
    expect(() => parseArgs(['--out', 'x', '--wait', '30'])).toThrow(/45 s/);
    expect(parseArgs(['--out', 'x', '--wait', '60']).waitMs).toBe(60_000);
    expect(() => parseArgs(['--out', 'x', '--phrase', 'p'])).toThrow(/inconnu/);
    expect(() => parseArgs(['--out', '--data'])).toThrow(/valeur manquante/);
  });

  it('ne prend un dossier de données de banc que sous Linux ; Electron du dépôt, sans bac à sable pour root seulement', () => {
    const env = dataEnv('linux', '/banc');
    expect(Object.keys(env).sort()).toEqual(['HOME', 'XDG_CONFIG_HOME']);
    expect(posix(env.XDG_CONFIG_HOME!)).toBe('/banc/config');
    expect(posix(env.HOME!)).toBe('/banc/home');
    expect(() => dataEnv('win32', 'C:\\banc')).toThrow(/Linux seulement/);
    expect(() => dataEnv('darwin', '/banc')).toThrow(/Linux seulement/);
    expect(electronArgs('linux', 0)).toEqual([REPO, '--no-sandbox']);
    expect(electronArgs('linux', 1000)).toEqual([REPO]);
    expect(electronArgs('win32', undefined)).toEqual([REPO]);
    expect(electronArgs('darwin', 501)).toEqual([REPO]);
    expect(shotName('es', { width: 1180, height: 720 }, 'kill-switch')).toBe('es-1180x720-kill-switch.png');
  });

  it('propose sur le contrat trimestriel du Micro Nasdaq en cours, roulé le 10 du mois d’échéance', () => {
    expect(frontContract(new Date('2026-11-04T06:00:00Z'))).toBe('MNQ 12-26');
    expect(frontContract(new Date('2026-12-09T06:00:00Z'))).toBe('MNQ 12-26');
    expect(frontContract(new Date('2026-12-10T06:00:00Z'))).toBe('MNQ 03-27');
    expect(frontContract(new Date('2027-01-05T06:00:00Z'))).toBe('MNQ 03-27');
    expect(frontContract(new Date('2026-06-10T06:00:00Z'))).toBe('MNQ 09-26');
  });

  it('ne contourne ni le verrou ni un dialogue du process principal, n’écrit rien par le preload et laisse chaque geste à l’opérateur', () => {
    // La phrase est saisie, jamais doublée : aucun script d'initialisation, aucune empreinte réécrite.
    expect(SOURCE).not.toMatch(/crypto\.subtle|\.digest\b|addInitScript/);
    expect(SOURCE).toMatch(/process\.env\.CANTO_PHRASE/);
    // Ni la console, ni un fichier, ni le rapport ne reçoivent la phrase : aucune de ces lignes ne nomme la variable.
    const leaks = SOURCE.split('\n').filter((line) => /console\.|writeFileSync|report\./.test(line) && (/\$\{[^}]*\bphrase\b/.test(line) || /\bphrase\b/.test(line.replace(/'[^']*'|`[^`]*`|"[^"]*"/g, ''))));
    expect(leaks).toEqual([]);
    // Aucun dialogue du process principal n'est intercepté ni répondu par le script.
    expect(SOURCE).not.toMatch(/showMessageBox|dialog\.show|\bdialog\b\s*[.=]/);
    expect(SOURCE).not.toMatch(/Envoyer l’ordre|Send the order|Enviar la orden/);
    // Le preload n'est lu que pour trois états ; aucune écriture, aucun ordre, aucun kill switch par l'IPC.
    const calls = new Set([...SOURCE.matchAll(/window\.canto\??\.([a-zA-Z]+)\??\.([a-zA-Z]+)/g)].map((m) => `${m[1]}.${m[2]}`));
    expect([...calls].sort()).toEqual(['agentOrders.status', 'mcp.status', 'ntbridge.status']);
    // Le kill switch est le raccourci global du process principal : un geste de l'opérateur, jamais une touche de la page.
    expect(SOURCE).not.toMatch(/keyboard\.press\(['"](?:Control|Meta)\+Shift\+K/i);
    // Chaque geste de l'opérateur est demandé par la recette, et chacun a ses mots.
    const performed = new Set([...SOURCE.matchAll(/operator\.perform\('([a-zA-Z]+)'/g)].map((m) => m[1]));
    expect([...performed].sort()).toEqual(Object.keys(GESTURES).sort());
    // Le jeu de démonstration et la discipline ne se règlent qu'au banc (--demo, qui demande --data).
    expect(SOURCE).toMatch(/if \(opts\.demo && !staged\)/);
    // Playwright n'est pas une dépendance : il vient de PLAYWRIGHT_MODULE, importé à la demande.
    expect(SOURCE).not.toMatch(/^import [^\n]*['"]playwright['"]/m);
    expect(SOURCE).toMatch(/process\.env\.PLAYWRIGHT_MODULE/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => /playwright/.test(name))).toEqual([]);
  });

  it('mesure les pièces de la vague et lit le desk par des sélecteurs que le desk pose encore', () => {
    expect(ZONES).toEqual(['[data-drawer]', 'footer[data-chassis="status"]', '[data-frise]', '[role="alert"]', '[data-proposals]']);
    // Chaque attribut que la recette lit est posé par le desk : une recette sans modification suit le desk tel qu'il est.
    const attributes = new Set([...SOURCE.matchAll(/\[(data-[a-z-]+)/g)].map((m) => m[1]!));
    expect(attributes.size).toBeGreaterThanOrEqual(14);
    const missing = [...attributes].filter((name) => !new RegExp(`\\b${name}[=}\\s"'>/]`).test(DESK) && !DESK.includes(`'${name}'`));
    expect(missing).toEqual([]);
    for (const id of ['agent-tab-options', 'agent-tab-conversation', 'agent-panel-options']) expect(DESK).toContain(id.replace(/-(?:options|conversation)$/, '-'));
    expect(DESK).toMatch(/aria-labelledby="gate-title"/);
  });
});
