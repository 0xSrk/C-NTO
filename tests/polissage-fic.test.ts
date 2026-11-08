// Polissage du desk (POL3) : la fiche, troisième colonne. Le repos ne change pas ; seule la manière d'y arriver et d'en
// partir, et la lumière du passage du pointeur.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules, hoverOffenses, type CssRule } from './helpers/cssRules';

const FICHE = 'src/app/objects/fiche.module.css';
const sheet = (path: string) => cssRules(readFileSync(path, 'utf8'));
/** Le corps d'une règle hors de tout bloc @, par son sélecteur exact. */
const top = (rules: CssRule[], selector: string) => rules.find((rule) => rule.selector === selector && rule.at.length === 0)?.body ?? '';
/** Les composants qui lisent la feuille de la fiche sous le nom `s`. */
const ficheSources = () =>
  readdirSync('src/app/objects')
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, src: readFileSync(`src/app/objects/${name}`, 'utf8') }))
    .filter(({ src }) => /import s from '\.\/fiche\.module\.css';/.test(src));
/** Les classes de la feuille posées avec `s.row` sur un même élément. */
const withRow = () => {
  const found = new Set<string>();
  for (const { src } of ficheSources()) {
    for (const [, args] of src.matchAll(/className=\{cx\(s\.row,(.*?)\)\}/g)) for (const [, name] of args!.matchAll(/s\.(\w+)/g)) found.add(name!);
  }
  return [...found];
};

