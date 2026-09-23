import { describe, expect, it } from 'vitest';
import { chartHostReady, safePaneHeight } from '../src/modules/visual/chartBox';

describe('cadre du graphique', () => {
  it('refuse un cadre vide ou non fini', () => {
    expect(chartHostReady(0, 400)).toBe(false);
    expect(chartHostReady(400, 0)).toBe(false);
    expect(chartHostReady(Number.NaN, 400)).toBe(false);
    expect(chartHostReady(800, 480)).toBe(true);
  });

  it('ne produit pas de hauteur infinie quand le chart mesure 0', () => {
    expect(safePaneHeight(70, 0, 2)).toBeNull();
    expect(safePaneHeight(70, Number.POSITIVE_INFINITY, 2)).toBeNull();
    expect(safePaneHeight(70, 400, 2)).toBe(70);
    expect(safePaneHeight(200, 100, 2)).toBe(70);
  });
});
