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

// OROS2.4 posait la plaque d'artefact au pied du rail ; OROS2.10 la tirait de la cartouche SK-ART-002.
// OROS4.5 la réduit à sa marque : le sceau du Lab gravé, le même qu'au verrou (décision de l'ADMIN, 2026-10-27).
describe('OROS4.5 la plaque réduite à la marque du Lab', () => {
  it('le pied du rail porte le sceau du Lab, gravé, puis les langues ; plus de cartouche ni de version', () => {
    const foot = between(shell, '<div className={s.railFoot}>', '</aside>');
    // OROS4.20 le compte, dans sa cartouche, précède le sceau ; son intitulé visible est retiré
    expect(foot).not.toContain('COMPTE ACTIF');
    expect(foot.indexOf('data-part="account-mark"')).toBeGreaterThan(-1);
    expect(foot.indexOf('data-part="account-mark"')).toBeLessThan(foot.indexOf('<Seal'));
    expect(foot).toMatch(/<Seal kind="negative" className=\{s\.sealMarkSvg\} label="SIΞRRΛSKΛ Lab" \/>/);
    expect(foot.indexOf('<Seal')).toBeLessThan(foot.indexOf('role="radiogroup"'));
    expect(foot).not.toContain('<Cartouche');
    expect(foot).not.toContain('<ChangelogJournal');
    expect(foot).not.toContain('SK-ART-002');
  });

  it('le sceau est gravé : encre d’ivoire assourdie, ombre au-dessus, reflet dessous ; plus d’objet arrondi au rail', () => {
    const mark = rule('.sealMark');
    expect(mark).toMatch(/width: 76px/);
    expect(mark).toMatch(/color: color-mix\(in srgb, var\(--ivory\) \d+%, transparent\)/);
    expect(rule('.sealMarkSvg')).toMatch(/filter: drop-shadow\(0 -1px 0 color-mix\(in srgb, var\(--bg-void\) \d+%, transparent\)\) drop-shadow\(0 1px 0 color-mix\(in srgb, var\(--ivory\) \d+%, transparent\)\)/);
    expect(css).not.toMatch(/^\.plate \{/m);
    expect(css).not.toMatch(/border-radius: 3px/);
  });

  it('OROS4.20 le compte se pose dans une cartouche du Lab ; le sceau le suit sans filet', () => {
    // la cartouche est dessinée par ses deux calques découpés au chanfrein, jamais par un cadre arrondi ni une ombre
    const account = rule('.account');
    expect(account).not.toMatch(/border-radius|box-shadow/);
    expect(rule('.account::before')).toMatch(/clip-path: var\(--chamfer\)/);
    expect(rule('.signature')).not.toMatch(/border-top/);
  });
});
