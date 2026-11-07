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
    // OROS5.51 les comptes connectés précèdent le sceau, là où se tenait la cartouche du compte (décision de l'ADMIN,
    // 2026-11-07) ; ni intitulé, ni cartouche
    expect(foot).not.toContain('COMPTE ACTIF');
    expect(foot.indexOf('<RailAccounts />')).toBeGreaterThan(-1);
    expect(foot.indexOf('<RailAccounts />')).toBeLessThan(foot.indexOf('<Seal'));
    expect(foot).not.toMatch(/className=\{s\.account\}/);
    expect(shell).not.toMatch(/tr\(`Tous les comptes/);
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

  it('OROS5.51 les comptes connectés se posent sans cartouche : ni filet, ni fond, ni chanfrein ; le sceau les suit sans filet', () => {
    // OROS4.20 dessinait la cartouche par deux calques découpés au chanfrein ; l'ADMIN la retire (2026-11-07)
    for (const selector of ['.accounts', '.account']) expect(rule(selector), selector).not.toMatch(/border|background|clip-path|box-shadow|^$/);
    expect(rule('.account::before')).toBe('');
    expect(rule('.account::after')).toBe('');
    expect(rule('.signature')).not.toMatch(/border-top/);
    // DESIGN.md dit la décision : § 06 les comptes et le seuil du rail court, § 02 la seule LED à la menthe
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    const details = doc.slice(doc.indexOf('## 06.'), doc.indexOf('## 07.'));
    expect(details).not.toMatch(/Compte : la même cartouche|le compte les suit|Quand le rail n’a plus que 704 px/);
    expect(details).toMatch(/Comptes \(décision de l’ADMIN, 2026-11-07\) : la cartouche « Tous les comptes » est retirée/);
    expect(details).toMatch(/rien tant qu’aucun compte n’est connecté/);
    expect(details).toMatch(/allumé à la menthe \(`--mint`\), fixe/);
    expect(details).toMatch(/Quand le rail n’a plus que 716 px de haut/);
    expect(details).toMatch(/autant de lignes que la place le permet sans faire défiler les cartouches, la ligne d’écrous des portes réservée, deux au moins \(`accountsFit`/);
    const signals = doc.slice(doc.indexOf('## 02.'), doc.indexOf('## 03.'));
    expect(signals).toMatch(/Le voyant d’un compte connecté est la seule LED à la menthe/);
  });
});
