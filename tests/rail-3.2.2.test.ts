import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/app/Shell.tsx', 'utf8');
const css = readFileSync('src/app/shell.module.css', 'utf8');
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe('rail 3.2.2', () => {
  it('le compte actif est posé à même le rail, avec son voyant', () => {
    expect(shell).not.toContain('accountCard');
    expect(css).not.toMatch(/\.accountCard\b/);
    for (const state of ['voyantOn', 'voyantVeille', 'voyantOff']) expect(css).toContain(`.${state}`);
    expect(shell).toMatch(/className=\{cx\(s\.voyant, s\[linkState\]\)\} role="img" aria-label=\{linkLabel\}/);
  });

  it('la version quitte la barre d’état pour le rail, sous le compte', () => {
    const rail = between(shell, '<div className={s.railFoot}>', '<PlaqueSignature');
    expect(rail.indexOf('COMPTE ACTIF')).toBeLessThan(rail.indexOf('<ChangelogJournal'));
    expect(between(shell, '<footer', '</footer>')).not.toContain('ChangelogJournal');
  });

  it('ART-002 quitte la barre d’état et reste dans la barre de titre', () => {
    const status = between(shell, '<footer', '</footer>');
    expect(status).not.toContain('ART-002');
    expect(status).not.toContain('labDot');
    expect(between(shell, '<header', '</header>')).toContain('SRK—LAB / ART-002');
  });

  it('la plaque signature est gravée à 40 px', () => {
    expect(readFileSync('src/design/plaqueSignature.module.css', 'utf8')).toMatch(/height:\s*40px/);
  });
});
