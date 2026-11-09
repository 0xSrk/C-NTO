import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareSemver } from '../electron/semver';

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
  it('la section suit les derniers réglages de l’ADMIN, et dit ce que main a reçu', () => {
    // R3.10.1a la version de package.json a suivi : cette section reste celle de la 3.10.0, que le desk ne redescend pas.
    expect(compareSemver(version, '3.10.0')).toBeGreaterThanOrEqual(0);
    expect(reglages.start).toBeGreaterThan(-1);
    expect(publication.start).toBeGreaterThan(reglages.start);
    for (const pr of ['#139', '#143', '#144', '#145']) expect(publication.text, pr).toContain(pr);
  });

  it('une ligne par ticket, chacune avec ses tests, qui existent', () => {
    for (const id of ['R3.9c', 'R3.10a', 'R3.10b', 'R3.10c']) {
      const lines = row(id);
      expect(lines, id).toHaveLength(1);
      const tests = [...lines[0]!.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) expect(existsSync(file), `${id} : ${file}`).toBe(true);
    }
  });

  it('les vérifications disent les tests de la publication ; le badge du README n’en dit jamais moins', () => {
    // R3.10c les vérifications sont celles de la publication : le badge suit les versions suivantes sans les réécrire.
    const checks = publication.text.slice(publication.text.indexOf('**Vérifications.**'), publication.text.indexOf('**Reste.**'));
    expect(checks).toContain('`npm run check` vert (typecheck, 337 fichiers, 3 167 tests, build)');
    expect(checks).not.toContain('@@');
    const badge = readme.match(/img\.shields\.io\/badge\/tests-(\d+)%20passed/);
    expect(badge).not.toBeNull();
    expect(Number(badge![1])).toBeGreaterThanOrEqual(3167);
  });

  it('R3.10c la publication et le contrôle croisé se consignent : le run, la signature, les empreintes, le tag, aucun écart', () => {
    const head = '**Publication et contrôle croisé (2026-11-07).**';
    expect(publication.text).toContain(head);
    const cross = publication.text.slice(publication.text.indexOf(head));
    // Le brouillon vient du workflow `release` lancé sur main, à la fusion de la montée.
    expect(cross).toContain('lancé sur `main` à `62894e1`');
    expect(cross).toContain('run 42367908957');
    // Le second contrôle : les sommes contre le journal de la CI et contre GitHub, la signature par le vérificateur du desk.
    expect(cross).toContain('identique, octet pour octet, au journal du job `publish`');
    expect(cross).toContain('les 13 empreintes que GitHub calcule');
    expect(cross).toContain('valide pour 3.10.0 avec la clé de `electron/release-keys.ts`, par `verifyReleaseSignature`');
    expect(cross).toContain('refusé rejoué sous 3.9.0');
    // Le tag pointe la fusion, et son run n'écrit rien.
    expect(cross).toContain('le tag `v3.10.0` pointe `62894e1`');
    expect(cross).toContain('« Release existante », sans rien écrire');
    expect(cross.trim().endsWith('Aucun écart.')).toBe(true);
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