describe('POL3 la fiche, troisième colonne : le mouvement et la lumière', () => {
  it('POL3.1 la ligne remise dans la sélection revient à son pas : l’atténuation s’anime dans les deux sens', () => {
    const fiche = sheet(FICHE);
    // OROS5.32 : hors de la sélection, à sa place, atténué à 35 % ; la valeur ne change pas.
    expect(top(fiche, '.out')).toMatch(/opacity: 0\.35;/);
    // `.out`, plus loin dans la feuille, remplaçait la transition de `.row` : en sortant de `.out`, l'opacité sautait de
    // 0,35 à 1 en une image, et le fond survolé d'une ligne atténuée s'allumait d'un coup. La transition est celle de la
    // ligne, dans les deux sens.
    expect(top(fiche, '.out')).not.toMatch(/transition/);
    expect(top(fiche, '.row')).toMatch(/transition:[^;]*\bopacity 220ms linear\b/);
    expect(top(fiche, '.row')).toMatch(/transition:[^;]*\bbackground-color\b/);
    // `.out` ne se pose que sur une ligne, et aucune classe posée avec `.row` ne remplace sa transition.
    const partners = withRow();
    expect(partners).toContain('out');
    for (const name of partners) expect(top(fiche, `.${name}`), `.${name}`).not.toMatch(/transition/);
    const uses = ficheSources().flatMap(({ name, src }) => [...src.matchAll(/s\.out\b/g)].map((m) => ({ name, line: src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index)) })));
    expect(uses.length).toBeGreaterThan(0);
    for (const { name, line } of uses) expect(line, name).toMatch(/className=\{cx\(s\.row,.*\bs\.out\b.*\)\}/);
  });

  it('POL3.2 la lecture liée s’allume d’une seule lumière : la ligne, le rayon et l’anneau du nœud, au même pas', () => {
    const fiche = sheet(FICHE);
    // Décision 2 (OROS5.26) : le nœud et sa ligne s'allument ensemble. La ligne montait en 220 ms, le rayon en 160 ms
    // linéaires, l'anneau en 260 ms ; et l'encre de l'anneau (--k, non enregistrée) sautait d'une image.
    expect(top(fiche, '.row')).toMatch(/transition:[^;]*\bbackground-color var\(--t-med\) var\(--ease-out\)/);
    expect(top(fiche, '.ray')).toMatch(/transition: opacity var\(--t-med\) var\(--ease-out\);/);
    expect(top(fiche, '.egoRing')).toMatch(/transition:[^;]*\bopacity var\(--t-med\) var\(--ease-out\)/);
    // l'anneau est un tracé plein de la table d'états : son trait (stroke: var(--k)) suit la lumière, au même pas
    expect(top(fiche, '.egoRing')).toMatch(/transition:[^;]*\bstroke var\(--t-med\) var\(--ease-out\)/);
    // Le repos et l'allumage ne changent pas : rayon 0,72 puis 1, anneau 0,35 puis 0,9 (ou 1 au focus).
    expect(top(fiche, '.ray')).toMatch(/opacity: 0\.72;/);
    expect(top(fiche, '.egoRing')).toMatch(/opacity: 0\.35;/);
    const lit = fiche.filter((rule) => /\[data-lit\]/.test(rule.selector));
    expect(lit.find((rule) => rule.selector === '.ray[data-lit]')?.body).toMatch(/opacity: 1;/);
    expect(lit.find((rule) => rule.selector === '.egoNode[data-lit] .egoRing')?.body).toMatch(/opacity: 0\.9;[\s\S]*--k: var\(--text-0\);/);
    // Le halo de l'hypothèse (le second contour tireté) n'est pas une lumière : ni transition, ni animation, ni ombre.
    expect(fiche.filter((rule) => /\.(?:egoHypo|etat)\b/.test(rule.selector)).some((rule) => /transition|animation|box-shadow|filter/.test(rule.body))).toBe(false);
    expect(readFileSync('src/design/etat.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/transition|animation/);
  });

  it('POL3.3 les sommaires de la fiche s’allument au passage du pointeur, comme ses liens en code', () => {
    const fiche = sheet(FICHE);
    /** La règle d'un sélecteur sous `@media (hover: hover)`, l'une des parties de sa liste. */
    const hover = (selector: string) =>
      fiche.find((rule) => rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head)) && rule.selector.split(',').map((part) => part.trim()).includes(selector))?.body ?? '';
    // La lumière la plus proche dans la feuille : celle de ses liens en code (« Ouvrir le plan », « Toute l'activité »),
    // l'encre qui monte vers --text-0 en 200 ms linéaires.
    for (const link of ['.planOpen', '.activityAll']) {
      expect(top(fiche, link), link).toMatch(/transition: color 200ms linear;/);
      expect(hover(`${link}:hover`), link).toMatch(/color: var\(--text-0\);/);
    }
    // « Les 12 issues, dans l'ordre de la garde » (fiche Compte) et « n liens rejetés · masqués » (C.042) : au repos, rien
    // ne change ; au passage du pointeur, l'encre monte, et le glyphe du refus avec elle.
    for (const summary of ['.gates summary', '.rejected summary']) {
      expect(top(fiche, summary), summary).toMatch(/color: var\(--text-2\);/);
      expect(top(fiche, summary), summary).toMatch(/transition: color 200ms linear;/);
      expect(hover(`${summary}:hover`), summary).toMatch(/color: var\(--text-0\);/);
    }
    expect(top(fiche, '.rejectedGlyph')).toMatch(/--k: var\(--text-2\);/);
    expect(hover('.rejected summary:hover .rejectedGlyph')).toMatch(/--k: var\(--text-0\);/);
    // De la lumière seulement, sous @media (hover: hover) (garde OROS4.1).
    expect(hoverOffenses(readFileSync(FICHE, 'utf8')).offenders).toEqual([]);
  });

  it('POL3.4 le bouton qui ouvre la fiche depuis la carte s’allume au lieu de s’éteindre : l’encre de C.092 monte', () => {
    const PROPOSAL = 'src/app/objects/proposal.module.css';
    const card = sheet(PROPOSAL);
    const underHover = card.filter((rule) => rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head)));
    // Le seul survol du desk qui éteignait (opacité 0,8) : « la lumière monte » (DESIGN.md § 00).
    expect(card.filter((rule) => /\.open:hover/.test(rule.selector)).some((rule) => /opacity/.test(rule.body))).toBe(false);
    // `.chainGlyph` pose son propre --k : le bouton vise son glyphe, de --text-1 au repos à --text-0 sous le pointeur.
    expect(top(card, '.chainGlyph')).toMatch(/--k: var\(--text-1\);/);
    expect(underHover.find((rule) => rule.selector === '.open:hover .chainGlyph')?.body).toMatch(/--k: var\(--text-0\);/);
    // Au repos, le bouton ne change pas ; sa transition d'opacité n'avait plus rien à animer.
    expect(top(card, '.open')).not.toMatch(/opacity/);
    expect(hoverOffenses(readFileSync(PROPOSAL, 'utf8')).offenders).toEqual([]);
  });
});

