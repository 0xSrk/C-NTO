import { readFileSync } from 'node:fs';
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
});
