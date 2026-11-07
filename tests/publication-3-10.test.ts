import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * R3.10b — la publication de la 3.10.0 se consigne dans `docs/AUDIT.md`, après les derniers réglages de l'ADMIN : ce
 * qu'elle porte, une ligne par ticket avec ses tests, ce qui ne change pas, les vérifications et ce qui reste, la
 * signature au seul poste de l'ADMIN comprise.
 */
const audit = readFileSync('docs/AUDIT.md', 'utf8').replace(/\r\n/g, '\n');
const readme = readFileSync('README.md', 'utf8');
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const sectionOf = (head: string) => {
  const start = audit.indexOf(head);
  const next = audit.indexOf('\n## ', start + 1);
  return { start, text: start < 0 ? '' : audit.slice(start, next < 0 ? undefined : next) };
};
const publication = sectionOf('\n## Publication de la 3.10.0 (2026-11-07)\n');
const reglages = sectionOf('\n## Système 5 — derniers réglages de l’ADMIN (2026-11-07)\n');
const row = (id: string) => publication.text.split('\n').filter((line) => line.startsWith(`| ${id} |`));

describe('R3.10b · la publication de la 3.10.0 se consigne', () => {
  it('la section suit les derniers réglages de l’ADMIN, à la version de package.json, et dit ce que main a reçu', () => {
    expect(version).toBe('3.10.0');
    expect(reglages.start).toBeGreaterThan(-1);
    expect(publication.start).toBeGreaterThan(reglages.start);
    for (const pr of ['#139', '#143', '#144', '#145']) expect(publication.text, pr).toContain(pr);
  });

  it('une ligne par ticket, chacune avec ses tests, qui existent', () => {
    for (const id of ['R3.9c', 'R3.10a', 'R3.10b']) {
      const lines = row(id);
      expect(lines, id).toHaveLength(1);
      const tests = [...lines[0]!.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) expect(existsSync(file), `${id} : ${file}`).toBe(true);
    }
  });

  it('les vérifications disent les tests que dit le badge du README', () => {
    const badge = readme.match(/img\.shields\.io\/badge\/tests-(\d+)%20passed/);
    expect(badge).not.toBeNull();
    const count = Number(badge![1]).toLocaleString('fr-FR').replace(/\s/g, ' ');
    const checks = publication.text.slice(publication.text.indexOf('**Vérifications.**'), publication.text.indexOf('**Reste.**'));
    expect(checks).toContain(`${count} tests`);
    expect(checks).not.toContain('@@');
  });

  it('ce qui reste : la fusion, le workflow, la signature au poste de l’ADMIN, le contrôle croisé, la recette réelle', () => {
    const rest = publication.text.slice(publication.text.indexOf('**Reste.**'));
    expect(rest).toContain('workflow `release`');
    expect(rest).toContain('`scripts/sign-release.mjs`');
    expect(rest).toContain('une session dans le cloud ne signe pas');
    expect(rest).toContain('`verifyReleaseSignature`');
    expect(rest).toContain('`scripts/capture-oros5.mjs --reel`');
  });

  it('le point ouvert du README, aux derniers réglages, se dit réglé', () => {
    const open = reglages.text.slice(reglages.text.indexOf('**Points ouverts.**'));
    expect(open).toContain('Réglé le jour même : R3.9c pour le README et ses plates, R3.10a pour le journal et la 3.10.0');
  });

  it('rien ne nomme l’outil ni la session qui l’a produite (CLAUDE.md § 1)', () => {
    expect(publication.text).not.toMatch(/claude(?!\.md)|anthropic|session_|co-authored/i);
  });
});
