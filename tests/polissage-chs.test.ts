import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules, hoverOffenses } from './helpers/cssRules';

const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
const rules = cssRules(css);
/** Corps des règles hors de tout bloc @ dont l'un des sélecteurs est `sel`, réunis. */
const body = (sel: string) =>
  rules
    .filter((r) => r.at.length === 0 && r.selector.split(',').map((s) => s.trim()).includes(sel))
    .map((r) => r.body)
    .join(';');
/** Corps de la règle de survol `sel`, sous `@media (hover: hover)`. */
const hover = (sel: string) =>
  rules.find((r) => r.at.some((a) => /^@media\s*\(hover:\s*hover\)/.test(a)) && r.selector.split(',').map((s) => s.trim()).includes(sel))?.body ?? null;
/** La valeur d'une déclaration, blancs resserrés. */
const decl = (text: string, prop: string) =>
  new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

describe('POL1 châssis : rail, barre de titre, barre d’état', () => {
  it('POL1.1 d’un onglet à l’autre, la lumière zénithale monte et descend au pas du filet ; la quantité suit l’encre de la cartouche', () => {
    // La lumière zénithale est une couleur déclarée : elle s'interpole, et éteinte, transparente, elle ne peint rien.
    expect(css).toMatch(/@property --nav-zenith \{\s*syntax: '<color>';\s*inherits: false;\s*initial-value: transparent;\s*\}/);
    const zenith = (text: string) => decl(text, '--nav-zenith');
    // L'onglet ouvert, au repos : exactement la lumière d'avant, mêmes couches, mêmes valeurs, une fois --nav-zenith posé.
    const lit = (sel: string) => decl(body(sel), 'background')!.replace(/var\(--nav-zenith\)/g, zenith(body(sel))!);
    expect(lit('.navItem.on::before')).toBe(
      'linear-gradient(90deg, transparent 4%, color-mix(in srgb, var(--ivory) 70%, transparent) 50%, transparent 96%) top / 100% 1px no-repeat, color-mix(in srgb, var(--ivory) 18%, var(--bg-0))',
    );
    expect(lit('.navItem.on::after')).toBe('linear-gradient(color-mix(in srgb, var(--ivory) 6%, transparent), transparent 60%), color-mix(in srgb, var(--ivory) 2%, var(--bg-0))');
    // La cartouche fermée porte le même dessin, éteint (aucune --nav-zenith posée), sur son fond d'avant ; la lumière passe au pas
    // du filet et du fond (280 ms, --ease-out).
    const image = (b: string) => decl(b, 'background')!.replace(/,\s*color-mix\(in srgb, var\(--ivory\) [\d.]+%, var\(--bg-0\)\)$/, '');
    for (const [layer, base] of [
      ['::before', '6%'],
      ['::after', '1.5%'],
    ] as const) {
      const rest = body(`.navItem${layer}`);
      expect(zenith(rest), layer).toBeNull();
      expect(image(rest), layer).toMatch(/var\(--nav-zenith\)/);
      expect(image(rest), layer).toBe(image(body(`.navItem.on${layer}`)));
      expect(decl(rest, 'background'), layer).toMatch(new RegExp(`color-mix\\(in srgb, var\\(--ivory\\) ${base.replace('.', '\\.')}, var\\(--bg-0\\)\\)$`));
      expect(decl(rest, 'transition'), layer).toBe('background-color 280ms var(--ease-out), --nav-zenith 280ms var(--ease-out)');
    }
    // Le survol ne change que la couleur du fond, et le focus garde son filet d'or : la lumière zénithale ne s'y mêle pas.
    for (const sel of ['.navItem:hover::before', '.navItem.on:hover::before', '.navItem:hover::after']) expect(hover(sel), sel).not.toMatch(/--nav-zenith|background:/);
    // La quantité suivait la cartouche d'un coup : elle prend l'horloge de l'encre de ses voisins, le nom et le numéro.
    expect(decl(body('.navQty'), 'transition')).toBe(decl(body('.navIndex'), 'transition'));
    expect(decl(body('.navItem'), 'transition')).toBe('color 240ms linear');
    expect(body('.navItem.on .navQty')).toMatch(/color: var\(--text-1\)/);
  });

  it('POL1.2 réduire, agrandir, fermer, la mise à jour et la bascule 24/12 s’éclairent au passage du pointeur, comme le zoom voisin', () => {
    // La lumière du zoom, dans la même barre : le trait à l'ivoire, le carré levé de 6 %, aux mêmes horloges.
    const zoomLight = hover('.zoomBtn:hover:not(:disabled)')!.replace(/\s+/g, ' ').trim();
    const zoomClock = decl(body('.zoomBtn'), 'transition');
    expect(zoomLight).toBe('color: var(--text-0); background-color: color-mix(in srgb, var(--ivory) 6%, transparent);');
    expect(zoomClock).toBe('color 200ms linear, background-color 260ms var(--ease-out)');
    for (const [rest, lit] of [
      ['.winControls button', '.winControls button:hover'],
      ['.updateBtn', '.updateBtn:hover:not(:disabled)'],
      ['.clockFace button', '.clockFace button:not(.on):hover'],
    ] as const) {
      expect(hover(lit)?.replace(/\s+/g, ' ').trim(), lit).toBe(zoomLight);
      expect(decl(body(rest), 'transition'), rest).toBe(zoomClock);
    }
    // Ni or ni rouge, pas même sur Fermer : aucune règle ne vise `.close`, et la face choisie de l'horloge garde son ivoire.
    expect(css).not.toMatch(/\.close\b/);
    expect(body('.clockFace button.on')).toMatch(/background: var\(--text-0\);\s*color: var\(--bg-0\)/);
    // Le point de la mise à jour est une LED : jamais animé.
    for (const sel of ['.updateDot', '.updateAvail .updateDot']) expect(body(sel), sel).not.toMatch(/transition|animation/);
    expect(body('.updateBtn')).not.toMatch(/opacity/);
    expect(hoverOffenses(css).offenders).toEqual([]);
  });
  it('POL1.1a une propriété typée d’une feuille de module porte le nom de sa pièce : @property est global, que CSS Modules ne renomme pas', () => {
    const files = execSync("git ls-files 'src/**/*.module.css'", { encoding: 'utf8' }).trim().split('\n');
    const names = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/@property (--[\w-]+)/g)].map((m) => ({ file, name: m[1]! })));
    expect(names.length).toBeGreaterThan(0);
    for (const { file, name } of names) expect(name, file).toMatch(/^--[a-z]+-[a-z-]+$/);
    expect(new Set(names.map((n) => n.name)).size).toBe(names.length);
    expect(names.map((n) => n.name)).toContain('--nav-zenith');
  });
});
