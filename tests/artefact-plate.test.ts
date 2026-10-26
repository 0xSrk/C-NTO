import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/app/Shell.tsx', 'utf8');
const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
/** Corps de la règle dont le sélecteur ouvre la ligne. */
const rule = (selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('OROS2.4 plaque d’artefact au pied du rail', () => {
  it('la plaque porte l’artefact, la version qui ouvre le journal, le nom, le secteur, le code en clair et les langues', () => {
    const plate = between(shell, '<div className={s.plate}', '</aside>');
    expect(plate).toContain('role="group"');
    expect(plate).toContain('ART 002');
    expect(plate).toContain('<ChangelogJournal version={appVersion} />');
    expect(plate).toContain('CΛNTO');
    expect(plate).toContain("tr('S.01 MARCHÉS', 'S.01 MARKETS', 'S.01 MERCADOS')");
    expect(plate).toContain('SK-ART-002');
    expect(plate).toContain('role="radiogroup"');
  });

  it('la plaque vient après le compte actif, et c’est le seul objet arrondi du rail', () => {
    const rail = between(shell, '<div className={s.railFoot}>', '</aside>');
    expect(rail.indexOf('COMPTE ACTIF')).toBeLessThan(rail.indexOf('<div className={s.plate}'));
    expect(rule('.plate')).toMatch(/border-radius:\s*3px/);
    expect(rule('.plateName')).toMatch(/font-family:\s*var\(--font-name\)/);
    expect(rule('.plateArt')).toMatch(/background:\s*var\(--ivory\)/);
  });
});
