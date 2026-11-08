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
});

void hoverOffenses;
