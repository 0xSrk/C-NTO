import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const audit = readFileSync('docs/AUDIT.md', 'utf8');
const lines = audit.split('\n');

/** Les lignes des tableaux « Ticket » : identifiant de première colonne et numéro de ligne (1 d'abord). */
function ticketRows(): { id: string; line: number; text: string }[] {
  const rows: { id: string; line: number; text: string }[] = [];
  let inTable = false;
  lines.forEach((text, index) => {
    if (/^\| *Ticket *\|/.test(text)) {
      inTable = true;
      return;
    }
    if (inTable && /^\|[-| :]+\|$/.test(text)) return;
    if (inTable && text.startsWith('|')) {
      rows.push({ id: text.split('|')[1]?.trim() ?? '', line: index + 1, text });
      return;
    }
    inTable = false;
  });
  return rows;
}

/** Le texte d'une section `## …`, jusqu'à la suivante. */
function section(title: string): string {
  const start = audit.indexOf(`\n## ${title}\n`);
  expect(start, title).toBeGreaterThan(0);
  const end = audit.indexOf('\n## ', start + 1);
  return audit.slice(start, end < 0 ? undefined : end);
}

const row = (text: string, id: string) => text.split('\n').find((l) => l.startsWith(`| ${id} |`));

describe('LAB7 un ticket n’a qu’une ligne dans les tableaux « Ticket » de docs/AUDIT.md', () => {
  it('chaque identifiant de première colonne n’apparaît qu’une fois dans tout le fichier', () => {
    const rows = ticketRows();
    expect(rows.length).toBeGreaterThan(100);
    const seen = new Map<string, number[]>();
    for (const r of rows) seen.set(r.id, [...(seen.get(r.id) ?? []), r.line]);
    const doubled = [...seen].filter(([, at]) => at.length > 1).map(([id, at]) => `${id} (l. ${at.join(', ')})`);
    expect(doubled).toEqual([]);
  });

  it('LAB2 et LAB3 restent ceux du 2026-10-26 ; ceux du 2026-11-01 deviennent LAB5 et LAB6', () => {
    const cloud = section('Agent cloud — rapports quotidiens (2026-10-26)');
    expect(row(cloud, 'LAB2')).toContain('Précision de l\'ADMIN (2026-10-26)');
    expect(row(cloud, 'LAB3')).toContain('L\'onglet Agent IA était trop lourd');
    const release = section('La Release confiée aux agents (2026-11-01)');
    expect(row(release, 'LAB5')).toContain('`CLAUDE.md` § 3');
    expect(row(release, 'LAB6')).toContain('`scripts/centre.mjs`');
    expect(row(release, 'LAB6')).toContain('`tests/centre.test.ts` › LAB6');
    expect(row(release, 'LAB2')).toBeUndefined();
    expect(row(release, 'LAB3')).toBeUndefined();
    expect(release).toContain('Renommés LAB5 et LAB6 le 2026-11-03 (LAB7)');
  });

  it('les deux describe renommés existent', () => {
    expect(readFileSync('tests/release-agents.test.ts', 'utf8')).toContain('describe("LAB5 la Release confiée aux agents');
    expect(readFileSync('tests/centre.test.ts', 'utf8')).toContain('describe("LAB6 le centre reste sur le poste');
  });
});
