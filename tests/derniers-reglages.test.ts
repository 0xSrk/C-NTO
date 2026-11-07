import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OROS5.52 — les derniers réglages de l'ADMIN (2026-11-07) se consignent dans `docs/AUDIT.md`, après la clôture du
 * Système 5 : la demande, une ligne par ticket avec ses citations et son test, la recette, ce que l'ADMIN peut renverser
 * et ce qui reste ouvert.
 */
const audit = readFileSync('docs/AUDIT.md', 'utf8').replace(/\r\n/g, '\n');
const HEAD = '\n## Système 5 — derniers réglages de l’ADMIN (2026-11-07)\n';
const start = audit.indexOf(HEAD);
const next = audit.indexOf('\n## ', start + 1);
const section = start < 0 ? '' : audit.slice(start, next < 0 ? undefined : next);
const row = (id: string) => section.split('\n').filter((line) => line.startsWith(`| ${id} |`));

describe('OROS5.52 · les derniers réglages de l’ADMIN se consignent', () => {
  it('la section suit la clôture du Système 5 et dit la demande de l’ADMIN', () => {
    expect(start).toBeGreaterThan(audit.indexOf('\n## Système 5 « Fiche et Frise » (2026-11-01)\n'));
    expect(audit.indexOf('**Clôture de la vague.**')).toBeLessThan(start);
    expect(section).toContain('supprimer le losange en bas à droite du desk');
    expect(section).toContain('premier indicateur en bas à gauche du desk');
    expect(section).toContain('« une micro + le nom du compte quand connecté »');
  });

  it('une ligne par ticket, chacune avec ses citations et ses tests, qui existent', () => {
    for (const id of ['OROS5.49', 'OROS5.50', 'OROS5.51', 'OROS5.52']) {
      const lines = row(id);
      expect(lines, id).toHaveLength(1);
      const tests = [...lines[0]!.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) expect(existsSync(file), `${id} : ${file}`).toBe(true);
    }
    for (const id of ['OROS5.49', 'OROS5.50', 'OROS5.51']) expect(row(id)[0], id).toMatch(/`src\/app\/[\w.]+:\d+`/);
    expect(row('OROS5.51')[0]).toContain('`src/app/railFit.ts:76`');
    expect(row('OROS5.51')[0]).toContain('113 → 111');
  });

  it('la recette, les choix que l’ADMIN peut renverser et les points ouverts sont dits', () => {
    expect(section).toContain('**Recette.**');
    expect(section).toContain('Le desk Electron, son vrai pont et le siège n’ont pas été lancés dans cette session.');
    const choices = section.slice(section.indexOf('**Choix que l’ADMIN peut renverser.**'), section.indexOf('**Points ouverts.**'));
    expect(choices).toContain('`--mint`');
    expect(choices).toContain('`stale`');
    const open = section.slice(section.indexOf('**Points ouverts.**'));
    expect(open).toContain('README');
    expect(open).toContain('`src/app/StatusBornes.tsx:385`');
  });
});
