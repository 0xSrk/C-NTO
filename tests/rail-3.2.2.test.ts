import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/app/Shell.tsx', 'utf8');
const css = readFileSync('src/app/shell.module.css', 'utf8');
const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe('rail 3.2.2', () => {
  it('le compte garde son voyant, OROS4.20 au cœur de sa micro', () => {
    expect(shell).not.toContain('accountCard');
    expect(css).not.toMatch(/\.accountCard\b/);
    for (const state of ['voyantOn', 'voyantVeille', 'voyantOff']) expect(css).toContain(`.${state}`);
    expect(shell).toMatch(/className=\{cx\(s\.voyant, s\[linkState\]\)\} role="img" aria-label=\{linkLabel\}/);
  });

  it('OROS5.50 la version quitte la barre de titre pour la barre d’état : en bas à gauche, le premier indicateur, avant le pont ; jamais au rail', () => {
    const rail = between(shell, '<div className={s.railFoot}>', '</aside>');
    expect(rail).not.toContain('<ChangelogJournal');
    // OROS4.5 l'avait posée en haut à droite ; l'ADMIN la descend au pied (décision du 2026-11-07)
    expect(between(shell, '<header', '</header>')).not.toContain('ChangelogJournal');
    const left = between(shell, 'statusLeft', 'statusRight');
    expect(left).toContain('<ChangelogJournal version={appVersion} />');
    expect(left.indexOf('<ChangelogJournal')).toBeLessThan(left.indexOf('<StatusBornes />'));
    expect(between(shell, '<footer', '</footer>').match(/<ChangelogJournal\b/g)).toHaveLength(1);
    expect(css).not.toMatch(/\.versionCell\b|\.titleVersion\b/);
    // la version ne cède jamais sa place à l'étroit, et garde sa minuscule dans la barre en capitales
    const version = css.slice(css.indexOf('.statusVersion {'), css.indexOf('}', css.indexOf('.statusVersion {')));
    expect(version).toMatch(/flex: none;/);
    expect(version).toMatch(/text-transform: none;/);
    // DESIGN.md § 06 et § 09 disent où elle vit
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    expect(doc).not.toMatch(/Version \(4\.1\) : seule en haut à droite|la version se lit en haut à droite du desk/);
    expect(doc).toMatch(/Version : en bas à gauche, le premier indicateur de la barre d’état, avant le pont NT8[^.]*2026-11-07/);
  });

  it('le sigle et l’heure quittent la barre de titre ; le zoom s’y place ; Système 5 (décision 7) : New York reste, Tokyo, Paris et le libellé de séance cèdent à la ligne de la journée', () => {
    const header = between(shell, '<header', '</header>');
    const status = between(shell, '<footer', '</footer>');
    expect(header).not.toContain('SRK—LAB / ART-002');
    expect(header).toContain('<ZoomControls />');
    expect(status).not.toContain('ART-002');
    expect(status).not.toContain('127.0.0.1');
    // la ligne de la journée (OROS5.22) : le pont et les bornes à gauche ; TYO, PAR et « CME GLOBEX · ETH » cèdent leur place
    expect(between(status, 'statusLeft', 'statusRight')).toContain('<StatusBornes />');
    expect(status).not.toContain('CME GLOBEX');
    expect(shell).not.toMatch(/Asia\/Tokyo|Europe\/Paris|code: 'TYO'|code: 'PAR'|globexLabel/);
    // New York reste, sur 24 ou 12 h, avant la signature
    expect(shell).toMatch(/const NEW_YORK = \{ zone: ET_ZONE, code: 'NYC'/);
    expect(status).toContain("chooseFace('24')");
    expect(status).toContain("chooseFace('12')");
    const right = between(status, 'statusRight', '</footer>');
    expect(right).toContain('{NEW_YORK.code}');
    expect(right).toContain('BraceCode');
    expect(right).toContain('SIΞRRΛSKΛ');
    expect(right).not.toContain('SignatureGlyphs');
    expect(right.indexOf('{NEW_YORK.code}')).toBeLessThan(right.indexOf('BraceCode'));
    expect(right.indexOf('BraceCode')).toBeLessThan(right.indexOf('SIΞRRΛSKΛ'));
    expect(right).not.toContain('CME GLOBEX');
    expect(between(shell, '<div className={s.railFoot}>', '</aside>')).not.toContain('PlaqueSignature');
    expect(between(shell, '<div className={s.railFoot}>', '</aside>')).not.toContain('ZoomControls');
  });

  it('la plaque signature est gravée à 40 px', () => {
    expect(readFileSync('src/design/plaqueSignature.module.css', 'utf8')).toMatch(/height:\s*40px/);
  });
});
