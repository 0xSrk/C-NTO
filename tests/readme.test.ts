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
    expect(visual).toContain('System 4.0 « ΟΡΟΣ »');
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
});
