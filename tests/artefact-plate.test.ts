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
    expect(foot.indexOf('COMPTE ACTIF')).toBeLessThan(foot.indexOf('<Seal'));
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

  it('le compte actif se pose à même le rail, sans carte', () => {
    const account = rule('.account');
    expect(account).not.toMatch(/background|border|box-shadow/);
  });
});
