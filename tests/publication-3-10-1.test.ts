import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * R3.10.1b — la seconde vague de l'audit du 9 novembre et la publication de la 3.10.1 se consignent dans `docs/AUDIT.md` :
 * une ligne par ticket, chacune avec ses citations `fichier:ligne`, qui existent, et son test, qui existe et le nomme ; la
 * méthode, les mesures, les choix que l'ADMIN peut renverser et ce qui reste ouvert ; puis ce que la Release porte, ce qui
 * ne change pas, les vérifications et ce qui reste, la signature au seul poste de l'ADMIN comprise.
 */
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const audit = read('docs/AUDIT.md');
const readme = read('README.md');
const { version } = JSON.parse(read('package.json')) as { version: string };
const sectionOf = (head: string) => {
  const start = audit.indexOf(head);
  const next = audit.indexOf('\n## ', start + 1);
  return { start, text: start < 0 ? '' : audit.slice(start, next < 0 ? undefined : next) };
};
const first = sectionOf('\n## Sécurité et tenue du desk — audit du 9 novembre (2026-11-09)\n');
const wave = sectionOf('\n## Points ouverts de l\'audit du 9 novembre — seconde vague (2026-11-09)\n');
const publication = sectionOf('\n## Publication de la 3.10.1 (2026-11-09)\n');
const row = (text: string, id: string) => text.split('\n').filter((line) => line.startsWith(`| ${id} |`));
const testsOf = (line: string) => [...line.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]!);

/** Les citations d'une ligne : `chemin:ligne`, puis `:ligne` pour le même fichier. */
function citations(line: string): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  let file = '';
  for (const m of line.matchAll(/`((?:[\w.-]+\/)*[\w.-]+\.[a-z]+):(\d+)`|`:(\d+)`/g)) {
    if (m[1]) file = m[1];
    out.push({ file, line: Number(m[2] ?? m[3]) });
  }
  return out;
}

const WAVE = ['SEC2.1', 'SEC2.2', 'SEC2.3', 'SEC2.4', 'SEC2.5', 'SEC2.6', 'SEC2.7', 'SEC2.8', 'SEC1.6a'];

