import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

/**
 * OROS5.47k — la fiche ouverte sur Visual (AF3) : la légende OHLC et l'étiquette de source étaient deux pièces absolues,
 * l'une à gauche, l'autre à 72 px de l'échelle des prix, sans borne ni retour à la ligne. Dès que le graphique rétrécissait
 * (fiche ouverte à 1600 × 1000, la fenêtre minimale de 1180 × 720), « Données synthétiques · démo » recouvrait le plus-bas
 * et la clôture de la barre lue. Elles partagent désormais une seule rangée qui passe à la ligne : l'une ne recouvre plus
 * l'autre, à aucune largeur.
 */
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const rules = cssRules(read('src/modules/visual/visual.module.css'));
const body = (selector: string) => rules.find((rule) => rule.selector === selector && rule.at.length === 0)?.body ?? '';

describe('OROS5.47k · la légende de Visual et l’étiquette de source ne se recouvrent pas', () => {
  it('une seule rangée posée sur le graphique, qui passe à la ligne ; ni la légende ni l’étiquette ne sont plus absolues', () => {
    const overlay = body('.overlay');
    expect(overlay).toMatch(/position: absolute;/);
    expect(overlay).toMatch(/left: 12px;/);
    expect(overlay).toMatch(/right: 72px;/);
    expect(overlay).toMatch(/display: flex;/);
    expect(overlay).toMatch(/flex-wrap: wrap;/);
    expect(overlay).toMatch(/pointer-events: none;/);
    for (const selector of ['.legend', '.stamp']) expect(body(selector), selector).not.toMatch(/position: absolute/);
    expect(body('.legend')).toMatch(/min-width: 0;/);
    expect(body('.legendMain')).toMatch(/flex-wrap: wrap;/);
    // l'étiquette garde sa largeur et sa place à droite, sous la légende quand la rangée manque de place
    expect(body('.stamp')).toMatch(/flex: none;/);
    expect(body('.stamp')).toMatch(/margin-left: auto;/);
  });

  it('la légende et l’étiquette sont les deux enfants de la rangée', () => {
    const source = read('src/modules/visual/Visual.tsx');
    const start = source.indexOf('<div className={s.overlay}>');
    expect(start).toBeGreaterThan(0);
    const legend = source.indexOf('<div className={s.legend}>', start);
    const stamp = source.indexOf('<div className={s.stamp}>', start);
    const chart = source.indexOf('<Chart ', start);
    expect(legend).toBeGreaterThan(start);
    expect(stamp).toBeGreaterThan(legend);
    expect(chart).toBeGreaterThan(stamp);
    // la rangée se ferme avant le graphique : ses deux enfants seulement
    const between = source.slice(start, chart);
    expect(between.match(/<div\b/g)?.length).toBe(between.match(/<\/div>/g)?.length);
  });
});
