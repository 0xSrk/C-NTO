import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * POL10 — le polissage du desk (mouvement et lumière, 2026-11-08) se consigne dans `docs/AUDIT.md` : une ligne par ticket,
 * chacune avec ses citations `fichier:ligne` et son test ; la preuve du repos au pixel ; les choix que l'ADMIN peut
 * renverser et les points ouverts. DESIGN.md dit ce que la vague change de la grammaire du mouvement.
 */
const audit = readFileSync('docs/AUDIT.md', 'utf8').replace(/\r\n/g, '\n');
const design = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
const HEAD = '\n## Polissage du desk — mouvement et lumière (2026-11-08)\n';
const start = audit.indexOf(HEAD);
const next = audit.indexOf('\n## ', start + 1);
const section = start < 0 ? '' : audit.slice(start, next < 0 ? undefined : next);
const row = (id: string) => section.split('\n').filter((line) => line.startsWith(`| ${id} |`));
/** Les tickets que tiennent les tests du polissage, lus dans les fichiers : sans git, comme en CI. */
const tickets = readdirSync('tests')
  .filter((file) => /^polissage-\w+\.test\.ts$/.test(file) && file !== 'polissage-consigne.test.ts')
  .flatMap((file) => [...readFileSync(`tests/${file}`, 'utf8').matchAll(/\bit\(['"](POL\d+\.\d+[a-z]?) /g)].map((m) => m[1]!));

describe('POL10 · le polissage se consigne', () => {
  it('la section suit la publication de la 3.10.0 et dit la demande, la méthode et la preuve du repos, sans rien laissé en blanc', () => {
    expect(start).toBeGreaterThan(audit.indexOf('\n## Publication de la 3.10.0 (2026-11-07)\n'));
    expect(section).toContain('sans toucher au design');
    expect(section).toContain('**Le repos, au pixel.**');
    expect(section).toMatch(/0 écran changé sur 40/);
    expect(section).not.toContain('@@');
  });

  it('une ligne par ticket des tests du polissage, chacune avec ses citations, qui existent, et son test, qui existe', () => {
    expect(new Set(tickets).size).toBeGreaterThan(50);
    for (const id of new Set(tickets)) {
      const lines = row(id);
      expect(lines, id).toHaveLength(1);
      const tests = [...lines[0]!.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(tests.length, id).toBeGreaterThan(0);
      for (const file of tests) expect(existsSync(file), `${id} : ${file}`).toBe(true);
      for (const [, file, line] of lines[0]!.matchAll(/`((?:src|electron)\/[\w./-]+):(\d+)`/g)) {
        expect(existsSync(file!), `${id} : ${file}`).toBe(true);
        expect(Number(line), `${id} : ${file}:${line}`).toBeLessThanOrEqual(readFileSync(file!, 'utf8').split('\n').length);
      }
    }
    expect(row('POL10')).toHaveLength(1);
  });

  it('les choix que l’ADMIN peut renverser et les points ouverts sont dits ; OROS5.45a dit que la fenêtre rejoue son entrée', () => {
    const choices = section.slice(section.indexOf("**Choix que l'ADMIN peut renverser.**"), section.indexOf('**Points ouverts.**'));
    expect(choices).toContain('POL2.3');
    expect(choices).toContain('POL5.1');
    expect(choices).toContain('POL9.1');
    const open = section.slice(section.indexOf('**Points ouverts.**'));
    expect(open).toContain('chassis-2');
    expect(open).toContain('ceremonies-8');
    const oros = audit.split('\n').find((line) => line.startsWith('| OROS5.45a |'))!;
    expect(oros).toContain('Depuis POL2.3');
  });

  it('DESIGN.md dit la grammaire du mouvement que la vague pose', () => {
    expect(design).toContain('la lumière monte sur le contour ou sur le fond, tamisée et lente');
    expect(design).toContain('en mouvement réduit, le menu et ses options paraissent d’un bloc, sans délai');
    expect(design).toContain('Surcouches (polissage, 2026-11-08)');
    expect(design).toContain('l’anneau d’or de l’action principale suit son chanfrein');
  });
});
