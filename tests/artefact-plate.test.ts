import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARTOUCHES } from '@/design/micro/assets';

const shell = readFileSync('src/app/Shell.tsx', 'utf8');
const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
/** Corps de la règle dont le sélecteur ouvre la ligne. */
const rule = (selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

// OROS2.4 posait la plaque ; OROS2.10 la tire de la cartouche SK-ART-002 du Lab (Ligne V2), sans code.
describe('OROS2.4 plaque d’artefact au pied du rail', () => {
  it('la plaque porte l’artefact, la version qui ouvre le journal, le nom, le secteur, le code en clair et les langues', () => {
    const plate = between(shell, '<div className={s.plate}', '</aside>');
    expect(plate).toContain('role="group"');
    expect(plate).toContain('<Cartouche id="artefact"');
    expect(plate).toContain('<ChangelogJournal version={appVersion} />');
    expect(plate).toContain('SK-ART-002');
    expect(plate).toContain('CΛNTO');
    expect(plate).toContain('role="radiogroup"');
    // ART 002, le nom et le secteur sont imprimés par la cartouche elle-même
    for (const text of ['ART 002', 'CΛNTO', 'SECTOR: S.01 MARKETS']) expect(CARTOUCHES.artefact).toContain(text);
  });

  it('la plaque vient après le compte actif, et c’est le seul objet arrondi du rail', () => {
    const rail = between(shell, '<div className={s.railFoot}>', '</aside>');
    expect(rail.indexOf('COMPTE ACTIF')).toBeLessThan(rail.indexOf('<div className={s.plate}'));
    expect(rule('.plate')).toMatch(/border-radius:\s*3px/);
    // l'encre de la cartouche est l'ivoire, son papier le sol : par les jetons
    expect(rule('.plate')).toMatch(/--k:\s*var\(--text-0\)/);
    expect(rule('.plate')).toMatch(/--p:\s*var\(--bg-1\)/);
  });
});
