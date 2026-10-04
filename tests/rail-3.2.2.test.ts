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
    const rail = between(shell, '<div className={s.railFoot}>', '</aside>');
    expect(rail.indexOf('COMPTE ACTIF')).toBeLessThan(rail.indexOf('<ChangelogJournal'));
    expect(between(shell, '<footer', '</footer>')).not.toContain('ChangelogJournal');
  });

  it('le sigle et l’heure quittent la barre de titre ; le zoom s’y place', () => {
    const header = between(shell, '<header', '</header>');
    const status = between(shell, '<footer', '</footer>');
    expect(header).not.toContain('SRK—LAB / ART-002');
    expect(header).toContain('<ZoomControls />');
    expect(status).not.toContain('ART-002');
    expect(status).not.toContain('127.0.0.1');
    expect(status).toContain('CME GLOBEX');
    expect(status).toContain('city.code');
    expect(status).toContain("chooseFace('24')");
    expect(status).toContain("chooseFace('12')");
    expect(shell).toContain("zone: 'Asia/Tokyo'");
    expect(shell).toContain("zone: 'Europe/Paris'");
    expect(shell).toContain("zone: 'America/New_York'");
    expect(shell).toContain("code: 'TYO'");
    expect(shell).toContain("code: 'PAR'");
    expect(shell).toContain("code: 'NYC'");
    const right = between(status, 'statusRight', '</footer>');
    expect(right).toContain('Barcode');
    expect(right).toContain('SIΞRRΛSKΛ');
    expect(right).toContain('<SignatureGlyphs />');
    expect(right.indexOf('Barcode')).toBeLessThan(right.indexOf('SIΞRRΛSKΛ'));
    expect(right.indexOf('SIΞRRΛSKΛ')).toBeLessThan(right.indexOf('<SignatureGlyphs />'));
    expect(right).not.toContain('CME GLOBEX');
    expect(between(shell, '<div className={s.railFoot}>', '</aside>')).not.toContain('PlaqueSignature');
    expect(between(shell, '<div className={s.railFoot}>', '</aside>')).not.toContain('ZoomControls');
  });

  it('la plaque signature est gravée à 40 px', () => {
    expect(readFileSync('src/design/plaqueSignature.module.css', 'utf8')).toMatch(/height:\s*40px/);
  });
});
