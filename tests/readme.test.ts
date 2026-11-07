import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('README.md', 'utf8');
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

describe('README', () => {
  it('aucun badge ne lit l’API GitHub : le dépôt est privé, shields.io y affiche « repo not found »', () => {
    expect(readme).not.toMatch(/img\.shields\.io\/github\//);
  });

  it('le badge de version et les deux cartouches suivent package.json', () => {
    expect(readme).toContain(`https://img.shields.io/badge/version-${version}-`);
    const plates = readme.match(/\*\*`SIΞRRΛSKΛ—LAB · CΛNTO · ARTEFACT 002 · [^`]*`\*\*/g) ?? [];
    expect(plates).toHaveLength(2);
    for (const plate of plates) expect(plate).toContain(` v${version} `);
  });

  it('chaque lien interne mène à une ancre du README', () => {
    const ids = new Set([...readme.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));
    const targets = [...readme.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(20);
    expect(targets.filter((t) => !ids.has(t))).toEqual([]);
  });

  it('R3.7c le README suit le desk 3.7 : système 4.0, licences de polices livrées, plaques servies, onglet Agent IA réagencé', () => {
    // Le système visuel décrit est celui du desk (l'historique des versions garde le 3.4).
    const visual = readme.slice(readme.indexOf('### Visual system'), readme.indexOf('<a id="develop">'));
    // R3.8c le système décrit est la révision 4.1, celle du desk 3.8.
    expect(visual).toContain('System 4.1 « ΟΡΟΣ »');
    expect(visual).not.toMatch(/System 3\.4|Archivo|JetBrains Mono|#E5263D/);
    // Chaque fichier de licence de police cité est livré.
    const licences = [...readme.matchAll(/`((?:src|electron)\/[^`]*OFL-[^`]+\.txt)`/g)].map((m) => m[1]!);
    expect(licences.length).toBeGreaterThanOrEqual(4);
    for (const file of licences) expect(existsSync(file), file).toBe(true);
    // Chaque plaque citée existe, et chaque plaque de docs/media est citée.
    const cited = new Set([...readme.matchAll(/docs\/media\/([a-z-]+\.png)/g)].map((m) => m[1]));
    expect(cited).toEqual(new Set(readdirSync('docs/media').filter((f) => f.endsWith('.png'))));
    // L'onglet Agent IA s'ouvre sur les rapports ; le fournisseur se règle dans les options.
    for (const view of ['A · Reports', 'B · Conversation', 'C · Options']) expect(readme).toContain(view);
    expect(readme).toContain('<a id="lab-reports"></a>');
    // Le dépôt est public, et le bouton de mise à jour n'est plus ambre.
    expect(readme).not.toMatch(/repository is private|turns amber/);
  });

  it('R3.8c le README suit le desk 3.8 : Système 4.1, rail en cartouches, menu Options, verrou ouvert par un circuit', () => {
    // R3.9a « What's new » suit désormais la dernière version (test R3.9a) ; la 3.8.0 garde son ancre dans l'historique.
    expect(readme).toContain('<a id="whats-new-in-380"></a>**3.8.0**');
    expect(readme).toContain('badge/design-System%204.1%20ΟΡΟΣ');
    // Ce que le 4.1 a retiré n'est plus décrit : catégories du rail, survol inerte, plaque TIME ENGINE, accroches d'en-tête,
    // outils de Métrique hors du menu Options.
    expect(readme).not.toMatch(/under \*In design\*|The \*\*rail\*\* is a manifest|nothing reacts to hover|TIME ENGINE|ULTIMATE JOURNAL|A tool row holds/);
    expect(readme).not.toMatch(/Metrics › NinjaTrader bridge|Metrics › \*\*Settings\*\*/);
    expect(readme).toContain('Metrics › Options › NinjaTrader bridge');
    // Les deux plaques du premier lancement : la fiche d'accès et « DESK UNLOCKED » au cœur du circuit.
    expect(readme).toMatch(/access sheet: the phrase, its state, <b>Paste<\/b> and <b>Open<\/b>/);
    expect(readme).toMatch(/the circuit spreads around it and traces the chassis/);
  });

  it("R3.9a le README suit le desk 3.9 : « What's new » de la version publiée, formation quant du Lab, liens d’installation", () => {
    // « What's new » reprend mot pour mot les points anglais de l'entrée du journal qui porte la version de package.json.
    const journal = JSON.parse(readFileSync('src/engine/changelog/changelog.json', 'utf8')) as { entries: { version: string; highlights: { en: string[] } }[] };
    const entry = journal.entries.find((e) => e.version === version);
    expect(entry?.highlights.en.length).toBeGreaterThan(0);
    const news = readme.slice(readme.indexOf(`## What's new in ${version}`), readme.indexOf('<a id="install"></a>'));
    expect(news.length).toBeGreaterThan(0);
    for (const point of entry?.highlights.en ?? []) expect(news).toContain(point);
    expect(news).toContain(`[Release v${version}](https://github.com/0xSrk/C-NTO/releases/tag/v${version})`);
    // Chaque lien d'installation et chaque nom d'installeur cité est celui de la version publiée.
    const installers = [...readme.matchAll(/CANTO-(\d+\.\d+\.\d+)-(?:mac|win|linux)/g)].map((m) => m[1]);
    expect(installers.length).toBeGreaterThanOrEqual(10);
    expect(new Set(installers)).toEqual(new Set([version]));
    // La formation quant est décrite là où le sont les rapports du Lab, et la ligne de sécurité de l'agent cloud la nomme.
    const lab = readme.slice(readme.indexOf('### Lab reports'), readme.indexOf('<a id="ninjatrader-8-bridge"></a>'));
    expect(lab).toContain('**The training.**');
    expect(lab).toContain('Train the agent');
    expect(lab).toContain('$25 cap');
    expect(lab).toContain('`AGT-FRM-YYYYMMDD`');
    expect(readme).not.toContain('The agent reads official sources only');
    expect(readme).toContain('the training is started, resumed and stopped from the Lab\'s own desk only');
  });

  it('R3.9c le README suit le desk de main : la version au pied, les comptes connectés, la ligne de la journée, la fiche et la frise, des plates recapturées avec le pont', () => {
    const desk = readme.slice(readme.indexOf('<a id="the-desk"></a>'), readme.indexOf('<a id="metrics"></a>'));
    // La section dit qu'elle montre main, en avance sur les installeurs de la version publiée.
    expect(desk).toContain('This section and its plates show the desk on `main`.');
    // Le pied du rail : les comptes connectés, et plus la cartouche du compte ; rien sans compte connecté.
    expect(desk).toContain('**connected accounts**');
    expect(desk).toContain('its lamp lit green');
    expect(desk).toContain('nothing at all when none is connected');
    expect(readme).not.toMatch(/the \*\*account\*\* in the same cartouche|then the name and the source/);
    // La version au pied, premier indicateur de la barre d'état : plus en haut à droite.
    expect(desk).toContain('The version comes first and opens the changelog.');
    expect(readme).not.toMatch(/At the top right of the title bar, the version|the version at the top right|beside the version in the title bar|opened from the version at the top right/);
    // La barre d'état est la ligne de la journée : ni Tokyo, ni Paris, ni la phase Globex.
    expect(desk).toContain("The **status bar** is the day's line.");
    expect(readme).not.toMatch(/Tokyo, Paris and New York clocks|the CME Globex phase|The status bar gives the CME Globex session/);
    // Le Système 5 : les portes, la fiche, l'omnibar, la frise et le registre, et la plate de la fiche Compte.
    for (const piece of ['**gates**', '**Every object has its record.**', '**omnibar**', '**The frise and the log.**']) expect(desk, piece).toContain(piece);
    expect(desk).toContain('<img src="docs/media/fiche.png"');
    // Le système visuel suit la doctrine du Système 5 et le voyant à la menthe.
    const visual = readme.slice(readme.indexOf('### Visual system'), readme.indexOf('<a id="develop">'));
    expect(visual).toContain('Gold `#CCB066` says what you hold');
    expect(visual).not.toMatch(/marks what is alive|one is left on the desk, on the kill-switch band/);
    expect(visual).toMatch(/mint `#74C69D`[^.]*connected account/);
    expect(visual).toContain('the version at the bottom left of the status bar');
    // La journée fermée dans les gardes de l'agent (décision 15).
    expect(readme).toContain('the CME day stays closed to openings until the next CME day');
    // Le script des plates pose un pont vivant qui rapporte les deux comptes de la démo, et capture la fiche Compte.
    const script = readFileSync('scripts/capture-readme.mjs', 'utf8');
    expect(script).toContain("export const BRIDGE_ACCOUNTS = ['Sim101', 'Apex-PA-50K'];");
    expect(script).toMatch(/await liveBridge\(page\);\s*await page\.getByRole\('button', \{ name: 'Demo dataset'/);
    expect(script).toContain("await shot(page, out, 'fiche.png');");
  });
});