describe('R3.10.1b · la seconde vague et la publication de la 3.10.1 se consignent', () => {
  it('les trois sections se suivent : l’audit, sa seconde vague, la publication, à la version de package.json', () => {
    expect(version).toBe('3.10.1');
    expect(first.start).toBeGreaterThan(-1);
    expect(wave.start).toBeGreaterThan(first.start);
    expect(publication.start).toBeGreaterThan(wave.start);
    // La seconde vague cite la demande de l'ADMIN ; la publication, ce que main a reçu depuis la v3.10.0.
    expect(wave.text).toContain('« Occupes toi de tout et appliques les propositions que tu as énoncé »');
    for (const pr of ['#147', '#148', '#149', '#150']) expect(publication.text, pr).toContain(pr);
  });

  it('une ligne par ticket de la seconde vague, dans l’ordre, chacune avec ses citations, qui existent, et son test, qui existe et le nomme', () => {
    const ids = wave.text.split('\n').filter((line) => /^\| (?:SEC|R)\d/.test(line)).map((line) => line.split('|')[1]!.trim());
    expect(ids).toEqual(WAVE);
    for (const id of WAVE) {
      const lines = row(wave.text, id);
      expect(lines, id).toHaveLength(1);
      const tests = testsOf(lines[0]!.split('|').at(-2) ?? '');
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) {
        expect(existsSync(file), `${id} : ${file}`).toBe(true);
        expect(read(file), `${id} : ${file}`).toContain(id);
      }
      const cited = citations(lines[0]!);
      expect(cited.length, id).toBeGreaterThan(0);
      for (const c of cited) {
        expect(existsSync(c.file), `${id} : ${c.file}`).toBe(true);
        expect(c.line, `${id} : ${c.file}:${c.line}`).toBeGreaterThan(0);
        expect(c.line, `${id} : ${c.file}:${c.line}`).toBeLessThanOrEqual(read(c.file).split('\n').length);
      }
    }
  });

  it('la méthode, les mesures, les choix et ce qui reste ouvert sont dits, sans rien laissé en blanc', () => {
    const heads = ['**Méthode.**', '**Mesures.**', "**Choix que l'ADMIN peut renverser.**", '**Encore ouvert, par ordre de risque.**'];
    let at = -1;
    for (const head of heads) {
      const next = wave.text.indexOf(head);
      expect(next, head).toBeGreaterThan(at);
      at = next;
    }
    expect(`${wave.text}${publication.text}`).not.toContain('@@');
    const measures = wave.text.slice(wave.text.indexOf('**Mesures.**'), wave.text.indexOf("**Choix que l'ADMIN peut renverser.**"));
    expect(measures).toContain('3 289 tests sur 356 fichiers');
    expect(measures).toMatch(/`npm audit` : 8 avis modérés → 6/);
    const choices = wave.text.slice(wave.text.indexOf("**Choix que l'ADMIN peut renverser.**"), wave.text.indexOf('**Encore ouvert, par ordre de risque.**'));
    for (const id of ['SEC2.1', 'SEC2.2', 'SEC2.3', 'SEC2.4', 'SEC2.5', 'SEC2.6', 'SEC2.8']) expect(choices, id).toContain(`**${id}, `);
    const open = wave.text.slice(wave.text.indexOf('**Encore ouvert, par ordre de risque.**'));
    // L'AddOn n'est pas borné par cette version ; sa borne attend la compilation de l'ADMIN.
    expect(open).toContain('`addon/borne-historique`');
    expect(open).toContain("qu'après sa compilation dans NinjaTrader 8 et son essai sur Sim par l'ADMIN");
    // Le test de l'instantané lit l'année courante : il rougira au 1er janvier 2027.
    expect(open).toContain('il passera au rouge le 1er janvier');
    expect(read('tests/calendar-bundle.test.ts')).toContain('const year = new Date().getUTCFullYear();');
    // Les gardes nouvelles ne sont pas inscrites aux invariants : c'est à l'ADMIN.
    expect(open).toContain('**`CLAUDE.md` § 5.**');
    for (const c of citations(`${choices}${open}`)) {
      expect(existsSync(c.file), c.file).toBe(true);
      expect(c.line, `${c.file}:${c.line}`).toBeLessThanOrEqual(read(c.file).split('\n').length);
    }
  });

  it('la liste « Encore ouvert » de l’audit du 9 novembre dit ce qui est réglé, et ce qui ne l’est pas', () => {
    const open = first.text.slice(first.text.indexOf('**Encore ouvert, par ordre de risque.**'));
    for (const note of ['Réglé le jour même : SEC2.1.', 'SEC2.2 pour la garde, SEC2.8 pour les dates 2027 du BLS', 'Réglé le jour même : SEC2.3 et SEC2.4.', 'Réglé le jour même : SEC2.5.', 'Réglé le jour même : SEC2.6', 'Réglé le jour même : SEC2.7']) {
      expect(open, note).toContain(note);
    }
    const bullet = (title: string) => open.split('\n').find((line) => line.startsWith(`- **${title}`)) ?? '';
    expect(bullet('Historique, côté AddOn.')).toContain('Toujours ouvert');
    for (const title of ['Voie source.', 'Installeurs non signés']) expect(bullet(title), title).not.toMatch(/Réglé/);
  });

  it('la publication : une ligne par ticket, chacune avec ses tests, qui existent ; ce qui ne change pas se vérifie', () => {
    for (const id of ['R3.10.1a', 'R3.10.1b', 'R3.10.1c']) {
      const lines = row(publication.text, id);
      expect(lines, id).toHaveLength(1);
      const tests = testsOf(lines[0]!);
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) {
        expect(existsSync(file), `${id} : ${file}`).toBe(true);
        expect(read(file), `${id} : ${file}`).toContain(id);
      }
    }
    const same = publication.text.slice(publication.text.indexOf('**Ce qui ne change pas.**'), publication.text.indexOf('**Vérifications.**'));
    expect(same).toContain("L'AddOn NinjaTrader reste en 2.2.0");
    expect(same).toContain('Les plates du README ne sont pas recapturées');
    expect(same).toContain("pas celle de l'AddOn");
  });

  it('les vérifications disent les tests de la publication ; le badge du README n’en dit jamais moins', () => {
    const checks = publication.text.slice(publication.text.indexOf('**Vérifications.**'), publication.text.indexOf('**Reste.**'));
    const said = /`npm run check` vert \(typecheck, (\d+) fichiers, (\d) (\d{3}) tests, build\)/.exec(checks);
    expect(said, checks.slice(0, 120)).not.toBeNull();
    const tests = Number(`${said![2]}${said![3]}`);
    // Plus que l'audit du 9 novembre n'en laissait, et le même compte qu'aux mesures de la seconde vague.
    expect(tests).toBeGreaterThan(3289);
    expect(Number(said![1])).toBeGreaterThan(356);
    expect(wave.text).toContain(`${said![2]} ${said![3]} tests sur ${said![1]} fichiers`);
    expect(checks).toContain('`node scripts/release-notes.mjs --check --version 3.10.1`');
    const badge = readme.match(/img\.shields\.io\/badge\/tests-(\d+)%20passed/);
    expect(badge).not.toBeNull();
    expect(Number(badge![1])).toBeGreaterThanOrEqual(tests);
  });

  it('ce qui reste : la fusion, le workflow, la signature au poste de l’ADMIN, le contrôle croisé, l’essai sur Sim', () => {
    const rest = publication.text.slice(publication.text.indexOf('**Reste.**'));
    expect(rest).toContain('Fusionner cette montée dans `main` (ADMIN)');
    expect(rest).toContain('workflow `release`');
    expect(rest).toContain('`scripts/sign-release.mjs`');
    expect(rest).toContain('une session dans le cloud ne signe pas');
    expect(rest).toContain('`verifyReleaseSignature`');
    expect(rest).toContain('un compte Sim');
    expect(rest).toContain('les liens d\'installation du README mènent à des fichiers que seule la Release en brouillon porte');
  });

  it('rien ne nomme l’outil ni la session qui l’a produite (CLAUDE.md § 1)', () => {
    expect(`${wave.text}${publication.text}`).not.toMatch(/claude(?!\.md)|anthropic|session_|co-authored/i);
  });
});
